// End-to-end tests of the server against the demo tree (scripts/demo.ts) and fixtures derived from it. Each test's
// name starts with the ids of the checks (docs/FLOWS.md) and rules (docs/RULES.md) it checks; `bun run trace` reads
// them. The server runs in the foreground on its own port, cache and data; nothing here touches the real ~/.claude.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, appendFileSync, symlinkSync, utimesSync, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { makeDemo } from "../scripts/demo";
import { put, jl, headless } from "./fixtures";

const SERVER = join(import.meta.dir, "..", "server.ts");
const PORT = 4700 + Math.floor(Math.random() * 40);
const base = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "flowscope-test-"));
let srv: ReturnType<typeof Bun.spawn>, data: { claude: string; codex: string }, before = "";

// A checksum of every file in the tree, to show the server changed nothing.
const sum = (d: string): string => readdirSync(d).sort().map((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? sum(p) : createHash("sha1").update(n).update(readFileSync(p)).digest("hex");
}).join("");
const get = (path: string, init?: RequestInit) => fetch(base + path, init);
const runs = async () => (await (await get("/api/runs")).json()) as any[];
const q = (r: any) => `p=${encodeURIComponent(r.projectKey)}&s=${r.session}&r=${r.runId}`;
const detail = async (r: any) => (await get(`/api/run?${q(r)}`)).json() as Promise<any>;
const byName = async (name: string) => (await runs()).find((r) => r.name.startsWith(name));
const env = (cache: string) => ({ ...process.env, CLAUDE_PROJECTS_DIR: data.claude, CODEX_SESSIONS_DIR: data.codex, FLOWSCOPE_CACHE: cache });
beforeAll(async () => {
  data = makeDemo(join(dir, "data"));
  before = sum(join(dir, "data"));
  srv = Bun.spawn([process.execPath, SERVER, "--foreground", "--port", String(PORT)], { env: env(join(dir, "cache")), stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 100; i++) { try { if ((await get("/api/pid")).ok) return; } catch {} await Bun.sleep(100); }
  throw new Error("server did not start");
});
afterAll(() => { srv?.kill(); rmSync(dir, { recursive: true, force: true }); });

test("F-13.1 F-13.2 lists every kind of run, newest activity first", async () => {
  const rs = await runs();
  expect(rs.map((r) => r.kind).sort()).toEqual(["agents", "cli", "cli", "workflow", "workflow"]);
  // Phases come from the script while a workflow has no final record, written with quoted keys or without.
  expect((await detail(rs.find((r) => r.name === "money-migration"))).phases).toHaveLength(3);
  for (let i = 1; i < rs.length; i++) expect(rs[i - 1].lastActivity).toBeGreaterThanOrEqual(rs[i].lastActivity);
});

// Before any test appends to a transcript: open every run and every agent, then compare the tree byte for byte.
test("F-12.4 never changes the files it reads", async () => {
  for (const r of await runs()) for (const a of (await detail(r)).agents) await get(`/api/agent?${q(r)}&a=${a.agentId}`);
  expect(sum(join(dir, "data"))).toBe(before);
});

test("F-13.3 answers an unchanged run list with 304", async () => {
  const r = await get("/api/runs");
  const again = await get("/api/runs", { headers: { "if-none-match": r.headers.get("etag")! } });
  expect(again.status).toBe(304);
});

test("F-4.1 F-4.4 F-4.5 R-S12 a finished workflow: status, phases, results, log, script, resume", async () => {
  const r = await byName("checkout-review");
  expect(r.status).toBe("completed");
  expect([r.agents, r.agentsDone]).toEqual([7, 7]);
  const d = await detail(r);
  expect(d.phases.map((p: any) => p.title)).toEqual(["Survey", "Review", "Verify"]);
  expect(d.agents.every((a: any) => a.state === "done" && a.result.includes("Finding"))).toBe(true);
  expect(d.agents.find((a: any) => a.attempt === 2)).toBeTruthy();
  expect(d.logs).toHaveLength(3);
  expect(d.script).toContain("checkout-review");
  // A plain folder and id are left as they are (R-S12).
  expect(d.resume).toBe(`cd /home/dev/acme-shop && claude --resume ${r.session}`);
});

test("F-4.6 F-4.7 a live workflow: running, one agent waiting on a tool, phases from the script", async () => {
  const r = await byName("money-migration");
  expect(r.status).toBe("running");
  const d = await detail(r);
  expect(d.phases.map((p: any) => p.title)).toEqual(["Plan", "Migrate", "Test"]);
  const states = Object.fromEntries(d.agents.map((a: any) => [a.label, a.state]));
  expect(states["plan the migration"]).toBe("done");
  expect(states["packages/search"]).toBe("running");
  expect(d.agents.find((a: any) => a.label === "packages/inventory").waiting.tool).toBe("Bash");
});

test("F-5.1 F-5.2 F-5.3 plain subagents: handback, text answer, working, usage limit", async () => {
  const r = await byName("Payments clean-up");
  expect(r.kind).toBe("agents");
  const d = await detail(r);
  expect(d.phases.map((p: any) => p.title)).toEqual(["Running", "Done", "Stopped"]);
  const a = Object.fromEntries(d.agents.map((x: any) => [x.label, x]));
  expect(a["research call sites of legacyTotal"].state).toBe("done");
  expect(a["research call sites of legacyTotal"].result).toContain("legacyTotal");
  expect(a["summarise the payments RFC"].result).toContain("integer pence");
  expect(a["draft the release notes"].state).toBe("running");
  // An agent that ended on a usage limit did not answer: it is stopped, with the limit flagged.
  expect(a["audit dependencies"].state).toBe("stopped");
  expect(a["audit dependencies"].apiError.kind).toBe("rate_limit");
});

test("F-5.4 R-T2 a resumed subagent runs again", async () => {
  const r = await byName("Payments clean-up");
  const id = (await detail(r)).agents.find((x: any) => x.label === "summarise the payments RFC").agentId;
  appendFileSync(join(data.claude, r.projectKey, r.session, "subagents", `agent-${id}.jsonl`),
    JSON.stringify({ type: "user", timestamp: new Date().toISOString(), message: { role: "user", content: "Add a sixth bullet on refunds." } }) + "\n");
  const again = (await detail(r)).agents.find((x: any) => x.agentId === id);
  expect(again.state).toBe("running");
  expect(again.result).toBeUndefined();
});

test("F-7.1 F-7.3 F-7.6 R-T7 40 claude -p runs are one batch, named by their role, with two one-word answers", async () => {
  const r = (await runs()).find((x) => x.kind === "cli" && x.tool === "claude");
  expect(r.name).toBe("Claude ×40: careful copy editor for an online shop");
  const d = await detail(r);
  expect(d.agents).toHaveLength(40);
  expect(d.agents[0].label).toBe("Product page 1");
  expect(d.agents.filter((a: any) => a.result === "OK")).toHaveLength(2);
  expect(d.agents[0].resume).toBe(`cd /home/dev/acme-shop && claude --resume ${d.agents[0].agentId}`);
});

test("F-7.7 codex runs: done by task_complete, no share of the week", async () => {
  const r = (await runs()).find((x) => x.kind === "cli" && x.tool === "codex");
  expect(r.weekShare).toBeNull();
  const d = await detail(r);
  const states = d.agents.map((a: any) => a.state).sort();
  expect(states).toEqual(["done", "running"]);
  expect(d.agents.find((a: any) => a.state === "done").result).toContain("reversible");
});

test("F-13.4 a transcript comes back as events", async () => {
  const r = await byName("checkout-review");
  const a = (await detail(r)).agents[0];
  const ev = await (await get(`/api/agent?${q(r)}&a=${a.agentId}`)).json();
  expect(ev.map((e: any) => e.kind)).toEqual(["prompt", "text", "tool", "output", "tool", "output", "text"]);
  expect(ev.find((e: any) => e.kind === "tool").name).toBe("Read");
});

test("F-13.5 R-L4 search finds text inside transcripts", async () => {
  let res: any;
  for (let i = 0; i < 50; i++) { res = await (await get("/api/search?q=legacyTotal")).json(); if (!res.indexing) break; await Bun.sleep(100); }
  expect(res.hits.length).toBeGreaterThan(0);
  expect(res.hits.length).toBeLessThanOrEqual(200);
  expect(res.hits[0].snippet.toLowerCase()).toContain("legacytotal");
  for (let i = 1; i < res.hits.length; i++) expect(res.hits[i - 1].at).toBeGreaterThanOrEqual(res.hits[i].at);
});

test("F-13.6 R-L3 search refuses a query over 200 characters and ignores one under 3", async () => {
  expect(await (await get("/api/search?q=ab")).json()).toEqual({ indexing: null, hits: [] });
  expect((await get(`/api/search?q=${"a".repeat(200)}`)).status).toBe(200);
  const long = await get(`/api/search?q=${"a".repeat(201)}`);
  expect(long.status).toBe(400);
  expect(await long.text()).toBe("query too long");
});

test("F-12.5 R-S10 only image types it knows go into the page", async () => {
  const r = await byName("checkout-review");
  const a = (await detail(r)).agents[0];
  const f = join(data.claude, r.projectKey, r.session, "subagents", "workflows", r.runId, `agent-${a.agentId}.jsonl`);
  const img = (media_type: string) => ({ type: "image", source: { type: "base64", media_type, data: "iVBORw0KGgo=" } });
  appendFileSync(f, JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x",
    content: [img("image/png"), img('image/png" onerror="alert(1)'), img("text/html")] }] } }) + "\n");
  const ev = await (await get(`/api/agent?${q(r)}&a=${a.agentId}`)).json();
  expect(ev.at(-1).images).toEqual(["data:image/png;base64,iVBORw0KGgo="]);
});

test("F-12.3 R-S2 refuses other hosts (DNS rebinding)", async () => {
  const bad = await get("/api/runs", { headers: { host: `evil.example:${PORT}` } });
  expect(bad.status).toBe(403);
  expect(await bad.text()).toBe("forbidden");
  expect((await get("/", { headers: { host: `evil.example:${PORT}` } })).status).toBe(403);
  expect((await get("/api/runs", { headers: { host: `localhost:${PORT}` } })).status).toBe(200);
});

test("F-12.2 R-S4 refuses names that leave their folder", async () => {
  expect((await get("/api/run?p=..&s=..&r=x")).status).toBe(400);
  expect((await get("/api/run?p=a%2Fb&s=x&r=y")).status).toBe(400);
  expect((await get("/api/run?p=a&s=b")).status).toBe(400);
  expect((await get("/api/agent?p=a&s=b&r=agents&a=..")).status).toBe(400);
  expect(await (await get("/api/agent?p=a&s=b&r=agents&a=.x")).text()).toBe("bad request");
});

test("F-13.7 unknown batches and paths are 404", async () => {
  expect((await get("/api/run?p=a&s=claude-nope&r=cli")).status).toBe(404);
  for (const p of ["/nope", "/index.html", "/vendor/", "/vendor/fonts/OFL.txt", "/api/nope", "/../server.ts"]) expect((await get(p)).status).toBe(404);
});

test("F-13.8 R-S6 API answers are neither cached nor sniffed", async () => {
  for (const p of ["/api/format", "/api/search?q=abc", "/api/run?p=..&s=x&r=y", "/api/pid", "/nope"]) {
    const r = await get(p);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
  }
  const list = await get("/api/runs");
  expect(list.headers.get("x-content-type-options")).toBe("nosniff");
  expect(list.headers.get("cache-control")).toBe("no-cache");
});

test("F-13.9 safe names that match nothing are an empty run, not an error", async () => {
  const r = await get("/api/run?p=nobody&s=nothing&r=wf_none");
  expect(r.status).toBe(200);
  expect((await r.json()).agents).toEqual([]);
  expect(await (await get("/api/agent?p=nobody&s=nothing&r=agents&a=none")).json()).toEqual([]);
});

const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

test("F-12.6 R-S3 serves the page with the exact content policy and no inline script", async () => {
  const r = await get("/");
  expect(r.headers.get("content-security-policy")).toBe(CSP);
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  const html = await r.text();
  // Every <script> loads a file; none carries code of its own, and no element has an on…= handler.
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  expect(scripts.length).toBeGreaterThan(0);
  for (const [tag, body] of scripts) { expect(tag).toContain(' src="/'); expect(body.trim()).toBe(""); }
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  const app = await get("/app.js");
  expect(app.headers.get("content-security-policy")).toBe(CSP);
  const js = await app.text();
  // The script writes no inline handlers into the markup it draws.
  expect(js).not.toMatch(/\son(click|input|change|error|load|mouse\w*|key\w*)=/);
  expect(js).toContain('data-act="agent"');
});

test("F-12.7 R-S9 serves its libraries and fonts itself, matching their integrity hashes", async () => {
  const html = await (await get("/")).text();
  expect(html).not.toMatch(/https?:\/\//);
  const linked = [...html.matchAll(/(?:src|href)="(\/[^"]*)"(?: integrity="([^"]+)")?/g)];
  expect(linked.length).toBeGreaterThanOrEqual(8);
  for (const [, path, sri] of linked) {
    const r = await get(path);
    expect(r.status).toBe(200);
    const body = new Uint8Array(await r.arrayBuffer());
    if (path.startsWith("/vendor/")) expect(sri).toBe(`sha384-${createHash("sha384").update(body).digest("base64")}`);
    if (/\.(css|js)$/.test(path)) expect(new TextDecoder().decode(body)).not.toMatch(/(?:url\(|@import\s)["']?https?:\/\//);
  }
  const css = await (await get("/vendor/fonts.css")).text();
  for (const [, f] of css.matchAll(/url\(([^)]+)\)/g)) expect((await get(`/vendor/${f}`)).headers.get("content-type")).toBe("font/woff2");
});

test("F-1.1 R-S11 marks its pid answer, so stop never kills another program", async () => {
  const r = await get("/api/pid");
  expect(r.headers.get("x-flowscope")).toBe("1");
  expect(Number(await r.text())).toBe(srv.pid);
});

test("F-1.5 R-S7 keeps its cache private", () => {
  expect(statSync(join(dir, "cache")).mode & 0o777).toBe(0o700);
  expect(readdirSync(join(dir, "cache"))).toContain("cache.db");
  for (const f of readdirSync(join(dir, "cache"))) expect(statSync(join(dir, "cache", f)).mode & 0o777).toBe(0o600);
});

test("F-1.6 help names Codex, CLI runs and every environment variable", () => {
  const out = Bun.spawnSync([process.execPath, SERVER, "--help"]).stdout.toString();
  for (const s of ["claude -p", "codex exec", "FLOWSCOPE_PORT", "CLAUDE_PROJECTS_DIR", "CODEX_SESSIONS_DIR", "FLOWSCOPE_CACHE", "4747", "--foreground", "--port", "--open", "stop"])
    expect(out).toContain(s);
});

test("F-1.2 F-1.3 R-S7 starts in the background once, and stop stops it", async () => {
  const port = String(PORT + 100), cache = join(dir, "cache-bg");
  const run = (...a: string[]) => Bun.spawnSync([process.execPath, SERVER, ...a, "--port", port], { env: env(cache) });
  const first = run();
  expect(first.exitCode).toBe(0);
  expect(first.stdout.toString()).toContain(`Flowscope on http://127.0.0.1:${port}`);
  const pid = Number(await (await fetch(`http://127.0.0.1:${port}/api/pid`)).text());
  expect(run().stdout.toString()).toContain(`already running on http://127.0.0.1:${port} (pid ${pid})`);
  expect(statSync(join(cache, "flowscope.log")).mode & 0o777).toBe(0o600);
  expect(run("stop").stdout.toString()).toContain(`stopped (pid ${pid})`);
  let up = true;
  for (let i = 0; i < 30 && up; i++) { try { await fetch(`http://127.0.0.1:${port}/api/pid`); await Bun.sleep(100); } catch { up = false; } }
  expect(up).toBe(false);
}, 20_000);

test("F-1.4 R-S11 stop leaves alone another program on the port", async () => {
  const other = Bun.serve({ port: PORT + 200, hostname: "127.0.0.1", fetch: () => new Response(String(process.pid)) });
  try {
    const out = Bun.spawnSync([process.execPath, SERVER, "stop", "--port", String(PORT + 200)], { env: env(join(dir, "cache-other")) });
    expect(out.stdout.toString()).toContain("not running");
    expect((await fetch(`http://127.0.0.1:${PORT + 200}/`)).ok).toBe(true);
  } finally { other.stop(true); }
});

// From here on the tests add hostile and broken input (X7–X9) to the tree.

test("F-12.8 R-S4 a CLI run whose id is not a safe name is left out", async () => {
  const evil = `x" onmouseover="alert(1)`, cwd = "/home/dev/evil";
  put(join(data.claude, "-home-dev-evil", "evil.jsonl"), headless(evil, cwd, "EVIL-CLAUDE"));
  put(join(data.claude, "-home-dev-evil", "fine.jsonl"), headless("fine-run", cwd, "FINE-CLAUDE"));
  put(join(data.codex, "evil", "rollout-evil.jsonl"), jl([{ type: "session_meta", timestamp: new Date().toISOString(),
    payload: { id: `y'><img src=x onerror=alert(2)>`, originator: "codex_exec", cwd, timestamp: new Date().toISOString() } }]));
  await Bun.sleep(1100); // the batch list is reused for R-T6
  const all = await runs(), text = JSON.stringify(all);
  const r = all.find((x) => x.kind === "cli" && x.project.includes("evil"));
  expect(r.agents).toBe(1);
  const d = await detail(r);
  expect(d.agents.map((a: any) => a.agentId)).toEqual(["fine-run"]);
  for (const s of [text, JSON.stringify(d)]) { expect(s).not.toContain("onmouseover"); expect(s).not.toContain("onerror"); }
});

test("F-12.9 R-S8 a symbolic link under a root is not followed", async () => {
  const outside = join(dir, "outside");
  put(join(outside, "secret.jsonl"), headless("linked-secret", "/home/dev/linked", "SECRET"));
  put(join(outside, "proj", "other.jsonl"), headless("linked-dir", "/home/dev/linked", "SECRET"));
  symlinkSync(join(outside, "secret.jsonl"), join(data.claude, "-home-dev-acme-shop", "linked.jsonl"));
  symlinkSync(join(outside, "proj"), join(data.claude, "-home-dev-linkedproj"));
  symlinkSync(outside, join(data.codex, "linked"));
  await Bun.sleep(1100);
  expect(JSON.stringify(await runs())).not.toContain("linked");
});

test("F-12.10 R-L1 a line over 64 MB is skipped and the rest of the file is read", async () => {
  const f = join(data.claude, "-home-dev-big", "big.jsonl");
  put(f, headless("big-run", "/home/dev/big", "BEFORE"));
  // A valid 72 MB line holding a tool call: read, it would count as one tool call.
  const fd = openSync(f, "a"), chunk = Buffer.alloc(8 << 20, 120);
  writeSync(fd, `{"type":"assistant","message":{"id":"m-long","role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"`);
  for (let i = 0; i < 9; i++) writeSync(fd, chunk);
  writeSync(fd, `"}}]}}` + "\n" + JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { id: "m-after", role: "assistant", content: [{ type: "text", text: "AFTER-LONG-LINE" }] } }) + "\n");
  closeSync(fd);
  await Bun.sleep(1100);
  const r = (await runs()).find((x) => x.kind === "cli" && x.project.includes("big"));
  const a = (await detail(r)).agents[0];
  expect(a.now).toBe("AFTER-LONG-LINE");
  expect(a.tools).toBe(0);
}, 30_000);

test("F-12.11 R-S5 an unexpected error answers a plain 500", async () => {
  const project = "-home-dev-acme-shop", session = "broken-session", runId = "wf_broken";
  put(join(data.claude, project, session, "subagents", "workflows", runId, "journal.jsonl"), jl([{ type: "launched" }]));
  put(join(data.claude, project, session, "workflows", `${runId}.json`), JSON.stringify({ status: "completed", workflowProgress: "not a list", phases: [] }));
  const r = await get(`/api/run?p=${project}&s=${session}&r=${runId}`);
  expect(r.status).toBe(500);
  expect(await r.text()).toBe("internal error");
  expect(r.headers.get("cache-control")).toBe("no-store");
  // The server is still serving.
  expect((await get("/api/pid")).ok).toBe(true);
});

test("F-11.1 the format endpoint names each surprise once, with its file", async () => {
  const r = await byName("money-migration");
  const journal = join(data.claude, r.projectKey, r.session, "subagents", "workflows", r.runId, "journal.jsonl");
  appendFileSync(journal, JSON.stringify({ type: "paused" }) + "\n" + JSON.stringify({ type: "paused" }) + "\n");
  await runs();
  const issues = await (await get("/api/format")).json();
  const mine = issues.filter((i: any) => i.what.includes('"paused"'));
  expect(mine).toHaveLength(1);
  expect(mine[0].file).toBe(journal);
});

test("F-4.10 R-T1 a workflow quiet past the live window is stopped, and so are its unfinished agents", async () => {
  const r = await byName("money-migration");
  const wf = join(data.claude, r.projectKey, r.session, "subagents", "workflows", r.runId), old = new Date(Date.now() - 20 * 60_000);
  for (const f of readdirSync(wf)) utimesSync(join(wf, f), old, old);
  const again = await byName("money-migration");
  expect(again.status).toBe("stopped");
  const states = Object.fromEntries((await detail(again)).agents.map((a: any) => [a.label, a.state]));
  expect(states["plan the migration"]).toBe("done");
  expect(states["packages/search"]).toBe("stopped");
  expect(states["packages/inventory"]).toBe("stopped");
});
