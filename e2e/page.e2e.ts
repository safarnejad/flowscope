// Browser end-to-end tests: the page, driven in Chromium, against the demo tree (scripts/demo.ts) and the extra
// fixtures in test/fixtures.ts. Each test's name starts with the ids of the checks (docs/FLOWS.md) and rules
// (docs/RULES.md) it checks; `bun run trace` reads them. Every test also fails on a console error, an uncaught
// exception, a Content Security Policy violation, a dialog, or a request to any host but the server (R-S3).
// Time-based states come from file times set by the fixtures, not from waiting.
import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, utimesSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeDemo } from "../scripts/demo";
import { makeExtra } from "../test/fixtures";

const ROOT = join(import.meta.dirname, "..");
const PORT = 4760 + Math.floor(Math.random() * 30);
const BASE = `http://127.0.0.1:${PORT}`;
// Screenshots for looking at by hand: FLOWSCOPE_SHOTS=<dir> bun run e2e
const SHOTS = process.env.FLOWSCOPE_SHOTS;
const MIN = 60_000;
let dir = "", data: { claude: string; codex: string }, srv: ChildProcess | undefined;

// What each test watches for, checked when it ends.
type Guard = { errors: string[]; csp: string[]; foreign: string[]; dialogs: string[] };
const test = base.extend<{ guard: Guard }>({
  guard: [async ({ page }, use) => {
    const g: Guard = { errors: [], csp: [], foreign: [], dialogs: [] };
    page.on("console", (m) => { if (m.type() === "error") g.errors.push(m.text()); });
    page.on("pageerror", (e) => g.errors.push(String(e)));
    page.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE + "/") && !u.startsWith("data:")) g.foreign.push(u); });
    page.on("dialog", (d) => { g.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    await page.exposeFunction("__cspViolation", (s: string) => g.csp.push(s));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation",
      (e) => (window as any).__cspViolation(`${e.violatedDirective} ${e.blockedURI}`)));
    await use(g);
    expect(g.csp, "CSP violations").toEqual([]);
    expect(g.errors, "console errors").toEqual([]);
    expect(g.foreign, "requests to other hosts").toEqual([]);
    expect(g.dialogs, "dialogs").toEqual([]);
  }, { auto: true }],
});

const api = async (path: string) => (await fetch(BASE + path)).json();
const runs = async () => (await api("/api/runs")) as any[];
const byName = async (name: string) => (await runs()).find((r) => r.name.startsWith(name));
const hashOf = (r: any) => `${r.session}/${r.runId}`;
// Opens a run by its link and waits until it is drawn.
async function open(page: Page, name: string, agent?: string) {
  const r = await byName(name);
  await page.goto(`${BASE}/#${hashOf(r)}${agent ? `/${agent}` : ""}`);
  await expect(page.locator("#main header h2")).toContainText(r.name);
  return r;
}
async function home(page: Page) { await page.goto(BASE + "/"); await expect(page.locator("#runs .run").first()).toBeVisible(); }
// Taken once the drawer has finished sliding in.
const shot = async (page: Page, name: string) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true });
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== "running"));
  await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const clip = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
// Each sidebar section's run names, by section title.
const sections = (page: Page) => page.locator("#runs").evaluate((el) => {
  const out: Record<string, string[]> = {}; let cur = "";
  for (const c of el.children) {
    if (c.classList.contains("sec")) out[cur = c.textContent!.trim()] = [];
    else if (c.classList.contains("run")) out[cur].push(c.querySelector("b")!.textContent!.trim());
  }
  return out;
});
// Ages every file of a run's workflow folder, as if it had been quiet that long.
const age = (d: string, ms: number) => { const t = new Date(Date.now() - ms); for (const f of readdirSync(d)) utimesSync(join(d, f), t, t); };
// Browser notifications, recorded instead of shown; the permission the "browser" answers is set per test.
const fakeNotifications = (page: Page, answer: "granted" | "denied") => page.addInitScript((answer) => {
  const w = window as any; w.__notes = [];
  // A browser keeps a granted permission across reloads; so does this one, in sessionStorage.
  w.Notification = class { title: string; body: string; onclick: any = null;
    static get permission() { return sessionStorage.getItem("perm") ?? "default"; }
    static async requestPermission() { sessionStorage.setItem("perm", answer); return answer; }
    constructor(title: string, o: any) { this.title = title; this.body = o?.body; w.__notes.push(this); } };
}, answer);
const notes = (page: Page) => page.evaluate(() => (window as any).__notes.map((n: any) => `${n.title}: ${n.body}`) as string[]);

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowscope-e2e-"));
  data = makeDemo(join(dir, "data"));
  makeExtra(data.claude);
  srv = spawn("bun", [join(ROOT, "server.ts"), "--foreground", "--port", String(PORT)], { stdio: "ignore",
    env: { ...process.env, CLAUDE_PROJECTS_DIR: data.claude, CODEX_SESSIONS_DIR: data.codex, FLOWSCOPE_CACHE: join(dir, "cache") } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + "/api/pid")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("server did not start");
});
test.afterAll(() => { srv?.kill(); rmSync(dir, { recursive: true, force: true }); });

test("F-2.1 F-2.2 R-L23 R-K3 home: running, recent and history in the sidebar, Now with today's counts", async ({ page }) => {
  await home(page);
  const s = await sections(page);
  expect(s["Running"]).toEqual(expect.arrayContaining(["money-migration", "Payments clean-up"]));
  expect(s["Recent"].length).toBe(3);
  const all = await runs(), finished = all.filter((r) => r.status !== "running");
  await expect(page.locator("#runs button.more")).toHaveText(`History (${finished.length - 3}) ›`);
  await page.locator("#runs button.more").click();
  await expect(page.locator("#runs .run")).toHaveCount(all.length);
  const live = all.filter((r) => r.status === "running").length, today = all.filter((r) => new Date(r.lastActivity).toDateString() === new Date().toDateString());
  const tokens = today.reduce((n, r) => n + r.usage.input + r.usage.cacheWrite + r.usage.output, 0);
  await expect(page.locator("#main header h2")).toHaveText("Now");
  const line = await page.locator("#main header .small").textContent();
  expect(line).toMatch(new RegExp(`^${live} running · ${today.length} active today · \\S+ tokens in today's runs$`));
  expect(tokens).toBeGreaterThan(0);
  await shot(page, "home");
});

test("F-2.3 R-T21 a running run quiet over 10 minutes is under Needs a look", async ({ page }) => {
  await home(page);
  const look = page.locator(".hgrid").first();
  await expect(page.locator("h3.hh").first()).toHaveText("Needs a look");
  await expect(look.locator(".hcard", { hasText: "Long build" })).toContainText(/no activity for 1[01]m/);
  await expect(page.locator("#runs .run", { hasText: "Long build" })).toContainText("quiet");
});

test("F-2.4 clicking Flowscope returns home and clears the hash", async ({ page }) => {
  await open(page, "checkout-review");
  await page.locator(".brand").click();
  await expect(page.locator("#main header h2")).toHaveText("Now");
  expect(new URL(page.url()).hash).toBe("");
});

test("F-3.1 R-U7 the kind filter shows only that kind and is kept across a reload", async ({ page }) => {
  await home(page);
  await page.locator("#runs button.more").click();
  for (const [label, kinds] of [["Workflows", ["workflow"]], ["Agents", ["agents"]], ["CLI", ["claude", "codex"]]] as const) {
    await page.locator("#filters button", { hasText: label }).click();
    const shown = await page.locator("#runs .run .kind").allTextContents();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((k) => (kinds as readonly string[]).includes(k))).toBe(true);
  }
  await page.locator("#filters button", { hasText: "Workflows" }).click();
  await page.reload();
  await expect(page.locator("#filters button.on")).toHaveText("Workflows");
  await expect(page.locator("#runs .run").first()).toBeVisible();
  expect(new Set(await page.locator("#runs .run .kind").allTextContents())).toEqual(new Set(["workflow"]));
});

test("F-3.2 F-3.3 F-3.4 search: names by day, then hits inside transcripts that open the agent", async ({ page }) => {
  await home(page);
  await page.keyboard.press("/");
  await expect(page.locator("#search")).toBeFocused();
  await page.keyboard.type("money");
  await expect(page.locator("#runs .sec").first()).toHaveText("Today");
  await expect(page.locator("#runs .run b")).toHaveText(["money-migration"]);
  await page.locator("#search").fill("pennies");
  await expect(page.locator("#runs")).toContainText("No run's name matches");
  // The index is read on the first search; until then the list says so, then shows the hits.
  await expect(page.locator("#hits .hit").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#hits .sec")).toContainText("In transcripts");
  await expect(page.locator("#hits .hit mark").first()).toHaveText(/pennies/i);
  const hit = page.locator("#hits .hit", { hasText: "checkout-review" }).first();
  const agent = await hit.getAttribute("data-agent");
  await hit.click();
  await expect(page.locator("#drawer")).toHaveClass(/open/);
  await expect(page.locator(".dtabs button.on")).toContainText("Transcript");
  expect(page.url()).toContain(`/${agent}`);
});

test("F-4.1 F-4.2 F-4.3 F-4.4 a finished workflow's page: header, phase strip, columns, cards, folded sections", async ({ page }) => {
  await open(page, "checkout-review");
  await expect(page.locator("#main header h2 .badge")).toHaveText("completed");
  await expect(page.locator(".stats")).toContainText("7/7done of started");
  await expect(page.locator(".stats")).toContainText("20m 0selapsed");
  await expect(page.locator(".segs .seg.done")).toHaveCount(3);
  await expect(page.locator(".segl")).toHaveText("Phase 3 of 3");
  await expect(page.locator(".phase h3")).toHaveText(["Survey 1/1", "Review 4/4", "Verify 2/2"]);
  const card = page.locator(".card").first();
  await expect(card).toContainText(/tools · \S+ · /);
  await expect(card.locator("i.db")).toHaveCount(1);
  expect(await page.locator(".card i.db").evaluateAll((is) => is.some((i) => parseFloat((i as HTMLElement).style.width) === 100))).toBe(true);
  const [log, result, script] = ["Log", "Final result", "Script"].map((s) => page.locator("details", { has: page.locator("summary", { hasText: s }) }));
  await expect(log).toHaveAttribute("open", "");
  for (const d of [result, script]) { await expect(d).not.toHaveAttribute("open"); await d.locator("summary").click(); await expect(d).toHaveAttribute("open", ""); }
  await expect(result).toContainText("VAT rounded per line");
  await expect(script.locator("pre.hljs span").first()).toBeVisible();
});

test("F-4.5 R-S12 Copy resume command copies the session's command", async ({ page }) => {
  const r = await open(page, "checkout-review");
  await page.locator("button.cmdbtn").click();
  await expect(page.locator("button.cmdbtn")).toHaveText("Copied");
  expect(await clip(page)).toBe(`cd /home/dev/acme-shop && claude --resume ${r.session}`);
});

test("F-4.6 F-4.7 F-4.8 R-T24 a live workflow: phase not started, a long wait in amber, ● in the title", async ({ page }) => {
  await open(page, "money-migration");
  await expect(page.locator("#main header h2 .badge")).toHaveText("running");
  await expect(page.locator(".phase h3", { hasText: "Test" })).toContainText("not started");
  const wait = page.locator(".card", { hasText: "packages/inventory" }).locator(".now.wait");
  await expect(wait).toHaveText(/^⏳ waiting on Bash for 4m/);
  await expect(wait).toHaveClass(/w-amber/);
  await expect(wait).not.toContainText("possibly stuck");
  await expect(page).toHaveTitle(/^● money-migration · Flowscope$/);
  await shot(page, "live-board");
});

test("F-4.7 F-4.8 R-T23 a tool wait over 10 minutes is red, possibly stuck, flagged, and ⚠ in the title", async ({ page }) => {
  await open(page, "Long build");
  const wait = page.locator(".card .now.wait");
  await expect(wait).toHaveClass(/w-red/);
  await expect(wait).toContainText("possibly stuck");
  await expect(page.locator(".attn")).toContainText("1 agent waiting on a tool over 10m");
  await expect(page).toHaveTitle(/^⚠ Long build · Flowscope$/);
});

test("F-4.9 R-T20 a live run refreshes and keeps what was opened and where it was scrolled", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 500 });
  await open(page, "money-migration");
  const script = page.locator("#main details", { has: page.locator("summary", { hasText: "Script" }) });
  await script.locator("summary").click();
  await page.locator("#main").evaluate((m) => { m.scrollTop = 200; });
  const card = page.locator(".card", { hasText: "packages/search" });
  const before = await page.locator("#main").evaluate((m) => (m as any)._html);
  // A running agent's transcript is drawn again on each poll too.
  await card.click();
  await expect(page.locator(".dtabs button.on")).toContainText("Transcript");
  const call = page.locator("#dbody details.call", { has: page.locator(".chip", { hasText: "Read" }) });
  await call.locator("summary").first().click();
  await expect(call).toHaveAttribute("open", "");
  // One poll later the run has been drawn again.
  await expect.poll(() => page.locator("#main").evaluate((m) => (m as any)._html), { timeout: 8_000 }).not.toBe(before);
  await expect(script).toHaveAttribute("open", "");
  expect(await page.locator("#main").evaluate((m) => m.scrollTop)).toBe(200);
  await expect(call).toHaveAttribute("open", "");
  await expect(card).toBeVisible();
});

test("F-6.1 F-6.2 R-U7 the drawer opens on Result or Transcript, tabs and transcript filters work and are kept", async ({ page }) => {
  const r = await open(page, "checkout-review");
  const card = page.locator(".card").first(), id = await card.getAttribute("data-agent");
  await card.click();
  await expect(page.locator("#drawer")).toHaveClass(/open/);
  await expect(page.locator(".dtabs button.on")).toContainText("Result");
  expect(new URL(page.url()).hash).toBe(`#${hashOf(r)}/${id}`);
  await expect(page.locator("#dbody")).toContainText("Finding");
  await page.locator(".dtabs button", { hasText: "Task" }).click();
  await expect(page.locator("#dbody")).toContainText("Review the checkout code for: map checkout modules.");
  await page.locator(".dtabs button", { hasText: "Transcript" }).click();
  const body = page.locator("#dbody");
  await expect(body.locator("details.call.task .chip")).toHaveText("task");
  await expect(body.locator(".ev.say .md").first()).toContainText("Reading the cart module first.");
  await expect(body.locator("details.call:not(.task) .chip")).toHaveText(["Read", "Bash"]);
  await expect(body.locator("details.call", { hasText: "Bash" }).locator(".meta")).toContainText("5 lines");
  await expect(body.locator(".tfilter")).toContainText("2 tool calls");
  await body.locator(".tfilter button", { hasText: "Agent only" }).click();
  await expect(body.locator("details.call:not(.task)")).toHaveCount(0);
  await expect(body.locator(".ev.say")).toHaveCount(2);
  await body.locator(".tfilter button", { hasText: "Errors" }).click();
  await expect(body.locator(".ev.say, details.call")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#drawer")).toHaveClass(/open/);
  await page.locator(".dtabs button", { hasText: "Transcript" }).click();
  await expect(page.locator(".tfilter button.on")).toHaveText("Errors");
  // A running agent with no result opens on its transcript.
  await open(page, "money-migration");
  await page.locator(".card", { hasText: "packages/search" }).click();
  await expect(page.locator(".dtabs button.on")).toContainText("Transcript");
});

test("F-6.3 a tool row opens to labelled input and highlighted output", async ({ page }) => {
  const r = await open(page, "checkout-review");
  const id = (await api(`/api/run?p=${encodeURIComponent(r.projectKey)}&s=${r.session}&r=${r.runId}`)).agents[0].agentId;
  await page.goto(`${BASE}/#${hashOf(r)}/${id}`);
  await page.locator(".dtabs button", { hasText: "Transcript" }).click();
  const read = page.locator("#dbody details.call", { has: page.locator(".chip", { hasText: "Read" }) });
  await read.locator("summary").first().click();
  await expect(read.locator(".kv span").first()).toHaveText("file_path");
  // cart.ts is TypeScript: its keywords are coloured, and the colour comes from the vendored theme.
  const kw = read.locator("pre.o .hljs-keyword").first();
  await expect(kw).toHaveText("export");
  expect(await kw.evaluate((e) => getComputedStyle(e).color)).not.toBe(await read.locator("pre.o").evaluate((e) => getComputedStyle(e).color));
  const bash = page.locator("#dbody details.call", { has: page.locator(".chip", { hasText: "Bash" }) });
  await bash.locator("summary").first().click();
  await expect(bash.locator("pre.in.hljs")).toContainText("bun test src/checkout");
  await expect(bash.locator("pre.o")).toContainText("2 pass, 1 fail");
  expect(await bash.locator("pre.in").evaluate((e) => getComputedStyle(e).fontFamily)).toContain("IBM Plex Mono");
  await shot(page, "drawer-transcript");
});

test("F-6.4 a step's link button copies a link that opens that step", async ({ page, context }) => {
  const r = await open(page, "checkout-review");
  await page.locator(".card").first().click();
  await page.locator(".dtabs button", { hasText: "Transcript" }).click();
  const bash = page.locator("#dbody details.call", { has: page.locator(".chip", { hasText: "Bash" }) });
  await bash.locator("summary").first().click();
  await bash.locator('button[data-v="step"]').click();
  await expect(bash.locator(".acts .done")).toHaveText("Link copied");
  const link = await clip(page);
  const step = await bash.getAttribute("id");
  expect(link).toMatch(new RegExp(`^${BASE}/#${hashOf(r)}/[^/]+/${step!.replace("step-", "")}$`));
  const other = await context.newPage();
  await other.goto(link);
  const target = other.locator(`#${step}`);
  await expect(target).toHaveAttribute("open", "");
  await expect(target).toHaveClass(/target/);
  await expect(target).toBeInViewport();
});

test("F-6.5 keys: j/k and arrows step agents, p/r/t switch tabs, ? lists keys, Esc closes and restores the hash", async ({ page }) => {
  const r = await open(page, "checkout-review");
  const d = await api(`/api/run?p=${encodeURIComponent(r.projectKey)}&s=${r.session}&r=${r.runId}`);
  const ids = d.agents.map((a: any) => a.agentId);
  await page.locator(`.card[data-agent="${ids[0]}"]`).click();
  const at = () => new URL(page.url()).hash.split("/")[2];
  await page.keyboard.press("j"); await expect.poll(at).toBe(ids[1]);
  await page.keyboard.press("ArrowDown"); await expect.poll(at).toBe(ids[2]);
  await page.keyboard.press("k"); await expect.poll(at).toBe(ids[1]);
  await page.keyboard.press("ArrowUp"); await expect.poll(at).toBe(ids[0]);
  for (const [k, t] of [["p", "Task"], ["t", "Transcript"], ["r", "Result"]]) { await page.keyboard.press(k); await expect(page.locator(".dtabs button.on")).toContainText(t); }
  await page.locator('.dh-nav button[data-act="step"][data-v="1"]').click(); await expect.poll(at).toBe(ids[1]);
  await page.keyboard.press("?");
  await expect(page.locator("#keys")).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.locator("#keys")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).not.toHaveClass(/open/);
  expect(new URL(page.url()).hash).toBe(`#${hashOf(r)}`);
});

test("F-6.6 Back and Forward move between runs, a pasted link opens the run and agent", async ({ page }) => {
  await home(page);
  await page.locator("#runs .run", { hasText: "money-migration" }).click();
  await expect(page.locator("#main header h2")).toContainText("money-migration");
  await page.locator("#runs .run", { hasText: "Payments clean-up" }).click();
  await expect(page.locator("#main header h2")).toContainText("Payments clean-up");
  await page.goBack();
  await expect(page.locator("#main header h2")).toContainText("money-migration");
  await page.goForward();
  await expect(page.locator("#main header h2")).toContainText("Payments clean-up");
  await page.goBack(); await page.goBack();
  await expect(page.locator("#main header h2")).toHaveText("Now");
  const r = await byName("Payments clean-up");
  const d = await api(`/api/run?p=${encodeURIComponent(r.projectKey)}&s=${r.session}&r=${r.runId}`);
  const a = d.agents.find((x: any) => x.label === "summarise the payments RFC");
  const fresh = await page.context().newPage();
  await fresh.goto(`${BASE}/#${hashOf(r)}/${a.agentId}`);
  await expect(fresh.locator("#drawer")).toHaveClass(/open/);
  await expect(fresh.locator("#dhead h2")).toHaveText("summarise the payments RFC");
});

test("F-5.3 a usage limit shows on the card and leads the needs-a-look strip", async ({ page }) => {
  await open(page, "Payments clean-up");
  await expect(page.locator(".card", { hasText: "audit dependencies" }).locator(".flag")).toHaveText("usage limit");
  await expect(page.locator(".attn button").first()).toHaveText("1 agent hit a usage limit (resets 7:10pm)");
});

test("F-7.2 F-7.3 F-7.5 R-L20 R-L22 R-L25 a batch over 30 agents is a table, shape filters count, j/k follow the filtered rows", async ({ page }) => {
  await open(page, "Claude ×40");
  await expect(page.locator(".viewbar button.on")).toHaveText("Table");
  const table = page.locator("table.batch");
  await expect(table.locator("tr").first().locator("th")).toHaveText(["#", "Product page …", "Tokens", "Took", "Result"]);
  await expect(table.locator("tr.r")).toHaveCount(40);
  await expect(table.locator("tr.r").first().locator("td").nth(1)).toHaveText("1");
  await expect(table.locator("tr.r").first().locator("td.res")).toContainText("Page 1: one fix.");
  await expect(page.locator(".tools .tabs button", { hasText: "All" })).toHaveText("All 40");
  await page.locator(".tools .tabs button", { hasText: "Empty or one word" }).click();
  await expect(page.locator(".tools .tabs button.on")).toHaveText("Empty or one word 2");
  await expect(table.locator("tr.r td:first-child")).toHaveText(["8", "24"]);
  await page.locator(".tools input").fill("page 24");
  await expect(table.locator("tr.r")).toHaveCount(1);
  await page.locator(".tools input").fill("");
  await table.locator("tr.r").first().click();
  await expect(page.locator("#dhead h2")).toHaveText("Product page 8");
  await page.keyboard.press("j");
  await expect(page.locator("#dhead h2")).toHaveText("Product page 24");
  await page.keyboard.press("j");
  await expect(page.locator("#dhead h2")).toHaveText("Product page 24");
  await page.keyboard.press("k");
  await expect(page.locator("#dhead h2")).toHaveText("Product page 8");
});

test("F-7.4 R-L21 the table shows 100 rows and Show more adds the rest", async ({ page }) => {
  await open(page, "Claude ×130");
  await expect(page.locator("table.batch tr.r")).toHaveCount(100);
  await page.locator("#main button.more", { hasText: "Show more (30 left)" }).click();
  await expect(page.locator("table.batch tr.r")).toHaveCount(130);
  await expect(page.locator("#main button.more")).toHaveCount(0);
});

test("F-7.6 R-S12 the drawer's terminal button copies the run's resume command, its folder quoted", async ({ page }) => {
  await open(page, "Claude: Summarise the VAT report", "fa-run-1");
  await page.locator('#dhead button[data-v="resume"]').click();
  await expect(page.locator('#dhead button[data-v="resume"]')).toHaveClass(/ok/);
  expect(await clip(page)).toBe("cd '/home/dev/my shop' && claude --resume fa-run-1");
});

test("F-8.1 F-8.3 the timeline: a lane per agent by phase, running striped, a usage limit red, a lane opens its agent", async ({ page }) => {
  await open(page, "checkout-review");
  await page.locator(".viewbar button", { hasText: "Timeline" }).click();
  await expect(page.locator(".tl-row")).toHaveCount(7);
  await expect(page.locator(".tl-ph")).toHaveText(["Survey", "Review", "Verify"]);
  await shot(page, "timeline");
  await page.locator(".tl-row", { hasText: "input validation" }).click();
  await expect(page.locator("#dhead h2")).toHaveText("input validation");
  await page.keyboard.press("Escape");
  await open(page, "money-migration");
  await page.locator(".viewbar button", { hasText: "Timeline" }).click();
  const bar = page.locator(".tl-row", { hasText: "packages/search" }).locator(".tl-bar");
  await expect(bar).toHaveClass(/running/);
  expect(await bar.evaluate((b) => getComputedStyle(b).backgroundImage)).toContain("repeating-linear-gradient");
  await open(page, "Payments clean-up");
  await page.locator(".viewbar button", { hasText: "Timeline" }).click();
  await expect(page.locator(".tl-row", { hasText: "audit dependencies" }).locator(".tl-bar")).toHaveClass(/limit/);
});

test("F-8.2 R-T29 agents hours apart: the idle stretch is cut and labelled", async ({ page }) => {
  await open(page, "Spread-out agents");
  await page.locator(".viewbar button", { hasText: "Timeline" }).click();
  await expect(page.locator(".tl.cut")).toBeVisible();
  await expect(page.locator(".tl-axis .gapl")).toHaveText(/^2h 30m idle$/);
  // One cut takes min(8, 30 / 1) % of the track.
  expect(await page.locator(".tl-axis .tl-gap").evaluate((b) => parseFloat((b as HTMLElement).style.width))).toBe(8);
});

test("F-9.1 refused permission leaves the bell off", async ({ page }) => {
  await fakeNotifications(page, "denied");
  await home(page);
  await page.locator("#bell").click();
  await expect(page.locator("#bell")).not.toHaveClass(/\bon\b/);
  await expect(page.locator("#bell")).toHaveAttribute("aria-pressed", "false");
});

test("F-9.3 R-T21 R-U7 a quiet run is told once, and again only after it was active in between", async ({ page }) => {
  await fakeNotifications(page, "granted");
  await home(page);
  await page.locator("#bell").click();
  await expect(page.locator("#bell")).toHaveClass(/\bon\b/);
  await page.reload();
  await expect(page.locator("#bell")).toHaveClass(/\bon\b/);
  const r = await byName("Long build");
  const sub = join(data.claude, r.projectKey, r.session, "subagents"), quiet = () => age(sub, 11 * MIN), touch = () => age(sub, 0);
  const told = async () => (await notes(page)).filter((n) => n.startsWith("Long build: No activity for"));
  // The list has to change for the page to look: another run's file is touched.
  const nudge = () => { const f = join(data.claude, "-home-dev-hostile", "hostile-1.jsonl"); const t = new Date(); utimesSync(f, t, t); };
  nudge();
  await expect.poll(told, { timeout: 10_000 }).toHaveLength(1);
  nudge();
  await page.waitForTimeout(3500);
  expect(await told()).toHaveLength(1);
  touch();
  await expect(page.locator("#runs .run", { hasText: "Long build" })).not.toContainText("quiet", { timeout: 10_000 });
  quiet();
  await expect.poll(told, { timeout: 10_000 }).toHaveLength(2);
});

test("F-10.1 R-U7 the theme switches, is remembered, and Auto follows the system", async ({ page }) => {
  await home(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator('#theme button[data-v="dark"]').click();
  const dark = await bg();
  await page.locator('#theme button[data-v="light"]').click();
  const light = await bg();
  expect(dark).not.toBe(light);
  await page.reload();
  await expect(page.locator("#theme button.on")).toHaveAttribute("data-v", "light");
  expect(await bg()).toBe(light);
  await page.locator('#theme button[data-v="auto"]').click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(bg).toBe(dark);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(bg).toBe(light);
  // Code takes the theme's colours too.
  await page.locator('#theme button[data-v="light"]').click();
  await open(page, "checkout-review");
  await page.locator(".card").first().click();
  await page.locator(".dtabs button", { hasText: "Transcript" }).click();
  await page.locator("#dbody details.call", { has: page.locator(".chip", { hasText: "Read" }) }).locator("summary").first().click();
  await shot(page, "light");
  await page.locator('#theme button[data-v="dark"]').click();
  expect(await page.locator("#hl-dark").evaluate((l) => (l as HTMLLinkElement).media)).toBe("all");
});

test("F-10.2 R-L26 a narrow window shows the sidebar and the run as separate screens", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await home(page);
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.locator("main")).toBeHidden();
  await page.locator("#runs .run", { hasText: "money-migration" }).click();
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.locator(".phase")).toHaveCount(3);
  const cols = await page.locator(".phase").evaluateAll((ps) => ps.map((p) => p.getBoundingClientRect().left));
  expect(new Set(cols).size).toBe(1);
  await page.locator(".card").first().click();
  expect(await page.locator("#drawer").evaluate((d) => d.getBoundingClientRect().width)).toBe(700);
  await page.keyboard.press("Escape");
  await page.locator("button.back").click();
  await expect(page.locator("aside")).toBeVisible();
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(700);
});

test("F-10.3 R-U5 R-U6 Persian gets its face and each block its own direction", async ({ page }) => {
  await open(page, "Claude: Summarise the VAT report", "fa-run-1");
  const md = page.locator("#dbody .md");
  await expect(md).toHaveAttribute("lang", "fa");
  expect(await md.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/^"?IBM Plex Sans Arabic/);
  await expect(md.locator("h2")).toHaveAttribute("dir", "rtl");
  await expect(md.locator("ul")).toHaveAttribute("dir", "rtl");
  await expect(md.locator("p").last()).toHaveAttribute("dir", "ltr");
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "IBM Plex Sans Arabic"', "سلام"); })).toBe(true);
  // The bullets sit on the right of a Persian list.
  expect(await md.locator("li").first().evaluate((e) => getComputedStyle(e).direction)).toBe("rtl");
  await shot(page, "rtl-result");
});

test("F-12.1 R-S3 hostile Markdown runs no script, keeps no javascript: link, and reaches no other host", async ({ page }) => {
  await open(page, "Claude: Write something hostile", "hostile-1");
  const body = page.locator("#dbody");
  await expect(body).toContainText("Hostile answer");
  await page.locator(".dtabs button", { hasText: "Transcript" }).click();
  await expect(body.locator(".ev.say")).toContainText("Hostile answer");
  for (const tab of ["Result", "Transcript"]) {
    await page.locator(".dtabs button", { hasText: tab }).click();
    await expect(body.locator("script, iframe, [onerror], [onload], a[href^='javascript' i]")).toHaveCount(0);
    await expect(body.locator("a", { hasText: "click me" })).not.toHaveAttribute("href", /javascript/i);
  }
  // Images not in data: URLs are shown as text, never asked for.
  await expect(body.locator("img")).toHaveCount(0);
  await expect(body.locator(".noimg[title='https://evil.example/track.png']")).toHaveText("[image: remote]");
  await page.locator(".dtabs button", { hasText: "Result" }).click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  // Every request went to the server, and no dialog opened: the guard checks both when the test ends.
});

test("F-11.2 a surprise in Claude Code's files shows a warning naming it, with the file in the tooltip", async ({ page }) => {
  const r = await byName("checkout-review");
  const journal = join(data.claude, r.projectKey, r.session, "subagents", "workflows", r.runId, "journal.jsonl");
  appendFileSync(journal, JSON.stringify({ type: "paused" }) + "\n");
  await fetch(`${BASE}/api/run?p=${encodeURIComponent(r.projectKey)}&s=${r.session}&r=${r.runId}`);
  await home(page);
  const bar = page.locator("#warn .warnbar");
  await expect(bar).toContainText("Claude Code's files look different.");
  await expect(bar).toContainText('"paused"');
  expect(await bar.getAttribute("title")).toContain(journal);
});

// Last: these age the live workflow, which the tests above need running.
test("F-9.2 F-2.3 F-4.10 R-T25 a run that stops is told once and its notice opens it, home lists it under Needs a look", async ({ page }) => {
  await fakeNotifications(page, "granted");
  await home(page);
  await page.locator("#bell").click();
  const r = await byName("money-migration");
  age(join(data.claude, r.projectKey, r.session, "subagents", "workflows", r.runId), 20 * MIN);
  const told = async () => (await notes(page)).filter((n) => n.startsWith("money-migration:"));
  await expect.poll(told, { timeout: 10_000 }).toEqual(["money-migration: Stopped before finishing"]);
  await page.waitForTimeout(3500);
  expect(await told()).toHaveLength(1);
  await page.evaluate(() => (window as any).__notes.find((n: any) => n.title === "money-migration").onclick());
  await expect(page.locator("#main header h2")).toContainText("money-migration");
  await expect(page.locator("#main header h2 .badge")).toHaveText("stopped");
  await page.locator(".brand").click();
  await expect(page.locator(".hgrid").first().locator(".hcard", { hasText: "money-migration" })).toContainText("stopped before finishing");
});
