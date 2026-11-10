// Theme: auto follows the system; light or dark is the viewer's choice, remembered in this browser.
function applyTheme(t) {
  const r = document.documentElement;
  if (t === "auto") r.removeAttribute("data-theme"); else r.setAttribute("data-theme", t);
  const sys = matchMedia("(prefers-color-scheme: dark)").matches, dark = t === "dark" || (t === "auto" && sys);
  const l = document.getElementById("hl-light"), d = document.getElementById("hl-dark");
  if (l && d) { l.media = dark ? "not all" : "all"; d.media = dark ? "all" : "not all"; }
}
let theme = (() => { try { return localStorage.getItem("flowscope.theme") || "auto"; } catch { return "auto"; } })();
applyTheme(theme);
