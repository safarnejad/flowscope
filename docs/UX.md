# UX design

## Who it is for and what they ask

A developer who has started work that runs without them: a workflow with dozens of agents, a script firing a hundred `claude -p` calls, background subagents. They glance at Flowscope between other work. The questions, in order of how often they are asked:

1. Is anything still running, and is it moving?
2. Did something go wrong: stuck, stopped, failed, out of quota?
3. What did agent X answer?
4. What exactly did agent X do, step by step?
5. How much did it cost, and what held it up?

The design puts the answer to each question one level deeper than the one before it: home → run → agent → step.

## Principles

- **Now first.** Home and the sidebar open on what is running; finished work is "Recent" (3 runs) and the rest is behind History, grouped by day.
- **Problems surface themselves.** Silent agents, long tool waits, stopped agents, empty or one-word answers, usage limits: each is counted in a strip of buttons above the board ("Needs a look") and colours the item itself (amber over 2 minutes, red over 10).
- **Live but steady.** The page refreshes every 3 seconds while a run is live, but a redraw never closes what the reader opened, moves their scroll, or steals focus from a search box. Identical HTML is not redrawn.
- **Honest state.** Status that is inferred is explained (the 15-minute rule is in the README and a column note). When the input files look unfamiliar, a warning says so instead of showing wrong numbers.
- **Every view has an address.** Run, agent and transcript step are in the URL hash; Back, Forward and pasted links work.
- **Read, not inspect.** Results and agent text render as Markdown; tool inputs as labelled fields; JSON output as tables; code highlighted by language. Raw JSON is the fallback, not the default.
- **Bidirectional text.** Each block takes its direction from its own text, so Persian or Arabic results read right to left with correct list bullets, in a face made for the script (IBM Plex Sans Arabic, taller line height), while English stays left to right.

## Layout

```
┌──────────────┬───────────────────────────────────────────┐
│ Flowscope 🔔 ◐│ Run name  [running]                       │
│ [search    ] │ description                               │
│ All Wf Ag CLI│ done/started · running · elapsed · tokens │
│ ⚠ format     │ ▓▓▓▓▓░░░ phase strip / progress bar       │
│ RUNNING      │ [Board|Timeline]  [Copy resume command]   │
│  run …       │ (2 agents silent over 10m) (1 stopped)    │
│ RECENT       │ ┌Phase 1─┐ ┌Phase 2─┐ ┌Phase 3─┐          │
│  run …       │ │ card   │ │ card   │ │        │          │
│ History (n) ›│ └────────┘ └────────┘ └────────┘          │
│ IN TRANSCR…  │ ▸ Log  ▸ Final result  ▸ Script           │
└──────────────┴───────────────────────────────────────────┘
                              drawer slides in from the right ▶
```

- **Sidebar (300 px).** Brand (click = home), notifications bell, theme switch, search, kind filter, format warning, run list, transcript hits. Each row: name, status (pulsing badge when running, else ✓ ✕ ■), "N of M going", kind, time, project folder kept to its end.
- **Main.** Home, or one run.
- **Drawer.** Up to 880 px, over the main area: title, state, resume / previous / next / keys / close, one meta line, tabs Task · Result · Transcript.

## Run view

- **Stats row**: done of started, running now, longest tool wait (only when someone waits), elapsed, tokens (hover for the split), cache reads, share of the week, last activity.
- **Progress**: workflows with phases get one segment per phase (done, active with moving stripes, stopped, pending) and "Phase k of n · active phase"; other runs get a plain bar.
- **Board**: one column per phase (or Running / Done / Stopped). Columns are 200–360 px wide, so one phase does not stretch into a banner. Cards: two-line label, kind, state badge (not for done), flags (usage limit, API error, attempt n), tools, tokens, peak context, and either "ago" (running) or the duration; a running card adds its current action or "⏳ waiting on Tool for N"; a finished card has a thin bottom bar for its duration against the slowest agent.
- **Table** (over 30 agents): number with a state colour, label with the shared prefix removed and named once in the header, tokens, took, start of result. Shape filters (All, Answers, Empty or one word, Running, Stopped) with counts, a search box, 100 rows then "Show more".
- **Timeline**: lanes grouped by phase on a shared axis; long idle stretches cut and drawn as hatched bands with their length, so agents hours apart are still readable; labels that would overlap are dropped.
- **Folded panels**: Log (open), Final result, Script.

## Transcript

Ordered as a story: the **task** (pinned style, accent edge), the agent's words in full, and each tool call folded into one row with its output: tool name in a fixed mono column, its description or command (without a leading `cd`), and on the right its duration, output size and status (red edge for error, amber for pending). Later user messages show as "message"; system notes fold under their tag name. Filters: All, Agent only, Errors. Copy and link buttons sit quietly in each step's Input/Output heading and show "Copied" / "Link copied" with a tick once done. A running agent ends with a live line: "working" or "running Tool for N".

## Keyboard

| Key | Action |
|---|---|
| `/` | search runs |
| `j` / `k`, ↓ / ↑ | next / previous agent (drawer open) |
| `p` / `r` / `t` | Task / Result / Transcript |
| `?` | key list |
| Esc | close the drawer |

Keys are ignored while typing in an input or with ⌘/Ctrl held. Key hints appear on hover next to the tabs, hidden on touch screens.

## Visual system

- IBM Plex Sans / Plex Sans Arabic / Plex Mono.
- Colour tokens on `:root`: background, panel, ink, mute, line, accent (blue), run (orange), ok (green), bad (red), code. A dark set applies when chosen or when the system is dark and nothing else was chosen.
- State colours are fixed: running orange, done/completed green, failed red, stopped grey. They appear as a 3 px leading edge on rows and cards and as tinted badges.
- Icons are 16 px line icons in the logo's stroke weight.

## Small screens (≤ 760 px)

The run list and a run are separate screens with a "‹ Runs" back button; phase columns stack; the drawer fills the screen; hover-only hints are hidden.

## Notifications

Opt-in with the bell. One notification per change: finished, failed, stopped before finishing, or quiet for 10 minutes (repeated only after it has been active again). Clicking one focuses the tab and opens the run.
