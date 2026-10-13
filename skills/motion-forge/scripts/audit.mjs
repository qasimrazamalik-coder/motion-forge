#!/usr/bin/env node
// Audit a composition or a finished video and return ranked, concrete suggestions (what, why, exact fix), plus a
// 0–100 craft score. Cheap: static source lint + the existing QA/inspect reports; renders stills only when needed.
//   audit.mjs <dir|comp.html>   source lint (determinism, perf, type, motion, structure) + stills QA + measured contrast
//   audit.mjs <video.mp4>       delivery checks + first-2-seconds hook + loudness + pacing (cuts/min) + platform fit
//   [--platform reels|tiktok|shorts|youtube|web] [--json audit.json] [--no-render]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, writeJSON, ffprobe, fps as rate, SKILL_DIR } from "./lib/common.mjs";

const a = parseArgs(), target = a._[0];
if (!target || !fs.existsSync(target)) { console.error("usage: audit.mjs <comp dir|index.html|video.mp4> [--platform reels] [--json out.json] [--no-render]"); process.exit(1); }
const S = (f) => path.join(SKILL_DIR, "scripts", f), sug = [];
const add = (sev, area, what, fix, why) => sug.push({ sev, area, what, fix, why });
const W8 = { critical: 30, high: 12, medium: 5, low: 2 };
const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(target);

if (!isVideo) {
  const comp = fs.statSync(target).isDirectory() ? path.join(target, "index.html") : target, dir = path.dirname(path.resolve(comp));
  const src = fs.readFileSync(comp, "utf8"), code = src.replace(/<!--[\s\S]*?-->/g, "");
  // determinism
  if (/Math\.random\(/.test(code)) add("high", "determinism", "Math.random() in the composition", "use MF.rng(seed) — same t must give the same frame", "random values change between renders and between workers");
  if (/Date\.now\(|performance\.now\(|new Date\(/.test(code)) add("high", "determinism", "wall-clock time used", "derive everything from t (the seek time)", "frames would depend on render speed");
  if (/requestAnimationFrame|setInterval|setTimeout\(/.test(code)) add("medium", "determinism", "timers / rAF loop in the composition", "move animation into the timeline or render(t)", "the renderer seeks; loops drift and break parallel rendering");
  if (/\btransition\s*:|@keyframes|animation\s*:/.test(code)) add("medium", "determinism", "CSS transitions/keyframes", "animate with the timeline instead", "CSS animations are not seekable; the renderer freezes them");
  // performance
  if (/https?:\/\/(cdn|unpkg|cdnjs|fonts\.googleapis)/.test(code)) add("high", "reliability", "assets loaded from a CDN", "vendor them locally (scaffold does this)", "offline renders fail and fonts can swap mid-render");
  if (/filter\s*:\s*blur\([^)]*\)/.test(code) && /<canvas/.test(code)) add("low", "performance", "CSS blur over a canvas", "blur inside the shader or pre-render", "CSS filters on large layers are slow to capture");
  if (/setPixelRatio\(\s*window\.devicePixelRatio/.test(code)) add("medium", "performance", "uses devicePixelRatio directly", "use MF.pixelRatio() so draft/final quality is controlled", "4K renders on HiDPI machines balloon in cost");
  // type & structure
  const fonts = new Set([...code.matchAll(/font-family\s*:\s*([^;}"]+)/g)].map((m) => m[1].split(",")[0].trim().replace(/['"]/g, "")).filter((f) => !/^var\(/.test(f)));
  if (fonts.size > 2) add("medium", "typography", `${fonts.size} font families (${[...fonts].slice(0, 4).join(", ")})`, "keep to one display + one text family", "more families read as noise, and each one is a load risk");
  if (/font-size\s*:\s*\d+px/.test(code)) add("low", "layout", "fixed px font sizes", "size type in frame units (var(--u) / calc(var(--mf-u)*N))", "px sizes break when the same comp renders at another aspect or 4K");
  if (!/data-mf-text/.test(code) && /<h1|<h2|<p/.test(code)) add("low", "qa", "text elements not tagged data-mf-text", "add data-mf-text to every visible text block", "QA checks clipping/safe zones more precisely on tagged text");
  if (!fs.existsSync(path.join(dir, "motionspec.yaml"))) add("low", "process", "no motionspec.yaml", "write the MotionSpec (references/creative-direction.md)", "without a spec, critique has nothing to judge against");
  // rendered evidence
  if (!a["no-render"]) {
    const outdir = path.join(dir, "out", "audit");
    spawnSync(process.execPath, [S("render.mjs"), comp, "--stills", "auto", "--score", "--thumb", "320", "--outdir", outdir], { encoding: "utf8" });
    let rep = null; try { rep = JSON.parse(fs.readFileSync(path.join(outdir, "report.json"), "utf8")); } catch {}
    if (!rep) add("critical", "render", "stills did not render", "run render.mjs --stills auto and read the error", "nothing else can be checked until it renders");
    else {
      const codes = {}; for (const i of rep.issues || []) (codes[i.code] ||= { n: 0, sev: i.severity, ex: i.text || i.detail || "" }).n++;
      const FIX = { TEXT_OUTSIDE_SAFE_ZONE: "move the block inside the safe area (var(--mf-safe-*))", TEXT_CLIPPED_BY_FRAME: "keep text inside the frame at every t", TEXT_OVERLAP: "separate the blocks in space or time",
        LOW_CONTRAST: "darken the scrim / lighten the text until ≥ 4.5:1 (3:1 for large)", FONT_MISSING: "declare and preload the font locally", NONDETERMINISTIC_FRAME: "remove randomness/clock from render", ORPHAN: "rebalance the line (text-wrap: balance or a <br>)" };
      for (const [c, v] of Object.entries(codes)) add(/critical/.test(v.sev) ? "critical" : /high/.test(v.sev) ? "high" : "medium", "qa", `${c.toLowerCase().replace(/_/g, " ")} ×${v.n}`, FIX[c] || "see references/qa.md", String(v.ex).slice(0, 90));
      const labels = rep.meta?.labels || {}, ts = Object.values(labels).sort((x, y) => x - y), dur = rep.meta?.duration || 0;
      const gaps = ts.map((t, i) => (ts[i + 1] ?? dur) - t).filter((g) => g > 0);
      if (gaps.some((g) => g < 0.9)) add("medium", "timing", `a beat lasts ${Math.min(...gaps).toFixed(2)} s`, "hold each text beat ≥ 1 s (≈ 3 words/s reading speed)", "viewers can't read faster than that");
      if (dur && !ts.some((t) => t > dur - 2.5)) add("low", "timing", "no beat in the last 2.5 s", "end on a held brand/CTA frame ≥ 1.5 s", "the last frame is what people screenshot and remember");
    }
  }
} else {
  const P = ffprobe(target), v = P.streams.find((s) => s.codec_type === "video"), au = P.streams.find((s) => s.codec_type === "audio"), dur = +P.format.duration, FPS = rate(v.avg_frame_rate);
  const plat = a.platform || (v.height > v.width ? "reels" : "youtube");
  const insp = spawnSync(process.execPath, [S("inspect-output.mjs"), target, "--json", "/dev/null"], { encoding: "utf8" }).stdout.split("\n")[0];
  if (/FAIL/.test(insp)) add("high", "delivery", insp.slice(0, 120), "fix the failing delivery check first", "platforms reject or re-encode badly");
  if (/reels|tiktok|shorts/.test(plat)) {
    if (v.height <= v.width) add("high", "platform", `${v.width}×${v.height} for ${plat}`, "deliver 1080×1920 (social-edit --aspect 9:16 or variants.mjs)", "landscape on a vertical feed loses most of the screen");
    if (v.height > v.width && v.height < 1920) add("medium", "platform", `${v.height}p vertical`, "deliver 1080×1920", "below 1080 wide looks soft after platform re-encoding");
    if (dur > 90) add("low", "platform", `${dur.toFixed(0)} s long`, "cut to 20–60 s for reach tests", "completion rate falls with length (rule of thumb)");
  }
  // first 2 s: is anything moving? (static openers lose the scroll)
  const sc = spawnSync("ffmpeg", ["-v", "info", "-t", "2", "-i", target, "-vf", "select='gt(scene,0.08)',showinfo", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const early = (sc.match(/showinfo.*pts_time/g) || []).length;
  const fr = spawnSync("ffmpeg", ["-v", "info", "-t", "2", "-i", target, "-vf", "freezedetect=n=0.003:d=0.8", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  if (/freeze_start/.test(fr) && early === 0) add("high", "hook", "the first 2 s are visually static", "open on motion: a cut, a punch-in or text animating in by 0.3 s (hooklab.mjs)", "the scroll decision happens in the first second or two");
  // pacing: cuts per minute
  const all = spawnSync("ffmpeg", ["-v", "info", "-i", target, "-vf", "select='gt(scene,0.05)',showinfo", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const cuts = (all.match(/showinfo.*pts_time/g) || []).length, cpm = cuts / (dur / 60);
  if (/reels|tiktok|shorts/.test(plat) && cpm < 8 && dur > 10) add("medium", "pacing", `${cpm.toFixed(1)} visual changes per minute (cuts, punch-ins, big text changes)`, "add jump cuts / punch-ins every 2–4 s (social-edit.mjs)", "long static shots feel slow on short-form platforms");
  // loudness
  if (!au) add(/reels|tiktok|shorts/.test(plat) ? "medium" : "low", "audio", "no audio track", "add music/VO (sfx.mjs or assets.mjs music)", "most short-form is watched with sound on");
  else { const m = spawnSync("ffmpeg", ["-hide_banner", "-i", target, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const I = +(((m.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop() || "").match(/-?[\d.]+/) || [NaN])[0], TP = +(((m.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop() || "").match(/-?[\d.]+/) || [NaN])[0];
    if (isFinite(I) && Math.abs(I + 14) > 2) add("medium", "audio", `loudness ${I} LUFS`, "master to −14 LUFS (sfx.mjs does two-pass linear gain + limiter)", "platforms normalise; too quiet sounds weak, too loud gets turned down and squashed");
    if (isFinite(TP) && TP > -1) add("medium", "audio", `true peak ${TP} dBFS`, "limit to ≤ −1 dBTP", "clips after platform transcoding"); }
  if (FPS && FPS < 24) add("medium", "delivery", `${FPS} fps`, "render at 30 (or 60 for fast motion)", "low frame rates stutter on phones");
}
const order = { critical: 0, high: 1, medium: 2, low: 3 }; sug.sort((x, y) => order[x.sev] - order[y.sev]);
const score = Math.max(0, 100 - sug.reduce((n, s) => n + W8[s.sev], 0));
if (a.json) writeJSON(a.json, { target: path.resolve(target), score, suggestions: sug });
line(`AUDIT ${path.basename(target)} · score ${score}/100 · ${sug.length} suggestion${sug.length === 1 ? "" : "s"}${sug.length ? "" : " — nothing to fix"}`);
sug.slice(0, +(a.max || 12)).forEach((s, i) => line(`${String(i + 1).padStart(2)}. [${s.sev}] ${s.area}: ${s.what}\n    fix: ${s.fix}\n    why: ${s.why}`));
process.exit(sug.some((s) => s.sev === "critical") ? 2 : 0);
