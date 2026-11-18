# Changelog

What changed for people using Flowscope, by version. Versions follow semver; before 1.0 a minor version may change behaviour (see [CONTRIBUTING.md](CONTRIBUTING.md#releasing)).

## 0.2.0

- `flowscope --version` prints the version, and the sidebar shows it under the name. Nothing checks for a newer one.

**Every session is listed.**
- Every Claude Code conversation is now a run of its own, kind `session`, named by its title (or its first prompt), dated by its last word, `running` while anything in it was written in the last 15 minutes. Before, a conversation showed only if it launched subagents, so an important thread could be missing.
- A session and the subagents it launched are one row. A live conversation whose subagents finished days ago stays among today's runs instead of sinking into History.
- Opening a session shows its **Conversation** card, the workflows it launched and its subagents' board; the conversation opens in the side drawer, read like any agent's transcript. A session that launched nothing opens straight into its conversation.
- A workflow stays a row of its own; the session lists it, and the workflow's page links back ("Launched from").
- A conversation at rest is `completed`, not flagged quiet or under Needs a look, and sends no notification, unless a subagent of it was left unfinished.

**Filters and marks.**
- The filters are **All · Sessions · Agents · Workflows · CLI**. Agents are the sessions that launched subagents. A filter remembered by 0.1 keeps working.
- In the list, a session that launched subagents or workflows carries a small mark for each, with a tooltip.

**Repeating CLI calls are one series.**
- `claude -p` or `codex exec` calls that an app makes again and again, each from its item's own folder in one repository (a title for each meeting, say), with prompts that start with the same five words, are one row however far apart: "Claude ×15: Give this meeting a short title from what was said". It opens as a table of every run, grouped by day, each named by its folder. Calls started together stay a batch, as before.

**Other.**
- `--help` says what Flowscope covers: Claude Code sessions, subagents and workflows, and headless Claude Code and Codex CLI runs.
- Links from 0.1 to a session's subagents (`#<session>/agents/…`) still open.
- A live conversation, its title and its token count are read on from where the last read stopped, not from the start, so a long session stays cheap to watch. The cache is rebuilt once on upgrade (its format changed).

## 0.1.0

First release.
- A live, local, read-only view of Claude Code workflow runs, the plain subagents of a session, and headless `claude -p` and `codex exec` runs, grouped into batches.
- Phases as columns and agents as cards, a timeline, a table for big batches, the needs-a-look strip, browser notifications.
- Each agent's result, task and transcript, search inside transcripts, deep links to a step, copy resume command.
- Tokens per run and agent, and each run's share of the last 7 days of Claude Code usage.
- Localhost only, strict Content Security Policy, vendored libraries with integrity hashes, no outbound requests.
