#!/usr/bin/env node
// Named command chains, so the Director (or mf-runner) sends one word instead of a command list — fewer tokens, fewer mistakes.
// usage: recipes.mjs <recipe> <comp.html> [--out out/name] [--aspects 16:9,9:16,1:1,4:5] [--audio mix.wav]
//   check     stills + measured contrast, small contact sheet                     (every iteration)
//   draft     half-res fast video + delivery check                                 (timing review)
//   final     full-res video with motion blur + webm + delivery check + sheet       (delivery)
//   formats   all aspect ratios as QA stills, then videos if they all pass          (multi-format briefs)
//   debug     stills with QA boxes burned in                                        (when a gate fails and you need to see why)
//   layers    alpha layer per element (ProRes 4444) + layers.json                  (editor hand-off, step 1)
//   nle       layers → Resolve/Premiere/CapCut timelines → frame-exact check vs a full render  (editor hand-off)
//   polish    final render → VFX look (--look film) → audit                       (finishing pass)
//   list      print recipes
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, SKILL_DIR, ffprobe } from "./lib/common.mjs";
const a = parseArgs();
const [name, comp] = a._;
const S = (f) => path.join(SKILL_DIR, "scripts", f);
const RECIPES = ["check", "draft", "final", "formats", "debug", "layers", "nle", "polish"];
if (!name || name === "list" || !RECIPES.includes(name) || !comp) { line("recipes: " + RECIPES.join(", ") + "   usage: recipes.mjs <recipe> <comp.html> [--out out/name]"); process.exit(name === "list" ? 0 : 1); }
const dir = path.dirname(path.resolve(comp)), out = path.resolve(a.out || path.join(dir, "out", path.basename(dir)));
const run = (script, args) => { const r = spawnSync(process.execPath, [S(script), ...args], { encoding: "utf8" }); const txt = ((r.stdout || "") + (r.stderr || "")).trim();
  line(txt.split("\n").filter((l) => !/^\s+out \d+ frames|^\s+seek /.test(l)).slice(0, 6).join("\n")); return r.status; };
let code = 0;
if (name === "check") code = run("render.mjs", [comp, "--stills", "auto", "--score", "--thumb", "320", "--outdir", path.join(dir, "out/frames")]);
if (name === "debug") code = run("render.mjs", [comp, "--stills", "auto", "--qa-overlay", "--thumb", "480", "--outdir", path.join(dir, "out/debug")]);
if (name === "draft" || name === "final") {
  const f = name === "final", mp4 = out + (f ? ".mp4" : "_draft.mp4");
  code = run("render.mjs", [comp, "--out", mp4, ...(f ? ["--motion-blur", "4", "--formats", "mp4,webm"] : ["--scale", "0.5", "--fast"]), ...(a.audio ? ["--audio", a.audio] : [])]);
  if (code === 0) { const v = (ffprobe(mp4).streams || []).find((s) => s.codec_type === "video") || {};
    code = run("inspect-output.mjs", [mp4, "--sheet", mp4.replace(/\.mp4$/, "_sheet.png"), "--width", String(v.width), "--height", String(v.height)]); }
}
if (name === "formats") {
  const asp = a.aspects || "16:9,9:16,1:1,4:5";
  code = run("variants.mjs", [comp, "--out", out, "--aspects", asp, "--stills"]);
  if (code === 0 && !a["stills-only"]) code = run("variants.mjs", [comp, "--out", out, "--aspects", asp]);
}
if (name === "polish") {
  const mp4 = out + ".mp4", graded = out + `_${a.look || "film"}.mp4`;
  code = run("render.mjs", [comp, "--out", mp4, "--motion-blur", "4", ...(a.audio ? ["--audio", a.audio] : [])]);
  if (code === 0) code = run("vfx.mjs", [mp4, "--out", graded, "--look", String(a.look || "film")]);
  if (code === 0) code = run("audit.mjs", [graded, ...(a.platform ? ["--platform", a.platform] : [])]);
}
if (name === "layers" || name === "nle") {
  const ld = path.join(dir, "out", "layers"), nd = path.join(dir, "out", "nle");
  code = run("layers.mjs", [comp, "--out", ld]);
  if (code === 0 && name === "nle") {
    code = run("export-nle.mjs", ["--layers", path.join(ld, "layers.json"), "--out", nd, ...(a.audio ? ["--audio", a.audio] : []), ...(a.srt ? ["--srt", a.srt] : []), ...(a["media-root"] ? ["--media-root", a["media-root"]] : [])]);
    const ref = path.join(dir, "out", "nle-ref.mp4");
    if (code === 0) code = run("render.mjs", [comp, "--out", ref, "--no-qa"]);
    if (code === 0) code = run("nle-check.mjs", [nd, "--ref", ref]);
  }
}
process.exit(code || 0);
