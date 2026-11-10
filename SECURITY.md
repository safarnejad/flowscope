# Security

Flowscope shows prompts, code and tool output, so it is built to keep them on your machine.

## What it guarantees

- **Read-only.** It never writes to `~/.claude/projects` or `~/.codex/sessions`. A test checks the input tree byte for byte after opening every run and transcript.
- **Local only.** It listens on `127.0.0.1` and answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS-rebinding attacks from web pages open in your browser.
- **No telemetry.** It makes no outbound requests. The page loads three pinned libraries (marked, DOMPurify, highlight.js) and fonts from public CDNs (jsDelivr, cdnjs, Google Fonts); the scripts carry Subresource Integrity hashes.
- **Hostile transcript content stays inert.** Transcripts can hold text from web pages and tool output. All text is escaped, Markdown goes through DOMPurify, and a Content Security Policy (`default-src 'none'`, `img-src 'self' data:`, `connect-src 'self'`) stops injected markup from loading remote resources or sending data out.
- **Strict input names.** Every path part in an API request must be one safe name: no `/`, no leading `.`.
- **Private cache.** Its cache and log live in `~/.claude/flowscope/` with mode `0700`.
- **Safe stop.** `flowscope stop` signals only a process that identifies itself as Flowscope.

The full threat model is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security).

## Reporting a problem

Please open a [private security advisory](https://github.com/safarnejad/flowscope/security/advisories/new) rather than a public issue.
