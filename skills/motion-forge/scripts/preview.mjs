#!/usr/bin/env node
// Live preview server: serves a composition folder, reloads the page whenever a file changes and keeps the playhead
// where it was (the MF player UI stores it). Local-only by default.
// usage: preview.mjs <dir|comp.html> [--port 5177] [--host 127.0.0.1]
//   open the printed URL → space play/pause · ←/→ frame step (shift = 1s) · drag the scrubber · ?guides=1 safe zones · ?q=draft fast low-res 3D
//   Timing panel (top right): nudge any timeline label, preview it, "Save to source" rewrites literal addLabel("name", 1.20) times
import fs from "node:fs";
import path from "node:path";
import { parseArgs, serve, line } from "./lib/common.mjs";

const a = parseArgs();
const target = path.resolve(a._[0] || ".");
const dir = fs.statSync(target).isDirectory() ? target : path.dirname(target);
const page = fs.statSync(target).isDirectory() ? "index.html" : path.basename(target);
const clients = new Set();
const RELOAD = `<script data-mf-qa-ignore>(()=>{try{const es=new EventSource("/__mf/events");es.onmessage=()=>location.reload();}catch(e){}})();</script>`;
// Timing editor: nudge timeline labels in the browser and write them back into the source (literal addLabel times only).
const EDITOR = `<script data-mf-qa-ignore>(()=>{ const go = () => { if (!window.__MF || !window.__MF.ready) return setTimeout(go, 200);
  window.__MF.ready.then(() => build()); };
  const build = () => { const L = window.__MF.meta.labels || {}, names = Object.keys(L); if (!names.length || new URLSearchParams(location.search).get("ui") === "0") return;
  const box = document.createElement("div"); box.setAttribute("data-mf-qa-ignore", "");
  box.style.cssText = "position:fixed;right:8px;top:8px;z-index:2147483647;background:rgba(20,20,22,.92);color:#eee;font:12px/1.4 system-ui,sans-serif;padding:8px 10px;border-radius:8px;max-height:70vh;overflow:auto";
  box.innerHTML = "<b>Timing</b> <small style=opacity:.7>(labels, s)</small>" + names.map((n) => '<div style="display:flex;gap:4px;align-items:center;margin-top:4px"><span style="flex:1;min-width:70px">' + n + '</span><button data-n="' + n + '" data-d="-0.1">−</button><input data-n="' + n + '" value="' + (+L[n]).toFixed(2) + '" style="width:52px;background:#222;color:#eee;border:1px solid #444;border-radius:4px;padding:1px 4px"><button data-n="' + n + '" data-d="0.1">+</button><button data-seek="' + n + '">▶</button></div>').join("") + '<button id="__mfsave" style="margin-top:8px;width:100%">Save to source</button><div id="__mfmsg" style="opacity:.8;margin-top:4px"></div>';
  document.body.appendChild(box);
  box.addEventListener("click", (e) => { const b = e.target; if (b.dataset.d) { const i = box.querySelector('input[data-n="' + b.dataset.n + '"]'); i.value = Math.max(0, +i.value + +b.dataset.d).toFixed(2); window.__MF.seek(+i.value); }
    if (b.dataset.seek) window.__MF.seek(+box.querySelector('input[data-n="' + b.dataset.seek + '"]').value);
    if (b.id === "__mfsave") { const body = {}; box.querySelectorAll("input[data-n]").forEach((i) => { if (Math.abs(+i.value - L[i.dataset.n]) > 1e-3) body[i.dataset.n] = +i.value; });
      fetch("/__mf/labels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page: location.pathname, labels: body }) }).then((r) => r.json()).then((j) => { document.getElementById("__mfmsg").textContent = j.message; }); } });
}; go(); })();</script>`;

const srv = await serve(dir, {
  host: a.host || "127.0.0.1", port: +(a.port || 5177),
  routes: { "/__mf/labels": (req, res) => { let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
      let msg; try { const { page: pg, labels } = JSON.parse(body); const f = path.join(dir, path.basename(decodeURIComponent(pg || page)) || page);
        let src = fs.readFileSync(f, "utf8"); const done = [], skipped = [];
        for (const [name, t] of Object.entries(labels || {})) { const re = new RegExp(`(addLabel\\(\\s*["'\`]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]\\s*,\\s*)(-?[\\d.]+)(\\s*\\))`);
          if (re.test(src)) { src = src.replace(re, `$1${(+t).toFixed(2)}$3`); done.push(name); } else skipped.push(name); }
        if (done.length) fs.writeFileSync(f, src);
        msg = (done.length ? `saved ${done.join(", ")}` : "nothing saved") + (skipped.length ? ` · not a literal time in source: ${skipped.join(", ")} (edit by hand)` : ""); }
      catch (e) { msg = "error: " + e.message; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ message: msg })); }); },
    "/__mf/events": (req, res) => { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": connected\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); } },
  transform: (html) => (html.includes("</body>") ? html.replace("</body>", RELOAD + EDITOR + "</body>") : html + RELOAD + EDITOR)
});
let timer = null;
const ignore = /(^|[\\/])(out|node_modules|\.git)([\\/]|$)|_frames|_segments|\.report\.json$/;
const onChange = (_e, f) => { if (f && ignore.test(String(f))) return; clearTimeout(timer);
  timer = setTimeout(() => { clients.forEach((c) => c.write(`data: ${Date.now()}\n\n`)); line(`  ↻ ${f || "change"} → reloaded ${clients.size} tab(s)`); }, 120); };
try { fs.watch(dir, { recursive: true }, onChange); } catch { fs.watch(dir, onChange); }   // recursive needs Node ≥ 19 on Linux
line(`preview ${srv.url}/${page}   (live reload on save; Ctrl+C to stop)`);
const stop = () => { clients.forEach((c) => c.end()); srv.server.closeAllConnections?.(); srv.close().then(() => process.exit(0)); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
