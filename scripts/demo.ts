#!/usr/bin/env bun
// Writes a made-up ~/.claude/projects and ~/.codex/sessions tree: a finished workflow, a live one with an agent
// waiting on a tool, a session's plain subagents (one stopped on a usage limit), a batch of 40 `claude -p` runs and
// two `codex exec` runs. The tests and the screenshots use it; nothing in it is real.
//
//   bun scripts/demo.ts <dir>     then: CLAUDE_PROJECTS_DIR=<dir>/claude CODEX_SESSIONS_DIR=<dir>/codex bun server.ts
import { mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const MIN = 60_000;

export function makeDemo(root: string, now = Date.now()) {
  rmSync(root, { recursive: true, force: true });
  const claude = join(root, "claude"), codex = join(root, "codex");
  const cwd = "/home/dev/acme-shop", project = "-home-dev-acme-shop";
  let n = 0;
  const iso = (t: number) => new Date(t).toISOString();
  // Writes a file and sets its time, which is what Flowscope reads state from.
  const put = (f: string, body: string, at: number) => {
    mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body);
    utimesSync(f, new Date(at), new Date(at));
  };
  const jl = (xs: any[]) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
  const usage = (i: number, o: number) => ({ input_tokens: i, cache_creation_input_tokens: i * 4, cache_read_input_tokens: i * 30, output_tokens: o });
  const user = (t: number, content: any, extra: object = {}) => ({ type: "user", timestamp: iso(t), cwd, message: { role: "user", content }, ...extra });
  const asst = (t: number, content: any[], u = usage(400, 300), extra = {}) => ({ type: "assistant", timestamp: iso(t), effort: "medium",
    message: { id: `msg_${++n}`, model: "claude-opus-5-5", role: "assistant", content, usage: u }, ...extra });
  const tool = (name: string, input: any) => ({ type: "tool_use", id: `toolu_${++n}`, name, input });
  const result = (t: number, id: string, content: string, is_error = false) => user(t, [{ type: "tool_result", tool_use_id: id, content, is_error }]);
  // A transcript that reads a file, runs a command, and ends with an answer (or not).
  function transcript(t0: number, task: string, answer: string | null, opts: { pending?: boolean; limit?: boolean } = {}) {
    const read = tool("Read", { file_path: `${cwd}/src/checkout/cart.ts` });
    const run = tool("Bash", { command: `cd ${cwd} && bun test src/checkout`, description: "Run the checkout tests" });
    const xs: any[] = [user(t0, task), asst(t0 + 20_000, [{ type: "text", text: "Reading the cart module first." }, read]),
      result(t0 + 22_000, read.id, "export function total(items: Item[]) {\n  return items.reduce((s, i) => s + i.price * i.qty, 0);\n}"),
      asst(t0 + 60_000, [run])];
    if (opts.pending) return xs;
    xs.push(result(t0 + 95_000, run.id, "✓ cart total (3 ms)\n✓ applies discount (1 ms)\n✗ rounds VAT to pennies\n\n2 pass, 1 fail"));
    if (opts.limit) xs.push(asst(t0 + 100_000, [{ type: "text", text: "You've hit your session limit · resets 7:10pm" }], usage(0, 0), { isApiErrorMessage: true, error: "rate_limit" }));
    else if (answer !== null) xs.push(asst(t0 + 130_000, [{ type: "text", text: answer }], usage(900, 1200)));
    return xs;
  }

  // 1. A finished workflow: three phases, seven agents.
  {
    const session = "7d1c2f60-0000-4000-8000-000000000001", runId = "wf_3a9e1c-ab1", t0 = now - 5 * 60 * MIN;
    const base = join(claude, project, session), dir = join(base, "subagents", "workflows", runId);
    const phases = [{ title: "Survey", detail: "map the checkout code" }, { title: "Review", detail: "one reviewer per concern" }, { title: "Verify", detail: "check each finding" }];
    const agents = [["Survey", "map checkout modules"], ["Review", "rounding and VAT"], ["Review", "concurrency in cart updates"], ["Review", "input validation"],
      ["Review", "error handling"], ["Verify", "verify: VAT rounding"], ["Verify", "verify: double submit"]];
    const journal: any[] = [{ type: "launched" }], progress: any[] = [];
    agents.forEach(([phase, label], i) => {
      const id = `a${(0x1000 + i).toString(16)}d0e1f2a3b4c5`, start = t0 + (phase === "Survey" ? 0 : phase === "Review" ? 6 : 14) * MIN + i * 20_000;
      const answer = `## ${label}\n\n- **Finding:** ${i % 2 ? "no issue found" : "VAT is rounded per line, not per order"}\n- **Evidence:** \`src/checkout/cart.ts:42\`\n- **Severity:** ${i % 2 ? "none" : "medium"}`;
      journal.push({ type: "started", agentId: id, label, phase }, { type: "result", agentId: id, result: answer });
      progress.push({ type: "workflow_agent", agentId: id, startedAt: start, model: "claude-opus-5-5", attempt: i === 3 ? 2 : 1, state: "done" });
      put(join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: "workflow-subagent", description: label, workflowPhase: phase }), start);
      put(join(dir, `agent-${id}.jsonl`), jl(transcript(start, `Review the checkout code for: ${label}.`, answer)), start + 2 * MIN + i * 30_000);
    });
    put(join(dir, "journal.jsonl"), jl(journal), t0 + 20 * MIN);
    const script = `export const meta = {\n  name: 'checkout-review',\n  description: 'Survey the checkout code, review it by concern, verify each finding',\n  phases: ${JSON.stringify(phases)},\n}\n`;
    put(join(base, "workflows", "scripts", `checkout-review-${runId}.js`), script, t0);
    put(join(base, "workflows", `${runId}.json`), JSON.stringify({ runId, status: "completed", workflowName: "checkout-review",
      summary: "Survey the checkout code, review it by concern, verify each finding", startTime: t0, durationMs: 20 * MIN, phases,
      workflowProgress: [{ type: "workflow_phase", index: 1, title: "Survey" }, ...progress], logs: ["survey done: 9 modules", "4 reviews done, 2 findings", "2 of 2 findings confirmed"],
      result: { confirmed: ["VAT rounded per line instead of per order", "double submit creates two orders"] }, script }), t0 + 20 * MIN);
    put(join(claude, project, `${session}.jsonl`), jl([{ type: "ai-title", aiTitle: "Review checkout" }, { type: "user", cwd }]), t0 + 20 * MIN);
  }

  // 2. A live workflow: phase 2 of 3, one agent waiting on a long test run.
  {
    const session = "7d1c2f60-0000-4000-8000-000000000002", runId = "wf_8b2d4e-c07", t0 = now - 14 * MIN;
    const base = join(claude, project, session), dir = join(base, "subagents", "workflows", runId);
    const phases = [{ title: "Plan" }, { title: "Migrate", detail: "one agent per package" }, { title: "Test" }];
    const journal: any[] = [{ type: "launched" }];
    const list: [string, string, "done" | "run" | "wait"][] = [["Plan", "plan the migration", "done"], ["Migrate", "packages/payments", "done"],
      ["Migrate", "packages/inventory", "wait"], ["Migrate", "packages/search", "run"], ["Migrate", "packages/emails", "run"]];
    list.forEach(([phase, label, st], i) => {
      // A working agent's last tool call went out seconds ago; the waiting one's minutes ago.
      const id = `b${(0x2000 + i).toString(16)}d0e1f2a3b4c5`, start = st === "run" ? now - 75_000 - i * 9000 : st === "wait" ? now - 5 * MIN : t0 + (phase === "Plan" ? 0 : 3 * MIN) + i * 15_000;
      journal.push({ type: "started", agentId: id, label, phase });
      if (st === "done") journal.push({ type: "result", agentId: id, result: `Migrated ${label} to the new money type; 31 tests pass.` });
      put(join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: "workflow-subagent", description: label, workflowPhase: phase }), start);
      put(join(dir, `agent-${id}.jsonl`), jl(transcript(start, `Migrate ${label} to Money.`, st === "done" ? "done" : null, { pending: st !== "done" })),
        st === "done" ? start + 3 * MIN : st === "wait" ? now - 4 * MIN : now - 20_000);
    });
    put(join(dir, "journal.jsonl"), jl(journal), now - 20_000);
    put(join(base, "workflows", "scripts", `money-migration-${runId}.js`),
      `export const meta = {\n  name: 'money-migration',\n  description: 'Move every package from number prices to the Money type',\n  phases: ${JSON.stringify(phases)},\n}\n`, t0);
    put(join(claude, project, `${session}.jsonl`), jl([{ type: "ai-title", aiTitle: "Money migration" }, { type: "user", cwd }]), now - MIN);
  }

  // 3. A session's plain subagents: one handed back, one answered, one working, one stopped on a usage limit.
  {
    const session = "7d1c2f60-0000-4000-8000-000000000003", t0 = now - 40 * MIN, dir = join(claude, project, session, "subagents");
    const hb = tool("SubagentHandback", { message: "Found 3 call sites of `legacyTotal`; all are in admin reports. Safe to remove after those." });
    const specs: [string, string, any[], number, any][] = [
      ["research call sites of legacyTotal", "Explore", [user(t0, "Find every call of legacyTotal."), asst(t0 + 40_000, [hb])], t0 + MIN, { requestShape: "background" }],
      ["summarise the payments RFC", "general-purpose", transcript(t0, "Summarise docs/rfc-payments.md in five bullets.", "- Money is integer pence\n- One currency per order\n- Rounding at order level\n- Refunds mirror charges\n- No floats anywhere"), t0 + 3 * MIN, {}],
      ["draft the release notes", "general-purpose", transcript(now - 3 * MIN, "Draft release notes for 2.4.", null, { pending: true }), now - 30_000, {}],
      ["audit dependencies", "general-purpose", transcript(t0 + 5 * MIN, "Audit dependencies for known CVEs.", null, { limit: true }), t0 + 8 * MIN, {}],
    ];
    specs.forEach(([description, agentType, lines, at, extra], i) => {
      const id = `c${(0x3000 + i).toString(16)}d0e1f2a3b4c5`;
      put(join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType, description, ...extra }), at);
      put(join(dir, `agent-${id}.jsonl`), jl(lines), at);
    });
    put(join(claude, project, `${session}.jsonl`), jl([{ type: "ai-title", aiTitle: "Payments clean-up" }, { type: "user", cwd }]), now - MIN);
  }

  // 4. A script's 40 parallel `claude -p` runs, one per product page; two answer only "OK".
  {
    const t0 = now - 90 * MIN;
    for (let i = 0; i < 40; i++) {
      const sessionId = `9e0f1a2b-0000-4000-8000-${String(i).padStart(12, "0")}`, t = t0 + i * 4000;
      const prompt = `You are a careful copy editor for an online shop.\n\nCheck the product page below for errors of fact, tone and grammar.\n\n## Product page ${i + 1}`;
      const answer = i === 7 || i === 23 ? "OK" : `Page ${i + 1}: ${i % 3 ? "two" : "one"} fix${i % 3 ? "es" : ""}.\n\n- "recieve" → "receive"\n- The size table says cm but lists inches`;
      put(join(claude, project, `${sessionId}.jsonl`), jl([
        { type: "system", sessionId, message: { content: [{ type: "text", text: "You are a Claude agent, built on Anthropic's Claude Agent SDK." }] } },
        user(t, prompt, { sessionId }), asst(t + 30_000 + i * 900, [{ type: "text", text: answer }], usage(1800, 250 + i * 10)),
      ]), t + 30_000 + i * 900);
    }
  }

  // 5. Two `codex exec` runs: one finished, one still going.
  [["review the SQL migrations", true], ["write tests for refunds", false]].forEach(([task, done], i) => {
    const id = `5c0de000-0000-4000-8000-00000000000${i}`, t = now - (done ? 9 : 2) * MIN;
    const lines: any[] = [{ type: "session_meta", timestamp: iso(t), payload: { id, originator: "codex_exec", cwd, timestamp: iso(t) } },
      { type: "turn_context", payload: { model: "gpt-5-codex", effort: "high" } },
      { type: "response_item", timestamp: iso(t), payload: { type: "message", role: "user", content: [{ type: "input_text", text: `Please ${task}.` }] } },
      { type: "response_item", timestamp: iso(t + 10_000), payload: { type: "function_call", name: "shell", call_id: `call_${i}`, arguments: "{\"command\":[\"ls\",\"db/migrations\"]}" } }];
    if (done) lines.push({ type: "response_item", timestamp: iso(t + 12_000), payload: { type: "function_call_output", call_id: `call_${i}`, output: "001_init.sql\n002_money.sql" } },
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 42_000, cached_input_tokens: 30_000, output_tokens: 3_100 }, last_token_usage: { input_tokens: 21_000 } } } },
      { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Both migrations are reversible; 002 needs an index on orders.total_pence." } });
    put(join(codex, "2026", "11", "10", `rollout-${id}.jsonl`), jl(lines), done ? t + MIN : now - 10_000);
  });
  return { claude, codex };
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: bun scripts/demo.ts <dir>"); process.exit(1); }
  const { claude, codex } = makeDemo(dir);
  console.log(`CLAUDE_PROJECTS_DIR=${claude} CODEX_SESSIONS_DIR=${codex} bun server.ts`);
}
