# User flows and end-to-end checks

What a user does and what must happen, as checks with stable ids `F-<section>.<n>`. These tables are the specification: a test whose name starts with a check's id checks it, and `bun run trace` keeps the two in step (see [CONTRIBUTING.md](../CONTRIBUTING.md)). The **Test** column names that test, or says `—` when no automated test covers the check yet. Tests of the server and the CLI are in `test/` (`bun test`); tests of the page, driven in Chromium, are in `e2e/` (`bun run e2e`). Numbers come from [RULES.md](RULES.md), cited by id.

Ids are never reused. A check that no longer holds is marked *retired* in its row and stays in the table.

Tests run against a fixture tree, never the real `~/.claude`:

```sh
CLAUDE_PROJECTS_DIR=$FIX/claude CODEX_SESSIONS_DIR=$FIX/codex FLOWSCOPE_CACHE=$FIX/cache \
  bun server.ts --foreground --port 4799
```

Time-based states are tested by setting file times (`utimes`), not by waiting.

## Fixtures

`scripts/demo.ts` writes X1, X2, X4, X5, X6 and X10–X12; the tests derive X3, X7, X8 and X9 from them.

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
| X10 | Plain conversations, no subagents: one live with an `ai-title` and a tool call; one from three days ago with no title whose first user line is a command's echo (`<command-name>…`) and whose first prompt is over 68 characters; one with no prompt and no title. |
| X11 | A live conversation (file written minutes ago) whose two subagents finished two days ago. |
| X12 | An app's `claude -p` calls over five days, each from its meeting's own folder under one repository: 15 title calls with one prompt opening, and 15 notes calls whose openings differ after the fifth word ("…a meeting for Ana"); each meeting's two calls start together. |

## 1. Start and stop

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-1.1 | nothing running | `bun server.ts` | prints the URL and pid and exits 0; `GET /api/pid` answers the pid with header `x-flowscope: 1` (R-S11) | F-1.1 R-S11 marks its pid answer, so stop never kills another program |
| F-1.2 | Flowscope running on the port | `bun server.ts` again | prints "already running" and starts nothing new | F-1.2 F-1.3 R-S7 starts in the background once, and stop stops it |
| F-1.3 | Flowscope running | `bun server.ts stop` | it stops; `/api/pid` no longer answers | F-1.2 F-1.3 R-S7 starts in the background once, and stop stops it |
| F-1.4 | another program answers `/api/pid` on the port without `x-flowscope` | `stop` | reports that Flowscope is not running and kills nothing | F-1.4 R-S11 stop leaves alone another program on the port |
| F-1.5 | a start | — | the cache folder exists with mode `0700`; `cache.db` and its WAL files are `0600`; the background log is in the folder and `0600` (R-S7) | F-1.5 R-S7 keeps its cache private |
| F-1.7 | — | `--version` | prints `flowscope <version>` from its `package.json` and exits 0; nothing is started and nothing is fetched | F-1.7 F-2.5 prints and shows its own version, from package.json |
| F-1.6 | — | `--help` | its first line says it covers Claude Code sessions, subagents and workflows and headless Claude Code and Codex CLI runs; it names `claude -p` and `codex exec`, and every environment variable with its default | F-1.6 help says what it covers, names Codex, CLI runs and every environment variable |

## 2. Home page

Given X1, X2, X3, X4. Open `/`.

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-2.1 | runs of every state | open `/` | the sidebar has **Running** with X2 and the X4 session, **Recent** with up to 3 finished runs (R-L23); older ones sit behind **History (N) ›** | F-2.1 F-2.2 R-L23 R-K3 home: running, recent and history in the sidebar, Now with today's counts |
| F-2.2 | same | open `/` | the main area shows **Now** with the count running, runs active today and today's tokens (R-K3) | F-2.1 F-2.2 R-L23 R-K3 home: running, recent and history in the sidebar, Now with today's counts |
| F-2.3 | X3, and a running run quiet over R-T21 | open `/` | **Needs a look** lists X3 as stopped (idle under R-T25) and the quiet run | F-2.3 R-T21 a running run quiet over 10 minutes is under Needs a look; F-9.2 F-2.3 F-4.10 R-T25 a run that stops is told once and its notice opens it, home lists it under Needs a look |
| F-2.5 | — | open `/` | the sidebar shows `v<version>` from `GET /api/version` under the name, and the name's tooltip says `Flowscope <version>` | F-2.5 the sidebar shows the running version; F-1.7 F-2.5 prints and shows its own version, from package.json |
| F-2.4 | a run open | click **Flowscope** | returns home and clears the URL hash | F-2.4 clicking Flowscope returns home and clears the hash |

## 3. Filter and search runs

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-3.1 | all fixtures | the filters read **All · Sessions · Agents · Workflows · CLI**; click each, reload | Sessions shows every session; Agents only the sessions that launched subagents (X4, X11, …); Workflows X1–X3; CLI the batches and series. The choice is kept, a value kept by 0.1 means the same, and an unknown one falls back to All (R-U7) | F-3.1 R-U7 the kind filter shows only that kind and is kept across a reload |
| F-3.2 | all fixtures | type part of a run's name | the list filters, grouped by day; no match shows "No run's name matches" | F-3.2 F-3.3 F-3.4 search: names by day, then hits inside transcripts that open the agent |
| F-3.3 | text only inside a transcript | type at least 3 characters of it | **In transcripts** shows "Reading transcripts…" first (R-T27), then hits with the match highlighted; clicking a hit opens its run and that agent's transcript | F-3.2 F-3.3 F-3.4 search: names by day, then hits inside transcripts that open the agent |
| F-3.4 | focus not in an input | press `/` | the search box takes focus | F-3.2 F-3.3 F-3.4 search: names by day, then hits inside transcripts that open the agent |
| F-3.5 | All | look at a session's row | a session that launched subagents shows the subagents mark, one that launched workflows the workflow mark, each with a tooltip naming how many ("Launched 4 subagents"); other rows show none | F-3.5 in All, a session shows a mark for the subagents and the workflows it launched |

## 4. A workflow run

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-4.1 | X1 | open it | header: name and `completed` badge, description, stats (done of started 7/7, elapsed = `durationMs`, tokens, cache reads, share of the week, last activity) | F-4.1 F-4.4 F-4.5 R-S12 a finished workflow: status, phases, results, log, script, resume; F-4.1 F-4.2 F-4.3 F-4.4 a finished workflow's page: header, phase strip, columns, cards, folded sections |
| F-4.2 | X1 | open it | the phase strip has one segment per phase, all done; "Phase 3 of 3" | F-4.1 F-4.2 F-4.3 F-4.4 a finished workflow's page: header, phase strip, columns, cards, folded sections |
| F-4.3 | X1 | open it | one column per phase with "done/total"; each card shows label, tool count, tokens, peak context and duration, with a thin bar relative to the slowest agent | F-4.1 F-4.2 F-4.3 F-4.4 a finished workflow's page: header, phase strip, columns, cards, folded sections |
| F-4.4 | X1 | open it | **Log** is open; **Final result** and **Script** are folded and expand | F-4.1 F-4.4 F-4.5 R-S12 a finished workflow: status, phases, results, log, script, resume; F-4.1 F-4.2 F-4.3 F-4.4 a finished workflow's page: header, phase strip, columns, cards, folded sections |
| F-4.5 | X1 | **Copy resume command** | copies `cd <cwd> && claude --resume <session>`, each part quoted per R-S12 | F-4.1 F-4.4 F-4.5 R-S12 a finished workflow: status, phases, results, log, script, resume; F-4.5 R-S12 Copy resume command copies the session's command |
| F-4.6 | X2 | open it | status `running`; phases come from the script; a phase with no agents shows as a column marked "not started" | F-4.6 F-4.7 a live workflow: running, one agent waiting on a tool, phases from the script; F-4.6 F-4.7 F-4.8 R-T24 a live workflow: phase not started, a long wait in amber, ● in the title |
| F-4.7 | X2 | open it | the card in mid tool call shows "⏳ waiting on <Tool> for …"; amber over R-T24, red with "possibly stuck" over R-T23, and the needs-a-look strip shows "1 agent waiting on a tool over 10m" | F-4.6 F-4.7 a live workflow: running, one agent waiting on a tool, phases from the script; F-4.6 F-4.7 F-4.8 R-T24 a live workflow: phase not started, a long wait in amber, ● in the title; F-4.7 F-4.8 R-T23 a tool wait over 10 minutes is red, possibly stuck, flagged, and ⚠ in the title |
| F-4.8 | X2 | open it | the page title starts with `●`, or `⚠` when a wait is over R-T23 | F-4.6 F-4.7 F-4.8 R-T24 a live workflow: phase not started, a long wait in amber, ● in the title; F-4.7 F-4.8 R-T23 a tool wait over 10 minutes is red, possibly stuck, flagged, and ⚠ in the title |
| F-4.9 | X2 open | wait | the view refreshes per R-T20; an expanded tool call and the scroll position stay as they were | F-4.9 R-T20 a live run refreshes and keeps what was opened and where it was scrolled |
| F-4.10 | X3 | open it | status `stopped`; unfinished agents are `stopped` (R-T1) | F-4.10 R-T1 a workflow quiet past the live window is stopped, and so are its unfinished agents; F-9.2 F-2.3 F-4.10 R-T25 a run that stops is told once and its notice opens it, home lists it under Needs a look |

## 5. Plain subagents

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-5.1 | X4 | open it | it is a `session` run; the name is the latest `ai-title`; its subagents' columns Running, Done, Stopped, empty ones hidden | F-5.1 F-5.2 F-5.3 plain subagents: handback, text answer, working, usage limit |
| F-5.2 | X4 | open it | the background agent is Done with the handback message as its Result; the foreground one is Done with its last text | F-5.1 F-5.2 F-5.3 plain subagents: handback, text answer, working, usage limit |
| F-5.3 | X4 | open it | the API-error agent is stopped with a red "usage limit" flag, and the strip leads with "1 agent hit a usage limit (…reset time…)" | F-5.1 F-5.2 F-5.3 plain subagents: handback, text answer, working, usage limit; F-5.3 a usage limit shows on the card and leads the needs-a-look strip |
| F-5.4 | X4, a done agent | append a user prompt line to its transcript | within one poll it is Running and has no result | F-5.4 R-T2 a resumed subagent runs again |

## 6. Agent drawer

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-6.1 | a run open | click a card | the drawer opens on **Result** when there is one, else **Transcript**; the hash becomes `#<session>/<runId>/<agentId>` | F-6.1 F-6.2 R-U7 the drawer opens on Result or Transcript, tabs and transcript filters work and are kept |
| F-6.2 | drawer open | switch tabs and filters | **Task** shows the first prompt; **Transcript** shows the task row, agent text as Markdown, and tool rows with name, label, duration, output line count; errors red. Filters **All / Agent only / Errors** work and are remembered (R-U7) | F-6.1 F-6.2 R-U7 the drawer opens on Result or Transcript, tabs and transcript filters work and are kept |
| F-6.3 | a transcript | expand a tool row | Input as labelled fields; Output as a table or pretty JSON for JSON, Markdown for prose tools, code highlighted by file extension (R-L24) | F-6.3 a tool row opens to labelled input and highlighted output |
| F-6.4 | a transcript | click a step's link button | copies a URL ending `/<step>`; opening it scrolls to and opens that step, highlighted | F-6.4 a step's link button copies a link that opens that step |
| F-6.5 | drawer open | `j`/`k`, ↓/↑, `p`/`r`/`t`, `?`, Esc | next/previous agent; tabs; the key list; Esc closes and restores the hash to the run | F-6.5 keys: j/k and arrows step agents, p/r/t switch tabs, ? lists keys, Esc closes and restores the hash |
| F-6.6 | runs opened in turn | Back / Forward, or paste a hash | moves between runs; a pasted hash opens the same run and agent | F-6.6 Back and Forward move between runs, a pasted link opens the run and agent |

## 7. CLI batch (big run)

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-7.1 | X5 | list runs | one run named `Claude ×40: <role>` (R-L8), grouped per R-L9, R-T7, R-T8 | F-7.1 F-7.3 F-7.6 R-T7 40 claude -p runs are one batch, named by their role, with two one-word answers |
| F-7.2 | X5 | open it | with over R-L20 agents the board is a **Table**: #, label without the common prefix (R-L25), tokens, took, start of the result | F-7.2 F-7.3 F-7.5 R-L20 R-L22 R-L25 a batch over 30 agents is a table, shape filters count, j/k follow the filtered rows |
| F-7.3 | X5 | open it | shape filters show counts: All 40, Answers, Empty or one word 2 (R-L22), Running, Stopped; the search box filters by label and result | F-7.1 F-7.3 F-7.6 R-T7 40 claude -p runs are one batch, named by their role, with two one-word answers; F-7.2 F-7.3 F-7.5 R-L20 R-L22 R-L25 a batch over 30 agents is a table, shape filters count, j/k follow the filtered rows |
| F-7.4 | X5 | scroll the table | the first rows show, and **Show more** adds more (R-L21) | F-7.4 R-L21 the table shows 100 rows and Show more adds the rest |
| F-7.5 | X5, drawer open | `j`/`k` | follow the filtered table order | F-7.2 F-7.3 F-7.5 R-L20 R-L22 R-L25 a batch over 30 agents is a table, shape filters count, j/k follow the filtered rows |
| F-7.6 | X5, drawer open | click the terminal button | copies `claude --resume <id>` for that run | F-7.1 F-7.3 F-7.6 R-T7 40 claude -p runs are one batch, named by their role, with two one-word answers; F-7.6 R-S12 the drawer's terminal button copies the run's resume command, its folder quoted |
| F-7.7 | X6 | open it | share of the week is `—` (R-U4); the run with `task_complete` is Done, the other Running or Stopped by time | F-7.7 codex runs: done by task_complete, no share of the week |
| F-7.8 | X12 | list runs | two series rows (R-L13): `Claude ×15: Give this meeting a short title from what was said` and `Claude ×15: You write the notes of a meeting for…` (named by the words their roles share), `series: true`, dated by their newest run; no batch of those runs is left; X5 stays one batch | F-7.8 R-L13 an app's calls fired one per item over days are a series each, not a batch per day |
| F-7.9 | X12 | open the title series | a **Table** of all 15 runs although under R-L20 agents, grouped under one row per day, each run named by its folder | F-7.9 R-L20 a series opens as a table of all its runs, grouped by day, each named by its folder |

## 8. Timeline

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-8.1 | a run | **Timeline** | one lane per agent on a shared axis, grouped by phase for workflows; running bars striped, API-error bars red | F-8.1 F-8.3 the timeline: a lane per agent by phase, running striped, a usage limit red, a lane opens its agent |
| F-8.2 | agents started hours apart | **Timeline** | idle stretches are cut per R-T29 and drawn as hatched bands labelled "N idle" | F-8.2 R-T29 agents hours apart: the idle stretch is cut and labelled |
| F-8.3 | timeline shown | click a lane | that agent opens | F-8.1 F-8.3 the timeline: a lane per agent by phase, running striped, a usage limit red, a lane opens its agent |

## 9. Notifications

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-9.1 | bell off | click the bell | asks for browser permission; refused, it stays off | F-9.1 refused permission leaves the bell off |
| F-9.2 | bell on | a run goes from running to completed, failed or stopped | one notification; clicking it opens the run | F-9.2 F-2.3 F-4.10 R-T25 a run that stops is told once and its notice opens it, home lists it under Needs a look |
| F-9.3 | bell on | a running run is quiet over R-T21 | one notification, and again only after it has been active in between | F-9.3 R-T21 R-U7 a quiet run is told once, and again only after it was active in between |

## 10. Theme and layout

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-10.1 | — | Auto / light / dark | the theme switches and is remembered (R-U7); Auto follows the system | F-10.1 R-U7 the theme switches, is remembered, and Auto follows the system |
| F-10.2 | a narrow window (R-L26) | — | the sidebar and the run are separate screens with a **Runs** back button; phases stack; the drawer is full width | F-10.2 R-L26 a narrow window shows the sidebar and the run as separate screens |
| F-10.3 | Persian text | it is drawn | it gets the Persian face (R-U5) and each block its own direction (R-U6) | F-10.3 R-U5 R-U6 Persian gets its face and each block its own direction |

## 11. Format warning

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-11.1 | X8 | `GET /api/format` after the run is read | lists each kind of surprise once, with the first file it was seen in | F-11.1 the format endpoint names each surprise once, with its file |
| F-11.2 | X8 | open `/` | the sidebar shows "Claude Code's files look different…" naming the issues; the tooltip lists the files | F-11.2 a surprise in Claude Code's files shows a warning naming it, with the file in the tooltip |

## 12. Safety

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-12.1 | X7 hostile Markdown (`<img onerror>`, `javascript:` link, remote image, `<script>`) in a browser | open the transcript | no script runs and no dialog opens, the `javascript:` link is removed; an image not in a `data:` URL is shown as `[image: <alt>]` with its address in the tooltip and is never requested, so no request leaves for the remote host and none reaches the content policy | F-12.1 R-S3 hostile Markdown runs no script, keeps no javascript: link, and reaches no other host |
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

## 14. Sessions

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F-14.1 | X10, X5 | list runs | each conversation is one `session` run, the live one `running` and named by its `ai-title`, the old one `completed` and named by its first prompt (R-L11) with its tokens counted; the empty one is not listed; no headless session is a session run | F-14.1 R-L11 every session is a run, named by its AI title or else its first prompt, and an empty one is left out |
| F-14.2 | X11 | list runs | one row for the session and its subagents, `running`, dated by the conversation's file (R-T1), above runs from earlier today; its detail has the conversation as agent `main` with its latest words | F-14.2 R-T1 a session that launched subagents is one run, dated and kept running by its conversation |
| F-14.3 | X10 live | click it in the sidebar | it launched nothing, so the drawer opens at once on the conversation's **Transcript**, hash `#<session>/session/main`; Esc closes it and shows the session's page with its **Conversation** card and no board | F-14.3 a session that launched nothing opens on its conversation, and Esc shows its page |
| F-14.4 | X11 | open it | the **Conversation** card (its latest action, R-L14) sits above **Subagents** and their board; clicking it opens the conversation in the drawer; `j` steps on to the first subagent | F-14.4 R-L14 a session with subagents shows its conversation above its subagents' board |
| F-14.5 | X2's session | open it | **Workflows it launched** lists X2, which opens it; X2 stays a run of its own, and its page says "Launched from" the session, which opens it | F-14.5 a session lists the workflows it launched, and the workflow stays a run of its own; F-14.5 a session lists the workflows it launched, and the workflow links back to it |
| F-14.6 | X4 | `GET /api/run?…&r=agents`, or open a 0.1 link `#<session>/agents/<agent>` | the session is answered and opened, with that agent in the drawer | F-14.6 a link from 0.1 to a session's subagents answers the session; F-14.6 a link from 0.1 to a session's subagents opens the session and the agent |
| F-14.7 | X10 live | `GET /api/agent?…&r=session&a=main`, then append half a line, then the rest | the conversation as events; the half line is not read until it ends; then it is, and the card's latest action follows (R-C4) | F-14.7 R-C4 the conversation's transcript is read as it grows |
| F-14.8 | X10 live quiet 12 minutes; X10 old; the session of `Long build` | open `/` | X10 live is `running` but not quiet and not under **Needs a look**, nor is X10 old; `Long build`, whose subagent runs, is (R-T21) | F-14.8 R-T21 a conversation at rest needs no look, and one is quiet only while a subagent of it runs |
| F-14.9 | X11; X10 live | open the conversation (it opens on **Transcript**), then **Latest reply** (`r`) | it shows Claude's text since the last prompt, the same as `main.result` in the run's detail; a conversation whose last prompt has no answer yet says so instead of "No result yet" | F-14.9 R-L14 a conversation's Latest reply is Claude's answer to the last prompt; F-14.9 a conversation's Latest reply tab shows Claude's answer to the last prompt |
