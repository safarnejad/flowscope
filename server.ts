#!/usr/bin/env bun
// Flowscope: reads Claude Code's sessions, subagents and workflow runs from ~/.claude/projects, and headless CLI runs of
// Claude Code and Codex, and serves a live view of them on localhost.
// It never changes Claude Code's files; the only thing it writes is its own cache, ~/.claude/flowscope/cache.db.
import { readdirSync, readFileSync, statSync, lstatSync, existsSync, openSync, readSync, closeSync, mkdirSync, chmodSync } from "node:fs";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    foreground: { type: "boolean", short: "f" },
    port: { type: "string", short: "p" },
    open: { type: "boolean", short: "o" },
    help: { type: "boolean", short: "h" },
  },
});
if (args.help) {
  console.log(`flowscope: a live view of Claude Code sessions, subagents and workflows, and of headless Claude Code and Codex CLI runs

  flowscope [start]  start in the background; does nothing if it is already running
  flowscope stop     stop the running server

  -f, --foreground serve in this terminal instead of the background
  -p, --port <n>   port to serve on (default 4747, or $FLOWSCOPE_PORT)
  -o, --open       open the page in the browser
  -h, --help       show this help

  Shows every Claude Code session with the subagents and workflows it launched, and headless \`claude -p\`
  and \`codex exec\` runs, in batches and in series.

  Environment:
    FLOWSCOPE_PORT       port, when -p is not given (default 4747)
    CLAUDE_PROJECTS_DIR  Claude Code's projects (default ${join(homedir(), ".claude", "projects")})
    CODEX_SESSIONS_DIR   Codex's sessions (default ${join(homedir(), ".codex", "sessions")})
    FLOWSCOPE_CACHE      Flowscope's own cache and log (default ${join(homedir(), ".claude", "flowscope")})`);
  process.exit(0);
}

const ROOT = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
const PORT = Number(args.port ?? process.env.FLOWSCOPE_PORT ?? 4747);
const PUBLIC = join(import.meta.dir, "public");
const url = `http://127.0.0.1:${PORT}`;
// The cache and the log hold prompts and answers, so their folder is the user's alone (not a shared temp folder).
// Everything Flowscope creates (cache folder, cache.db and its -wal/-shm files, the log) is the user's alone (R-S7).
process.umask(0o077);
const CACHE_DIR = process.env.FLOWSCOPE_CACHE ?? join(homedir(), ".claude", "flowscope");
mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
try { chmodSync(CACHE_DIR, 0o700); } catch (e) { console.warn(`flowscope: could not make ${CACHE_DIR} private (mode 0700): ${(e as Error).message}`); }
const LOG = join(CACHE_DIR, "flowscope.log");
const opener = process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"];
const openPage = () => { try { Bun.spawn([...opener, url]); } catch { console.log(`open ${url} in a browser`); } };

// The pid of a Flowscope already serving on PORT, or null. Asks the server itself, so a stale pid file can't mislead,
// and trusts only an answer marked as Flowscope's, so `stop` never kills another program that holds the port.
const runningPid = async (): Promise<number | null> => {
  try {
    const r = await fetch(`${url}/api/pid`, { signal: AbortSignal.timeout(3000) });
    const pid = Number(await r.text());
    return r.ok && r.headers.get("x-flowscope") === "1" && Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
};

const command = positionals[0] ?? "start";
if (command === "stop") {
  const pid = await runningPid();
  if (pid === null) console.log(`Flowscope is not running on ${url}`);
  else { process.kill(pid); console.log(`Flowscope stopped (pid ${pid})`); }
  process.exit(0);
}
if (command !== "start") { console.error(`unknown command: ${command} (try --help)`); process.exit(1); }
if (!args.foreground) {
  let pid = await runningPid();
  if (pid !== null) console.log(`Flowscope already running on ${url} (pid ${pid})`);
  else {
    const log = openSync(LOG, "a", 0o600);
    try { chmodSync(LOG, 0o600); } catch {}
    spawn(process.execPath, [import.meta.path, "--foreground", "--port", String(PORT)], { detached: true, stdio: ["ignore", log, log] }).unref();
    for (let i = 0; i < 50 && pid === null; i++) { await Bun.sleep(100); pid = await runningPid(); }
    if (pid === null) { console.error(`Flowscope did not start; see ${LOG}`); process.exit(1); }
    console.log(`Flowscope on ${url} (pid ${pid}, log ${LOG}); stop with: flowscope stop`);
  }
  if (args.open) openPage();
  process.exit(0);
}
// A run without its final record is "running" while anything in it was written this recently. Generous, because an agent
// waiting on a long command (tests, a browser, a background task) writes nothing until the command returns.
const LIVE_MS = 15 * 60_000; // R-T1

// What Flowscope has worked out from each file (a run's summary, token counts, how an agent ended, an answer), kept
// on disk with the file's size and time, so a restart reads only files that are new or changed since. Answers of
// finished CLI runs, the bulk of it, stay here and are read when that run is opened. Bump VERSION when a stored
// shape changes, and the old entries are simply not found.
const VERSION = 2; // R-C2
const DB = join(CACHE_DIR, "cache.db");
const db = new Database(DB);
db.run("PRAGMA journal_mode = WAL"); db.run("PRAGMA synchronous = OFF");
db.run("CREATE TABLE IF NOT EXISTS kv (kind TEXT, path TEXT, key TEXT, value TEXT, PRIMARY KEY (kind, path))");
// A cache made before the umask was set may be readable by others; it is made private too (R-S7).
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) try { chmodSync(f, 0o600); } catch (e) { console.warn(`flowscope: could not make ${f} private: ${(e as Error).message}`); }
const getQ = db.prepare("SELECT key, value FROM kv WHERE kind = ? AND path = ?");
const putQ = db.prepare("INSERT OR REPLACE INTO kv VALUES (?, ?, ?, ?)");
const fileKey = (f: string) => { try { const st = statSync(f); return `${st.mtimeMs}:${st.size}`; } catch { return "none"; } };
function stored<T>(kind: string, path: string, key: string, make: () => T): T {
  const k = `${kind}@${VERSION}`, hit = getQ.get(k, path) as { key: string; value: string } | null;
  if (hit?.key === key) return JSON.parse(hit.value);
  const v = make();
  putQ.run(k, path, key, JSON.stringify(v));
  return v;
}
// A name that is one path part: no slash, and no leading dot, so never "." or "..". Ids and folder names that end up
// in the page's links and click handlers must pass it too, so a file name can't break out of them.
const SAFE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/; // R-S4

// Entries of a folder under the input roots, without symbolic links: a link could point Flowscope at files outside
// the roots it was given (R-S8). Regular files and folders only.
const ls = (dir: string) => {
  if (!existsSync(dir)) return [];
  try { return readdirSync(dir, { withFileTypes: true }).filter((d) => !d.isSymbolicLink()).map((d) => d.name); } catch { return []; }
};
const mtime = (f: string) => (existsSync(f) ? statSync(f).mtimeMs : 0);
// Transcripts are read in pieces through one buffer and decoded a line at a time, or, given a needle, only the
// lines that contain it. Reading each whole file into memory left the process at 2.5GB: Flowscope reads gigabytes
// of transcripts, and Bun keeps memory it has once used.
const CHUNK = Buffer.allocUnsafe(8 << 20);
// A single line longer than this is skipped up to its end, so one huge line cannot grow memory without bound (R-L1).
const MAX_LINE = 64 << 20;
// Calls `each` with every line of a file from byte `from` on (or, given a needle, only the lines that contain it) and
// returns the offset just past the last complete line, so an append-only file can be read on from there next time.
// `partial` also takes a last line with no newline yet (a whole read); a follower leaves it for the next read.
function eachLine(f: string, each: (l: string) => void, o: { needle?: string; from?: number; partial?: boolean } = {}): number {
  // Every 128MB read, before the next file: by then the last ones' parsed records are garbage, and collected before
  // they pile up. Memory Bun has once used it keeps, so the peak is what stays.
  if (readSinceGc > 128 << 20) { readSinceGc = 0; Bun.gc(true); }
  const from = o.from ?? 0;
  let fd: number;
  try { fd = openSync(f, "r"); } catch { return from; }
  const n = o.needle ? Buffer.from(o.needle) : null;
  let pos = from, end = from, carry: Buffer | null = null, skipping = false, read = 0;
  const emit = (data: Buffer, s: number, e: number) => { if (e > s) { read += e - s; each(data.toString("utf8", s, e)); } };
  try {
    for (;;) {
      const got = readSync(fd, CHUNK, 0, CHUNK.length, pos);
      // `base` is the file offset of data[0].
      let base = pos - (carry?.length ?? 0);
      pos += got;
      let data: Buffer = carry ? Buffer.concat([carry, CHUNK.subarray(0, got)]) : CHUNK.subarray(0, got);
      carry = null;
      if (skipping) {
        const nl = data.indexOf(10);
        if (nl < 0) { if (!got) break; continue; }
        data = data.subarray(nl + 1); base += nl + 1; end = base; skipping = false;
      }
      // Complete lines only; the rest waits for the next piece, or ends the file.
      const cut = data.lastIndexOf(10) + 1;
      const stop = !got && o.partial ? data.length : cut;
      if (!n) for (let s = 0; s < stop; ) { const e0 = data.indexOf(10, s), e = e0 < 0 || e0 >= stop ? stop : e0; emit(data, s, e); s = e + 1; }
      else for (let i = data.indexOf(n); i >= 0 && i < stop; ) {
        const s = data.lastIndexOf(10, i) + 1, e0 = data.indexOf(10, i), e = e0 < 0 || e0 >= stop ? stop : e0;
        emit(data, s, e);
        i = data.indexOf(n, e);
      }
      end = base + stop;
      if (!got) break;
      carry = cut < data.length ? Buffer.from(data.subarray(cut)) : null;
      // An over-long line is dropped: what follows is skipped up to the next newline (R-L1).
      if (carry && carry.length > MAX_LINE) { carry = null; skipping = true; }
    }
  } finally { closeSync(fd); }
  readSinceGc += read;
  return end;
}
function lines(f: string, needle?: string): string[] {
  const out: string[] = [];
  eachLine(f, (l) => out.push(l), { needle, partial: true });
  return out;
}
let readSinceGc = 0;
// A session file's first bytes, read once: whether it is a headless run (R-K4), and what the list shows of a
// session without reading the rest of it (its folder, its first prompt, its start). Once the file is longer than the
// head, the head no longer changes, so it is kept by path alone (R-L2).
const HEAD = Buffer.allocUnsafe(512 << 10);
type Head = { headless: boolean; cwd: string; prompt: string; startedAt: number | null };
function sessionHead(f: string): Head {
  let size = 0;
  try { size = statSync(f).size; } catch { return { headless: false, cwd: "", prompt: "", startedAt: null }; }
  return stored("head", f, size >= HEAD.length ? "full" : fileKey(f), () => {
    const fd = openSync(f, "r");
    let head: Buffer;
    try { head = HEAD.subarray(0, readSync(fd, HEAD, 0, HEAD.length, 0)); } finally { closeSync(fd); }
    const h: Head = { headless: head.indexOf(HEADLESS) >= 0, cwd: "", prompt: "", startedAt: null };
    const cut = head.length < HEAD.length ? head.length : head.lastIndexOf(10) + 1;
    for (const l of head.toString("utf8", 0, cut).split("\n")) {
      let x: any; try { x = JSON.parse(l); } catch { continue; }
      if (!h.cwd && typeof x.cwd === "string") h.cwd = x.cwd;
      if (h.startedAt == null && typeof x.timestamp === "string") h.startedAt = Date.parse(x.timestamp) || null;
      // The first thing the person typed: not a tool result, a command's echo (<command-name>…) or a system note.
      if (!h.prompt && x.type === "user" && !x.isMeta) {
        const t = textOf(x.message?.content).trim();
        if (t && !t.startsWith("<")) h.prompt = t.slice(0, 2000);
      }
      if (h.cwd && h.prompt && h.startedAt != null) break;
    }
    return h;
  });
}
// What has been read of an append-only file (a session, a transcript), kept with the offset it got to and a hash of
// the file's first bytes: a file that grew is read on from that offset, not again from the start (R-C4).
const SIG = Buffer.allocUnsafe(256);
const sigOf = (f: string) => { try { const fd = openSync(f, "r"); try { return Bun.hash(SIG.subarray(0, readSync(fd, SIG, 0, SIG.length, 0))).toString(36); } finally { closeSync(fd); } } catch { return ""; } };
type Followed<S> = { sig: string; end: number; s: S };
const followed = new Map<string, { key: string; st: Followed<any> }>();
function follow<S>(kind: string, f: string, init: () => S, needle: string | undefined, step: (s: S, line: string) => void,
  o: { persist?: boolean; cache?: Map<string, { key: string; st: Followed<any> }> } = {}): S {
  const cache = o.cache ?? followed, persist = o.persist ?? true, id = `${kind}\0${f}`, key = fileKey(f);
  const hit = cache.get(id);
  if (hit?.key === key) { cache.delete(id); cache.set(id, hit); return hit.st.s; }
  let prev: Followed<S> | null = hit?.st ?? null;
  if (!prev && persist) {
    const d = getQ.get(`${kind}@${VERSION}`, f) as { key: string; value: string } | null;
    try { prev = d ? JSON.parse(d.value) : null; } catch {}
    if (prev && d!.key === key) { cache.set(id, { key, st: prev }); return prev.s; }
  }
  const size = key === "none" ? 0 : Number(key.split(":")[1]), sig = sigOf(f);
  const st: Followed<S> = prev && prev.sig === sig && prev.end <= size ? prev : { sig, end: 0, s: init() };
  st.end = eachLine(f, (l) => step(st.s, l), { needle, from: st.end });
  cache.delete(id); cache.set(id, { key, st });
  if (persist) putQ.run(`${kind}@${VERSION}`, f, key, JSON.stringify(st));
  return st.s;
}
const jsonl = (f: string) => lines(f).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const json = (f: string) => {
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
};

// Flowscope reads files whose format Claude Code and Codex do not document. What it expects and does not find is
// collected here and shown on the page, so a format change shows up as a warning, not as quietly wrong numbers.
const formatIssues = new Map<string, { what: string; file: string; at: number }>();
const odd = (what: string, file: string) => { if (!formatIssues.has(what)) formatIssues.set(what, { what, file, at: Date.now() }); };

type Loc = { project: string; session: string; runId: string };
// A Claude Code session is one run with this id: its own conversation, and the plain subagents it launched (the Agent
// tool, outside any workflow). Links from 0.1, when a session's subagents were a run of their own, used "agents".
const SESSION = "session", AGENTS = "agents";
// The conversation itself, in a session's detail and in links, as if it were one of its agents.
const MAIN = "main";
const runDir = (l: Loc) => l.runId === SESSION || l.runId === AGENTS
  ? join(ROOT, l.project, l.session, "subagents")
  : join(ROOT, l.project, l.session, "subagents", "workflows", l.runId);
const finalFile = (l: Loc) => join(ROOT, l.project, l.session, "workflows", `${l.runId}.json`);
const sessionFile = (l: Loc) => join(ROOT, l.project, `${l.session}.jsonl`);
const workflowIds = (l: Loc) => ls(join(ROOT, l.project, l.session, "subagents", "workflows")).filter((n) => n.startsWith("wf_") && SAFE.test(n));

function scriptFor(l: Loc): string {
  const dir = join(ROOT, l.project, l.session, "workflows", "scripts");
  const f = ls(dir).find((n) => n.includes(l.runId));
  return f ? readFileSync(join(dir, f), "utf8") : json(finalFile(l))?.script ?? "";
}

function metaFromScript(src: string) {
  const name = src.match(/name:\s*['"`]([^'"`]+)/)?.[1];
  const description = src.match(/description:\s*['"`]([^'"`]+)/)?.[1];
  const block = src.match(/phases:\s*\[([\s\S]*?)\]\s*,?\s*\}/)?.[1] ?? "";
  // Keys may be quoted too ({ "title": "Plan" }), as a script that builds its phases with JSON writes them.
  const phases = [...block.matchAll(/['"]?title['"]?:\s*['"`]([^'"`]+)['"`](?:\s*,\s*['"]?detail['"]?:\s*['"`]([^'"`]+))?/g)]
    .map((m) => ({ title: m[1], detail: m[2] }));
  return { name, description, phases };
}

function listRuns() {
  const runs = [];
  for (const project of ls(ROOT).filter((n) => SAFE.test(n))) {
    const entries = ls(join(ROOT, project));
    const sessions = new Set<string>();
    for (const e of entries) {
      if (e.endsWith(".jsonl")) {
        // Every Claude Code session is a run; a headless one (`claude -p`) is a CLI run instead (R-K4).
        const session = e.slice(0, -6), f = join(ROOT, project, e);
        if (!SAFE.test(session)) continue;
        try { if (!statSync(f).isFile() || sessionHead(f).headless) continue; } catch { continue; }
        sessions.add(session);
        continue;
      }
      if (!SAFE.test(e)) continue;
      for (const runId of workflowIds({ project, session: e, runId: "" })) runs.push(cachedSummary({ project, session: e, runId }));
      // A session folder with plain subagents is listed even when its file is gone or headless.
      if (ls(join(ROOT, project, e, "subagents")).some((f) => f.endsWith(".meta.json"))) sessions.add(e);
    }
    for (const session of sessions) { const s = cachedSummary({ project, session, runId: SESSION }); if (s.name) runs.push(s); }
  }
  for (const b of cliBatches()) runs.push(cliSummary(b));
  return runs.sort((a, b) => b.lastActivity - a.lastActivity);
}

// A run's summary, cached until a file in it changes or it crosses the live window. Reading every run's journal and
// transcripts on each 3-second poll grew with the number of runs; finished runs now cost one directory listing.
const summaryCache = new Map<string, { key: string; value: any }>();
function cachedSummary(l: Loc) {
  const dir = runDir(l);
  // Files only: a folder's time moves when something is added to it, not when its files are written.
  const files = [...ls(dir).filter((f) => f !== "workflows").map((f) => join(dir, f)), finalFile(l), sessionFile(l)];
  // A session is dated by its newest file: the conversation, its subagents, or its workflows' files.
  if (l.runId === SESSION) for (const wf of workflowIds(l)) { const d = join(dir, "workflows", wf); files.push(...ls(d).map((f) => join(d, f))); }
  const stamps = files.map(mtime);
  // A run with no final record turns from running to stopped by time alone, and an agent's report counts after 5 quiet seconds.
  const idle = Date.now() - Math.max(...stamps);
  const key = `${stamps.join(",")}|${idle < 10_000}|${idle < LIVE_MS}`;
  const k = `${l.session}/${l.runId}`;
  const hit = summaryCache.get(k);
  const value = hit?.key === key ? hit.value : (l.runId === SESSION ? sessionSummary(l, Math.max(...stamps)) : summary(l));
  if (hit?.key !== key) summaryCache.set(k, { key, value });
  // The week's total moves on its own, so the share is worked out fresh.
  const week = weekUsage();
  return { ...value, weekShare: value.weekShare === null ? null : week.weighted ? value.usage.weighted / week.weighted : 0 };
}

const shortProject = (p: string) => p.replace(/^-(Users|home)-[^-]+-/, "").replace(/-/g, "/");

// The session's latest AI-written title. Only lines holding "ai-title" are decoded, and a session that grew is read
// on from where the last read stopped (R-C4).
function sessionTitle(project: string, session: string) {
  return follow("title", join(ROOT, project, `${session}.jsonl`), () => ({ title: "" }), '"ai-title"', (s, l) => {
    try { const x = JSON.parse(l); if (x.type === "ai-title" && typeof x.aiTitle === "string" && x.aiTitle.trim()) s.title = own(x.aiTitle.trim()); } catch {}
  }).title;
}

// The folder a session ran in, which a resume command has to start from: from the head, else the first line naming one.
const cwdCache = new Map<string, string>();
function sessionCwd(project: string, session: string) {
  const f = join(ROOT, project, `${session}.jsonl`);
  if (cwdCache.has(f)) return cwdCache.get(f)!;
  let cwd = existsSync(f) ? sessionHead(f).cwd : "";
  if (!cwd) for (const l of lines(f, '"cwd"')) { try { cwd = JSON.parse(l).cwd ?? ""; } catch {} if (cwd) break; }
  cwdCache.set(f, cwd);
  return cwd;
}
const q1 = (s: string) => /^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
// Picking a session up again in a terminal. Subagents cannot be resumed on their own; their session can.
const resumeCmd = (tool: string, cwd: string, id: string) => `${cwd ? `cd ${q1(cwd)} && ` : ""}${tool === "codex" ? "codex resume" : "claude --resume"} ${q1(id)}`;

function plainAgents(l: Loc) {
  const dir = runDir(l);
  return ls(dir).flatMap((f) => {
    const id = f.match(/^agent-(.+)\.meta\.json$/)?.[1];
    const m = id && SAFE.test(id) && json(join(dir, f));
    if (m && !("agentType" in m)) odd("an agent's .meta.json has no agentType", join(dir, f));
    return m && m.agentType !== "workflow-subagent" ? [{ agentId: id, meta: m }] : [];
  });
}

// How a plain subagent ended, cached until its transcript changes. A background agent hands its report back through
// the SubagentHandback tool; a foreground one ends on a plain text reply. Either way, that is its result.
// A message sent to the agent after that (SendMessage) resumes it, so a report counts only if no prompt came after it.
const endCache = new Map<string, { key: string; report: string | null; endedOnText: boolean }>();
function ending(t: string) {
  const key = fileKey(t);
  const hit = endCache.get(t);
  if (hit?.key === key) return hit;
  const r = { key, ...stored("end", t, key, () => readEnding(t)) };
  endCache.set(t, r);
  return r;
}
function readEnding(t: string) {
  let report: string | null = null, lastText = "", endedOnText = false;
  for (const x of jsonl(t)) {
    const content = x.message?.content;
    if (x.type === "user" && !(Array.isArray(content) && content.some((c: any) => c.type === "tool_result"))) {
      report = null; endedOnText = false;
    }
    // An API error ("You've hit your session limit") is not a report: the agent stopped, it did not answer.
    if (x.type !== "assistant" || !Array.isArray(content) || x.isApiErrorMessage) continue;
    for (const c of x.message.content) {
      if (c.type === "tool_use") { endedOnText = false; if (c.name === "SubagentHandback") report = c.input?.message ?? report; }
      if (c.type === "text" && c.text.trim()) { endedOnText = true; lastText = c.text; }
    }
  }
  return { report: report ?? (endedOnText ? lastText : null), endedOnText };
}

function agentState(meta: any, t: string) {
  const idle = Date.now() - mtime(t);
  const { report } = ending(t);
  // The finished flag can outlive a resume, so it counts only with a report after the last prompt.
  if (meta.finished && report !== null) return "done";
  // A report, and the transcript quiet for a few seconds: text written mid-turn is followed quickly by more.
  if (report !== null && idle > 5_000) return "done";
  return idle < LIVE_MS ? "running" : "stopped";
}

// A session's name: its latest AI-written title, else the first line of its first prompt (R-L11). A session with
// neither, and no subagents, was opened and left; it is not listed.
const cutLine = (t: string) => (t.split("\n").map((x) => x.trim()).find(Boolean) ?? "").replace(/^(.{68}).{3,}$/s, (_, h) => h.replace(/\s+\S*$/, "") + "…");
function sessionSummary(l: Loc, lastActivity: number) {
  const dir = runDir(l), f = sessionFile(l);
  // A headless session's own file is a CLI run's; here only its subagents count.
  const head = existsSync(f) && !sessionHead(f).headless ? sessionHead(f) : null;
  const list = plainAgents(l).map(({ agentId, meta }) => {
    const t = join(dir, `agent-${agentId}.jsonl`);
    return { state: agentState(meta, t), usage: fileUsage(t).total };
  });
  const usage = list.reduce((u, a) => add(u, a.usage), head ? add(zero(), fileUsage(f).total) : zero());
  const week = weekUsage();
  const workflows = workflowIds(l).length;
  const name = sessionTitle(l.project, l.session) || cutLine(head?.prompt ?? "") || (list.length ? `Session ${l.session.slice(0, 8)}` : "");
  const live = Date.now() - lastActivity < LIVE_MS;
  return {
    ...l,
    kind: SESSION,
    project: shortProject(l.project),
    projectKey: l.project,
    name,
    description: `Claude Code session ${l.session}${head?.cwd ? ` in ${head.cwd}` : ""}`,
    // A conversation has no end marker: it is running while anything in it was written within the live window (R-T1),
    // then at rest, which counts as stopped only when one of its subagents was left unfinished.
    status: live ? "running" : list.some((a) => a.state === "stopped") ? "stopped" : "completed",
    startTime: head?.startedAt ?? null,
    durationMs: null,
    usage,
    weekShare: week.weighted ? usage.weighted / week.weighted : 0,
    agents: list.length,
    agentsDone: list.filter((a) => a.state === "done").length,
    agentsRunning: list.filter((a) => a.state === "running").length,
    workflows,
    lastActivity,
  };
}

// The tail a session's card is read from: its current action, a pending tool call, its model. A session runs to
// hundreds of megabytes, and only its end says what it is doing now (R-L2).
const TAIL = 1 << 20;
function tailLines(f: string) {
  let size = 0; try { size = statSync(f).size; } catch { return []; }
  const from = Math.max(0, size - TAIL), out: any[] = [];
  let first = from > 0;
  eachLine(f, (l) => { if (first) { first = false; return; } try { out.push(JSON.parse(l)); } catch {} }, { from, partial: true });
  return out;
}

function sessionDetail(l: Loc) {
  const dir = runDir(l), f = sessionFile(l);
  const s = cachedSummary({ ...l, runId: SESSION });
  const agents = plainAgents(l).map(({ agentId, meta }) => {
    const t = join(dir, `agent-${agentId}.jsonl`);
    const a: any = { agentId, label: meta.description, type: meta.agentType, background: meta.requestShape === "background" };
    a.state = agentState(meta, t);
    // Columns by state, so what is running now sits first.
    a.phase = { running: "Running", done: "Done", stopped: "Stopped" }[a.state as string];
    describe(a, t);
    if (a.state === "done") a.result = ending(t).report ?? "";
    return a;
  });
  const resume = resumeCmd("claude", sessionCwd(l.project, l.session), l.session);
  // The conversation, drawn like an agent: from the head and the tail of its file, never the whole of it.
  let main = null;
  if (existsSync(f)) {
    const head = sessionHead(f), m: any = { agentId: MAIN, label: s.name, type: "conversation", resume,
      state: Date.now() - mtime(f) < LIVE_MS ? "running" : "done", startedAt: head.startedAt ?? mtime(f) };
    const lines = tailLines(f);
    describeLines(m, lines, f);
    m.result = latestReply(lines);
    m.tools = null;
    main = m;
  }
  const workflows = workflowIds(l).map((runId) => { const w = cachedSummary({ ...l, runId });
    return { session: l.session, runId, name: w.name, status: w.status, agents: w.agents, agentsDone: w.agentsDone, lastActivity: w.lastActivity }; });
  return {
    ...s, resume, main, workflows,
    phases: [{ title: "Running" }, { title: "Done" }, { title: "Stopped", detail: "unfinished, no activity in 15 minutes" }],
    logs: [], result: null, script: "",
    agents: agents.sort((a, b) => b.startedAt - a.startedAt),
  };
}

// A conversation's latest reply: Claude's text since the person's last prompt, from the file's tail (R-L14); "" while
// Claude has not answered it yet. A conversation never hands back a report, so this is what its Result shows.
function latestReply(lines: any[]) {
  let reply = "";
  for (const x of lines) {
    const content = x.message?.content;
    if (x.type === "user" && !(Array.isArray(content) && content.some((c: any) => c.type === "tool_result"))) reply = "";
    if (x.type !== "assistant" || !Array.isArray(content) || x.isApiErrorMessage) continue;
    const text = content.filter((c: any) => c.type === "text" && c.text.trim()).map((c: any) => c.text).join("\n\n");
    if (text) reply = text;
  }
  return reply;
}

// Fills in what the transcript tells about an agent: start, activity, model, tokens, tool calls, current action. Returns its lines.
function describe(a: any, t: string) { return describeLines(a, jsonl(t), t); }
function describeLines(a: any, lines: any[], t: string) {
  a.startedAt ??= lines[0]?.timestamp ? Date.parse(lines[0].timestamp) : mtime(t);
  a.lastActivity = mtime(t);
  a.model ??= lines.find((x) => x.type === "assistant")?.message?.model;
  // Each record carries the effort in force for its turn; the latest one is what the agent runs at now.
  a.effort ??= lines.findLast((x) => typeof x.effort === "string")?.effort;
  a.usage = fileUsage(t).total;
  a.tools = lines.filter((x) => x.type === "assistant")
    .reduce((n, x) => n + (Array.isArray(x.message?.content) ? x.message.content.filter((c: any) => c.type === "tool_use").length : 0), 0);
  const last = [...lines].reverse().find((x) => x.type === "assistant" && Array.isArray(x.message?.content));
  const lc = last?.message.content.findLast?.((c: any) => c.type === "tool_use" || c.type === "text");
  // A tool call with no result logged after it is still executing.
  const answered = lc?.type === "tool_use" && lines.some((x) => x.type === "user" && Array.isArray(x.message?.content)
    && x.message.content.some((c: any) => c.type === "tool_result" && c.tool_use_id === lc.id));
  a.waiting = lc?.type === "tool_use" && !answered && a.state === "running" ? { tool: lc.name, since: Date.parse(last.timestamp) } : null;
  a.now = own(lc ? (lc.type === "text" ? lc.text.slice(0, 160) : `${lc.name}: ${toolHint(lc.input)}`) : "");
  // The most context any one request carried: how close the agent came to its window.
  a.peakContext = Math.max(0, ...lines.filter((x) => x.type === "assistant" && x.message?.usage).map((x) => {
    const u = x.message.usage; return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0); }));
  // An API error as the agent's last word ("You've hit your session limit · resets 7:10am") is why it stopped.
  const lastA = lines.findLast((x) => x.type === "assistant");
  a.apiError = lastA?.isApiErrorMessage ? { kind: lastA.error ?? "error", text: textOf(lastA.message?.content).slice(0, 200) } : null;
  if (lines.length && !lines.some((x) => x.timestamp)) odd("a transcript has no timestamps", t);
  return lines;
}

function summary(l: Loc) {
  const fin = json(finalFile(l));
  const journal = jsonl(join(runDir(l), "journal.jsonl"));
  for (const e of journal) if (!["launched", "started", "result"].includes(e.type)) odd(`a workflow journal has an event of a new type, "${e.type}"`, join(runDir(l), "journal.jsonl"));
  if (fin) for (const k of ["status", "workflowProgress", "phases"]) if (!(k in fin)) odd(`a finished workflow's record has no "${k}"`, finalFile(l));
  const dir = runDir(l);
  const lastActivity = Math.max(mtime(join(dir, "journal.jsonl")), ...ls(dir).map((f) => mtime(join(dir, f))));
  const meta = fin ? { name: fin.workflowName, description: fin.summary } : metaFromScript(scriptFor(l));
  const started = journal.filter((e) => e.type === "started").length;
  const done = journal.filter((e) => e.type === "result").length;
  const status = fin?.status ?? (Date.now() - lastActivity < LIVE_MS ? "running" : "stopped");
  const usage = ls(dir).filter((f) => /^agent-.+\.jsonl$/.test(f)).reduce((u, f) => add(u, fileUsage(join(dir, f)).total), zero());
  const week = weekUsage();
  return {
    ...l,
    kind: "workflow",
    project: shortProject(l.project),
    projectKey: l.project,
    name: meta.name ?? l.runId,
    description: meta.description ?? "",
    status,
    startTime: fin?.startTime ?? null,
    durationMs: fin?.durationMs ?? null,
    usage,
    weekShare: week.weighted ? usage.weighted / week.weighted : 0,
    agents: started,
    agentsDone: done,
    lastActivity,
  };
}

function detail(l: Loc) {
  const dir = runDir(l);
  const fin = json(finalFile(l));
  const script = scriptFor(l);
  const phases = fin?.phases ?? metaFromScript(script).phases;
  const progress: any[] = fin?.workflowProgress?.filter((p: any) => p.type === "workflow_agent") ?? [];
  const agents = new Map<string, any>();
  for (const e of jsonl(join(dir, "journal.jsonl"))) {
    if (typeof e.agentId !== "string" || !SAFE.test(e.agentId)) continue;
    const a = agents.get(e.agentId) ?? { agentId: e.agentId, label: e.label, phase: e.phase };
    if (e.type === "started") Object.assign(a, { label: e.label ?? a.label, phase: e.phase ?? a.phase });
    if (e.type === "result") a.result = typeof e.result === "string" ? e.result : JSON.stringify(e.result, null, 2);
    agents.set(e.agentId, a);
  }
  for (const f of ls(dir)) {
    const id = f.match(/^agent-(.+)\.meta\.json$/)?.[1];
    if (!id || !SAFE.test(id)) continue;
    const m = json(join(dir, f));
    const a = agents.get(id) ?? { agentId: id };
    a.label ??= m?.description;
    a.phase ??= m?.workflowPhase;
    agents.set(id, a);
  }
  const s = summary(l);
  for (const a of agents.values()) {
    const t = join(dir, `agent-${a.agentId}.jsonl`);
    const p = progress.find((x) => x.agentId === a.agentId);
    a.startedAt = p?.startedAt;
    a.model = p?.model;
    a.attempt = p?.attempt;
    const live = s.status === "running" && Date.now() - mtime(t) < LIVE_MS;
    a.state = a.result !== undefined ? "done" : live ? "running" : p?.state === "done" ? "done" : "stopped";
    describe(a, t);
  }
  return { ...s, resume: resumeCmd("claude", sessionCwd(l.project, l.session), l.session), phases, logs: fin?.logs ?? [], result: fin?.result ?? null, script, agents: [...agents.values()].sort((a, b) => a.startedAt - b.startedAt) };
}

// Token usage from a transcript, one count per API message (a message is logged once per content block).
// `weighted` follows API price ratios (input 1, cache write 1.25, cache read 0.1, output 5), the closest local proxy for plan usage.
type Usage = { input: number; cacheWrite: number; cacheRead: number; output: number; weighted: number };
const zero = (): Usage => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, weighted: 0 });
const add = (a: Usage, b: Usage) => { for (const k of Object.keys(a) as (keyof Usage)[]) a[k] += b[k]; return a; };
const sub = (a: Usage, b: Usage) => { for (const k of Object.keys(a) as (keyof Usage)[]) a[k] -= b[k]; return a; };

// Followed as the file grows (R-C4). The last few message ids are kept, so a message logged again after a read
// replaces its count instead of adding to it (R-K2).
type UsageState = { total: Usage; daily: Record<string, Usage>; recent: [string, string, Usage][] };
function fileUsage(f: string) {
  return follow<UsageState>("usage", f, () => ({ total: zero(), daily: {}, recent: [] }), '"usage"', (s, l) => {
    if (!l.includes('"assistant"')) return;
    let x: any; try { x = JSON.parse(l); } catch { return; }
    if (x.type !== "assistant" || !x.message?.usage) return;
    const u = x.message.usage, id = String(x.message.id ?? x.uuid), h = String(x.timestamp ?? "").slice(0, 13); // hour bucket, for the rolling week
    const v = { input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0, weighted: 0 };
    v.weighted = v.input + v.cacheWrite * 1.25 + v.cacheRead * 0.1 + v.output * 5;
    const i = s.recent.findIndex((r) => r[0] === id);
    if (i >= 0) { const [, ph, pv] = s.recent[i]; sub(s.total, pv); sub(s.daily[ph] ?? zero(), pv); s.recent.splice(i, 1); }
    add(s.total, v); add(s.daily[h] ??= zero(), v);
    s.recent.push([id, h, v]); if (s.recent.length > 32) s.recent.shift();
  });
}

const walk = (d: string): string[] => ls(d).flatMap((n) => {
  const p = join(d, n);
  return n.endsWith(".jsonl") ? [p] : statSync(p).isDirectory() ? walk(p) : [];
});

let weekCache = { at: 0, value: zero() };
function weekUsage() {
  if (Date.now() - weekCache.at < 30_000) return weekCache.value;
  const since = Date.now() - 7 * 86400_000;
  const total = zero();
  for (const f of walk(ROOT)) {
    if (mtime(f) < since) continue;
    for (const [h, u] of Object.entries(fileUsage(f).daily)) if (Date.parse(h + ":00:00Z") >= since - 3600_000) add(total, u);
  }
  weekCache = { at: Date.now(), value: total };
  return total;
}

function toolHint(i: any) {
  if (!i) return "";
  return String(i.description ?? i.command ?? i.file_path ?? i.pattern ?? i.query ?? i.prompt ?? i.message ?? i.url ?? JSON.stringify(i)).slice(0, 140);
}

// Headless CLI runs: `claude -p` and `codex exec` started by a script (a batch of parallel reads, say), outside any
// workflow. Claude writes each as an ordinary session whose system prompt is the Agent SDK's, not Claude Code's;
// Codex writes a rollout under ~/.codex/sessions marked originator "codex_exec". Runs of one tool, in one folder, with
// the same opening to their prompt and started close together, are one batch.
const CODEX = process.env.CODEX_SESSIONS_DIR ?? join(homedir(), ".codex", "sessions");
const CLI = "cli";
const BATCH_GAP = 30 * 60_000;
const PARALLEL_GAP = 10 * 60_000; // R-T7, R-T8
const HEADLESS = '"text":"You are a Claude agent, built on';

// A run keeps only what is shown or grouped by, as fresh copies: its prompt runs to tens of kilobytes, and any piece
// cut from a string keeps the whole string in memory. 2,500 kept prompts were most of Flowscope's memory.
type CliRun = { tool: "claude" | "codex"; id: string; file: string; projectKey: string; cwd: string; head: string; role: string; label?: string; startedAt: number;
  lastLabel?: string; hasResult?: boolean; turns?: number; peakContext?: number; apiError?: { kind: string; text: string } | null; model?: string; effort?: string; tools: number; usage: Usage; complete: boolean; result: string | null; now: string; waiting: { tool: string; since: number } | null };
const own = <T extends string | null | undefined>(v: T): T => (typeof v === "string" ? Buffer.from(v).toString() : v) as T;
const fromPrompt = (p: string) => ({ head: own(p.slice(0, 300)), role: own(runRole(p)), label: own(runLabel(p)) });
const cliCache = new Map<string, { key: string; run: CliRun | null }>();
const cached = (f: string, parse: (f: string) => CliRun | null) => {
  const st = statSync(f);
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cliCache.get(f);
  if (hit?.key === key) return hit.run;
  const run = stored("cli", f, key, () => {
    let r: CliRun | null = null;
    try { r = parse(f); } catch {}
    // The answer is kept apart, read only when the run is opened.
    if (r) { putQ.run(`answer@${VERSION}`, f, key, JSON.stringify(r.result)); r.result = null; r.hasResult = true; }
    return r;
  });
  cliCache.set(f, { key, run });
  return run;
};
const answerOf = (r: CliRun) => { const hit = getQ.get(`answer@${VERSION}`, r.file) as { value: string } | null; return hit ? JSON.parse(hit.value) as string | null : null; };
const encodeCwd = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");
const textOf = (c: any): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p.text ?? "").join("\n") : "";

function parseClaude(f: string): CliRun | null {
  // The SDK's system prompt is in the session's first records; interactive sessions, the big files, stop here.
  if (!sessionHead(f).headless) return null;
  const lines = jsonl(f);
  const first = lines.find((x) => x.type === "user");
  // The id ends up in the page's links and attributes, so a run whose id is not a safe name is left out (R-S4).
  if (!first || typeof first.sessionId !== "string" || !SAFE.test(first.sessionId)) return null;
  // A live session (stream-json input) gets one prompt per turn; the newest one says where it has got to.
  const asks = lines.filter((x) => x.type === "user" && textOf(x.message?.content).trim()).map((x) => textOf(x.message.content));
  const a: any = { state: "running" };
  describe(a, f);
  const end = ending(f);
  return {
    tool: "claude", id: first.sessionId, file: f, projectKey: encodeCwd(first.cwd ?? ""), cwd: first.cwd ?? "", ...fromPrompt(textOf(first.message?.content)),
    lastLabel: asks.length > 1 ? own(runLabel(asks.at(-1)!)) : undefined, turns: asks.length, startedAt: Date.parse(first.timestamp), model: a.model, effort: a.effort, tools: a.tools, usage: a.usage,
    complete: end.endedOnText && !a.apiError, result: end.endedOnText ? own(end.report) : null, now: own(a.now), waiting: a.waiting,
    peakContext: a.peakContext, apiError: a.apiError,
  };
}

function parseCodex(f: string): CliRun | null {
  const lines = jsonl(f);
  const meta = lines[0]?.type === "session_meta" ? lines[0].payload : null;
  if (meta?.originator !== "codex_exec" || typeof meta.id !== "string" || !SAFE.test(meta.id)) return null;
  if (lines.length > 3 && !lines.some((x) => x.type === "response_item")) odd("a Codex rollout has no response_item records", f);
  const items = lines.filter((x) => x.type === "response_item").map((x) => ({ ...x.payload, ts: x.timestamp }));
  const user = items.filter((p) => p.type === "message" && p.role === "user").map((p) => textOf(p.content)).filter((t) => !t.startsWith("<environment_context"));
  const calls = items.filter((p) => /^(function_call|custom_tool_call|local_shell_call)$/.test(p.type));
  const answered = new Set(items.filter((p) => /_output$/.test(p.type)).map((p) => p.call_id));
  const last = items.findLast((p) => calls.includes(p) || (p.type === "message" && p.role === "assistant"));
  const tc = lines.findLast((x) => x.payload?.type === "token_count")?.payload.info?.total_token_usage;
  const usage = zero();
  if (tc) {
    Object.assign(usage, { input: tc.input_tokens - tc.cached_input_tokens, cacheRead: tc.cached_input_tokens, output: tc.output_tokens });
    usage.weighted = usage.input + usage.cacheRead * 0.1 + usage.output * 5;
  }
  const fin = lines.findLast((x) => x.payload?.type === "task_complete")?.payload;
  const peakContext = Math.max(0, ...lines.filter((x) => x.payload?.type === "token_count").map((x) => x.payload.info?.last_token_usage?.input_tokens ?? 0));
  const isCall = last && calls.includes(last);
  return {
    tool: "codex", id: meta.id, file: f, projectKey: encodeCwd(meta.cwd ?? ""), cwd: meta.cwd ?? "", ...fromPrompt(user[0] ?? ""),
    startedAt: Date.parse(meta.timestamp), model: lines.find((x) => x.type === "turn_context")?.payload?.model,
    effort: lines.findLast((x) => x.type === "turn_context")?.payload?.effort,
    tools: calls.length, usage, complete: !!fin, result: fin ? own(fin.last_agent_message ?? "") : null,
    now: own(!last ? "" : isCall ? `${last.name}: ${String(last.input ?? last.arguments ?? "").slice(0, 140)}` : textOf(last.content).slice(0, 160)),
    waiting: isCall && !answered.has(last.call_id) ? { tool: last.name, since: Date.parse(last.ts) } : null,
    peakContext, apiError: null,
  };
}

function cliState(r: CliRun) {
  const idle = Date.now() - mtime(r.file);
  if (r.complete && (r.tool === "codex" || idle > 5_000)) return "done";
  return idle < LIVE_MS ? "running" : "stopped";
}

// What a run is, from its prompt: its first line, without "You are a" and the like. "You are an independent, harsh
// referee for Journal of Energy Storage" becomes "independent, harsh referee for Journal of Energy Storage".
const runRole = (prompt: string) => (prompt.split("\n").map((s) => s.trim()).find(Boolean) ?? "")
  .replace(/^#+\s*/, "").replace(/^(you are|you're|act as|tu)\s+(an?|the)?\s*/i, "")
  .split(/(?<=[a-z]{3}[.!?:])\s/)[0].replace(/[.:]$/, "").replace(/^(.{68}).{3,}$/s, (_, h) => h.replace(/\s+\S*$/, "") + "…");

// The batch's own line from a run's prompt: its last heading (`# …` or `=== … ===`), which is usually what varies.
const runLabel = (prompt: string) => prompt.split("\n").map((s) => s.trim().match(/^(?:#{1,6}\s+|={3,}\s*)(.+?)\s*=*$/)?.[1]).filter(Boolean).at(-1);

// A batch is the unit for runs started together. A series is the unit for runs one program fires again and again,
// one at a time, often each from its own folder (one title per meeting, say): runs of one tool, in one repository as a
// batch's (R-L9), whose prompts open the same way (R-L13). A series spread over more than one batch is one run of its own.
type Batch = { id: string; runs: CliRun[]; series: boolean };
const folderKey = (cwd: string) => cwd.split("/").slice(0, 6).join("/"); // R-L9
const opening = (r: CliRun) => r.role.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
let batchCache = { at: 0, value: [] as Batch[] };
function cliBatches() {
  if (Date.now() - batchCache.at < 1_000) return batchCache.value;
  const all: CliRun[] = [];
  // A file can vanish between listing and reading; it is simply left out. An id that is not a safe name is too.
  const take = (f: string, parse: (f: string) => CliRun | null) => { try { const r = cached(f, parse); if (r && SAFE.test(r.id ?? "")) all.push(r); } catch {} };
  for (const project of ls(ROOT).filter((n) => SAFE.test(n))) for (const f of ls(join(ROOT, project))) if (f.endsWith(".jsonl")) take(join(ROOT, project, f), parseClaude);
  for (const f of walk(CODEX)) take(f, parseCodex);
  all.sort((a, b) => a.startedAt - b.startedAt);
  // One batch: runs of one tool in one repository, each started soon after the one before. Parallel reviewers with
  // different prompts land together; a long series with the same prompt opening may space out more.
  const groups = new Map<string, CliRun[]>();
  for (const r of all) {
    const k = `${r.tool}\0${folderKey(r.cwd)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const batches: CliRun[][] = [];
  for (const rs of groups.values()) {
    let cur: CliRun[] = [];
    for (const r of rs) {
      const prev = cur.at(-1);
      const gap = prev && prev.head === r.head ? BATCH_GAP : PARALLEL_GAP;
      if (prev && r.startedAt - prev.startedAt > gap) { batches.push(cur); cur = []; }
      cur.push(r);
    }
    batches.push(cur);
  }
  const batchOf = new Map<CliRun, number>();
  batches.forEach((b, i) => { for (const r of b) batchOf.set(r, i); });
  const keyed = new Map<string, CliRun[]>();
  for (const r of all) { const o = opening(r); if (o) { const k = `${r.tool}\0${o}\0${folderKey(r.cwd)}`; keyed.set(k, [...(keyed.get(k) ?? []), r]); } }
  const series = [...keyed.values()].filter((rs) => new Set(rs.map((r) => batchOf.get(r))).size > 1);
  const inSeries = new Set(series.flat());
  const out = [...batches.map((rs) => rs.filter((r) => !inSeries.has(r))).filter((rs) => rs.length).map((runs) => ({ runs, series: false })),
    ...series.map((runs) => ({ runs, series: true }))];
  batchCache = { at: Date.now(), value: out.map((b) => ({ id: `${b.runs[0].tool}-${b.runs[0].id}`, ...b })) };
  return batchCache.value;
}

const localDay = (t: number) => new Date(t).toDateString();
function cliSummary(b: Batch) {
  const r0 = b.runs[0];
  const states = b.runs.map(cliState);
  const usage = b.runs.reduce((u, r) => add(u, { ...r.usage }), zero());
  const week = weekUsage();
  // Runs that share a prompt opening are named by it; a mixed batch by its most common role, with a count. A series
  // whose roles differ further on (one per person named) is named by the words they all start with.
  const roles = b.runs.map((r) => r.role);
  const common = [...new Set(roles)].sort((x, y) => roles.filter((r) => r === y).length - roles.filter((r) => r === x).length)[0];
  const words = roles.map((r) => r.split(/\s+/));
  let n = 0; while (n < words[0].length && words.every((ws) => ws[n] === words[0][n])) n++;
  const shared = words[0].slice(0, n);
  const heading = new Set(roles).size === 1 ? common : b.series ? `${shared.join(" ")}…` : `${common} +${new Set(roles).size - 1} more`;
  const cmd = r0.tool === "claude" ? "claude -p" : "codex exec";
  const days = new Set(b.runs.map((r) => localDay(r.startedAt))).size;
  return {
    // A series spans folders; it is shown by the repository they share (R-L9).
    project: shortProject(b.series ? encodeCwd(folderKey(r0.cwd)) : r0.projectKey), projectKey: b.series ? encodeCwd(folderKey(r0.cwd)) : r0.projectKey, session: b.id, runId: CLI,
    kind: "cli", tool: r0.tool, series: b.series,
    name: `${r0.tool === "claude" ? "Claude" : "Codex"}${b.runs.length > 1 ? ` ×${b.runs.length}` : ""}: ${heading || r0.id}`,
    description: b.series
      ? `A series of ${b.runs.length} headless \`${cmd}\` runs over ${days} day${days > 1 ? "s" : ""}, in ${folderKey(r0.cwd)}, with the same prompt opening`
      : `${b.runs.length} headless \`${cmd}\` run${b.runs.length > 1 ? "s" : ""} in ${r0.cwd}, started close together`,
    status: states.includes("running") ? "running" : states.includes("stopped") ? "stopped" : "completed",
    startTime: r0.startedAt, durationMs: null, usage,
    // Codex runs on a separate plan, so its share of Claude usage is meaningless.
    weekShare: r0.tool === "claude" && week.weighted ? usage.weighted / week.weighted : null,
    agents: b.runs.length, agentsDone: states.filter((s) => s === "done").length,
    lastActivity: Math.max(...b.runs.map((r) => mtime(r.file))),
  };
}

function cliDetail(b: Batch) {
  // Each run is named by what tells it apart: its role when that is its own (one referee per journal, say), its last
  // heading when many runs share the role (one listener per paragraph), and both when the batch mixes the two.
  const roleCount = new Map<string, number>();
  for (const r of b.runs) roleCount.set(r.role, (roleCount.get(r.role) ?? 0) + 1);
  const folders = new Set(b.runs.map((r) => r.cwd)).size;
  const agents = b.runs.map((r, i) => {
    const state = cliState(r);
    return {
      agentId: r.id, label: (() => { const role = r.role, head = r.label;
        if (r.turns! > 1) return `${r.lastLabel ?? "turn"} · ${r.turns} turns`;
        // In a series fired from one folder per item, the folder is what tells the runs apart (a meeting's, say).
        if (b.series && folders > 1) return `${r.cwd.split("/").filter(Boolean).at(-1)}${head ? ` · ${head}` : ""}`;
        return (roleCount.get(role)! > 1 ? (head && roleCount.size > 1 ? `${role} · ${head}` : head ?? role) : role || head) || `run ${i + 1}`; })(), type: r.tool, state,
      phase: { running: "Running", done: "Done", stopped: "Stopped" }[state],
      startedAt: r.startedAt, lastActivity: mtime(r.file), model: r.model, effort: r.effort, usage: r.usage, tools: r.tools,
      now: r.now, waiting: state === "running" ? r.waiting : null, result: state === "done" ? answerOf(r) ?? "" : undefined,
      peakContext: r.peakContext, apiError: r.apiError, resume: resumeCmd(r.tool, r.cwd, r.id),
    };
  });
  return {
    ...cliSummary(b),
    phases: [{ title: "Running" }, { title: "Done" }, { title: "Stopped", detail: "unfinished, no activity in 15 minutes" }],
    logs: [], result: null, script: "",
    agents: agents.sort((a, b) => a.startedAt - b.startedAt),
  };
}

function codexTranscript(f: string) {
  const out: any[] = [];
  for (const x of jsonl(f)) {
    if (x.type !== "response_item") continue;
    const p = x.payload, ts = x.timestamp;
    if (p.type === "message" && p.role !== "developer") {
      const t = textOf(p.content);
      if (!t.startsWith("<environment_context")) out.push({ kind: p.role === "user" ? "prompt" : "text", text: t, ts });
    } else if (/^(function_call|custom_tool_call|local_shell_call)$/.test(p.type)) {
      const input = p.input ?? p.arguments ?? JSON.stringify(p.action ?? {}, null, 2);
      out.push({ kind: "tool", id: p.call_id, name: p.name ?? p.type, text: String(input).slice(0, 140), input: String(input), ts });
    } else if (/_output$/.test(p.type)) {
      let t = p.output;
      try { const o = typeof t === "string" ? JSON.parse(t) : t; t = Array.isArray(o) ? o.map((q: any) => q.text ?? "").join("\n") : o?.output ?? t; } catch {}
      t = typeof t === "string" ? t : JSON.stringify(t);
      out.push({ kind: "output", for: p.call_id, text: t.length > 20000 ? t.slice(0, 20000) + "\n… (cut)" : t, error: false, ts });
    }
  }
  return out;
}

function transcript(l: Loc, agentId: string) {
  if ((l.runId === SESSION || l.runId === AGENTS) && agentId === MAIN) return claudeTranscript(sessionFile(l));
  if (l.runId === CLI) {
    const r = cliBatches().find((b) => b.id === l.session)?.runs.find((r) => r.id === agentId);
    return !r ? [] : r.tool === "codex" ? codexTranscript(r.file) : claudeTranscript(r.file);
  }
  return claudeTranscript(join(runDir(l), `agent-${agentId}.jsonl`));
}

// A transcript is followed as it grows: an open live session is read on from where the last poll stopped, not
// parsed again whole every few seconds (R-C4). Only the last few opened are kept (R-L12).
const transcripts = new Map<string, { key: string; st: Followed<any> }>();
function claudeTranscript(f: string) {
  const ev = follow<any[]>("transcript", f, () => [], undefined, (out, l) => {
    let x: any; try { x = JSON.parse(l); } catch { return; }
    if (x.type !== "user" && x.type !== "assistant") return;
    const c = x.message?.content;
    const ts = x.timestamp;
    if (typeof c === "string") { out.push({ kind: x.type === "user" ? "prompt" : "text", text: c, ts }); return; }
    for (const p of Array.isArray(c) ? c : []) {
      if (p.type === "text") out.push({ kind: x.type === "user" ? "prompt" : "text", text: p.text, ts });
      else if (p.type === "tool_use") out.push({ kind: "tool", id: p.id, name: p.name, desc: p.input?.description, cmd: p.input?.command,
        text: toolHint(p.input), input: JSON.stringify(p.input, null, 2), ts });
      else if (p.type === "tool_result") {
        const t = typeof p.content === "string" ? p.content : (Array.isArray(p.content) ? p.content : []).filter((q: any) => q.type !== "image").map((q: any) => q.text ?? `[${q.type}]`).join("\n");
        // Images a tool returned (a screenshot it read, say), small enough to send to the page.
        // Only known image types and plain base64, since the URL goes into the page's HTML.
        const images = (Array.isArray(p.content) ? p.content : []).filter((q: any) => q.type === "image" && typeof q.source?.data === "string" && q.source.data.length < 3e6
          && /^image\/(png|jpeg|gif|webp)$/.test(q.source.media_type ?? "image/png") && /^[A-Za-z0-9+/=\s]*$/.test(q.source.data))
          .map((q: any) => `data:${q.source.media_type ?? "image/png"};base64,${q.source.data}`);
        out.push({ kind: "output", for: p.tool_use_id, images, text: own(t.length > 20000 ? t.slice(0, 20000) + "\n… (cut)" : t), error: !!p.is_error, ts });
      }
    }
  }, { persist: false, cache: transcripts });
  while (transcripts.size > 8) transcripts.delete(transcripts.keys().next().value!);
  return ev;
}

// Search inside transcripts: every agent Flowscope shows, by what it said, was told, ran or got back. The transcripts
// run to gigabytes, mostly images and JSON around the text, so each one's text is kept lower-cased in memory, read
// on the first search and again only when the file changes. Persian has no case; the rest matches in any case.
const searchText = (c: any): string => typeof c === "string" ? c : !Array.isArray(c) ? "" : c.map((p: any) =>
  p.type === "image" ? "" : p.text ?? (p.input ? JSON.stringify(p.input) : searchText(p.content))).join("\n");
const lineText = (x: any) => searchText(x.message?.content ?? x.payload?.content ?? x.payload?.output ?? x.payload?.arguments ?? x.payload?.input);
const textCache = new Map<string, { key: string; low: Buffer }>();
function lowText(f: string) {
  const st = statSync(f), key = `${st.mtimeMs}:${st.size}`;
  const hit = textCache.get(f);
  if (hit?.key === key) return hit.low;
  const low = Buffer.from(jsonl(f).map(lineText).join("\n").toLowerCase());
  textCache.set(f, { key, low });
  return low;
}
function searchable() {
  const files = new Map<string, { run: string; agentId: string; label?: string }>();
  // An agent is named by its description, as on its card.
  const label = (dir: string, id: string) => json(join(dir, `agent-${id}.meta.json`))?.description;
  const idOf = (f: string) => { const id = f.match(/^agent-(.+)\.jsonl$/)?.[1]; return id && SAFE.test(id) ? id : null; };
  for (const project of ls(ROOT).filter((n) => SAFE.test(n))) for (const session of ls(join(ROOT, project)).filter((n) => SAFE.test(n))) {
    const sub = join(ROOT, project, session, "subagents");
    for (const f of ls(sub)) { const id = idOf(f); if (id) files.set(join(sub, f), { run: `${session}/${SESSION}`, agentId: id, label: label(sub, id) }); }
    for (const wf of ls(join(sub, "workflows")).filter((n) => SAFE.test(n))) for (const f of ls(join(sub, "workflows", wf))) {
      const id = idOf(f); if (id) files.set(join(sub, "workflows", wf, f), { run: `${session}/${wf}`, agentId: id, label: label(join(sub, "workflows", wf), id) });
    }
  }
  for (const b of cliBatches()) for (const r of b.runs) files.set(r.file, { run: `${b.id}/${CLI}`, agentId: r.id, label: r.label ?? r.role });
  return files;
}
// The first read of every transcript takes a while, so it runs in steps between requests; until it ends, a search
// answers with how far it has got.
let indexing: { done: number; total: number } | null = null, indexed = false;
async function buildIndex() {
  if (indexing) return;
  const list = [...searchable().keys()];
  indexing = { done: 0, total: list.length };
  for (const f of list) { try { lowText(f); } catch {} indexing.done++; if (indexing.done % 20 === 0) await Bun.sleep(0); }
  indexed = true; indexing = null;
}
// Kept while searches come, let go after 15 minutes without one: a few hundred MB that most visits never use.
let lastSearch = 0;
const SNIPPET_COUNT_MAX = 1000, QUERY_MAX = 200;
setInterval(() => { if (indexed && Date.now() - lastSearch > 15 * 60_000) { textCache.clear(); indexed = false; } }, 60_000);
function searchTranscripts(query: string) {
  lastSearch = Date.now();
  if (!indexed) { buildIndex(); return { indexing: indexing ?? { done: 0, total: 1 }, hits: [] }; }
  const files = searchable();
  const ql = query.toLowerCase(), needle = Buffer.from(ql);
  const hits = [...files.keys()].filter((f) => lowText(f).indexOf(needle) >= 0).sort((a, b) => mtime(b) - mtime(a)).slice(0, 200);
  return { indexing: null, hits: hits.map((f) => {
    let snippet = "", count = 0;
    // Counting stops at SNIPPET_COUNT_MAX places, so one huge transcript cannot hold a search up (R-L4).
    for (const x of jsonl(f)) {
      if (count >= SNIPPET_COUNT_MAX) break;
      const t = lineText(x), at = t.toLowerCase().indexOf(ql);
      if (at < 0) continue;
      count++;
      snippet ||= (at > 60 ? "…" : "") + t.slice(Math.max(0, at - 60), at + ql.length + 100).replace(/\s+/g, " ");
    }
    return { ...files.get(f)!, snippet, count, at: mtime(f) };
  }) };
}

const locFrom = (u: URL): Loc | null => {
  const l = { project: u.searchParams.get("p") ?? "", session: u.searchParams.get("s") ?? "", runId: u.searchParams.get("r") ?? "" };
  return Object.values(l).every((v) => SAFE.test(v)) ? l : null;
};

// A web page in the browser can point its own domain at 127.0.0.1 (DNS rebinding) and then read this API as
// same-origin; the Host it sends is still its own domain, so only our own names are served.
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
// What the page may load (R-S3): everything from Flowscope itself, nothing from anywhere else. No inline script: the
// page's handlers are one delegated listener, so markup that slips into a rendered transcript cannot run code, load a
// remote image, or fetch or post anywhere. Inline styles stay allowed: the page sets widths and positions with them.
const CSP = ["default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
  "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
// The only files served: the page, its script, and the vendored libraries and fonts (R-S9). Nothing else in public/.
const STATIC: Record<string, string> = {
  "/": "index.html", "/favicon.svg": "favicon.svg", "/app.js": "app.js", "/theme.js": "theme.js",
  "/vendor/marked.min.js": "vendor/marked.min.js", "/vendor/purify.min.js": "vendor/purify.min.js", "/vendor/highlight.min.js": "vendor/highlight.min.js",
  "/vendor/github.min.css": "vendor/github.min.css", "/vendor/github-dark.min.css": "vendor/github-dark.min.css", "/vendor/fonts.css": "vendor/fonts.css",
  ...Object.fromEntries(["sans-400", "sans-500", "sans-600", "sans-arabic-400", "sans-arabic-500", "sans-arabic-600", "mono-400", "mono-500"]
    .map((w) => [`/vendor/fonts/plex-${w}.woff2`, `vendor/fonts/plex-${w}.woff2`])),
};
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", svg: "image/svg+xml", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", woff2: "font/woff2" };
const SECURE = { "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const page = (f: string) => new Response(Bun.file(join(PUBLIC, f)), { headers: { "content-type": TYPES[f.split(".").pop()!], ...SECURE } });
// Every API answer: never cached by the browser, never sniffed as another type (R-S6).
const API = { "x-content-type-options": "nosniff", "cache-control": "no-store", "referrer-policy": "no-referrer" };
const json200 = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json", ...API } });
const text = (body: string, status: number, extra: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...API, ...extra } });

Bun.serve({
  port: PORT,
  idleTimeout: 30,
  hostname: "127.0.0.1",
  // No development error pages: a failure answers a plain 500 that says nothing about the files or the code (R-S5).
  development: false,
  error(e) { console.error(e); return text("internal error", 500); },
  fetch(req) {
    if (!HOSTS.has(req.headers.get("host") ?? "")) return text("forbidden", 403);
    const u = new URL(req.url);
    if (Object.hasOwn(STATIC, u.pathname)) return page(STATIC[u.pathname]);
    if (u.pathname === "/api/pid") return text(String(process.pid), 200, { "x-flowscope": "1" });
    if (u.pathname === "/api/format") return json200([...formatIssues.values()]);
    if (u.pathname === "/api/search") {
      const qs = (u.searchParams.get("q") ?? "").trim();
      // Under 3 characters finds too much to be useful; over QUERY_MAX is refused (R-L3).
      if (qs.length > QUERY_MAX) return text("query too long", 400);
      return qs.length < 3 ? json200({ indexing: null, hits: [] }) : json200(searchTranscripts(qs));
    }
    if (u.pathname === "/api/runs") {
      // Most polls find nothing new: answer those with 304 and no body.
      const body = JSON.stringify(listRuns());
      const tag = `"${Bun.hash(body).toString(36)}"`;
      // no-cache, not no-store: the page revalidates with the ETag (R-S6).
      if (req.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers: { ...API, etag: tag, "cache-control": "no-cache" } });
      return new Response(body, { headers: { "content-type": "application/json", ...API, etag: tag, "cache-control": "no-cache" } });
    }
    if (u.pathname !== "/api/run" && u.pathname !== "/api/agent") return text("not found", 404);
    const l = locFrom(u);
    if (!l) return text("bad request", 400);
    if (u.pathname === "/api/run") {
      if (l.runId !== CLI) return json200(l.runId === SESSION || l.runId === AGENTS ? sessionDetail({ ...l, runId: SESSION }) : detail(l));
      const b = cliBatches().find((b) => b.id === l.session);
      return b ? json200(cliDetail(b)) : text("not found", 404);
    }
    const a = u.searchParams.get("a") ?? "";
    return SAFE.test(a) ? json200(transcript(l, a)) : text("bad request", 400);
  },
});
console.log(`Flowscope on ${url}`);
// Read everything once now, so the page is ready when it is opened; after the first start this is mostly the cache.
setTimeout(() => { const t = performance.now(); listRuns(); console.log(`warm in ${(performance.now() - t) / 1000 | 0}s`); }, 50);
if (args.open) openPage();
