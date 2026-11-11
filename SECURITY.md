# Security

Flowscope shows prompts, code and tool output, so it is built to keep them on your machine. Each guarantee below is a rule in [docs/RULES.md](docs/RULES.md#r-s-security) or a check in [docs/FLOWS.md](docs/FLOWS.md), and is checked by a test that cites its id.

## What it guarantees

| Guarantee | How | Id |
|---|---|---|
| **Read-only** | It never writes to the Claude projects root or the Codex sessions root. A test compares the input tree byte for byte after opening every run and transcript. | F-12.4 |
| **Local only** | Listens on `127.0.0.1` only, and answers `403` to any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding from web pages open in your browser. | R-S1, R-S2 |
| **No outbound requests** | Neither the server nor the page contacts any other host. The page's libraries (marked 12.0.2, DOMPurify 3.1.6, highlight.js 11.9.0 and its two styles) and fonts (IBM Plex, SIL Open Font License) are vendored in `public/vendor/` and served by Flowscope; the scripts and styles carry Subresource Integrity hashes. No analytics, no update checks. | R-S9 |
| **Hostile transcript content stays inert** | All text is HTML-escaped and Markdown goes through DOMPurify; an image in Markdown is drawn only from a `data:` URL, any other is shown as text and never requested (F-12.1). The page has no inline script and no inline event handlers; ids reach the page only as escaped `data-*` attributes. The Content Security Policy below allows nothing from any other host. | R-S3, R-S4, R-S10 |
| **Strict names** | Every path part in a request, and every id placed in the page, must match `^[A-Za-z0-9_-][A-Za-z0-9._-]*$`: no `/`, no leading `.`. Symbolic links in the input roots are not followed. | R-S4, R-S8 |
| **Safe shell commands** | The copied resume command quotes its folder and id. | R-S12 |
| **No error details** | Unexpected errors answer a plain `500 internal error`. | R-S5 |
| **Nothing cached by the browser** | API answers carry `cache-control: no-store` (the run list `no-cache`, revalidated by ETag) and `x-content-type-options: nosniff`. | R-S6 |
| **Private cache** | umask `077`; the cache folder (`$FLOWSCOPE_CACHE`, default `~/.claude/flowscope/`) is `0700`; `cache.db`, its `-wal`/`-shm` files and the log are `0600`. | R-S7 |
| **Bounded work** | Over-long lines are skipped, search queries are capped at 200 characters, search work is bounded. | R-L1, R-L3, R-L4 |
| **Safe stop** | `flowscope stop` signals only a process whose `/api/pid` answer carries `x-flowscope: 1`. | R-S11 |

The Content Security Policy sent with every page and file:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

`style-src` keeps `'unsafe-inline'` because the page sets bar widths and positions with `style` attributes. Styles cannot run script, and with `img-src` and `font-src` limited as above they cannot load anything from another host.

Not defended: another process running as the same user can read the same files Flowscope reads anyway.

The full threat model is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security).

## Reporting a problem

Please open a [private security advisory](https://github.com/safarnejad/flowscope/security/advisories/new) rather than a public issue.
