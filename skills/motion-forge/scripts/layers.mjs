#!/usr/bin/env node
// Render a composition as separate layers for editing in DaVinci Resolve / Premiere Pro / CapCut:
// background (opaque) + every other layer as ProRes 4444 with alpha (or PNG sequences), all frame-aligned, plus a
// layers.json manifest that export-nle.mjs turns into a timeline.
// Layers: every top-level element of the stage (named by data-mf-layer, id or class), background (canvas/plates/stage fill),
// captions; tag any inner element data-mf-layer="title" to split it out. Output order = paint order (bottom → top).
// usage: layers.mjs <comp.html> --out out/layers [--format prores|png] [--scale 1] [--only background,title]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, writeJSON, launchBrowser, serve, SKILL_DIR } from "./lib/common.mjs";
const a = parseArgs();
const comp = a._[0];
if (!comp || !fs.existsSync(comp)) { console.error("usage: layers.mjs <comp.html> --out out/layers [--format prores|png] [--only a,b]"); process.exit(1); }
const abs = path.resolve(comp), out = path.resolve(a.out || path.join(path.dirname(abs), "out", "layers"));
fs.mkdirSync(out, { recursive: true });
// discover layers
const srv = await serve(path.dirname(abs)), browser = await launchBrowser();
let meta;
try { const p = await browser.newPage(); await p.addInitScript(() => { window.__MF_RENDER = true; });
  await p.goto(`${srv.url}/${path.basename(abs)}`); await p.waitForFunction(() => !!window.__MF); await p.evaluate(() => window.__MF.ready);
  meta = await p.evaluate(() => JSON.parse(JSON.stringify(window.__MF.meta))); }
finally { await browser.close(); await srv.close(); }
const want = a.only ? String(a.only).split(",") : meta.layers;
const order = meta.layers.filter((l) => want.includes(l));   // paint order from the runtime: restacks correctly in any editor
const fmt = a.format === "png" ? "png" : "prores", sc = String(a.scale || 1), files = [];
for (const L of order) {
  const base = path.join(out, `${String(files.length + 1).padStart(2, "0")}_${L}`);
  const opaque = L === "background";
  const r = spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts", "render.mjs"), abs, "--out", base + (opaque ? ".mp4" : ".mov"), "--query", `layer=${encodeURIComponent(L)}`, "--scale", sc, "--no-qa", "--force",
    ...(opaque ? ["--crf", "14"] : ["--formats", fmt])], { encoding: "utf8" });
  const first = ((r.stdout || "") + (r.stderr || "")).split("\n")[0];
  if (r.status !== 0) { line(`FAIL layer ${L}: ${first}`); process.exit(2); }
  const file = opaque ? base + ".mp4" : fmt === "png" ? base + "_frames" : base + ".mov";
  if (!opaque) fs.rmSync(base + "_alpha.webm", { force: true });
  if (!opaque && fmt === "prores") fs.rmSync(base + "_frames", { recursive: true, force: true });
  files.push({ layer: L, file: path.relative(out, file), alpha: !opaque, kind: fmt === "png" && !opaque ? "png-sequence" : "video" });
  line(`  ${L.padEnd(12)} → ${path.relative(process.cwd(), file)}${opaque ? " (opaque)" : " (alpha)"}`);
}
const manifest = { comp: path.relative(out, abs), width: meta.width * +sc, height: meta.height * +sc, fps: meta.fps, duration: meta.duration, labels: meta.labels, title: meta.title, layers: files };
writeJSON(path.join(out, "layers.json"), manifest);
line(`PASS layers ${path.basename(abs)} → ${files.length} layers (${order.join(", ")}) + layers.json → ${path.relative(process.cwd(), out)}`);
