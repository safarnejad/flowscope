# User flows and end-to-end tests

Each flow lists what the user does and what must happen, written so that each numbered check can be a test. Tests run against a fixture tree, not the real `~/.claude`:

```sh
CLAUDE_PROJECTS_DIR=$FIX/claude CODEX_SESSIONS_DIR=$FIX/codex FLOWSCOPE_CACHE=$FIX/cache \
  bun server.ts --foreground --port 4799
```

Time-based states (running → stopped after 15 minutes, done after 5 quiet seconds) are tested by setting file mtimes (`touch -d`), not by waiting.

## Fixtures needed

| Id | Content |
|---|---|
| F1 | A finished workflow: script, journal (3 started, 3 results), 3 agent transcripts + metas, final record with `status: completed`, 2 phases, logs, result. |
| F2 | A live workflow: script with 3 phases, journal with 2 started and 1 result, no final record; one transcript touched now whose last line is a `tool_use` with no result. |
| F3 | The same as F2 with every file's mtime 20 minutes ago. |
| F4 | A session with plain subagents: one background agent with a `SubagentHandback`, one foreground agent ending on text, one agent in mid tool call, one whose last line is an API error (`isApiErrorMessage`, `error: "rate_limit"`). Session file with two `ai-title` lines and a `cwd`. |
| F5 | 40 headless `claude -p` sessions in one folder, started 5 seconds apart, same prompt opening, last heading `## Paragraph N`; some ending on text, two ending on `OK`. |
| F6 | Two `codex exec` rollouts, one with `task_complete`, one without. |
| F7 | A transcript containing hostile text: `<img src=x onerror=alert(1)>` in a tool output, a Markdown link `[x](javascript:alert(1))`, a Markdown image from a remote URL, and an agent text with `<script>`. |
| F8 | A journal with an unknown event type and a meta file without `agentType`. |

## 1. Start and stop

1. `bun server.ts` with nothing running prints the URL and pid and exits 0; `GET /api/pid` answers the pid with header `x-flowscope: 1`.
2. Running it again prints "already running" and starts nothing new.
3. `bun server.ts stop` stops it; `/api/pid` no longer answers.
4. If another program answers on the port without the `x-flowscope` header, `stop` reports that Flowscope is not running and kills nothing.
5. The cache folder exists with mode `0700`; the log is in it.

## 2. Home page

Given F1, F2, F3, F4. Open `/`.

1. The sidebar has a **Running** section with F2 and the F4 agent group, and a **Recent** section with up to 3 finished runs; older ones sit behind **History (N) ›**.
2. The main area shows **Now** with the count running, runs active today and today's tokens.
3. **Needs a look** lists F3 as stopped (seen within the last day) and any running run quiet for over 10 minutes.
4. Clicking **Flowscope** from a run returns home and clears the URL hash.

## 3. Filter and search runs

1. **Workflows** shows only F1–F3; **Agents** only F4; **CLI** only F5/F6. Reload: the choice is kept.
2. Typing part of a run's name filters the list, grouped by day; no match shows "No run's name matches".
3. Typing three or more characters that appear only inside a transcript shows **In transcripts** with "Reading transcripts…" first, then hits with a highlighted snippet. Clicking a hit opens its run and that agent's transcript.
4. `/` focuses the search box when not typing elsewhere.

## 4. A workflow run

Open F1.

1. Header: name and `completed` badge, description, stats (done of started 3/3, elapsed = `durationMs`, tokens, cache reads, share of the week, last activity).
2. The phase strip has 2 segments, both done; "Phase 2 of 2".
3. Board: one column per phase with "done/total"; each card shows label, tool count, tokens, peak context and duration, with a thin bar relative to the slowest agent.
4. **Log** is open; **Final result** and **Script** are folded and expand.
5. **Copy resume command** copies `cd <cwd> && claude --resume <session>`.

Open F2.

6. Status `running` with a pulsing badge; the empty third phase shows as a column marked "not started".
7. The card in mid tool call shows "⏳ waiting on <Tool> for …"; after 2 minutes the text turns amber, after 10 red with "possibly stuck", and the needs-a-look strip shows "1 agent waiting on a tool over 10m".
8. The page title starts with `●` (or `⚠` when a wait is over 10 minutes).
9. The view refreshes every 3 seconds; an expanded tool call and the scroll position stay as they were.

Open F3: status `stopped`; unfinished agents are `stopped`.

## 5. Plain subagents

Open F4.

1. Name is the latest `ai-title`. Columns: Running, Done, Stopped; empty ones hidden.
2. The background agent is Done with the handback message as its Result; the foreground one is Done with its last text.
3. The API-error agent has a red "usage limit" flag, and the strip leads with "1 agent hit a usage limit (…reset time…)".
4. Append a user prompt line to the done background agent's transcript: within one poll it shows as Running.

## 6. Agent drawer

1. Clicking a card opens the drawer on **Result** when there is one, else **Transcript**; the hash becomes `#<session>/<runId>/<agentId>`.
2. **Task** shows the first prompt; **Transcript** shows the task row, agent text as Markdown, and tool rows with name, label, duration, output line count; errors marked red. Filters **All / Agent only / Errors** work and are remembered.
3. Expanding a tool row shows Input as labelled fields and Output (JSON as a table or pretty JSON, Markdown for prose tools, code highlighted by file extension).
4. The link button copies a URL ending `/<step>`; opening it scrolls to and opens that step, highlighted.
5. `j`/`k` or ↓/↑ step to the next/previous agent; `p`/`r`/`t` switch tabs; `?` shows the key list; Esc closes and restores the hash to the run.
6. Back and Forward move between runs; a pasted hash opens the same run and agent.

## 7. CLI batch (big run)

Open F5.

1. It is one run named `Claude ×40: <role>`, with kind `claude`.
2. With more than 30 agents the board is a **Table**: #, label without the common prefix, tokens, took, start of the result.
3. Shape filters show counts: All 40, Answers, Empty or one word (2), Running, Stopped. The search box filters by label and result.
4. The first 100 rows show; **Show more** adds 200.
5. `j`/`k` in the drawer follow the filtered table order.
6. The drawer has a terminal button copying `claude --resume <id>` for that run.

Open a F6 batch: share of the week shows `—`; the run without `task_complete` is Running or Stopped by mtime.

## 8. Timeline

1. **Timeline** shows one lane per agent on a shared axis, grouped by phase for workflows; running bars are striped, API-error bars red.
2. Agents started hours apart: idle stretches over 10 minutes and over a fifth of the work time are cut and drawn as hatched bands labelled "N idle".
3. Clicking a lane opens that agent.

## 9. Notifications

1. The bell asks for browser permission; refused, it stays off.
2. On: a run going from running to completed, failed or stopped raises one notification; clicking it opens the run.
3. A running run quiet for 10 minutes raises one notification, and again only after it has been active in between.

## 10. Theme and layout

1. Auto / light / dark switch the theme and are remembered; Auto follows the system.
2. At 760 px wide or less: the sidebar and the run are separate screens with a **Runs** back button; phases stack; the drawer is full width.

## 11. Format warning

Given F8: the sidebar shows "Claude Code's files look different…" naming both issues; the tooltip lists the files.

## 12. Safety

1. Given F7, no alert fires and no request leaves for the remote image host (check the browser's network log and CSP reports). The `javascript:` link is removed.
2. `GET /api/run?p=..&s=..&r=x` returns `400`.
3. A request with `Host: evil.example:4799` returns `403`.
4. The server never modifies the fixture tree: a checksum of `$FIX/claude` and `$FIX/codex` is unchanged after all tests.
