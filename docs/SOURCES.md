# Input files: what Flowscope reads and how

Flowscope reads files that Claude Code and Codex write for their own use. None of these formats are documented or stable; this is what Flowscope relies on as of late 2026. When one changes, start here, and check the format warning in the sidebar (`/api/format`).

Roots:

| Root | Default | Override |
|---|---|---|
| Claude Code projects | `~/.claude/projects` | `$CLAUDE_PROJECTS_DIR` |
| Codex sessions | `~/.codex/sessions` | `$CODEX_SESSIONS_DIR` |

Under the Claude root, `<project>` is the working directory with every non-alphanumeric character replaced by `-` (for example `-Users-me-code-app`), and `<session>` is a session UUID.

## How files are read

- **JSONL** files are read in chunks (R-L2) and split on newlines. A line that fails to parse is skipped, and an over-long line is skipped unread (R-L1). Symbolic links under the roots are not followed (R-S8). When only some lines matter, the raw bytes are first searched for a needle (`"usage"`, `"ai-title"`, `"cwd"`), and only lines containing it are decoded and parsed.
- **JSON** files are read whole; a parse failure counts as "absent".
- **Header probes** read only the head of a file (`sessionHead`, R-L2), to classify a session and name it without reading all of it; a session's card reads only its tail (R-L14).
- **Followed** files (a session's title, any file's usage, an open transcript) are read on from where the last read stopped when they grow (R-C4).
- Every derived result is cached by the file's `mtime:size` (see [ARCHITECTURE.md](ARCHITECTURE.md#caching)).

## Claude Code: workflow runs

Directory: `<root>/<project>/<session>/`

| File | Read by | Fields used | Becomes |
|---|---|---|---|
| `subagents/workflows/<runId>/` (dir name must start `wf_`) | `listRuns` | the name | one workflow run |
| `subagents/workflows/<runId>/journal.jsonl` | `summary`, `detail` | `type` (`launched`, `started`, `result`), `agentId`, `label`, `phase`, `result` | agents started / done; each agent's label, phase, and result (string, or object pretty-printed as JSON) |
| `subagents/workflows/<runId>/agent-<id>.meta.json` | `detail`, search | `description`, `workflowPhase` | label and phase when the journal lacks them |
| `subagents/workflows/<runId>/agent-<id>.jsonl` | `describe`, `fileUsage`, transcript, search | see *Transcripts* | card details, tokens, transcript |
| `workflows/<runId>.json` (final record, written at the end) | `summary`, `detail` | `status`, `workflowName`, `summary`, `startTime`, `durationMs`, `phases[]` (`title`, `detail`), `workflowProgress[]` (entries with `type: "workflow_agent"`: `agentId`, `startedAt`, `model`, `attempt`, `state`), `logs[]`, `result`, `script` | run status, name, description, duration, phase columns, per-agent model/attempt, log, final result, script fallback |
| `workflows/scripts/<name>-<runId>.js` | `scriptFor` | file text; regex for `name:`, `description:`, `phases: [{ title, detail }]` | the Script panel; name, description and phases while the run has no final record |
| `../<session>.jsonl` (the session itself) | see *Sessions* | | the session the workflow is linked from; the folder for the resume command |

## Claude Code: sessions

File: `<root>/<project>/<session>.jsonl`. Every such file whose head lacks the marker in R-K4 is a session run (a headless one is a CLI run, below).

| Read | Fields used | Becomes |
|---|---|---|
| head (R-L2) | the R-K4 marker; the first `cwd`; the first `timestamp`; the first `type: "user"` line that is not `isMeta` and whose `message.content` (string, or `text` blocks) does not start with `<` | headless or not; the folder (description, resume command); start; the name when there is no title (R-L11) |
| lines with `"ai-title"` (followed, R-C4) | `type: "ai-title"`, `aiTitle` (last wins) | the name |
| lines with `"usage"` (followed) | as *Transcripts* | the session's tokens, with its subagents' |
| tail (R-L14) | as *Transcripts*: last assistant action, pending `tool_use`, `message.model`, `effort`, `message.usage`, `isApiErrorMessage` | the **Conversation** card |
| the whole file, only when opened (followed) | as *Transcripts* | the conversation's transcript |
| file time | mtime | with its subagents' and workflows' files: last activity and running/at rest (R-T1) |

## Claude Code: plain subagents

Directory: `<root>/<project>/<session>/subagents/`

| File | Fields used | Becomes |
|---|---|---|
| `agent-<id>.meta.json` | `agentType` (agents with `workflow-subagent` are skipped here), `description`, `requestShape` (`background`), `finished` | label, type, background flag, `done` signal |
| `agent-<id>.jsonl` | see *Transcripts*; plus `SubagentHandback` tool calls (`input.message`) | card details, the agent's report (its Result) |

These belong to the session's run. A session folder with such agents is listed even when its `.jsonl` is missing or headless.

## Claude Code: headless CLI runs (`claude -p`)

File: `<root>/<project>/<session>.jsonl`, the same place as interactive sessions.

| Check / field | Use |
|---|---|
| The head contains the marker in R-K4 | it is headless (Agent SDK system prompt); otherwise it is a session (above) |
| first `type: "user"` line: `sessionId`, `cwd`, `timestamp`, `message.content` | run id (a safe name, R-S4, else the run is skipped), folder, start time, prompt (role, label, `head` for grouping, R-L7) |
| every user line with text | turn count; newest prompt's heading for live sessions |
| the rest | as *Transcripts*; result = final text when the run ended on text |

## Codex: headless runs (`codex exec`)

Files: every `*.jsonl` under the Codex root, recursively.

| Record | Fields used | Use |
|---|---|---|
| line 1, `type: "session_meta"` | `payload.originator` must be `codex_exec`; `payload.id` (a safe name, R-S4, else the run is skipped), `payload.cwd`, `payload.timestamp` | id, folder, start |
| `type: "turn_context"` | `payload.model` (first), `payload.effort` (last) | model, effort |
| `type: "response_item"`, `payload.type: "message"` | `role` (`user`, `assistant`; `developer` skipped), `content[].text`; user text starting `<environment_context` is skipped | prompt, agent text |
| `response_item` with `payload.type` `function_call`, `custom_tool_call`, `local_shell_call` | `name`, `call_id`, `input` / `arguments` / `action` | tool calls, waiting state |
| `response_item` with `payload.type` ending in `_output` | `call_id`, `output` (string, JSON string with `output`, or array of `{text}`) | tool outputs |
| `event_msg` with `payload.type: "token_count"` | last `info.total_token_usage` (`input_tokens`, `cached_input_tokens`, `output_tokens`); max `info.last_token_usage.input_tokens` | tokens (input = input − cached), peak context |
| `payload.type: "task_complete"` | `last_agent_message` | done; result |

## Transcripts (Claude Code)

One JSON object per line. Flowscope uses:

| Field | Use |
|---|---|
| `type` (`user`, `assistant`; others ignored) | who spoke |
| `timestamp` | start time (first line), per-step times, hourly usage buckets |
| `message.id` | de-duplicating usage (one line per content block) |
| `message.model` | model (first assistant line) |
| `message.usage`: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` | tokens, peak context |
| `message.content`: string, or blocks `text`, `tool_use` (`id`, `name`, `input`), `tool_result` (`tool_use_id`, `content` as string or blocks of `text` / `image` with `source.media_type`, `source.data`, `is_error`) | transcript, current action, waiting state, ending |
| `effort` | effort level (last value) |
| `isApiErrorMessage`, `error` | API error / usage limit on the last assistant line |

Limits applied when sending a transcript to the page: tool output text is cut per R-L5; images are dropped per R-L6 and R-S10.

## What is written

| Path | Content |
|---|---|
| `$FLOWSCOPE_CACHE/cache.db` (+ `-wal`, `-shm`), default `~/.claude/flowscope/` | derived results, including CLI answers |
| `$FLOWSCOPE_CACHE/flowscope.log` | the background server's stdout and stderr |

Nothing else is written.
