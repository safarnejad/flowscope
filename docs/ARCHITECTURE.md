# Architecture

Flowscope is a read-only, local viewer for the work Claude Code and Codex do on this machine: every Claude Code session with the subagents and workflows it launched, and headless CLI runs. It has two parts and no build step:

- `server.ts`, a single Bun process. It finds runs on disk, works out their state and token use, keeps a cache, and serves a JSON API and the page.
- `public/index.html`, the whole client: HTML, CSS and plain JavaScript in one file. It polls the API and draws.

This document explains what the server works out and why it is built this way. Every number it relies on (windows, gaps, limits) is in [RULES.md](RULES.md) and cited here by id. [SOURCES.md](SOURCES.md) lists every file read and every field taken from it. [DATA.md](DATA.md) gives the API shapes and how each field reaches the screen. [FLOWS.md](FLOWS.md) describes what a user does, as checks with ids that tests cite. [UX.md](UX.md) covers the interface design.

## Constraints that shape everything

| Constraint | Consequence |
|---|---|
| The input files are Claude Code's and Codex's internal files, not a public format. | Every parse is defensive (bad lines are skipped, missing fields default). Unexpected shapes are recorded as *format issues* and shown as a warning instead of failing silently. |
| Flowscope must never change those files. | The server opens them read-only. The only thing it writes is its own cache (`$FLOWSCOPE_CACHE`, default `~/.claude/flowscope/`) and, in background mode, its log. |
| A workflow's final record exists only after the run ends. | While a run is in progress, its state is inferred from file modification times (see *Status*). |
| Transcripts add up to gigabytes, mostly images and JSON. | Files are streamed through a fixed buffer, filtered by a substring before JSON parsing where possible, and parsed results are cached on disk keyed by `mtime:size`. |
| The data is private: prompts, code, tool output. | The server listens on `127.0.0.1` only, checks the `Host` header, and sends a strict Content Security Policy (see *Security*). |
| The page polls every 3 seconds (R-T20). | Summaries are cached in memory and recomputed only when a file in the run changes or a time threshold is crossed. `/api/runs` answers with an ETag so unchanged lists cost a `304`. |

## Concepts

- **Run**: one row in the sidebar. There are three kinds:
  - `session`: one Claude Code conversation (a `<session>.jsonl` that is not headless), together with the plain subagents (Agent tool) it launched. Its run id is the literal `session`. Its conversation is shown like an agent with the id `main`. (0.1 listed only sessions that launched subagents, as a run `agents`; that id still answers, for old links.)
  - `workflow`: one execution of a workflow script, id `wf_…`. It runs agents in named **phases**.
  - `cli`: a **batch** or a **series** of headless `claude -p` or `codex exec` runs, grouped by the server. Its run id is the literal `cli`, and its session field is `<tool>-<first run's session id>`.
- **Agent**: one card in a run. For `workflow` it is a workflow subagent; for `session` it is a plain subagent (and `main`, the conversation, which is not counted among them); for `cli` it is one headless session.

### Sessions, their subagents and their workflows

A session is one row. Its plain subagents are part of it, not a row of their own: a person thinks of "the conversation where I asked for three reviewers", and the subagents' state reads best beside the conversation that is waiting on them. A session that launched subagents is what the **Agents** filter shows.

A workflow it launched stays a row of its own and is also linked from the session's page, and links back to it ("Launched from"). A workflow has phases, a script, a log and a final result, and is often watched on its own for an hour; folding it into the session would hide its board one level deeper and lose its own status. So the session's row carries a mark that it launched workflows, the session's page lists them, and the two link both ways. A workflow's agents' tokens count in the workflow's row only, so a day's total does not count them twice.

Opening a session that launched nothing opens its conversation in the drawer at once, since that is all there is to see; Esc shows its page. A session with subagents or workflows opens on its page, the **Conversation** card first. The drawer is reused, not the main area, because a conversation is read exactly like an agent's transcript (tool rows, filters, step links, keys, the live line) and the main area keeps the session's overview beside it.
- **Location (`Loc`)**: `{project, session, runId}`, the three path parts that identify a run under `~/.claude/projects`. Each must be a safe name (R-S4: no slashes, no leading dot, so no `..`).

## Status

### Run status

| Kind | Rule |
|---|---|
| workflow | `status` from the final record (`completed`, `failed`, …) when it exists. Otherwise `running` while the run is within the live window (R-T1), else `stopped`. |
| session | `running` while its newest file (the conversation, a subagent's, a workflow's) is within the live window (R-T1). At rest: `stopped` if a subagent of it stopped unfinished, else `completed`. |
| cli | `running` if any run is running; else `stopped` if any run stopped; else `completed`. |

**Why a session at rest is `completed`:** a conversation has no end marker, and nearly every conversation is at rest most of the time. Calling them all `stopped` would fill **Needs a look** (R-T25) and send a "stopped before finishing" notice for each. A session goes there only when something it launched was cut off. For the same reason a running session is *quiet* (R-T21) only while a subagent of it runs, and a session coming to rest sends no notice.

**Why the window is long (R-T1):** an agent waiting on a long tool call writes nothing until the call returns. The cost is that a run killed mid-way still shows `running` until the window passes.

### Agent state (`running` / `done` / `stopped`)

| Kind | `done` when | otherwise |
|---|---|---|
| workflow agent | The journal has a `result` line for it, or the final record's progress says `done`. | `running` if the run is running and the transcript is within R-T1, else `stopped`. Agents from an earlier attempt of a resumed workflow that never finished show as `stopped`. |
| plain subagent | It has a **report** (see below) and either its meta says `finished` or the transcript has been quiet for R-T2. | `running` within R-T1, else `stopped`. |
| Claude CLI run | It ended on a text reply with no API error, and the file has been quiet for R-T2. | same |
| Codex CLI run | The rollout has a `task_complete` event. | same |
| conversation (`main`) | never: it is `running` within R-T1 of its file's last write, else `done` | |

**Report of a plain subagent:** the `message` of its last `SubagentHandback` tool call (background agents), or else its last text if the transcript ends on text (foreground agents). A non-tool-result user message after the report (a `SendMessage` that resumes the agent) clears it. **Why the quiet period (R-T2):** text written mid-turn is quickly followed by a tool call; without the wait a working agent would flicker to `done`.

### Agent details worked out from a transcript (`describe`)

Start time, last activity (file mtime), model, latest effort, token usage, number of tool calls, **now** (the latest text or tool call, shortened), **waiting** (the latest tool call has no result yet and the agent is running: tool name and since when), **peak context** (largest input + cache write + cache read in one request), and **API error** (the last assistant message is flagged `isApiErrorMessage`: kind and text, such as a usage-limit reset time).

## Tokens and share of the week

- Tokens are summed per API message (R-K2): Claude Code logs one line per content block with the same `message.id`.
- **Weighted usage** follows API price ratios (R-K1). It is a local stand-in for plan usage, which only Anthropic's servers know.
- **Week total**: every `.jsonl` under the projects root inside the week window contributes its hourly buckets (R-T4), recomputed per R-T5.
- **Share of the week** = run weighted ÷ week weighted. Codex batches show `—` because Codex is billed separately.

## CLI batches

A headless Claude session is recognised by the Agent SDK's system prompt in the head of the file, and a Codex rollout by its originator (R-K4); interactive sessions are rejected from the head without a full read. A run whose id is not a safe name is left out (R-S4).

Grouping, in `cliBatches()`:

1. Group runs by tool and by the first folders of their working directory (R-L9).
2. Sort each group by start time.
3. Start a new batch when the gap since the previous run's start is over R-T7 if the two prompts share their first 300 characters, or over R-T8 otherwise.

**Why:** a script that fans out parallel calls starts them within seconds; a long sequential series with the same prompt template (one call per paragraph, say) can space out more and still be one job.

4. Then series (R-L13): runs of one tool, in one R-L9 folder, whose roles start with the same five words, form one series when they fall in more than one batch. They leave their batches, and a batch left empty is gone.

**Why series:** an app that asks `claude -p` for each item's title, from the item's own folder, makes one call per meeting, hours or days apart. Gap-based batches cut that stream into one row per day (or per meeting, when its notes call starts with it), so the same name filled the sidebar fifteen times. A batch stays the unit for a fan-out started together; a series is the unit for one call made again and again. A series is checked against batches, not formed on its own, so a parallel fan-out whose prompts happen to share five words stays one batch. Its opening is the role's first five words, not the first 300 characters a batch compares, because an app's prompt names the item or person early ("You write the notes of a meeting for Ana"), and the role leaves out "You are a". The folder is R-L9's, so per-item subfolders (`desk/items/<meeting>`) fall together while separate repositories do not; an app whose items sit fewer than five folders deep gets no series.

A series opens as a table (R-L20), grouped by day, each run named by its folder when the folders differ, since that is what tells an app's runs apart.

**Naming.** Each run gets a *role* (the prompt's first line without "You are a…", R-L8) and a *label* (the prompt's last heading, `# …` or `=== … ===`, which is usually the part that varies). A batch is named by its most common role, with `+N more` if roles differ; a series whose roles differ is named by the words they all start with, and `…`. A card is named by its label when several runs share a role, by its role when it is unique, and by `<newest prompt's heading> · N turns` for a live multi-turn session.

## Caching

Three layers:

1. **In-memory, per poll** (`summaryCache`, `followed` (titles, usage), `transcripts` (R-L12), `endCache`, `cliCache`, `batchCache` (R-T6), `weekCache` (R-T5)). Run summaries are keyed by the mtimes of every file in the run plus two time flags (R-T3), so a run changes state on time alone without a file change.
2. **On disk** (`cache.db`, SQLite, one table `kv(kind, path, key, value)`). Holds per-file results: `usage` and `title` (followed state, below), `head` (what a session's first bytes say, R-L2), `end` (how an agent ended), `cli` (a parsed CLI run without its answer), and `answer` (the CLI run's final answer, read only when that batch is opened). The key is `mtime:size` (R-C1). Each kind is suffixed with `@VERSION`, bumped by the rule in R-C2. Deleting the folder is always safe.
3. **Following** (R-C4). Claude Code only appends to its files. A session's title, every file's usage, and an open transcript are kept with the byte offset read so far and a hash of the file's first 256 bytes; when the file grows, only the new complete lines are read. A live conversation of hundreds of MB then costs what it wrote since the last poll, not a full read. The usage state keeps the last 32 message ids, so a message logged again across two reads replaces its count (R-K2).
4. **Search index** (`textCache`): every searchable transcript's text, lower-cased, kept in memory. Built in the background on the first search (yielding per R-L10), reused while searches arrive, dropped per R-T9.

**Memory.** Bun keeps memory it has once used, so peak memory is what stays. Reading is streamed through one buffer, the GC is forced after a set amount read (R-L2), an over-long line is skipped (R-L1), and strings kept in long-lived structures are copied (`own()`) so they do not pin the large prompt strings they were sliced from.

## Format checks

`odd(what, file)` records the first occurrence of each surprise: a meta file without `agentType`, a journal event type other than `launched`/`started`/`result`, a final record missing `status`/`workflowProgress`/`phases`, a transcript without timestamps, a Codex rollout without `response_item` records. `/api/format` returns them and the sidebar shows a warning.

## Process lifecycle / CLI

| Command or option | Does | Default |
|---|---|---|
| `flowscope`, `flowscope start` | If a Flowscope already answers `/api/pid` on the port (R-T10, R-S11), print it and exit 0. Otherwise spawn `server.ts --foreground` detached, logging to `<cache>/flowscope.log` (R-S7), wait for it to answer (R-T11), print URL, pid and log, exit 0; if it never answers, print where the log is and exit 1. | |
| `flowscope stop` | Ask `/api/pid`; if the answer carries `x-flowscope: 1`, send `SIGTERM` to that pid and print it; otherwise print that Flowscope is not running. Exit 0 either way. | |
| any other command | Print `unknown command` and exit 1. | |
| `-f`, `--foreground` | Serve in this process; build the run list once at boot (R-T12). | off |
| `-p`, `--port <n>` | Port to serve on. | R-P1 |
| `-o`, `--open` | Open the page with the platform's opener (`open`, `xdg-open`, `cmd /c start`). | off |
| `-h`, `--help` | Print usage, the kinds of runs shown, and the environment variables below; exit 0. | |
| `FLOWSCOPE_PORT` | Port, when `-p` is not given. | `4747` |
| `CLAUDE_PROJECTS_DIR` | Claude Code's projects root. | `~/.claude/projects` |
| `CODEX_SESSIONS_DIR` | Codex's sessions root. | `~/.codex/sessions` |
| `FLOWSCOPE_CACHE` | Flowscope's cache and log folder. | `~/.claude/flowscope` |

## Security

The threat model is a local single-user tool that holds sensitive text. Each defence is a rule in [RULES.md](RULES.md#r-s-security); [SECURITY.md](../SECURITY.md) states the guarantees.

| Threat | Defence |
|---|---|
| Other machines on the network | Bound to `127.0.0.1` (R-S1). |
| A web page in the user's browser reading the API (DNS rebinding) | `Host` allow list, else `403` (R-S2). Plain cross-origin reads are already blocked because the API sends no CORS headers. |
| Path traversal through `p`, `s`, `r`, `a` | Safe names only (R-S4). |
| A symbolic link in the input roots pointing elsewhere | Links are not followed (R-S8). |
| Hostile text in transcripts (a fetched web page, a tool output) rendered as HTML | All text is HTML-escaped; Markdown goes through DOMPurify, and an image in it that is not a `data:` URL becomes text, so a transcript cannot make the page ask any address, not even the page's own; every id that reaches the page is a safe name (R-S4) and is placed only in escaped `data-*` attributes, read by one delegated listener, never in code; image data URLs are rebuilt from a type list (R-S10). The CSP (R-S3) allows no inline script and no host but the page's own, so injected markup can neither run nor send data out. |
| A shell command built from a transcript | The resume command quotes its folder and id (R-S12). |
| A tampered library | Libraries and fonts are vendored in `public/vendor/` at pinned versions and served by Flowscope (R-S9); scripts and styles carry Subresource Integrity hashes. |
| Error details leaking paths or code | Plain `500` (R-S5). |
| Private answers kept by the browser | `cache-control: no-store` on API answers (R-S6). |
| A huge or hostile file exhausting memory | Line cap (R-L1), query cap (R-L3), bounded search work (R-L4). |
| `flowscope stop` killing the wrong process | Marker header (R-S11). |
| Other local users reading the cache or log | umask and file modes (R-S7). |

Not defended: another process running as the same user can read the same files Flowscope reads anyway.

## Known limits

- Status lag of up to R-T1 for a killed run (by design, see above).
- Share of the week covers this machine only.
- The API reads everything on demand. With tens of thousands of transcripts, the first start and the first search take tens of seconds; later starts use the disk cache. The first start reads every session file twice through a needle (titles, usage); later starts read only what changed.
- Search covers subagents', workflow agents' and CLI runs' transcripts, not the conversations themselves: their text would add hundreds of MB to the index (R-T9).
- A series needs its items at least five folders deep (R-L9, R-L13).
