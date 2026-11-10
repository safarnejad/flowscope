## What changes for the user

<!-- One or two plain sentences of behaviour, as the commit subject would say it. -->

## Spec sections changed

<!-- docs/FLOWS.md, docs/RULES.md, docs/ARCHITECTURE.md, docs/DATA.md, docs/SOURCES.md, docs/UX.md, README.md, SECURITY.md -->

## F- and R- ids

| Id | Added, changed or retired | Test that cites it |
|---|---|---|
| | | |

## Checks

- [ ] `bun test` passes
- [ ] `bun run trace` passes, and `BASELINE` in `scripts/trace.ts` is raised if coverage grew
- [ ] Every new or changed number is in docs/RULES.md and cited by id elsewhere, not restated
- [ ] Retired ids are marked retired, not deleted or reused
- [ ] The docs alone are still enough to reimplement this
