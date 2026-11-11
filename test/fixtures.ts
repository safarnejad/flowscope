// Fixture builders shared by the API tests (test/) and the browser tests (e2e/). X1, X2, X4, X5 and X6 come from
// scripts/demo.ts; these add the rest (docs/FLOWS.md, Fixtures). Plain node:fs only, so they run under Bun and Node.
import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";

const MIN = 60_000;
export const put = (f: string, body: string, at?: number) => {
  mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body);
  if (at != null) utimesSync(f, new Date(at), new Date(at));
};
export const jl = (xs: any[]) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
// A headless `claude -p` session (R-K4) with the given id, in its own folder so it forms its own batch.
export const headless = (sessionId: string, cwd: string, answer: string, at = Date.now(), prompt = "Say something.") => jl([
  { type: "system", sessionId, message: { content: [{ type: "text", text: "You are a Claude agent, built on Anthropic's Claude Agent SDK." }] } },
  { type: "user", sessionId, cwd, timestamp: new Date(at).toISOString(), message: { role: "user", content: prompt } },
  { type: "assistant", timestamp: new Date(at + 1000).toISOString(), message: { id: `m-${sessionId}`, role: "assistant", content: [{ type: "text", text: answer }] } }]);

// Markdown that would run code or reach another host if the page let it (X7).
export const HOSTILE = [
  "# Hostile answer",
  "",
  "<img src=x onerror=\"window.__pwned = 1; alert(1)\">",
  "",
  "[click me](javascript:window.__pwned=2) and <script>window.__pwned = 3; alert(3)</script>",
  "",
  "![remote](https://evil.example/track.png)",
  "",
  "<a href=\"javascript:alert(4)\">raw link</a> <svg onload=\"alert(5)\"></svg> <iframe src=\"https://evil.example/\"></iframe>",
].join("\n");
export const PERSIAN = "## خلاصه\n\nاین گزارش نشان می‌دهد که مالیات بر ارزش افزوده برای هر سطر گرد می‌شود، نه برای کل سفارش.\n\n- قیمت‌ها به پنی صحیح ذخیره می‌شوند\n- هر سفارش یک واحد پول دارد\n\nThe English line stays left to right.";

// The extra runs the browser tests need, written beside the demo tree:
// - a headless run with a Persian answer whose folder needs quoting (R-S12, R-U5, R-U6);
// - a headless run whose answer is hostile Markdown (X7);
// - a session whose one agent has waited on a tool for over R-T23 and is quiet over R-T21;
// - a session whose two agents ran hours apart, for the timeline's cut idle stretch (R-T29);
// - a batch of 130 headless runs, for the table's paging (R-L21).
export function makeExtra(claude: string, now = Date.now()) {
  const iso = (t: number) => new Date(t).toISOString();
  put(join(claude, "-home-dev-my-shop", "fa-run-1.jsonl"), headless("fa-run-1", "/home/dev/my shop", PERSIAN, now - 3 * MIN, "Summarise the VAT report in Persian."), now - 2 * MIN);
  put(join(claude, "-home-dev-hostile", "hostile-1.jsonl"), headless("hostile-1", "/home/dev/hostile", HOSTILE, now - 30 * MIN, "Write something hostile."), now - 30 * MIN);
  const agent = (dir: string, id: string, description: string, lines: any[], at: number) => {
    put(join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: "general-purpose", description }), at);
    put(join(dir, `agent-${id}.jsonl`), jl(lines), at);
  };
  const user = (t: number, content: any) => ({ type: "user", timestamp: iso(t), cwd: "/home/dev/acme-shop", message: { role: "user", content } });
  const say = (t: number, id: string, content: any[]) => ({ type: "assistant", timestamp: iso(t), message: { id, role: "assistant", content,
    usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 } } });
  const project = join(claude, "-home-dev-acme-shop");
  {
    const session = "7d1c2f60-0000-4000-8000-0000000000e1", t = now - 13 * MIN;
    agent(join(project, session, "subagents"), "e1000000000000a1", "run the full build", [user(t, "Run the full build."),
      say(now - 12 * MIN, "m-e1", [{ type: "tool_use", id: "toolu_e1", name: "Bash", input: { command: "make all", description: "Full build" } }])], now - 11 * MIN);
    put(join(project, `${session}.jsonl`), jl([{ type: "ai-title", aiTitle: "Long build" }, { type: "user", cwd: "/home/dev/acme-shop" }]), now - 11 * MIN);
  }
  {
    const session = "7d1c2f60-0000-4000-8000-0000000000e2", dir = join(project, session, "subagents");
    for (const [id, label, start] of [["e2000000000000a1", "morning survey", now - 3 * 60 * MIN], ["e2000000000000a2", "evening follow-up", now - 25 * MIN]] as const)
      agent(dir, id, label, [user(start, `Do the ${label}.`), say(start + 5 * MIN, `m-${id}`, [{ type: "text", text: `Finished the ${label} with three notes.` }])], start + 5 * MIN);
    put(join(project, `${session}.jsonl`), jl([{ type: "ai-title", aiTitle: "Spread-out agents" }, { type: "user", cwd: "/home/dev/acme-shop" }]), now - 20 * MIN);
  }
  for (let i = 0; i < 130; i++) {
    const id = `bulk-${String(i).padStart(3, "0")}`, t = now - 4 * 60 * MIN + i * 1000;
    put(join(claude, "-home-dev-bulk", `${id}.jsonl`), headless(id, "/home/dev/bulk", `Row ${i + 1} checked, nothing to change here.`, t, `Check row ${i + 1} of the price list.`), t + 2000);
  }
}
