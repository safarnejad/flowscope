# User flows and end-to-end checks

What a user does and what must happen, as checks with stable ids `F-<section>.<n>`. These tables are the specification: a test whose name starts with a check's id checks it, and `bun run trace` keeps the two in step (see [CONTRIBUTING.md](../CONTRIBUTING.md)). The **Test** column names that test, or says `—` when no automated test covers the check yet. Checks about drawing the page are `—` until there are browser tests. Numbers come from [RULES.md](RULES.md), cited by id.

Ids are never reused. A check that no longer holds is marked *retired* in its row and stays in the table.

Tests run against a fixture tree, never the real `~/.claude`:

```sh
CLAUDE_PROJECTS_DIR=$FIX/claude CODEX_SESSIONS_DIR=$FIX/codex FLOWSCOPE_CACHE=$FIX/cache \
  bun server.ts --foreground --port 4799
```

Time-based states are tested by setting file times (`utimes`), not by waiting.

## Fixtures

`scripts/demo.ts` writes X1, X2, X4, X5 and X6; the tests derive X3, X7, X8 and X9 from them.

| Id | Content |
|---|---|
| X1 | A finished workflow: script, journal, 7 agent transcripts and metas, final record with `status: completed`, 3 phases, logs, result. |
| X2 | A live workflow: script with 3 phases, journal with started and result events, no final record; one transcript touched now whose last line is a `tool_use` with no result. |
| X3 | X2 with every file's time set 20 minutes ago. |
| X4 | A session with plain subagents: one background agent with a `SubagentHandback`, one foreground agent ending on text, one agent in mid tool call, one whose last line is an API error (`isApiErrorMessage`, `error: "rate_limit"`). Session file with `ai-title` lines and a `cwd`. |
| X5 | 40 headless `claude -p` sessions in one folder, started close together, same prompt opening, last heading per run; two ending on `OK`. |
| X6 | Two `codex exec` rollouts, one with `task_complete`, one without. |
| X7 | Hostile input: a tool result with a non-image and an attribute-breaking media type; headless Claude and Codex runs whose ids are not safe names; a symbolic link to a headless session outside the root; a transcript with a line over 64 MB. |
| X8 | A journal with an event of an unknown type. |
| X9 | A workflow whose final record has a `workflowProgress` that is not a list. |

## 1. Start and stop

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-1.1 | nothing running | `bun server.ts` | prints the URL and pid and exits 0; `GET /api/pid` answers the pid with header `x-flowscope: 1` (R-S11) | F-1.1 R-S11 marks its pid answer, so stop never kills another program |
| F-1.2 | Flowscope running on the port | `bun server.ts` again | prints "already running" and starts nothing new | F-1.2 F-1.3 R-S7 starts in the background once, and stop stops it |
| F-1.3 | Flowscope running | `bun server.ts stop` | it stops; `/api/pid` no longer answers | F-1.2 F-1.3 R-S7 starts in the background once, and stop stops it |
| F-1.4 | another program answers `/api/pid` on the port without `x-flowscope` | `stop` | reports that Flowscope is not running and kills nothing | F-1.4 R-S11 stop leaves alone another program on the port |
| F-1.5 | a start | — | the cache folder exists with mode `0700`; `cache.db` and its WAL files are `0600`; the background log is in the folder and `0600` (R-S7) | F-1.5 R-S7 keeps its cache private |
| F-1.6 | — | `--help` | names Claude Code workflows and subagents, `claude -p` and `codex exec` runs, and every environment variable with its default | F-1.6 help names Codex, CLI runs and every environment variable |

## 2. Home page

Given X1, X2, X3, X4. Open `/`.

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-2.1 | runs of every state | open `/` | the sidebar has **Running** with X2 and the X4 agent group, **Recent** with up to 3 finished runs (R-L23); older ones sit behind **History (N) ›** | — |
| F-2.2 | same | open `/` | the main area shows **Now** with the count running, runs active today and today's tokens (R-K3) | — |
| F-2.3 | X3, and a running run quiet over R-T21 | open `/` | **Needs a look** lists X3 as stopped (idle under R-T25) and the quiet run | — |
| F-2.4 | a run open | click **Flowscope** | returns home and clears the URL hash | — |

## 3. Filter and search runs

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-3.1 | all fixtures | click **Workflows** / **Agents** / **CLI**, reload | only X1–X3 / X4 / X5 and X6 show; the choice is kept (R-U7) | — |
| F-3.2 | all fixtures | type part of a run's name | the list filters, grouped by day; no match shows "No run's name matches" | — |
| F-3.3 | text only inside a transcript | type at least 3 characters of it | **In transcripts** shows "Reading transcripts…" first (R-T27), then hits with the match highlighted; clicking a hit opens its run and that agent's transcript | — |
| F-3.4 | focus not in an input | press `/` | the search box takes focus | — |

## 4. A workflow run

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-4.1 | X1 | open it | header: name and `completed` badge, description, stats (done of started 7/7, elapsed = `durationMs`, tokens, cache reads, share of the week, last activity) | F-4.1 F-4.4 F-4.5 R-S12 a finished workflow: status, phases, results, log, script, resume |
| F-4.2 | X1 | open it | the phase strip has one segment per phase, all done; "Phase 3 of 3" | — |
| F-4.3 | X1 | open it | one column per phase with "done/total"; each card shows label, tool count, tokens, peak context and duration, with a thin bar relative to the slowest agent | — |
| F-4.4 | X1 | open it | **Log** is open; **Final result** and **Script** are folded and expand | F-4.1 F-4.4 F-4.5 R-S12 a finished workflow: status, phases, results, log, script, resume |
| F-4.5 | X1 | **Copy resume command** | copies `cd <cwd> && claude --resume <session>`, each part quoted per R-S12 | F-4.1 F-4.4 F-4.5 R-S12 a finished workflow: status, phases, results, log, script, resume |
| F-4.6 | X2 | open it | status `running`; phases come from the script; a phase with no agents shows as a column marked "not started" | F-4.6 F-4.7 a live workflow: running, one agent waiting on a tool, phases from the script |
| F-4.7 | X2 | open it | the card in mid tool call shows "⏳ waiting on <Tool> for …"; amber over R-T24, red with "possibly stuck" over R-T23, and the needs-a-look strip shows "1 agent waiting on a tool over 10m" | F-4.6 F-4.7 a live workflow: running, one agent waiting on a tool, phases from the script |
| F-4.8 | X2 | open it | the page title starts with `●`, or `⚠` when a wait is over R-T23 | — |
| F-4.9 | X2 open | wait | the view refreshes per R-T20; an expanded tool call and the scroll position stay as they were | — |
| F-4.10 | X3 | open it | status `stopped`; unfinished agents are `stopped` (R-T1) | F-4.10 R-T1 a workflow quiet past the live window is stopped, and so are its unfinished agents |

## 5. Plain subagents

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-5.1 | X4 | open it | the name is the latest `ai-title`; columns Running, Done, Stopped, empty ones hidden | F-5.1 F-5.2 F-5.3 plain subagents: handback, text answer, working, usage limit |
| F-5.2 | X4 | open it | the background agent is Done with the handback message as its Result; the foreground one is Done with its last text | F-5.1 F-5.2 F-5.3 plain subagents: handback, text answer, working, usage limit |
| F-5.3 | X4 | open it | the API-error agent is stopped with a red "usage limit" flag, and the strip leads with "1 agent hit a usage limit (…reset time…)" | F-5.1 F-5.2 F-5.3 plain subagents: handback, text answer, working, usage limit |
| F-5.4 | X4, a done agent | append a user prompt line to its transcript | within one poll it is Running and has no result | F-5.4 R-T2 a resumed subagent runs again |

## 6. Agent drawer

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-6.1 | a run open | click a card | the drawer opens on **Result** when there is one, else **Transcript**; the hash becomes `#<session>/<runId>/<agentId>` | — |
| F-6.2 | drawer open | switch tabs and filters | **Task** shows the first prompt; **Transcript** shows the task row, agent text as Markdown, and tool rows with name, label, duration, output line count; errors red. Filters **All / Agent only / Errors** work and are remembered (R-U7) | — |
| F-6.3 | a transcript | expand a tool row | Input as labelled fields; Output as a table or pretty JSON for JSON, Markdown for prose tools, code highlighted by file extension (R-L24) | — |
| F-6.4 | a transcript | click a step's link button | copies a URL ending `/<step>`; opening it scrolls to and opens that step, highlighted | — |
| F-6.5 | drawer open | `j`/`k`, ↓/↑, `p`/`r`/`t`, `?`, Esc | next/previous agent; tabs; the key list; Esc closes and restores the hash to the run | — |
| F-6.6 | runs opened in turn | Back / Forward, or paste a hash | moves between runs; a pasted hash opens the same run and agent | — |

## 7. CLI batch (big run)

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-7.1 | X5 | list runs | one run named `Claude ×40: <role>` (R-L8), grouped per R-L9, R-T7, R-T8 | F-7.1 F-7.3 F-7.6 R-T7 40 claude -p runs are one batch, named by their role, with two one-word answers |
| F-7.2 | X5 | open it | with over R-L20 agents the board is a **Table**: #, label without the common prefix (R-L25), tokens, took, start of the result | — |
| F-7.3 | X5 | open it | shape filters show counts: All 40, Answers, Empty or one word 2 (R-L22), Running, Stopped; the search box filters by label and result | F-7.1 F-7.3 F-7.6 R-T7 40 claude -p runs are one batch, named by their role, with two one-word answers |
| F-7.4 | X5 | scroll the table | the first rows show, and **Show more** adds more (R-L21) | — |
| F-7.5 | X5, drawer open | `j`/`k` | follow the filtered table order | — |
| F-7.6 | X5, drawer open | click the terminal button | copies `claude --resume <id>` for that run | F-7.1 F-7.3 F-7.6 R-T7 40 claude -p runs are one batch, named by their role, with two one-word answers |
| F-7.7 | X6 | open it | share of the week is `—` (R-U4); the run with `task_complete` is Done, the other Running or Stopped by time | F-7.7 codex runs: done by task_complete, no share of the week |

## 8. Timeline

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-8.1 | a run | **Timeline** | one lane per agent on a shared axis, grouped by phase for workflows; running bars striped, API-error bars red | — |
| F-8.2 | agents started hours apart | **Timeline** | idle stretches are cut per R-T29 and drawn as hatched bands labelled "N idle" | — |
| F-8.3 | timeline shown | click a lane | that agent opens | — |

## 9. Notifications

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-9.1 | bell off | click the bell | asks for browser permission; refused, it stays off | — |
| F-9.2 | bell on | a run goes from running to completed, failed or stopped | one notification; clicking it opens the run | — |
| F-9.3 | bell on | a running run is quiet over R-T21 | one notification, and again only after it has been active in between | — |

## 10. Theme and layout

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-10.1 | — | Auto / light / dark | the theme switches and is remembered (R-U7); Auto follows the system | — |
| F-10.2 | a narrow window (R-L26) | — | the sidebar and the run are separate screens with a **Runs** back button; phases stack; the drawer is full width | — |
| F-10.3 | Persian text | it is drawn | it gets the Persian face (R-U5) and each block its own direction (R-U6) | — |

## 11. Format warning

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-11.1 | X8 | `GET /api/format` after the run is read | lists each kind of surprise once, with the first file it was seen in | F-11.1 the format endpoint names each surprise once, with its file |
| F-11.2 | X8 | open `/` | the sidebar shows "Claude Code's files look different…" naming the issues; the tooltip lists the files | — |

## 12. Safety

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-12.1 | X7 hostile Markdown (`<img onerror>`, `javascript:` link, remote image, `<script>`) in a browser | open the transcript | no script runs, the `javascript:` link is removed, no request leaves for the remote host | — |
| F-12.2 | — | `GET /api/run?p=..&s=..&r=x`, a `/` in a name, `a=..` | `400` (R-S4) | F-12.2 R-S4 refuses names that leave their folder |
| F-12.3 | — | a request with `Host: evil.example:<port>` | `403` (R-S2) | F-12.3 R-S2 refuses other hosts (DNS rebinding) |
| F-12.4 | all fixtures | open every run and every transcript | the fixture tree is byte for byte unchanged | F-12.4 never changes the files it reads |
| F-12.5 | X7 tool images | open the transcript | only known image types in plain base64 come back, as `data:` URLs (R-S10) | F-12.5 R-S10 only image types it knows go into the page |
| F-12.6 | — | `GET /` and `/app.js` | the CSP is exactly R-S3; the HTML has no inline script and no `on…=` attribute; ids reach the page only in escaped `data-*` attributes | F-12.6 R-S3 serves the page with the exact content policy and no inline script |
| F-12.7 | — | `GET /` and every file it links | no `http://` or `https://` URL is referenced; every vendored script and style matches its integrity hash (R-S9) | F-12.7 R-S9 serves its libraries and fonts itself, matching their integrity hashes |
| F-12.8 | X7 runs with unsafe ids | list runs | they are left out, and no part of their id appears in any answer (R-S4) | F-12.8 R-S4 a CLI run whose id is not a safe name is left out |
| F-12.9 | X7 symbolic link | list runs | the linked session is not read (R-S8) | F-12.9 R-S8 a symbolic link under a root is not followed |
| F-12.10 | X7 over-long line | open the run | the long line is skipped and the lines after it are read (R-L1) | F-12.10 R-L1 a line over 64 MB is skipped and the rest of the file is read |
| F-12.11 | X9 | open the run | `500` with body `internal error` and nothing else (R-S5) | F-12.11 R-S5 an unexpected error answers a plain 500 |

## 13. API

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-13.1 | all fixtures | `GET /api/runs` | every kind of run, newest activity first | F-13.1 F-13.2 lists every kind of run, newest activity first |
| F-13.2 | X2 written with quoted keys | `GET /api/run` | phases are read from the script while there is no final record | F-13.1 F-13.2 lists every kind of run, newest activity first |
| F-13.3 | an unchanged list | `GET /api/runs` with the last ETag | `304` | F-13.3 answers an unchanged run list with 304 |
| F-13.4 | X1 | `GET /api/agent` | the transcript as events in order: prompt, text, tool, output | F-13.4 a transcript comes back as events |
| F-13.5 | text inside transcripts | `GET /api/search` until indexed | hits with a snippet holding the match (R-L4) | F-13.5 R-L4 search finds text inside transcripts |
| F-13.6 | — | `q` under 3 or over 200 characters | no hits, or `400 query too long` (R-L3) | F-13.6 R-L3 search refuses a query over 200 characters and ignores one under 3 |
| F-13.7 | — | an unknown CLI batch; an unknown path | `404` | F-13.7 unknown batches and paths are 404 |
| F-13.8 | — | any API answer | carries the headers of R-S6 | F-13.8 R-S6 API answers are neither cached nor sniffed |
| F-13.9 | safe names that match no run | `GET /api/run` | `200` with an empty run; `/api/agent` an empty list | F-13.9 safe names that match nothing are an empty run, not an error |
