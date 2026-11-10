# Architecture

Flowscope is a read-only, local viewer for work that Claude Code and Codex do without a human watching each step: workflow runs, plain subagents, and headless CLI runs. It has two parts and no build step:

- `server.ts`, a single Bun process. It finds runs on disk, works out their state and token use, keeps a cache, and serves a JSON API and the page.
- `public/index.html`, the whole client: HTML, CSS and plain JavaScript in one file. It polls the API and draws.

This document explains what the server works out and why it is built this way. [SOURCES.md](SOURCES.md) lists every file read and every field taken from it. [DATA.md](DATA.md) gives the API shapes and how each field reaches the screen. [FLOWS.md](FLOWS.md) describes what a user does, written as end-to-end test cases. [UX.md](UX.md) covers the interface design.

## Constraints that shape everything

| Constraint | Consequence |
|---|---|
| The input files are Claude Code's and Codex's internal files, not a public format. | Every parse is defensive (bad lines are skipped, missing fields default). Unexpected shapes are recorded as *format issues* and shown as a warning instead of failing silently. |
| Flowscope must never change those files. | The server opens them read-only. The only thing it writes is its own cache (`$FLOWSCOPE_CACHE`, default `~/.claude/flowscope/`) and, in background mode, its log. |
| A workflow's final record exists only after the run ends. | While a run is in progress, its state is inferred from file modification times (see *Status*). |
| Transcripts add up to gigabytes, mostly images and JSON. | Files are streamed through a fixed buffer, filtered by a substring before JSON parsing where possible, and parsed results are cached on disk keyed by `mtime:size`. |
| The data is private: prompts, code, tool output. | The server listens on `127.0.0.1` only, checks the `Host` header, and sends a strict Content Security Policy (see *Security*). |
| The page polls every 3 seconds. | Summaries are cached in memory and recomputed only when a file in the run changes or a time threshold is crossed. `/api/runs` answers with an ETag so unchanged lists cost a `304`. |

## Concepts

- **Run**: one row in the sidebar. There are three kinds:
  - `workflow`: one execution of a workflow script, id `wf_…`. It runs agents in named **phases**.
  - `agents`: a pseudo-run that groups all plain subagents (Agent tool) launched by one session. Its run id is the literal `agents`.
  - `cli`: a **batch** of headless `claude -p` or `codex exec` runs, grouped by the server. Its run id is the literal `cli`, and its session field is the batch id `<tool>-<first run's session id>`.
- **Agent**: one card in a run. For `workflow` it is a workflow subagent; for `agents` it is a plain subagent; for `cli` it is one headless session.
- **Location (`Loc`)**: `{project, session, runId}`, the three path parts that identify a run under `~/.claude/projects`. Each must match `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` (no slashes, no leading dot, so no `..`).

## Status

### Run status

| Kind | Rule |
|---|---|
| workflow | `status` from the final record (`completed`, `failed`, …) when it exists. Otherwise `running` if any file in the run changed in the last 15 minutes (`LIVE_MS`), else `stopped`. |
| agents | `running` if any agent is running; else `stopped` if any agent stopped; else `completed`. |
| cli | Same rule over the batch's runs. |

**Why 15 minutes:** an agent waiting on a long tool call (tests, a build) writes nothing until the call returns. A shorter window would show healthy runs as stopped. The cost is that a run killed mid-way still shows `running` for up to 15 minutes. This is documented on the page.

### Agent state (`running` / `done` / `stopped`)

| Kind | `done` when | otherwise |
|---|---|---|
| workflow agent | The journal has a `result` line for it, or the final record's progress says `done`. | `running` if the run is running and the transcript changed within 15 minutes, else `stopped`. Agents from an earlier attempt of a resumed workflow that never finished show as `stopped`. |
| plain subagent | It has a **report** (see below) and either its meta says `finished` or the transcript has been quiet for 5 seconds. | `running` within 15 minutes, else `stopped`. |
| Claude CLI run | It ended on a text reply with no API error, and the file has been quiet for 5 seconds. | same |
| Codex CLI run | The rollout has a `task_complete` event. | same |

**Report of a plain subagent:** the `message` of its last `SubagentHandback` tool call (background agents), or else its last text if the transcript ends on text (foreground agents). A non-tool-result user message after the report (a `SendMessage` that resumes the agent) clears it. **Why the 5-second quiet period:** text written mid-turn is quickly followed by a tool call; without the wait a working agent would flicker to `done`.

### Agent details worked out from a transcript (`describe`)

Start time, last activity (file mtime), model, latest effort, token usage, number of tool calls, **now** (the latest text or tool call, shortened), **waiting** (the latest tool call has no result yet and the agent is running: tool name and since when), **peak context** (largest input + cache write + cache read in one request), and **API error** (the last assistant message is flagged `isApiErrorMessage`: kind and text, such as a usage-limit reset time).

## Tokens and share of the week

- Tokens are summed per API message. Claude Code logs one line per content block with the same `message.id`, so usage is de-duplicated by message id.
- **Weighted usage** = input × 1 + cache write × 1.25 + cache read × 0.1 + output × 5, following API price ratios. It is a local stand-in for plan usage, which only Anthropic's servers know.
- **Week total**: every `.jsonl` under the projects root modified in the last 7 days contributes its hourly buckets from the last 7 days. Recomputed at most every 30 seconds.
- **Share of the week** = run weighted ÷ week weighted. Codex batches show `—` because Codex is billed separately.

## CLI batches

A headless Claude session is recognised by the Agent SDK's system prompt (`"text":"You are a Claude agent, built on`) in the first 512 KB of the file; interactive sessions are rejected there without a full read. A Codex rollout is recognised by `session_meta.payload.originator == "codex_exec"`.

Grouping, in `cliBatches()`:

1. Group runs by tool and by the first six path parts of their working directory.
2. Sort each group by start time.
3. Start a new batch when the gap since the previous run's start exceeds 30 minutes if the two prompts share their first 300 characters, or 10 minutes otherwise.

**Why:** a script that fans out parallel calls starts them within seconds; a long sequential series with the same prompt template (one call per paragraph, say) can space out more and still be one job.

**Naming.** Each run gets a *role* (the prompt's first line without "You are a…", up to about 68 characters) and a *label* (the prompt's last heading, `# …` or `=== … ===`, which is usually the part that varies). A batch is named by its most common role, with `+N more` if roles differ. A card is named by its label when several runs share a role, by its role when it is unique, and by `<newest prompt's heading> · N turns` for a live multi-turn session.

## Caching

Three layers:

1. **In-memory, per poll** (`summaryCache`, `titleCache`, `usageCache`, `endCache`, `cliCache`, `batchCache` (1 s), `weekCache` (30 s)). Run summaries are keyed by the mtimes of every file in the run plus two time flags (idle under 10 s, idle under 15 min), so a run changes state on time alone without a file change.
2. **On disk** (`cache.db`, SQLite, one table `kv(kind, path, key, value)`). Holds per-file results: `usage`, `end` (how an agent ended), `cli` (a parsed CLI run without its answer), and `answer` (the CLI run's final answer, read only when that batch is opened). The key is `mtime:size`; a changed file is simply re-parsed. Each kind is suffixed with `@VERSION`; bumping `VERSION` orphans old entries. Deleting the folder is always safe.
3. **Search index** (`textCache`): every searchable transcript's text, lower-cased, kept in memory. Built in the background on the first search (yielding every 20 files), reused while searches arrive, dropped after 15 minutes without one.

**Memory.** Bun keeps memory it has once used, so peak memory is what stays. Reading is streamed through one 8 MB buffer, the GC is forced every 128 MB read, and strings kept in long-lived structures are copied (`own()`) so they do not pin the large prompt strings they were sliced from.

## Format checks

`odd(what, file)` records the first occurrence of each surprise: a meta file without `agentType`, a journal event type other than `launched`/`started`/`result`, a final record missing `status`/`workflowProgress`/`phases`, a transcript without timestamps, a Codex rollout without `response_item` records. `/api/format` returns them and the sidebar shows a warning.

## Process lifecycle

- `flowscope` (or `flowscope start`): if a Flowscope already answers `/api/pid` on the port, print it and exit. Otherwise spawn `server.ts --foreground` detached, log to `<cache dir>/flowscope.log`, poll for up to 5 seconds until it answers, and exit.
- `flowscope stop`: ask `/api/pid`, check that the answer carries Flowscope's marker header, and send `SIGTERM` to that pid.
- `--foreground`: serve in this process. 50 ms after start it builds the run list once, so the first page load is fast.
- `--open`: open the page with the platform's opener (`open`, `xdg-open` or `start`).

## Security

The threat model is a local single-user tool that holds sensitive text. The defences:

| Threat | Defence |
|---|---|
| Other machines on the network | Bound to `127.0.0.1`. |
| A web page in the user's browser reading the API (DNS rebinding) | Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`; anything else gets `403`. Plain cross-origin reads are already blocked because the API sends no CORS headers. |
| Path traversal through `p`, `s`, `r`, `a` | Each must match the safe-name pattern above: no `/`, no leading `.`. |
| Hostile text in transcripts (a fetched web page, a tool output) rendered as HTML | All text is HTML-escaped, Markdown goes through DOMPurify, ids placed into inline handlers are restricted to safe names on the server, image data URLs are rebuilt from a whitelist of image types. A Content Security Policy limits scripts, styles and fonts to the page and three CDNs, images to the page and `data:`, and connections to the page itself, so injected markup cannot send data out by loading a remote image or calling `fetch`. |
| A tampered CDN script | Each CDN script and the highlight.js stylesheets carry a Subresource Integrity hash. (Google Fonts' CSS varies by browser and cannot be pinned; CSP limits it to styles and fonts.) |
| `flowscope stop` killing the wrong process | The pid is accepted only from a response carrying the `x-flowscope` header. |
| Other local users reading the cache or log | The cache folder is created with mode `0700`, and the log lives in it instead of a shared temp folder. |

Not defended: another process running as the same user can read the same files Flowscope reads anyway.

## Known limits

- Status lag of up to 15 minutes for a killed run (by design, see above).
- Share of the week covers this machine only.
- The API reads everything on demand. With tens of thousands of transcripts, the first start and the first search take tens of seconds; later starts use the disk cache.
- The page needs internet for Markdown, sanitising, syntax colours and fonts (CDNs). Without them, Markdown results do not render.
