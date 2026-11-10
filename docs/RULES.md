# Rules: every constant, threshold and limit

The single place where Flowscope's numbers are written down. Other documents cite a rule by its id (`R-T1`) instead of restating its value; code comments may cite it too. A test whose name starts with a rule id checks that rule (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

Words are exact: **over** means strictly greater (`>`), **under** strictly less (`<`), **at least** `>=`, **at most** `<=`. "Idle" is now minus the newest modification time of the files in question.

Ids are stable. A rule that goes away is marked *retired* and its id is never reused.

## R-T: timing

| ID | Rule | Value | Why |
|---|---|---|---|
| R-T1 | Live window. A run without a final record, an agent, or a CLI run is `running` while idle is under this, `stopped` once idle is at least this. | 15 min | An agent waiting on a long tool call (tests, a build) writes nothing until it returns; a shorter window shows healthy runs as stopped. |
| R-T2 | Quiet before done. A plain subagent with a report, or a Claude CLI run that ended on text, is `done` once idle is over this (a subagent whose meta says `finished` needs no wait). | 5 s | Text written mid-turn is soon followed by a tool call; without the wait a working agent flickers to `done`. |
| R-T3 | A run summary is cached in memory and recomputed when a file in it changes, or when idle crosses 10 s or R-T1. | 10 s | Lets R-T2 take effect without a file change, while unchanged runs cost one directory listing per poll. |
| R-T4 | Week window: files modified within the last 7 days contribute their hourly usage buckets that start no earlier than 7 days and 1 hour ago. | 7 days | The closest local stand-in for a weekly plan limit. |
| R-T5 | The week total is reused until it is at least this old. | 30 s | Walking every transcript on each poll is too slow. |
| R-T6 | The CLI batch list is reused until it is at least this old. | 1 s | Several requests in one poll share one scan. |
| R-T7 | Batch gap for runs whose prompts share their first 300 characters: a run starting over this after the previous one starts a new batch. | 30 min | A sequential series with one prompt template (one call per paragraph) spaces out and is still one job. |
| R-T8 | Batch gap for runs with different prompt openings (`PARALLEL_GAP`). | 10 min | Parallel fan-out starts within seconds; unrelated runs in one folder hours apart are separate jobs. |
| R-T9 | Search index: checked every 60 s, dropped when the last search is over 15 min ago. | 60 s / 15 min | A few hundred MB that most visits never use. |
| R-T10 | `start` and `stop` ask `/api/pid` with this timeout. | 3 s | A hung port must not hang the command. |
| R-T11 | `start` waits for the background server to answer: 50 tries, 100 ms apart. | about 5 s | Then it gives up and points at the log. |
| R-T12 | The foreground server builds the run list once, this long after it starts listening (cache warm at boot). | 50 ms | The first page load is then fast. |
| R-T13 | Idle HTTP connections are closed after this. | 30 s | Bun's `idleTimeout`. |
| R-T20 | The page polls `/api/runs` every 3 s, and `/api/run` for the open run while it is `running`. `/api/format` every 60 s. | 3 s / 60 s | Live enough to watch; each unchanged poll is a `304`. |
| R-T21 | Quiet run: a `running` run idle over this is flagged amber "quiet" in the sidebar and home, listed under **Needs a look**, and notified once (again only after it has been idle under this in between). | 10 min | Long enough not to cry wolf during a long tool call. |
| R-T22 | Silent agent: a `running` agent with no pending tool call, idle over this. | 10 min | Same as R-T21, per agent. |
| R-T23 | Stuck wait: a tool call pending for over this is red, says "possibly stuck", is listed under **Needs a look**, and puts `⚠` in the page title. | 10 min | |
| R-T24 | Long wait: a tool call pending for over this is amber. | 2 min | Worth noticing, not yet worth checking. |
| R-T25 | Home's **Needs a look** lists `failed` and `stopped` runs idle under this. | 24 h | Older ones are history. |
| R-T26 | Transcript search waits this long after the last keystroke before asking the server. | 350 ms | |
| R-T27 | While the search index is being built, the page asks again after this. | 1.5 s | |
| R-T28 | A copy button shows its tick for this long. | 1.2 s | |
| R-T29 | Timeline: an idle stretch between agents is cut when it is over 10 min and over a fifth of the total work time; each cut band takes `min(8, 30 / cuts)` % of the track. | 10 min, 1/5 | Runs hours apart stay readable. |

## R-L: limits

| ID | Rule | Value | Why |
|---|---|---|---|
| R-L1 | A single transcript line longer than this is skipped up to its next newline; the rest of the file is read. | 64 MB | One huge line cannot grow memory without bound. |
| R-L2 | Files are read through one buffer of 8 MB; a headless Claude session is recognised from its first 512 KB; the GC is forced before the next file once over 128 MB has been read since the last time. | 8 MB / 512 KB / 128 MB | Bun keeps memory it has once used, so the peak is what stays. |
| R-L3 | Search query, after trimming: under 3 characters returns no hits; over 200 characters is refused with `400`. | 3 / 200 chars | Short queries match everything; long ones cost time for nothing. |
| R-L4 | Search returns at most 200 hits, by file modification time, newest first. Each hit's snippet is the first matching line's text from 60 characters before the match to 100 after its end, whitespace collapsed, with a leading `…` when the match is over 60 characters in. Places are counted up to 1,000. The page shows `200+` when it gets 200. | 200 / 60 / 100 / 1,000 | Bounded work per search. |
| R-L5 | A tool output in a transcript is cut to this many characters, followed by `… (cut)`. | 20,000 chars | |
| R-L6 | An image a tool returned is sent to the page only if its base64 data is under this length (and see R-S10). | 3,000,000 chars | |
| R-L7 | An agent's `now`: its latest text cut to 160 characters, or `<tool>: <hint>` with the hint cut to 140. An API error's text is cut to 200. A CLI run keeps its prompt's first 300 characters (`head`). | 160 / 140 / 200 / 300 | |
| R-L8 | A run's role: its prompt's first non-empty line, without leading `#`s or a leading "You are", "You're", "Act as" or "Tu" (and a following "a", "an", "the"), up to its first sentence end; 71 characters or longer is cut to 68 at a word boundary plus `…`. | 68 chars | |
| R-L9 | CLI runs are grouped by tool and by the first five folders of their working directory. | 5 folders | One repository, even when runs start in different subfolders. |
| R-L10 | Index build yields to requests every 20 files. | 20 files | The server stays responsive while it reads gigabytes. |
| R-L20 | Table mode: a run with over 30 agents shows a table instead of the board; J/K step through the table's filtered rows. | 30 agents | Hundreds of cards do not read. |
| R-L21 | The table shows 100 rows, and **Show more** adds 200; a result is shown to 200 characters. | 100 / 200 | |
| R-L22 | A done agent's result is "empty or one word" when it has at most 2 words. | 2 words | Catches `OK`, `Done.` |
| R-L23 | The sidebar's **Recent** shows 3 finished runs; home's **Finished lately** 6. | 3 / 6 | |
| R-L24 | Syntax highlighting is off for code over 60,000 characters; a guessed language is kept only at relevance at least 12; the highlight cache is cleared when it holds over 2,000 entries. | 60,000 / 12 / 2,000 | Long outputs stay fast; plain text stays plain. |
| R-L25 | A common label prefix is dropped in the table only if it is at least 4 characters (trimmed), cut at a word boundary. | 4 chars | |
| R-L26 | Phone layout at 760 px wide or less. | 760 px | |

## R-S: security

| ID | Rule | Value | Why |
|---|---|---|---|
| R-S1 | The server listens on this address only. | `127.0.0.1` | Other machines cannot reach it. |
| R-S2 | A request whose `Host` is not one of these gets `403 forbidden`. | `127.0.0.1:<port>`, `localhost:<port>` | Blocks DNS rebinding. |
| R-S3 | Every served file carries this Content Security Policy, and the page has no inline script or inline event handler. | `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` | Injected markup cannot run code or reach any other host. Inline *styles* are allowed: the page sets bar widths and positions with them. |
| R-S4 | Safe name: every path part from a request (`p`, `s`, `r`, `a`) and every id placed in the page (project, session, run, agent and CLI run ids) must match this; others are refused (`400`) or left out. | `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` | One path part, never `.` or `..`; nothing that can break out of an attribute. |
| R-S5 | An unexpected error answers a plain `500 internal error`, with no stack or path; the error goes to the server's log. Development error pages are off. | `500` | |
| R-S6 | Every API answer carries `x-content-type-options: nosniff`, `referrer-policy: no-referrer` and `cache-control: no-store`, except `/api/runs`, which is `no-cache` with an ETag. Files served carry `nosniff`, `no-referrer` and R-S3. | | Nothing private lingers in the browser cache; `/api/runs` revalidates. |
| R-S7 | The process umask is `077`. The cache folder is mode `0700` (a failure to set it on an existing folder is warned about, not ignored); `cache.db`, its `-wal` and `-shm` files and the log are `0600`. | `077`, `0700`, `0600` | The cache holds prompts and answers. |
| R-S8 | Symbolic links under the Claude projects root and the Codex sessions root are not followed or read. | | A link cannot point Flowscope at files outside the roots. |
| R-S9 | Only these paths are served: `/`, `/favicon.svg`, `/app.js`, `/theme.js`, and the vendored files under `/vendor/` (marked 12.0.2, DOMPurify 3.1.6, highlight.js 11.9.0 with its `github` and `github-dark` styles, IBM Plex fonts). The scripts and styles carry Subresource Integrity hashes. The page makes no request to any other host. | | No CDN, no tracking, works offline. |
| R-S10 | An image goes into the page only as a `data:` URL rebuilt from a type in this list and plain base64. | `image/png`, `image/jpeg`, `image/gif`, `image/webp` | |
| R-S11 | `stop` signals a pid only from an `/api/pid` answer that carries header `x-flowscope: 1`. | | Never kills another program on the port. |
| R-S12 | A resume command quotes its folder and id for the shell: a value of only letters, digits, `_`, `.`, `/`, `-` is left as is; anything else is single-quoted. | | A folder name cannot inject a command. |

## R-C: cache

| ID | Rule | Value | Why |
|---|---|---|---|
| R-C1 | Per-file results on disk are keyed by the file's `mtime:size`; a changed file is parsed again. | | |
| R-C2 | Each stored kind is suffixed with `@VERSION`. Bump `VERSION` whenever a stored shape (`usage`, `end`, `cli`, `answer`) or the way it is worked out changes; old entries are then not found. | `VERSION = 1` | Deleting the cache folder is always safe too. |
| R-C3 | Cache location: `$FLOWSCOPE_CACHE`, default `~/.claude/flowscope`; files `cache.db` (SQLite, WAL) and, in background mode, `flowscope.log`. | | |

## R-K: counting

| ID | Rule | Value | Why |
|---|---|---|---|
| R-K1 | Weighted usage = input × 1 + cache write × 1.25 + cache read × 0.1 + output × 5. For Codex: input is input minus cached input, cached input counts as cache read. | 1 / 1.25 / 0.1 / 5 | API price ratios, the closest local proxy for plan usage. |
| R-K2 | Claude tokens are counted once per API message id. | | Claude Code logs one line per content block. |
| R-K3 | "Tokens" on the page = input + cache write + output; cache reads are shown apart. | | |
| R-K4 | Headless Claude marker: a session is a CLI run when its first 512 KB contain this. A Codex rollout is one when `session_meta.payload.originator` is `codex_exec`. | `"text":"You are a Claude agent, built on` | |

## R-U: display

| ID | Rule | Value | Why |
|---|---|---|---|
| R-U1 | `ago`: under 60 s `Ns ago`; under 1 h `Nm ago`; under 24 h `Nh ago`; else the local date and time (weekday, day, month, hour, minute). | | |
| R-U2 | `dur`: missing `—`; under 60 s `Ns`; under 1 h `Nm Ns`; under 24 h `Nh Nm`; else `Nd Nh`. | | |
| R-U3 | `tok`: 0 `0`; under 1,000 as is; under 1,000,000 `N.Nk` (one decimal under 10,000, none from there); else `N.NNM`. | | |
| R-U4 | `pct`: missing `—` (a Codex batch); 0 `0%`; under 0.001 `<0.1%`; under 0.1 one decimal; else whole percent. | | |
| R-U5 | Persian text: over 20 characters in U+0600–U+06FF within the first 300 gets `lang="fa"` and its own face and line height. | 20 / 300 | |
| R-U6 | Block direction: right to left when the block has more Hebrew/Arabic-script letters than Latin ones; with neither, by its first strong letter. Applied to each list, table, quote, paragraph, list item, heading and cell. | majority | An English sentence quoting one Persian word stays LTR. |
| R-U7 | Theme, run filter, transcript filter and notifications are kept in `localStorage` (`flowscope.theme`, `.filter`, `.tfilter`, `.notify`); everything else is in memory or the URL hash. | | |

## R-P: process

| ID | Rule | Value | Why |
|---|---|---|---|
| R-P1 | Port: `-p`, else `$FLOWSCOPE_PORT`, else this. | `4747` | |
| R-P2 | Roots: `$CLAUDE_PROJECTS_DIR`, default `~/.claude/projects`; `$CODEX_SESSIONS_DIR`, default `~/.codex/sessions`. | | |
