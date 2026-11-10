// Markdown for prose; JSON results shown as pretty JSON, with their string fields rendered as markdown. Persian per R-U5.
const isFa = (t) => (String(t).slice(0, 300).match(/[\u0600-\u06FF]/g) ?? []).length > 20;
// Syntax colours: a known language when we have one (a command is shell, a file by its extension), otherwise a guess
// kept only when highlight.js is fairly sure, so plain text stays plain. Cached, since a live transcript redraws often (R-L24).
const EXT = { py: "python", ts: "typescript", tsx: "typescript", js: "javascript", mjs: "javascript", json: "json", jsonl: "json", md: "markdown",
  html: "xml", xml: "xml", svg: "xml", css: "css", sh: "bash", zsh: "bash", yml: "yaml", yaml: "yaml", swift: "swift", toml: "ini", sql: "sql", diff: "diff" };
const langOf = (path) => EXT[String(path ?? "").split(".").pop().toLowerCase()];
const hlCache = new Map();
function hl(code, lang) {
  code = String(code ?? "");
  if (!window.hljs || code.length > 60000) return esc(code);
  const k = `${lang}\0${code}`;
  if (hlCache.has(k)) return hlCache.get(k);
  let out = esc(code);
  try {
    if (lang && hljs.getLanguage(lang)) out = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    else if (lang !== "text") {
      const r = hljs.highlightAuto(code, ["bash", "python", "typescript", "json", "css", "xml", "yaml", "diff", "sql"]);
      if (r.relevance >= 12) out = r.value;
    }
  } catch {}
  if (hlCache.size > 2000) hlCache.clear();
  hlCache.set(k, out);
  return out;
}
marked.use({ renderer: { code(text, info) { return `<pre><code class="hljs">${hl(text, (info || "").split(/\s/)[0] || undefined)}</code></pre>`; } } });
// Each block takes its direction from its own text, lists included: a Persian list is laid out right to left with
// its bullets on the right, instead of an LTR list whose bullets land inside the first word of each RTL item.
// dir="auto" on a list skips children that carry their own dir, so a list's direction is set here from its first strong letter.
const firstStrong = (t) => (String(t).match(/[A-Za-z\u00C0-\u024F\u0590-\u08FF\uFB1D-\uFEFC]/) ?? [""])[0];
// Right to left when most of the letters are Persian/Arabic: an English sentence quoting one Persian word stays LTR.
const isRtl = (t) => { const s = String(t), r = (s.match(/[\u0590-\u08FF\uFB1D-\uFEFC]/g) ?? []).length, l = (s.match(/[A-Za-z\u00C0-\u024F]/g) ?? []).length;
  return r + l ? r > l : /[\u0590-\u08FF\uFB1D-\uFEFC]/.test(firstStrong(s)); };
const dirOf = (t) => isRtl(t) ? "rtl" : "ltr";
function bidi(html) {
  const t = document.createElement("template"); t.innerHTML = html;
  for (const el of t.content.querySelectorAll("ul, ol, table, blockquote")) el.setAttribute("dir", isRtl(el.textContent) ? "rtl" : "ltr");
  for (const el of t.content.querySelectorAll("li, p, h1, h2, h3, h4, h5, h6, td, th")) el.setAttribute("dir", dirOf(el.textContent));
  return t.innerHTML;
}
const md = (s) => {
  const t = String(s ?? "").trim();
  const lang = isFa(t) ? ' lang="fa"' : "";
  if (/^[\[{]/.test(t)) { try { return `<div class="md"${lang}>${bidi(jsonMd(JSON.parse(t)))}</div>`; } catch {} }
  return `<div class="md"${lang}>${bidi(DOMPurify.sanitize(marked.parse(t, { gfm: true })))}</div>`;
};
const jsonMd = (v, depth = 0) => {
  if (Array.isArray(v)) return `<ol>${v.map((x) => `<li>${jsonMd(x, depth + 1)}</li>`).join("")}</ol>`;
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => typeof x === "object" && x
    ? `<h${Math.min(depth + 3, 4)}>${esc(k)}</h${Math.min(depth + 3, 4)}>${jsonMd(x, depth + 1)}`
    : `<p><b>${esc(k)}:</b> ${DOMPurify.sanitize(marked.parseInline(String(x)))}</p>`).join("");
  return DOMPurify.sanitize(marked.parse(String(v)));
};
const $ =(s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = (t) => { if (!t) return ""; const s = (Date.now() - t) / 1000; return s < 60 ? `${s | 0}s ago` : s < 3600 ? `${s / 60 | 0}m ago` : s < 86400 ? `${s / 3600 | 0}h ago`
  : new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
const when = (t) => t ? `<span title="${new Date(t).toLocaleString()}">${ago(t)}</span>` : "";
const dur = (ms) => ms == null ? "—" : ms < 60000 ? `${ms / 1000 | 0}s` : ms < 3600000 ? `${ms / 60000 | 0}m ${(ms % 60000) / 1000 | 0}s`
  : ms < 86400000 ? `${ms / 3600000 | 0}h ${(ms % 3600000) / 60000 | 0}m` : `${ms / 86400000 | 0}d ${(ms % 86400000) / 3600000 | 0}h`;
const tok = (n) => !n ? "0" : n < 1e3 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(2)}M`;
const pct = (f) => f == null ? "—" : !f ? "0%" : f < 0.001 ? "<0.1%" : `${(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`;
// Re-render without losing what the reader opened or where they scrolled: skips identical HTML,
// and reopens each <details> that was open, matched by its position among details with the same summary.
const detailKeys = (el) => { const seen = {}; return [...el.querySelectorAll("details")].map((d) => { const s = d.querySelector("summary")?.textContent ?? ""; seen[s] = (seen[s] ?? 0) + 1; return [d, `${s}#${seen[s]}`]; }); };
function setHTML(el, html) {
  if (el._html === html) return;
  const open = new Set(detailKeys(el).filter(([d]) => d.open).map(([, k]) => k));
  // Inner scrollers too (the phase columns scroll sideways), matched by class and position.
  const scrollers = (e) => [e, ...e.querySelectorAll(".phases, pre")];
  const pos = scrollers(el).map((e) => [e.className, e.scrollLeft, e.scrollTop]);
  // A search box being typed in is drawn again; keep the focus and caret in it.
  const act = el.contains(document.activeElement) && document.activeElement.matches("input") ? [document.activeElement.placeholder, document.activeElement.selectionStart] : null;
  el.innerHTML = html; el._html = html;
  if (act) { const i = [...el.querySelectorAll("input")].find((x) => x.placeholder === act[0]); if (i) { i.focus(); i.setSelectionRange(act[1], act[1]); } }
  for (const [d, k] of detailKeys(el)) if (open.has(k)) d.open = true;
  scrollers(el).forEach((e, i) => { if (pos[i]?.[0] === e.className) { e.scrollLeft = pos[i][1]; e.scrollTop = pos[i][2]; } });
}
const badge = (s) => `<span class="badge ${s} ${s === "running" ? "pulse" : ""}">${s}</span>`;
const q = (r) => `p=${encodeURIComponent(r.projectKey)}&s=${r.session}&r=${r.runId}`;
// A session's plain subagents all share the run id "agents", so a run is known by its session too.
const key = (r) => `${r.session}/${r.runId}`;
let runs = [], sel = null, run = null, agentSel = null, tab = "result";
let filter = (() => { try { return localStorage.getItem("flowscope.filter") || "all"; } catch { return "all"; } })();
let showHistory = false, search = "";
const RECENT = 3;

function setFilter(f) { filter = f; try { localStorage.setItem("flowscope.filter", f); } catch {} drawRuns(); }
function toggleHistory() { showHistory = !showHistory; drawRuns(); }
function setSearch(v) { search = v.trim().toLowerCase(); drawRuns(); clearTimeout(hitTimer); hitTimer = setTimeout(loadHits, 350); }
// Search inside transcripts too: what agents said, were told, ran or got back. The server reads every transcript
// once before the first search can answer, so the list says how far it has got until then.
let hitTimer, hitQ = "";
async function loadHits() {
  const qv = search; hitQ = qv;
  if (qv.length < 3) { $("#hits").innerHTML = ""; return; }
  const r = await (await fetch("/api/search?q=" + encodeURIComponent(qv))).json();
  if (qv !== search) return;
  if (r.indexing) { $("#hits").innerHTML = `<div class="sec">In transcripts</div><div class="small none">Reading transcripts for search… ${r.indexing.done} of ${r.indexing.total}</div>`; hitTimer = setTimeout(loadHits, 1500); return; }
  const name = (k) => runs.find((x) => key(x) === k)?.name ?? "";
  const shown = r.hits.filter((h) => runs.some((x) => key(x) === h.run));
  $("#hits").innerHTML = `<div class="sec">In transcripts (${shown.length}${r.hits.length >= 200 ? "+" : ""})</div>` + (shown.map((h) =>
    `<div class="hit" data-act="hit" data-run="${esc(h.run)}" data-agent="${esc(h.agentId)}"><b dir="auto">${esc(h.label || name(h.run))}</b>${h.label ? `<div class="who" dir="auto">${esc(name(h.run))}</div>` : ""}<div class="snip" dir="auto">${mark(esc(cleanSnip(h.snippet)), qv)}</div><div class="small">${h.count > 1 ? `${h.count} places · ` : ""}${when(h.at)}</div></div>`).join("")
    || `<div class="small none">No transcript mentions it</div>`);
}
// A hit inside a tool's JSON input reads as text: no keys, quotes or braces, and URL escapes decoded.
const cleanSnip = (t) => String(t).replace(/%[0-9A-Fa-f]{2}(?:%[0-9A-Fa-f]{2})*/g, (m) => { try { return decodeURIComponent(m); } catch { return m; } })
  .replace(/\\n/g, " ").replace(/"[A-Za-z_]+":\s*/g, "").replace(/[{}"]|\\/g, "").replace(/\s*,\s*(?=\S)/g, ", ").replace(/\s+/g, " ").trim();
const mark = (html, qv) => !qv ? html : html.replace(new RegExp(esc(qv).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`);
async function openHit(k, agentId) { pick(k); await loading; openAgent(agentId, "transcript"); }
let runsText = "";
async function loadRuns() {
  // The browser revalidates with the server's ETag; an unchanged list is not drawn again.
  const t = await (await fetch("/api/runs")).text();
  if (t === runsText) return;
  const before = new Map(runs.map((r) => [key(r), r]));
  runsText = t; runs = JSON.parse(t); drawRuns();
  if (before.size) notifyChanges(before);
}
// Browser notifications, when asked for: a run that finishes, fails or stops, and one that goes quiet for 10 minutes.
let notifyOn = (() => { try { return localStorage.getItem("flowscope.notify") === "1"; } catch { return false; } })();
const quietTold = new Set();
function drawBell() { const b = $("#bell"); b.className = `ibtn bell ${notifyOn ? "on" : ""}`; b.innerHTML = icon("bell");
  b.title = notifyOn ? "Notifications on: a run finishing, failing, stopping or going quiet. Click to turn off" : "Notifications off. Click to be told when a run finishes, fails, stops or goes quiet"; b.setAttribute("aria-pressed", notifyOn); }
async function toggleNotify() {
  if (!notifyOn && "Notification" in window && Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") return;
  notifyOn = !notifyOn; try { localStorage.setItem("flowscope.notify", notifyOn ? "1" : "0"); } catch {} drawBell();
}
function notifyChanges(before) {
  if (!notifyOn || !("Notification" in window) || Notification.permission !== "granted") return;
  const tell = (r, body) => { const n = new Notification(r.name, { body, icon: "/favicon.svg", tag: key(r) }); n.onclick = () => { window.focus(); pick(key(r)); }; };
  for (const r of runs) {
    const was = before.get(key(r));
    if (was?.status === "running" && r.status !== "running") tell(r, { completed: "Finished", failed: "Failed", stopped: "Stopped before finishing" }[r.status] ?? r.status);
    if (r.status === "running" && Date.now() - r.lastActivity > 600_000 && !quietTold.has(key(r))) { quietTold.add(key(r)); tell(r, `No activity for ${dur(Date.now() - r.lastActivity)}`); }
    if (r.status === "running" && Date.now() - r.lastActivity < 600_000) quietTold.delete(key(r));
  }
}
// Claude Code and Codex do not document the files Flowscope reads; when one stops looking as expected, say so.
async function loadFormat() {
  const issues = await (await fetch("/api/format")).json();
  $("#warn").innerHTML = issues.length ? `<div class="warnbar" title="${esc(issues.map((i) => `${i.what}\n  ${i.file}`).join("\n"))}"><b>Claude Code's files look different.</b> Flowscope may show some of this wrongly until it is updated: ${esc(issues.map((i) => i.what).join("; "))}.</div>` : "";
}
// The project's folder, kept to its end, which is the part that tells projects apart.
const projectTail = (r) => r.projectKey.replace(/^-(Users|home)-[^-]+-(Documents-)?(GitHub-)?/, "");
const day = (t) => { const d = new Date(t), n = new Date(); const k = (x) => x.toDateString();
  if (k(d) === k(n)) return "Today"; n.setDate(n.getDate() - 1); if (k(d) === k(n)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); };
const row = (r) => `<div class="run s-${r.status} ${sel && key(sel) === key(r) ? "sel" : ""}" data-act="pick" data-key="${esc(key(r))}">
  <b dir="auto">${esc(r.name)}</b><div class="small meta">${r.status === "running" ? `${badge("running")} ${r.agents - r.agentsDone} of ${r.agents} going${Date.now() - r.lastActivity > 600_000 ? ` <span class="w-amber">· quiet ${dur(Date.now() - r.lastActivity)}</span>` : ""}` : `<span class="st ${r.status}">${{ completed: "✓", failed: "✕", stopped: "■" }[r.status] ?? ""}</span>`}
  <span class="kind">${r.kind === "cli" ? r.tool : r.kind}</span> ${when(r.lastActivity)}</div>
  <div class="small proj" title="${esc(r.project)}">${esc(projectTail(r))}</div></div>`;
const section = (title, rs) => rs.length ? `<div class="sec">${title}</div>${rs.map(row).join("")}` : "";
// Home is what is happening now: running runs, then the last few finished. The rest is history, grouped by day.
function drawRuns() {
  $("#filters").innerHTML = [["all", "All"], ["workflow", "Workflows"], ["agents", "Agents"], ["cli", "CLI"]].map(([f, l]) =>
    `<button class="${filter === f ? "on" : ""}" data-act="filter" data-v="${f}">${l}</button>`).join("");
  const shown = runs.filter((r) => (filter === "all" || r.kind === filter)
    && (!search || `${r.name} ${r.project} ${r.description}`.toLowerCase().includes(search)));
  const live = shown.filter((r) => r.status === "running"), past = shown.filter((r) => r.status !== "running");
  let html;
  if (search) html = byDay(shown) || `<div class="sec">Runs</div><div class="small none">No run's name matches</div>`;
  else {
    html = section("Running", live) || `<div class="sec">Running</div><div class="small none">Nothing running</div>`;
    html += section("Recent", past.slice(0, RECENT));
    const rest = past.slice(RECENT);
    if (rest.length) html += `<button class="more" data-act="history">${showHistory ? "Hide history" : `History (${rest.length}) ›`}</button>` + (showHistory ? byDay(rest) : "");
  }
  setHTML($("#runs"), html);
  if (!sel) renderHome();
}
const byDay = (rs) => { const g = new Map(); for (const r of rs) { const d = day(r.lastActivity); g.set(d, [...(g.get(d) ?? []), r]); }
  return [...g].map(([d, xs]) => section(d, xs)).join(""); };
function pick(k, push = true) { const r = runs.find((x) => key(x) === k); if (!r) return; sel = r; closeDrawer();
  if (push && location.hash.slice(1) !== k) history.pushState(null, "", "#" + k);
  document.body.classList.add("show-main");
  if (!showHistory && runs.filter((x) => x.status !== "running").slice(RECENT).includes(r)) showHistory = true;
  loading = loadRun(); drawRuns(); }
let loading = Promise.resolve();

// Home: what is running and how it is doing, what needs a look, and what finished lately.
function renderHome() {
  const live = runs.filter((r) => r.status === "running");
  const today = runs.filter((r) => day(r.lastActivity) === "Today");
  const todayTok = today.reduce((n, r) => n + r.usage.input + r.usage.cacheWrite + r.usage.output, 0);
  const quiet = live.filter((r) => Date.now() - r.lastActivity > 600_000);
  const bad = runs.filter((r) => (r.status === "failed" || r.status === "stopped") && Date.now() - r.lastActivity < 86400_000);
  const tile = (r, note) => `<div class="hcard s-${r.status}" data-act="pick" data-key="${esc(key(r))}"><b dir="auto">${esc(r.name)}</b>
    <div class="small">${r.status === "running" ? `${badge("running")} ${r.agents - r.agentsDone} of ${r.agents} going${Date.now() - r.lastActivity > 600_000 ? ` <span class="w-amber">· quiet ${dur(Date.now() - r.lastActivity)}</span>` : ""}` : `<span class="st ${r.status}">${r.status}</span>`} · <span class="kind">${r.kind === "cli" ? r.tool : r.kind}</span> · ${when(r.lastActivity)}</div>
    ${note ? `<div class="small w-amber">${note}</div>` : ""}<div class="small proj">${esc(projectTail(r))}</div></div>`;
  setHTML($("#main"), `<header><h2>Now</h2><div class="small">${live.length} running · ${today.length} active today · ${tok(todayTok)} tokens in today's runs</div></header>
    ${quiet.length || bad.length ? `<h3 class="hh">Needs a look</h3><div class="hgrid">${quiet.map((r) => tile(r, `no activity for ${dur(Date.now() - r.lastActivity)}`)).join("")}${bad.map((r) => tile(r, r.status === "failed" ? "failed" : "stopped before finishing")).join("")}</div>` : ""}
    <h3 class="hh">Running</h3>${live.length ? `<div class="hgrid">${live.filter((r) => !quiet.includes(r)).map((r) => tile(r)).join("") || `<div class="small">Only the ones above</div>`}</div>` : `<div class="small">Nothing running</div>`}
    <h3 class="hh">Finished lately</h3><div class="hgrid">${runs.filter((r) => r.status !== "running").slice(0, 6).map((r) => tile(r)).join("")}</div>`);
}

async function loadRun() {
  if (!sel) return;
  run = await (await fetch("/api/run?" + q(sel))).json();
  renderRun();
}
// Draws the run already loaded; the table's search and paging redraw without fetching again.
function renderRun() {
  const titles = run.phases.map((p) => p.title);
  const extra = [...new Set(run.agents.map((a) => a.phase || "—"))].filter((t) => !titles.includes(t));
  const cols = [...run.phases, ...extra.map((t) => ({ title: t }))];
  const done = run.agents.filter((a) => a.state === "done").length;
  // Columns with no agents say nothing once a run is over; a running workflow keeps them to show what is still to come.
  // A workflow still running keeps its phases to come; status columns (Running, Done, Stopped) show only when filled.
  const shownCols = cols.filter((p) => (run.kind === "workflow" && run.status === "running") || run.agents.some((a) => (a.phase || "—") === p.title));
  const took = (a) => a.startedAt && a.lastActivity ? Math.max(0, a.lastActivity - a.startedAt) : 0;
  const slowest = Math.max(1, ...run.agents.map(took));
  // What deserves a look: long silences, long tool waits, agents that stopped, results that are empty or just "OK".
  const silent = run.agents.filter((a) => a.state === "running" && !a.waiting && Date.now() - a.lastActivity > 600_000);
  const stuck = run.agents.filter((a) => a.waiting && Date.now() - a.waiting.since > 600_000);
  const stopped = run.agents.filter((a) => a.state === "stopped");
  const thin = run.agents.filter((a) => a.state === "done" && shape(a) === "short");
  const attention = [[silent, "silent over 10m", "running"], [stuck, "waiting on a tool over 10m", "running"], [stopped, "stopped", "stopped"], [thin, "with an empty or one-word result", "short"]].filter(([l]) => l.length);
  // Many agents in few columns reads better as a table: one row each, with the start of its result (R-L20).
  const big = run.agents.length > 30;
  // A workflow's progress is its phases: done, active (something running), or still to come.
  const phased = run.kind === "workflow" && cols.length > 1;
  const phaseStates = cols.map((p) => { const as = run.agents.filter((a) => (a.phase || "—") === p.title);
    return [p, !as.length ? "pending" : as.some((a) => a.state === "running") ? "active" : as.every((a) => a.state === "done") ? "done" : "stopped"]; });
  const activePhase = phaseStates.filter(([, st]) => st === "active").map(([p]) => p.title).join(", ");
  const waits = run.agents.filter((a) => a.waiting).map((a) => Date.now() - a.waiting.since);
  const longest = Math.max(0, ...waits);
  document.title = run.status === "running" ? `${waits.length && longest > 600_000 ? "⚠ " : "● "}${run.name} · Flowscope` : "Flowscope";
  const elapsed = run.durationMs ?? (run.agents.length ? run.lastActivity - Math.min(...run.agents.map((a) => a.startedAt)) : null);
  const limited = run.agents.filter((a) => a.apiError);
  if (limited.length) attention.unshift([limited, limited[0].apiError.kind === "rate_limit" ? `hit a usage limit (${limited[0].apiError.text.replace(/^.*?·\s*/, "")})` : "ended on an API error", "stopped"]);
  const view = runView === "timeline" ? "timeline" : big ? "table" : "board";
  setHTML($("#main"), `<button class="back" data-act="home">${icon("prev")}Runs</button><header><h2 dir="auto">${esc(run.name)} ${badge(run.status)}</h2><div class="small" dir="auto">${esc(run.description)}</div></header>
    <div class="stats"><div><b>${done}/${run.agents.length}</b>done of started</div><div><b>${run.agents.filter((a) => a.state === "running").length}</b>running now</div>
    ${waits.length ? `<div class="${waitClass(longest)}"><b>${dur(longest)}</b>longest tool wait${waits.length > 1 ? ` (${waits.length} waiting)` : ""}</div>` : ""}
    <div><b>${dur(elapsed)}</b>elapsed</div><div title="input ${tok(run.usage.input)} · cache writes ${tok(run.usage.cacheWrite)} · output ${tok(run.usage.output)}"><b>${tok(run.usage.input + run.usage.cacheWrite + run.usage.output)}</b>tokens</div>
    <div><b>${tok(run.usage.cacheRead)}</b>cache reads</div>
    ${run.weekShare == null ? "" : `<div title="Cost-weighted share of all Claude Code usage on this machine in the last 7 days"><b>${pct(run.weekShare)}</b>of this week's usage</div>`}<div><b>${when(run.lastActivity)}</b>last activity</div></div>
    ${phased ? `<div class="segs">${phaseStates.map(([p, st]) => `<div class="seg ${st}" title="${esc(p.title)}: ${st}"></div>`).join("")}</div>
      <div class="small segl">Phase ${Math.max(1, phaseStates.findLastIndex(([, st]) => st !== "pending") + 1)} of ${cols.length}${activePhase ? ` · ${esc(activePhase)}` : ""}</div>`
    : `<div class="bar"><i style="width:${run.agents.length ? done / run.agents.length * 100 : 0}%"></i></div>`}
    <div class="viewbar"><span class="tabs filters">${[[big ? "table" : "board", big ? "Table" : "Board"], ["timeline", "Timeline"]].map(([k, l]) => `<button class="${view === k ? "on" : ""}" data-act="view" data-v="${k}">${l}</button>`).join("")}</span>
      ${run.resume ? `<button class="cmdbtn" data-act="copyResume" title="${esc(run.resume)}">Copy resume command</button>` : ""}</div>
    ${attention.length ? `<div class="attn">${attention.map(([l, what, sh]) => `<button ${big ? `data-act="shape" data-v="${sh}"` : `data-act="agent" data-agent="${esc(l[0].agentId)}"`}><b>${l.length}</b> ${l.length === 1 ? "agent" : "agents"} ${what}</button>`).join("")}</div>` : ""}
    ${view === "timeline" ? timeline(cols) : big ? batchTable() : `<div class="phases">${shownCols.map((p) => {
      const as = run.agents.filter((a) => (a.phase || "—") === p.title);
      return `<div class="phase"><h3 dir="auto">${esc(p.title)} <span class="small">${as.length ? `${as.filter((a) => a.state === "done").length}/${as.length}` : "not started"}</span></h3><div class="small" dir="auto">${esc(p.detail || "")}</div>
        ${as.map((a) => `<div class="card ${a.state}" data-act="agent" data-agent="${esc(a.agentId)}"><div class="lbl" dir="auto" title="${esc(a.label || a.agentId)}">${esc(a.label || a.agentId)}</div>
        <div class="small">${a.type ? `<span class="kind">${esc(a.type)}</span> ` : ""}${a.state === "done" ? "" : badge(a.state) + " "}${flags(a)}${a.tools} tools · ${tok(a.usage.input + a.usage.cacheWrite + a.usage.output)}${a.peakContext ? ` · <span title="the most context one request carried">ctx ${tok(a.peakContext)}</span>` : ""} · ${a.state === "running" ? when(a.lastActivity) : `<span title="ended ${new Date(a.lastActivity).toLocaleString()}">${dur(took(a))}</span>`}</div>${a.waiting ? `<div class="now wait ${waitClass(Date.now() - a.waiting.since)}">⏳ waiting on ${esc(a.waiting.tool)} for ${dur(Date.now() - a.waiting.since)}${Date.now() - a.waiting.since > 600_000 ? " · possibly stuck" : ""}</div>` : ""}${a.state === "running" && a.now ? `<div class="now" dir="auto" title="${esc(a.now)}">${esc(nowText(a.now))}</div>` : ""}${a.state !== "running" ? `<i class="db" style="width:${(took(a) / slowest * 100).toFixed(1)}%" title="took ${dur(took(a))}; the slowest took ${dur(slowest)}"></i>` : ""}</div>`).join("") || ""}</div>`;
    }).join("")}</div>`}
    ${run.logs.length ? `<details open><summary>Log</summary><pre>${esc(run.logs.join("\n"))}</pre></details>` : ""}
    ${run.result ? `<details><summary>Final result</summary>${md(typeof run.result === "string" ? run.result : JSON.stringify(run.result))}</details>` : ""}
    ${run.script ? `<details><summary>Script</summary><pre class="hljs">${hl(run.script, "javascript")}</pre></details>` : ""}`);
  if (agentSel) renderDrawer();
}

let runView = "board";
// Line icons, drawn on a 16px grid in the weight of the logo, coloured by their button.
const ICONS = {
  bell: '<path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1.5H3z"/><path d="M6.5 14.5a1.6 1.6 0 0 0 3 0"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  link: '<path d="M7 9a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.6.6"/><path d="M9 7a2.8 2.8 0 0 0-4 0L3 9a2.8 2.8 0 0 0 4 4l.6-.6"/>',
  term: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6.5 6.5 8l-2 1.5M8.5 10h3"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  prev: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  next: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.8 1.8 0 0 1 3.4.6c0 1.2-1.7 1.4-1.7 2.5"/><path d="M8 11.4v.1"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  moon: '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"/>',
};
const icon = (n) => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${ICONS[n]}</svg>`;
// An icon button that copies, and shows a tick for a moment after.
// The tick shows only once the clipboard has taken it.
// What it copies is named by data attributes (a step's link, an output, the open agent's resume command), never by code in the markup.
const copyBtn = (what, i, title, name = "copy") => `<button class="ibtn" data-act="copy" data-v="${what}" data-i="${i}" data-icon="${name}" title="${title}" aria-label="${title}">${icon(name)}</button>`;
function flash(btn, name) { btn.innerHTML = icon("check"); btn.classList.add("ok");
  // In a step's heading, say what was copied next to the tick.
  const said = btn.closest(".acts") ? Object.assign(document.createElement("span"), { className: "done", textContent: name === "link" ? "Link copied" : "Copied" }) : null;
  if (said) btn.before(said);
  setTimeout(() => { btn.innerHTML = icon(name); btn.classList.remove("ok"); said?.remove(); }, 1200); }
// What an agent's card says beyond its state: a usage limit or API error it ended on, a retry.
const flags = (a) => (a.apiError ? `<span class="flag" title="${esc(a.apiError.text)}">${a.apiError.kind === "rate_limit" ? "usage limit" : "API error"}</span> ` : "")
  + (a.attempt > 1 ? `<span class="flag" title="the workflow retried this agent">attempt ${a.attempt}</span> ` : "");
function copyText(t, btn) { navigator.clipboard?.writeText(t); if (btn) { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = o; }, 1200); } }
const clock = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
// Every agent on one time axis: what ran alongside what, what waited for what, and which one held the run up.
// Agents launched hours apart would be slivers on a plain axis, so a long stretch with nothing running is cut out
// and drawn as a narrow band that says how long it was; each stretch of work keeps its own scale.
function timeline(cols) {
  const end = (a) => a.state === "running" ? Date.now() : Math.max(a.lastActivity, a.startedAt);
  const as = run.agents.filter((a) => a.startedAt);
  if (!as.length) return `<div class="empty">No agent has started</div>`;
  // Stretches of work: agents' spans merged where they overlap or nearly touch.
  const spans = as.map((a) => [a.startedAt, end(a)]).sort((p, q) => p[0] - q[0]);
  const busy = [];
  for (const [b, e] of spans) { const last = busy.at(-1); if (last && b <= last[1]) last[1] = Math.max(last[1], e); else busy.push([b, e]); }
  const work = busy.reduce((n, [b, e]) => n + (e - b), 0);
  // A gap is cut when it is long against the work around it: over 10 minutes and over a fifth of all work time.
  const cut = (g) => g > 600_000 && g > work / 5;
  const segs = [];
  busy.forEach(([b, e], i) => { if (i) { const g = b - busy[i - 1][1]; segs.push({ b: busy[i - 1][1], e: b, gap: cut(g) }); } segs.push({ b, e, gap: false }); });
  const cuts = segs.filter((g) => g.gap).length;
  const GAP = cuts ? Math.min(8, 30 / cuts) : 0;  // percent of the track per cut gap
  const kept = segs.filter((g) => !g.gap).reduce((n, g) => n + (g.e - g.b), 0) || 1;
  let at = 0;
  for (const g of segs) { g.x = at; g.w = g.gap ? GAP : (g.e - g.b) / kept * (100 - GAP * cuts); at += g.w; }
  // A moment on the edge of a cut gap belongs to the work beside it, not to the band.
  // Work stretches are inset a little from the bands, so bars either side of a cut never read as one handoff.
  const P = cuts ? 0.5 : 0;
  const x = (t) => { const g = segs.find((g) => g.gap ? t < g.e && t > g.b : t <= g.e) ?? segs.at(-1);
    return g.gap ? g.x : g.x + P + (g.e > g.b ? (t - g.b) / (g.e - g.b) * (g.w - 2 * P) : 0); };
  // Across days a clock time alone is ambiguous: the weekday comes along when the day changes.
  let lastDay = "";
  const stamp = (t) => { const d = new Date(t).toDateString(), same = d === lastDay; lastDay = d;
    return same ? clock(t) : new Date(t).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }); };
  // Labels: each stretch of work starts with its clock time; a single stretch gets offsets along it too.
  const label = (pos, text, cls = "") => `<span class="${cls}" style="left:${pos.toFixed(2)}%">${text}</span>`;
  const t0 = busy[0][0], span = busy.at(-1)[1] - t0;
  // With many stretches, a label is dropped when it would run into the one before; every band says its length on hover.
  // A label keeps its place only if it starts after the last one ends; widths are measured in the axis's own font.
  const meas = Object.assign(document.createElement("canvas").getContext("2d"), { font: "11px 'IBM Plex Sans'" });
  const trackPx = Math.max(300, ($("#main")?.clientWidth ?? 1000) * .62);
  const fit = (items, centred) => { let end = -1e9; return items.filter(([pos, t]) => {
    const w = (meas.measureText(String(t)).width + 14) / trackPx * 100, start = centred ? pos - w / 2 : pos;
    return start >= end && (end = start + w, true); }); };
  const ticks = !cuts ? [0, .25, .5, .75, 1].map((f) => label(f * 100, f ? `+${dur(f * span)}` : clock(t0))).join("")
    : fit(segs.filter((g, i) => !g.gap && (i === 0 || segs[i - 1].gap)).map((g) => [g.x + P, stamp(g.b)])).map(([pos, t]) => label(pos, t, "at")).join("")
      + fit(segs.filter((g) => g.gap).map((g) => [g.x + g.w / 2, `${dur(g.e - g.b)} idle`]), true).map(([pos, t]) => label(pos, t, "gapl")).join("");
  const bands = segs.filter((g) => g.gap).map((g) => `<b class="tl-gap" style="left:${g.x.toFixed(2)}%;width:${g.w.toFixed(2)}%" title="${dur(g.e - g.b)} with nothing running"></b>`).join("");
  const lane = (a) => `<div class="tl-row" data-act="agent" data-agent="${esc(a.agentId)}" title="${esc(a.label || a.agentId)} · ${clock(a.startedAt)} · ${dur(end(a) - a.startedAt)}${a.peakContext ? ` · peak context ${tok(a.peakContext)}` : ""}">
    <span class="tl-l" dir="auto">${esc(a.label || a.agentId)}</span><div class="tl-track">${cuts ? bands : `<div class="tl-grid"></div>`}<i class="tl-bar ${a.apiError ? "limit" : a.state}" style="left:${x(a.startedAt).toFixed(2)}%;width:${Math.max(0, x(end(a)) - x(a.startedAt)).toFixed(2)}%"></i></div>
    <span class="tl-d">${dur(end(a) - a.startedAt)}</span></div>`;
  const groups = run.kind === "workflow" ? cols.map((p) => [p.title, as.filter((a) => (a.phase || "—") === p.title)]).filter(([, g]) => g.length) : [["", as]];
  return `<div class="tl ${cuts ? "cut" : ""}"><div class="tl-axis"><span></span><div class="tl-track">${ticks}${bands}</div><span></span></div>
    ${groups.map(([t, g]) => (t ? `<div class="tl-ph" dir="auto">${esc(t)}</div>` : "") + [...g].sort((a, b) => a.startedAt - b.startedAt).map(lane).join("")).join("")}</div>`;
}
// A wait over 2 minutes is worth noticing, over 10 worth checking (R-T24, R-T23).
const waitClass = (ms) => ms > 600_000 ? "w-red" : ms > 120_000 ? "w-amber" : "";
// "Bash: cd /long/path && the command" shows the command, which is what tells you what it waits on.
const nowText = (t) => t.replace(/^(Bash: )cd \S+\s*(&&|;)\s*/, "$1");
let batchQ = "", batchN = 100, batchShape = "all";
// A result's shape, for sorting through hundreds: empty or one word ("OK"), or a real answer.
const shape = (a) => a.state !== "done" ? a.state : String(a.result ?? "").trim().split(/\s+/).filter(Boolean).length <= 2 ? "short" : "long";
// Words every label starts with ("JUST HEARD (paragraph"), dropped in the table so what differs gets the room.
function commonPrefix(ls) {
  if (ls.length < 2) return "";
  let p = ls[0]; for (const l of ls) while (!l.startsWith(p)) p = p.slice(0, -1);
  p = p.slice(0, p.lastIndexOf(" ") + 1);
  return p.trim().length >= 4 ? p : "";
}
// The table's rows, after its search box; the drawer's next/previous steps through these.
const tableRows = () => run.agents.filter((a) => (batchShape === "all" || shape(a) === batchShape) && (!batchQ || `${a.label} ${a.result ?? ""} ${a.state}`.toLowerCase().includes(batchQ)));
function setBatchQ(v) { batchQ = v.trim().toLowerCase(); batchN = 100; renderRun(); }
function batchTable() {
  const rows = tableRows();
  const pre = commonPrefix(run.agents.map((a) => a.label || ""));
  const shapes = [["all", "All"], ["long", "Answers"], ["short", "Empty or one word"], ["running", "Running"], ["stopped", "Stopped"]]
    .map(([k, l]) => [k, l, k === "all" ? run.agents.length : run.agents.filter((a) => shape(a) === k).length]).filter(([k, , n]) => n || k === batchShape);
  return `<div class="tools"><input type="search" placeholder="Search labels and results" value="${esc(batchQ)}" data-input="batchq">
    <span class="tabs">${shapes.map(([k, l, n]) => `<button class="${batchShape === k ? "on" : ""}" data-act="shape" data-v="${k}">${l} <span class="small">${n}</span></button>`).join("")}</span>
    ${batchQ ? `<span class="small">${rows.length} match</span>` : ""}</div>
    <table class="batch"><tr><th>#</th><th>${pre ? `<span title="every label starts with this">${esc(pre)}…</span>` : "Label"}</th><th>Tokens</th><th>Took</th><th>Result</th></tr>
    ${rows.slice(0, batchN).map((a) => `<tr class="r" data-act="agent" data-agent="${esc(a.agentId)}"><td class="s-${a.state}">${run.agents.indexOf(a) + 1}</td>
      <td dir="auto" title="${esc(a.label || "")}">${esc((a.label || a.agentId).slice(pre.length))}</td><td>${tok(a.usage.input + a.usage.cacheWrite + a.usage.output)}</td>
      <td>${a.startedAt && a.lastActivity ? dur(a.lastActivity - a.startedAt) : "—"}</td>
      <td class="res" dir="${dirOf(a.result ?? a.now ?? "")}">${a.state === "done" ? esc(String(a.result ?? "").replace(/\s+/g, " ").slice(0, 200)) : a.state === "running" ? esc(a.now ?? "") : "stopped"}</td></tr>`).join("")}</table>
    ${rows.length > batchN ? `<button class="more" data-act="more">Show more (${rows.length - batchN} left)</button>` : ""}`;
}
// Next or previous agent with the drawer open: the table's order for a big run, the cards' order otherwise.
function stepAgent(d) {
  const list = run.agents.length > 30 ? tableRows() : run.agents;
  const i = list.findIndex((a) => a.agentId === agentSel);
  const next = list[i + d]; if (next) openAgent(next.agentId);
}

// The address follows the open agent (and a step in its transcript), so a link opens exactly that.
let target = null;
async function openAgent(id, t, step = null) { agentSel = id; target = step; const b = $("#dbody"); b._html = null; b.innerHTML = ""; b.scrollTop = 0;
  tab = t ?? (run.agents.find((a) => a.agentId === id)?.result ? "result" : "transcript"); $("#drawer").classList.add("open");
  const h = `${key(sel)}/${id}${step != null ? `/${step}` : ""}`; if (location.hash.slice(1) !== h) history.replaceState(null, "", "#" + h);
  await renderDrawer();
  if (step != null) { const el = $(`#step-${step}`); if (el) { el.open = true; el.scrollIntoView({ block: "center" }); } }
}
function closeDrawer() { const was = agentSel; agentSel = null; target = null; $("#drawer").classList.remove("open"); if (was && sel && location.hash.slice(1) !== key(sel)) history.replaceState(null, "", "#" + key(sel)); }
function copyStep(i) { return navigator.clipboard.writeText(`${location.origin}${location.pathname}#${key(sel)}/${agentSel}/${i}`); }
function setTab(t) { tab = t; renderDrawer(); }
// The transcript as a story: the agent's own words in full, each tool call and its output folded into one row
// that says what was done (its description, or the command without its cd), whether it worked, how much came back
// and how long it took.
let tFilter = (() => { try { return localStorage.getItem("flowscope.tfilter") || "all"; } catch { return "all"; } })();
function setTFilter(f) { tFilter = f; try { localStorage.setItem("flowscope.tfilter", f); } catch {} renderDrawer(); }
let outs = [];
const copyOut = (i) => navigator.clipboard.writeText(outs[i]);
const lines = (t) => t.split("\n").length;
const nLines = (t) => { const n = lines(t); return `${n} line${n === 1 ? "" : "s"}`; };
// A file path is known by its last two parts; the full path stays in the tooltip.
const shortPath = (t) => /^\/\S+$/.test(t) ? "…/" + t.split("/").slice(-2).join("/") : t;
const stripCd = (c) => String(c ?? "").replace(/^\s*cd \S+\s*(&&|;)\s*/, "");
const fmt = (v) => typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(+v.toPrecision(4)))
  : v && typeof v === "object" ? JSON.stringify(v, (k, x) => typeof x === "number" && !Number.isInteger(x) ? +x.toPrecision(4) : x) : String(v ?? "");
// Output that is JSON reads better laid out: lines of "name {…}" or "{…}" as a table, one object as indented JSON.
// Prose that tools return (a page fetched, an agent's answer, a Markdown file read) reads as Markdown.
const PROSE_TOOLS = /^(WebFetch|WebSearch|Agent|Task|SendMessage|Skill|TaskOutput)$|^mcp__/;
const looksMd = (t) => (t.match(/(^|\n)\s*(#{1,6} |[-*] |\d+\. |> )|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(http/g) ?? []).length >= 2 && !/^\s*[\[{<]/.test(t);
function renderOut(t, i, lang) {
  if (lang === "markdown" || (lang === undefined && looksMd(t))) return `<div class="brief outmd">${md(t)}</div>`;
  const ls = t.split("\n").filter((l) => l.trim());
  const recs = ls.map((l) => { const m = l.match(/^\s*(?:(\S+)\s+)?(\{.*\})\s*$/); if (!m) return null; try { return [m[1] ?? "", JSON.parse(m[2])]; } catch { return null; } });
  if (ls.length > 1 && recs.every(Boolean)) {
    const keys = [...new Set(recs.flatMap(([, o]) => Object.keys(o)))];
    const named = recs.some(([n]) => n);
    return `<div class="out"><div class="tbl"><table class="batch"><tr>${named ? "<th></th>" : ""}${keys.map((k) => `<th>${esc(k)}</th>`).join("")}</tr>
      ${recs.map(([n, o]) => `<tr>${named ? `<td><b>${esc(n)}</b></td>` : ""}${keys.map((k) => `<td>${esc(fmt(o[k]))}</td>`).join("")}</tr>`).join("")}</table></div></div>`;
  }
  let shown = t;
  if (/^\s*[\[{]/.test(t)) { try { shown = JSON.stringify(JSON.parse(t), null, 2); lang = "json"; } catch {} }
  return `<div class="out"><pre class="o hljs" dir="auto">${hl(shown, lang)}</pre></div>`;
}
// A tool's input as labelled fields, not a JSON blob: short values inline, code and long text in blocks,
// prompts and messages as Markdown.
const PROSE = /^(prompt|message|content|text|summary|question|instructions)$/;
// What an output is written in: a file a tool read, by its extension; grep and ls listings stay plain.
function outLang(u) {
  let i = {}; try { i = JSON.parse(u.input); } catch {}
  if (PROSE_TOOLS.test(u.name)) return "markdown";
  if (/^(Bash|shell|exec_command|local_shell_call)$/.test(u.name)) return "text";
  if (i.file_path && /^(Read)$/.test(u.name)) return langOf(i.file_path) ?? "text";
  if (/^(Grep|Glob|LS)$/.test(u.name)) return "text";
  return undefined;
}
function renderIn(u, acts = "") {
  let o; try { o = JSON.parse(u.input); } catch { return `<div class="io-h">Input${acts}</div><pre class="in">${esc(u.input)}</pre>`; }
  if (!o || typeof o !== "object") return "";
  const fileLang = langOf(o.file_path);
  const rows = Object.entries(o).filter(([k]) => k !== "description").map(([k, v]) => {
    if (typeof v === "string" && (k === "command" || /\n/.test(v) && !PROSE.test(k)))
      return `${k === "command" ? "" : `<div class="kv"><span>${esc(k)}</span></div>`}<pre class="in hljs">${hl(v, k === "command" ? "bash" : /^(content|new_string|old_string)$/.test(k) ? fileLang ?? "text" : "text")}</pre>`;
    if (typeof v === "string" && PROSE.test(k) && v.length > 80) return `<div class="kv"><span>${esc(k)}</span></div><div class="brief">${md(v)}</div>`;
    if (v && typeof v === "object") return `<div class="kv"><span>${esc(k)}</span></div><pre class="in hljs">${hl(JSON.stringify(v, null, 2), "json")}</pre>`;
    return `<div class="kv"><span>${esc(k)}</span><code dir="auto">${esc(String(v))}</code></div>`;
  });
  return rows.length ? `<div class="io-h">Input${acts}</div>${rows.join("")}` : "";
}
function transcriptHTML(ev, live) {
  outs = [];
  const results = new Map(ev.filter((e) => e.kind === "output" && e.for).map((e) => [e.for, e]));
  const units = [];
  for (const e of ev) {
    if (e.kind === "output" && e.for && ev.some((x) => x.kind === "tool" && x.id === e.for)) continue;
    if ((e.kind === "text" || e.kind === "prompt") && !String(e.text).trim()) continue;
    units.push(e.kind === "tool" ? { ...e, out: results.get(e.id) } : e);
  }
  const shown = units.filter((u) => tFilter === "all" || (tFilter === "agent" ? u.kind === "text" || u.kind === "prompt" : (u.out?.error || (u.kind === "output" && u.error))));
  const bar = `<div class="tfilter tabs">${[["all", "All"], ["agent", "Agent only"], ["errors", "Errors"]].map(([f, l]) =>
    `<button class="${tFilter === f ? "on" : ""}" data-act="tfilter" data-v="${f}">${l}</button>`).join("")}
    <span class="small">${units.filter((u) => u.kind === "tool").length} tool calls${units.some((u) => u.out?.error) ? ` · <span class="w-red">${units.filter((u) => u.out?.error).length} errors</span>` : ""}</span></div>`;
  const stepLink = (u) => copyBtn("step", units.indexOf(u), "Copy a link to this step", "link");
  const idOf = (u) => `id="step-${units.indexOf(u)}"`;
  return bar + shown.map((u) => {
    // Later "prompts" that are system notes (reminders, notifications) are context, not the task: shown folded.
    if (u.kind === "prompt" && u !== units.find((x) => x.kind === "prompt") && /^\s*<[a-z-]+>/.test(u.text))
      return `<details ${idOf(u)} class="call note"><summary><span class="chip">${esc(u.text.match(/<([a-z-]+)>/)[1])}</span><span class="lbl small">${esc(u.text.replace(/<[^>]+>/g, " ").trim().slice(0, 120))}</span><span class="meta"></span></summary><div class="io"><pre class="in" dir="auto">${esc(u.text)}</pre></div></details>`;
    // Messages after the task (one sent mid-run, an image) are messages, not a second task.
    if (u.kind === "prompt" && u !== units.find((x) => x.kind === "prompt"))
      return `<details ${idOf(u)} class="call note"><summary><span class="chip">message</span><span class="lbl" dir="auto">${esc(u.text.split("\n").find((l) => l.trim()) ?? "")}</span><span class="meta">${nLines(u.text)}</span></summary><div class="io brief">${md(u.text)}</div></details>`;
    if (u.kind === "prompt") return `<details ${idOf(u)} class="call task"><summary><span class="chip">task</span><span class="lbl" dir="auto">${esc(u.text.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") ?? "")}</span><span class="meta">${nLines(u.text)}</span></summary><div class="io brief">${md(u.text)}</div></details>`;
    if (u.kind === "text") return `<div ${idOf(u)} class="ev say">${md(u.text)}</div>`;
    if (u.kind === "output") { outs.push(u.text); return `<details ${idOf(u)} class="call ${u.error ? "err" : ""}"><summary><span class="chip">output</span> ${nLines(u.text)}</summary>${renderOut(u.text, outs.length - 1)}</details>`; }
    const cmd = u.cmd != null ? stripCd(u.cmd) : u.text;
    let fp; try { fp = JSON.parse(u.input).file_path; } catch {}
    const label = u.desc || (fp ? shortPath(fp) : shortPath(cmd));
    const o = u.out;
    const took = o?.ts && u.ts ? Date.parse(o.ts) - Date.parse(u.ts) : null;
    const status = !o ? (live ? `<span class="running">running</span>` : `<span class="small">no result</span>`)
      : o.error ? `<span class="w-red">✕ error</span>` : "";
    let body = "";
    // The step's link heads its first section; copy heads the output.
    const linkActs = `<span class="acts">${stepLink(u)}</span>`;
    body += renderIn(u, linkActs);
    if (o) { outs.push(o.text); body += `<div class="io-h">Output<span class="acts">${body ? "" : stepLink(u)}${o.text.trim() ? copyBtn("out", outs.length - 1, "Copy the output") : ""}</span></div>` + (o.text.trim() ? renderOut(o.text, outs.length - 1, outLang(u)) : (o.images?.length ? "" : `<div class="small">no output</div>`))
      + (o.images ?? []).map((src) => `<img class="shot" src="${src}" alt="image the tool returned">`).join(""); }
    return `<details ${idOf(u)} class="call ${o?.error ? "err" : !o ? "pending" : ""} ${target === units.indexOf(u) ? "target" : ""}"><summary><span class="chip">${esc(u.name)}</span><span class="lbl" dir="auto" title="${esc(cmd)}">${esc(label)}</span>
      <span class="meta">${[took != null && took >= 1000 ? dur(took) : "", o ? (o.text.trim() ? nLines(o.text) : o.images?.length ? "image" : "empty") : "", status].filter(Boolean).join(" · ")}</span>
      ${u.desc && cmd ? `<div class="cmd" title="${esc(u.cmd)}">${esc(cmd)}</div>` : ""}</summary><div class="io">${body}</div></details>`;
  }).join("");
}

const taskCache = new Map();
async function renderDrawer() {
  const a = run.agents.find((x) => x.agentId === agentSel); if (!a) return;
  const tabBtn = (k, l, key) => `<button class="${tab === k ? "on" : ""}" data-act="tab" data-v="${k}">${l} <kbd>${key}</kbd></button>`;
  setHTML($("#dhead"), `<div class="dh-top"><h2 dir="auto">${esc(a.label)}</h2>${badge(a.state)}
      <div class="dh-nav">${a.resume ? copyBtn("resume", 0, `Copy resume command: ${esc(a.resume)}`, "term") + `<span class="sep"></span>` : ""}<button class="ibtn" data-act="step" data-v="-1" title="Previous agent (K)">${icon("prev")}</button><button class="ibtn" data-act="step" data-v="1" title="Next agent (J)">${icon("next")}</button>
      <button class="ibtn" popovertarget="keys" title="Keyboard shortcuts (?)">${icon("help")}</button><button class="ibtn" data-act="close" title="Close (Esc)">${icon("close")}</button></div></div>
    <div class="dh-meta" title="agent id ${esc(a.agentId)}">${flags(a)}${esc([a.phase, a.type, a.model, a.effort && `${a.effort} effort`, `${a.tools} tools`,
      a.peakContext && `peak context ${tok(a.peakContext)}`, run.weekShare != null && run.usage.weighted && `${pct(a.usage.weighted / run.usage.weighted * run.weekShare)} of this week's usage`].filter(Boolean).join(" · "))}
</div>
    <nav class="dtabs">${tabBtn("task", "Task", "P")}${tabBtn("result", "Result", "R")}${tabBtn("transcript", "Transcript", "T")}</nav>`);
  const body = $("#dbody");
  if (tab === "result") { setHTML(body, a.result ? md(a.result) : `<div class="empty">No result yet</div>`); return; }
  if (tab === "task") {
    // The prompt the agent was given: the first message of its transcript, fetched once.
    let t = taskCache.get(a.agentId);
    if (t == null) { const ev = await (await fetch(`/api/agent?${q(sel)}&a=${a.agentId}`)).json(); t = ev.find((e) => e.kind === "prompt")?.text ?? ""; taskCache.set(a.agentId, t); }
    if (agentSel !== a.agentId || tab !== "task") return;
    setHTML(body, t ? `<div class="brief">${md(t)}</div>` : `<div class="empty">No task found</div>`); return;
  }
  const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
  const ev = await (await fetch(`/api/agent?${q(sel)}&a=${a.agentId}`)).json();
  if (agentSel !== a.agentId || tab !== "transcript") return; // the reader moved on while this loaded
  setHTML(body, transcriptHTML(ev, a.state === "running"));
  // The live line sits outside the transcript's HTML, so it is replaced, never stacked, on each refresh.
  body.querySelector(".live")?.remove();
  if (a.state === "running") body.insertAdjacentHTML("beforeend", `<div class="live ${a.waiting ? waitClass(Date.now() - a.waiting.since) : ""}"><span class="pulse"></span>${a.waiting ? `running ${esc(a.waiting.tool)} for ${dur(Date.now() - a.waiting.since)}` : "working"}</div>`);
  if (atBottom && a.state === "running") body.scrollTop = body.scrollHeight;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return closeDrawer();
  if (e.target.matches?.("input") || e.metaKey || e.ctrlKey) return;
  if (e.key === "/") { e.preventDefault(); $("#search").focus(); return; }
  if (e.key === "?") { $("#keys").togglePopover?.(); return; }
  if (!agentSel) return;
  if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); stepAgent(1); }
  if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); stepAgent(-1); }
  if (e.key === "r") setTab("result");
  if (e.key === "p") setTab("task");
  if (e.key === "t") setTab("transcript");
});
function setTheme(t) { theme = t; try { localStorage.setItem("flowscope.theme", t); } catch {} applyTheme(t); drawTheme(); }
function drawTheme() { $("#theme").innerHTML = [["auto", "Auto", "Follow the system"], ["light", icon("sun"), "Light"], ["dark", icon("moon"), "Dark"]]
  .map(([k, l, t]) => `<button class="${theme === k ? "on" : ""}" data-act="theme" data-v="${k}" title="${t}">${l}</button>`).join(""); }
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(theme));
applyTheme(theme); drawTheme();
// The address names the run; following it (a pasted link, Back, Forward) opens that run, and no run means home.
function route() { const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return goHome(false);
  const [s1, r1, agent, step] = h.split("/"), k = `${s1}/${r1}`;
  if (!sel || key(sel) !== k) pick(k, false);
  if (!agent && agentSel) closeDrawer();
  if (agent && agent !== agentSel) loading.then(() => openAgent(agent, step != null ? "transcript" : undefined, step != null ? Number(step) : null));
}
function goHome(push = true) { sel = null; run = null; closeDrawer(); if (push && location.hash) history.pushState(null, "", location.pathname);
  document.body.classList.remove("show-main"); document.title = "Flowscope"; drawRuns(); }
window.addEventListener("popstate", route);
window.addEventListener("hashchange", route);
drawBell();
loadRuns().then(route); loadFormat();
// R-T20
setInterval(() => { loadRuns(); if (sel && (run?.status === "running")) loadRun(); }, 3000);
setInterval(loadFormat, 60_000);

// Every click and input the page handles goes through these two listeners, keyed by the element's data-act or
// data-input. The markup carries no code, so the page runs without inline script (R-S3).
const ACTS = {
  home: () => goHome(), notify: () => toggleNotify(), history: () => toggleHistory(), close: () => closeDrawer(),
  hit: (d) => openHit(d.run, d.agent), pick: (d) => pick(d.key), agent: (d) => openAgent(d.agent),
  filter: (d) => setFilter(d.v), tfilter: (d) => setTFilter(d.v), tab: (d) => setTab(d.v), theme: (d) => setTheme(d.v),
  step: (d) => stepAgent(Number(d.v)), view: (d) => { runView = d.v; renderRun(); },
  shape: (d) => { batchShape = d.v; batchN = 100; renderRun(); }, more: () => { batchN += 200; renderRun(); },
  copyResume: (d, el) => copyText(run.resume, el),
  // A copy button may sit in a step's summary: the click copies, it does not fold the step.
  copy: (d, el, e) => { e.preventDefault(); e.stopPropagation();
    const done = d.v === "step" ? copyStep(Number(d.i)) : d.v === "out" ? copyOut(Number(d.i))
      : navigator.clipboard.writeText(run.agents.find((x) => x.agentId === agentSel).resume);
    Promise.resolve(done).then(() => flash(el, d.icon)).catch(() => {}); },
};
document.addEventListener("click", (e) => { const el = e.target.closest?.("[data-act]"); if (el && ACTS[el.dataset.act]) ACTS[el.dataset.act](el.dataset, el, e); });
document.addEventListener("input", (e) => { const k = e.target.dataset?.input;
  if (k === "search") setSearch(e.target.value); else if (k === "batchq") setBatchQ(e.target.value); });
