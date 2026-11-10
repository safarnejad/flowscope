# Data mapping: API shapes and where each field is shown

The page talks to the server only through these GET endpoints. All return JSON unless noted, with the headers in R-S6. Every request must come with an allowed `Host` (R-S2). Numbers below cite [RULES.md](RULES.md).

| Endpoint | Returns |
|---|---|
| `/`, `/app.js`, `/theme.js` | the page and its scripts |
| `/favicon.svg` | the icon |
| `/vendor/…` | vendored libraries, styles and fonts (R-S9) |
| `/api/pid` | the server's pid as text, with header `x-flowscope: 1` (used by `start` and `stop`) |
| `/api/runs` | `RunSummary[]`, newest activity first; ETag, `304` when unchanged |
| `/api/run?p=&s=&r=` | `RunDetail` |
| `/api/agent?p=&s=&r=&a=` | `Event[]`, one agent's transcript |
| `/api/search?q=` | `{ indexing, hits }`; limits in R-L3, R-L4 |
| `/api/format` | `FormatIssue[]` |

`p` is the raw project directory name (`projectKey`), `s` the session (or CLI batch id), `r` the run id (`wf_…`, `agents`, or `cli`), `a` an agent id.

## Errors

Every error is a short plain-text body; none carries a stack, a path or file content.

| Status | Body | When |
|---|---|---|
| `400` | `bad request` | `/api/run` or `/api/agent` with `p`, `s` or `r` missing or not a safe name (R-S4); `/api/agent` with `a` missing or not a safe name. |
| `400` | `query too long` | `/api/search` with `q` over 200 characters after trimming (R-L3). |
| `403` | `forbidden` | Any request whose `Host` is not allowed (R-S2), checked before anything else. |
| `404` | `not found` | A path that is not served (R-S9) or not an endpoint above; `/api/run?r=cli` with an unknown batch id. |
| `500` | `internal error` | Anything unexpected while answering (R-S5). |

An unknown workflow or session with valid names is not an error: `/api/run` answers an empty run and `/api/agent` an empty list.

## RunSummary

| Field | Type | Meaning | Shown |
|---|---|---|---|
| `kind` | `workflow` \| `agents` \| `cli` | run kind | sidebar kind tag, filter buttons |
| `tool` | `claude` \| `codex` | CLI only | kind tag |
| `project` | string | project folder, slashes restored (approximate) | sidebar tooltip |
| `projectKey` | string | raw folder name | sidebar project line (its end), `p=` |
| `session` | string | session id, or CLI batch id | URL hash, `s=` |
| `runId` | string | `wf_…`, `agents`, `cli` | URL hash, `r=` |
| `name` | string | workflow name; session title; CLI batch name | sidebar, home tiles, run header, notifications |
| `description` | string | workflow summary or a generated line | run header; included in run search |
| `status` | `running` \| `completed` \| `failed` \| `stopped` | see ARCHITECTURE | badges, colours, home sections, notifications |
| `startTime` | ms \| null | workflow final record, or the first CLI run | — |
| `durationMs` | ms \| null | workflow final record | run "elapsed" (else computed from agents) |
| `usage` | `Usage` | summed tokens | run stats, home "tokens today" |
| `weekShare` | number \| null | fraction of the week's weighted usage; null for Codex | run stats; per-agent share in the drawer |
| `agents`, `agentsDone` | number | started, finished | sidebar "N of M going", run bar |
| `lastActivity` | ms | newest mtime in the run | sidebar time, grouping by day, quiet detection |

`Usage` = `{ input, cacheWrite, cacheRead, output, weighted }`. "Tokens" on the page means `input + cacheWrite + output`; cache reads are shown separately.

## RunDetail

`RunSummary` plus:

| Field | Meaning | Shown |
|---|---|---|
| `phases` | `{ title, detail? }[]`: workflow phases; for `agents` and `cli` the fixed columns Running, Done, Stopped | board columns, phase strip, timeline groups |
| `logs` | string[] (workflow) | Log panel |
| `result` | any (workflow final result) | Final result panel (Markdown or JSON) |
| `script` | string (workflow) | Script panel, highlighted |
| `resume` | shell command (workflow, agents) | Copy resume command |
| `agents` | `Agent[]` | cards, table rows, timeline lanes, drawer |

## Agent

| Field | Meaning | Shown |
|---|---|---|
| `agentId` | id; safe name | URL hash, `a=` |
| `label` | description / journal label / CLI label | card title, table row, drawer title |
| `phase` | column title (`—` if none) | which column |
| `type` | agent type, or `claude`/`codex` for CLI | card tag, drawer meta |
| `background` | plain subagent ran in background | — |
| `state` | `running` \| `done` \| `stopped` | card edge colour, badge, table status bar |
| `result` | string; present only when done | Result tab, table "Result" column, "empty or one word" check |
| `startedAt`, `lastActivity` | ms | card duration or "ago", timeline bar, table "Took" |
| `model`, `effort`, `attempt` | strings / number | drawer meta; `attempt > 1` is flagged |
| `usage`, `tools`, `peakContext` | numbers | card line, drawer meta, timeline tooltip |
| `now` | latest action (R-L7) | running card's last line, table result column while running |
| `waiting` | `{ tool, since }` \| null | "⏳ waiting on X for N", longest wait stat, needs-a-look strip |
| `apiError` | `{ kind, text }` \| null | red "usage limit" / "API error" flag, needs-a-look strip, red timeline bar |
| `resume` | CLI only: resume command for this run | terminal button in the drawer |

## Event (transcript)

| `kind` | Fields | Shown as |
|---|---|---|
| `prompt` | `text`, `ts` | first: the **task** row (also the Task tab); later ones: **message** rows, or folded system notes when the text starts with a tag like `<system-reminder>` |
| `text` | `text`, `ts` | the agent's words, as Markdown |
| `tool` | `id`, `name`, `text` (hint), `input` (JSON text or raw), `desc`, `cmd`, `ts` | a folded row: tool name, description or shortened command/path, duration, output size, status |
| `output` | `for` (tool id), `text` (cut per R-L5), `error`, `images` (data URLs, R-S10, R-L6), `ts` | folded into its tool's row; shown alone only if its tool call is missing |

## Search

`hits[]`: `{ run: "<session>/<runId>", agentId, label, snippet, count, at }`, at most 200, newest first, snippet and count per R-L4. `indexing` is `{ done, total }` while the first index is being built (then `hits` is empty and the page asks again per R-T27), otherwise null. The page shows only hits whose run is in the current run list.

## FormatIssue

`{ what, file, at }`: one per kind of surprise, the first file it was seen in.

## Client state

| State | Where kept |
|---|---|
| open run, open agent, transcript step | URL hash `#<session>/<runId>[/<agentId>[/<step>]]` |
| theme, run filter, transcript filter, notifications on | `localStorage` (R-U7) |
| view (board/table vs timeline), table search, shape filter, rows shown | memory only |
