// End-to-end tests of the server against the demo tree (scripts/demo.ts): the flows in docs/FLOWS.md that the API
// can show, and the safety checks. The server runs in the foreground on its own port, cache and data.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { makeDemo } from "../scripts/demo";

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

beforeAll(async () => {
  data = makeDemo(join(dir, "data"));
  before = sum(join(dir, "data"));
  srv = Bun.spawn([process.execPath, join(import.meta.dir, "..", "server.ts"), "--foreground", "--port", String(PORT)], {
    env: { ...process.env, CLAUDE_PROJECTS_DIR: data.claude, CODEX_SESSIONS_DIR: data.codex, FLOWSCOPE_CACHE: join(dir, "cache") },
    stdout: "ignore", stderr: "inherit",
  });
  for (let i = 0; i < 100; i++) { try { if ((await get("/api/pid")).ok) return; } catch {} await Bun.sleep(100); }
  throw new Error("server did not start");
});
afterAll(() => { srv?.kill(); rmSync(dir, { recursive: true, force: true }); });

test("lists every kind of run, newest activity first", async () => {
  const rs = await runs();
  expect(rs.map((r) => r.kind).sort()).toEqual(["agents", "cli", "cli", "workflow", "workflow"]);
  // Phases come from the script while a workflow has no final record, written with quoted keys or without.
  expect((await detail(rs.find((r) => r.name === "money-migration"))).phases).toHaveLength(3);
  for (let i = 1; i < rs.length; i++) expect(rs[i - 1].lastActivity).toBeGreaterThanOrEqual(rs[i].lastActivity);
});

// Before any test appends to a transcript: open every run and every agent, then compare the tree byte for byte.
test("never changes the files it reads", async () => {
  for (const r of await runs()) for (const a of (await detail(r)).agents) await get(`/api/agent?${q(r)}&a=${a.agentId}`);
  expect(sum(join(dir, "data"))).toBe(before);
});

test("answers an unchanged run list with 304", async () => {
  const r = await get("/api/runs");
  const again = await get("/api/runs", { headers: { "if-none-match": r.headers.get("etag")! } });
  expect(again.status).toBe(304);
});

test("a finished workflow: status, phases, results, log, script, resume", async () => {
  const r = await byName("checkout-review");
  expect(r.status).toBe("completed");
  expect([r.agents, r.agentsDone]).toEqual([7, 7]);
  const d = await detail(r);
  expect(d.phases.map((p: any) => p.title)).toEqual(["Survey", "Review", "Verify"]);
  expect(d.agents.every((a: any) => a.state === "done" && a.result.includes("Finding"))).toBe(true);
  expect(d.agents.find((a: any) => a.attempt === 2)).toBeTruthy();
  expect(d.logs).toHaveLength(3);
  expect(d.script).toContain("checkout-review");
  expect(d.resume).toBe(`cd /home/dev/acme-shop && claude --resume ${r.session}`);
});

test("a live workflow: running, one agent waiting on a tool, phases from the script", async () => {
  const r = await byName("money-migration");
  expect(r.status).toBe("running");
  const d = await detail(r);
  expect(d.phases.map((p: any) => p.title)).toEqual(["Plan", "Migrate", "Test"]);
  const states = Object.fromEntries(d.agents.map((a: any) => [a.label, a.state]));
  expect(states["plan the migration"]).toBe("done");
  expect(states["packages/search"]).toBe("running");
  expect(d.agents.find((a: any) => a.label === "packages/inventory").waiting.tool).toBe("Bash");
});

test("plain subagents: handback, text answer, working, usage limit", async () => {
  const r = await byName("Payments clean-up");
  expect(r.kind).toBe("agents");
  const d = await detail(r);
  const a = Object.fromEntries(d.agents.map((x: any) => [x.label, x]));
  expect(a["research call sites of legacyTotal"].state).toBe("done");
  expect(a["research call sites of legacyTotal"].result).toContain("legacyTotal");
  expect(a["summarise the payments RFC"].result).toContain("integer pence");
  expect(a["draft the release notes"].state).toBe("running");
  // An agent that ended on a usage limit did not answer: it is stopped, with the limit flagged.
  expect(a["audit dependencies"].state).toBe("stopped");
  expect(a["audit dependencies"].apiError.kind).toBe("rate_limit");
});

test("a resumed subagent runs again", async () => {
  const r = await byName("Payments clean-up");
  const id = (await detail(r)).agents.find((x: any) => x.label === "summarise the payments RFC").agentId;
  appendFileSync(join(data.claude, r.projectKey, r.session, "subagents", `agent-${id}.jsonl`),
    JSON.stringify({ type: "user", timestamp: new Date().toISOString(), message: { role: "user", content: "Add a sixth bullet on refunds." } }) + "\n");
  const again = (await detail(r)).agents.find((x: any) => x.agentId === id);
  expect(again.state).toBe("running");
  expect(again.result).toBeUndefined();
});

test("40 claude -p runs are one batch, named by their role, with two one-word answers", async () => {
  const r = (await runs()).find((x) => x.kind === "cli" && x.tool === "claude");
  expect(r.name).toBe("Claude ×40: careful copy editor for an online shop");
  const d = await detail(r);
  expect(d.agents).toHaveLength(40);
  expect(d.agents[0].label).toBe("Product page 1");
  expect(d.agents.filter((a: any) => a.result === "OK")).toHaveLength(2);
  expect(d.agents[0].resume).toContain("claude --resume");
});

test("codex runs: done by task_complete, no share of the week", async () => {
  const r = (await runs()).find((x) => x.kind === "cli" && x.tool === "codex");
  expect(r.weekShare).toBeNull();
  const d = await detail(r);
  const states = d.agents.map((a: any) => a.state).sort();
  expect(states).toEqual(["done", "running"]);
  expect(d.agents.find((a: any) => a.state === "done").result).toContain("reversible");
});

test("a transcript comes back as events", async () => {
  const r = await byName("checkout-review");
  const a = (await detail(r)).agents[0];
  const ev = await (await get(`/api/agent?${q(r)}&a=${a.agentId}`)).json();
  expect(ev.map((e: any) => e.kind)).toEqual(["prompt", "text", "tool", "output", "tool", "output", "text"]);
  expect(ev.find((e: any) => e.kind === "tool").name).toBe("Read");
});

test("search finds text inside transcripts", async () => {
  let res: any;
  for (let i = 0; i < 50; i++) { res = await (await get("/api/search?q=legacyTotal")).json(); if (!res.indexing) break; await Bun.sleep(100); }
  expect(res.hits.length).toBeGreaterThan(0);
  expect(res.hits[0].snippet.toLowerCase()).toContain("legacytotal");
});

test("only image types it knows go into the page", async () => {
  const r = await byName("checkout-review");
  const a = (await detail(r)).agents[0];
  const f = join(data.claude, r.projectKey, r.session, "subagents", "workflows", r.runId, `agent-${a.agentId}.jsonl`);
  const img = (media_type: string) => ({ type: "image", source: { type: "base64", media_type, data: "iVBORw0KGgo=" } });
  appendFileSync(f, JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x",
    content: [img("image/png"), img('image/png" onerror="alert(1)'), img("text/html")] }] } }) + "\n");
  const ev = await (await get(`/api/agent?${q(r)}&a=${a.agentId}`)).json();
  expect(ev.at(-1).images).toEqual(["data:image/png;base64,iVBORw0KGgo="]);
});

test("refuses other hosts (DNS rebinding)", async () => {
  expect((await get("/api/runs", { headers: { host: `evil.example:${PORT}` } })).status).toBe(403);
  expect((await get("/api/runs", { headers: { host: `localhost:${PORT}` } })).status).toBe(200);
});

test("refuses names that leave their folder", async () => {
  expect((await get("/api/run?p=..&s=..&r=x")).status).toBe(400);
  expect((await get("/api/run?p=a%2Fb&s=x&r=y")).status).toBe(400);
  expect((await get("/api/agent?p=a&s=b&r=agents&a=..")).status).toBe(400);
});

test("serves the page with a strict content policy", async () => {
  const r = await get("/");
  const csp = r.headers.get("content-security-policy")!;
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("img-src 'self' data:");
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  const html = await r.text();
  expect([...html.matchAll(/<script src=/g)].length).toBe([...html.matchAll(/<script src="[^"]+" integrity="sha384-/g)].length);
});

test("marks its pid answer, so stop never kills another program", async () => {
  const r = await get("/api/pid");
  expect(r.headers.get("x-flowscope")).toBe("1");
  expect(Number(await r.text())).toBe(srv.pid);
});

test("keeps its cache private", () => {
  expect(statSync(join(dir, "cache")).mode & 0o777).toBe(0o700);
});
