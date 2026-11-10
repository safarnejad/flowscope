# Contributing

## The docs are the source of truth

Flowscope is specified by its documents. The code is one implementation of them: someone should be able to rewrite Flowscope in another language from the docs alone and pass the same checks. So every change updates the docs and the code together, in the same pull request.

| Document | Specifies |
|---|---|
| [docs/FLOWS.md](docs/FLOWS.md) | what a user does and what must happen, as checks `F-<section>.<n>` |
| [docs/RULES.md](docs/RULES.md) | every constant, threshold and limit, as rules `R-<group><n>` |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how state, tokens, batches and caching are worked out; the CLI; the threat model |
| [docs/DATA.md](docs/DATA.md) | API shapes, errors, and where each field is shown |
| [docs/SOURCES.md](docs/SOURCES.md) | every input file and field read |
| [docs/UX.md](docs/UX.md) | the interface |
| [SECURITY.md](SECURITY.md) | the security guarantees |

CI fails a pull request that changes `server.ts`, `public/` or `scripts/` without changing anything under `docs/`, `README.md` or `SECURITY.md`. A change that truly has no documented effect (a refactor, a comment) carries the label `no-doc-change`.

## Ids

| Kind | Form | Where defined | Example |
|---|---|---|---|
| Check | `F-<section>.<n>` | first cell of a row in docs/FLOWS.md | `F-4.7` |
| Rule | `R-<group><n>`; groups T timing, L limits, S security, C cache, K counting, U display, P process | first cell of a row in docs/RULES.md | `R-T1` |
| Fixture | `X<n>` | docs/FLOWS.md, *Fixtures* | `X2` |

- An id is defined once. It is never renumbered or reused: a check or rule that no longer holds stays in its table, marked *retired*.
- A number lives only in docs/RULES.md. Other documents, and code comments, cite its id instead of restating it.
- Say **over**, **under**, **at least** or **at most**, never "after" or "within", so a boundary is never in doubt.

## Tests cite ids

A test's name starts with the ids it checks, then says what it checks in plain words:

```ts
test("F-4.10 R-T1 a workflow quiet past the live window is stopped, and so are its unfinished agents", …)
```

A check's **Test** column in docs/FLOWS.md names the tests that cite it (separated by `;`), or `—`.

`bun run trace` (`scripts/trace.ts`) reads the ids from the docs and the test names and fails when an id is defined twice, when a test, a document or a code comment cites an id that does not exist (or a test cites a retired one), when a Test column and the tests disagree, or when coverage falls below `BASELINE`. It prints how many ids are covered. When you cover more, raise `BASELINE` to the new count.

## Running

```sh
bun test          # end-to-end tests: the server against a fixture tree in a temp folder
bun run trace     # docs and tests agree; prints coverage
bun run demo /tmp/flowscope-demo   # the fixture tree, to look at by hand
```

Tests never read or write the real `~/.claude` or `~/.codex`: they set `CLAUDE_PROJECTS_DIR`, `CODEX_SESSIONS_DIR` and `FLOWSCOPE_CACHE` to temp folders.

The tests drive the API and the CLI. Checks that are only about drawing the page (most of sections 2, 3, 6, 8, 9, 10 of docs/FLOWS.md) are `—` for now: browser end-to-end tests are future work.

## Dependencies

None. The page's libraries and fonts are vendored in `public/vendor/` at pinned versions, with Subresource Integrity hashes in `public/index.html` (R-S9). To update one, replace the file from its upstream release, update its version in docs/RULES.md and SECURITY.md, and its hash in `index.html`; the test for F-12.7 checks that hash and file agree.
