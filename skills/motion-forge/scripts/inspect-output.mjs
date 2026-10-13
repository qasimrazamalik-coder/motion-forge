#!/usr/bin/env node
// Deterministic delivery validation of a rendered video (or image sequence dir) with ffprobe/ffmpeg.
// usage: inspect-output.mjs <file> [--width 1920 --height 1080 --fps 30 --duration 12 --tol 0.1] [--sheet out.png] [--json report.json]
// Checks: container/codec, dimensions, fps, duration, frame count, black frames, uniform/blank frames, frozen spans,
// duplicate-frame ratio, audio presence/duration alignment, file size. Exit 0 PASS, 2 FAIL.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, ffprobe, fps as rate, writeJSON, line } from "./lib/common.mjs";

const a = parseArgs();
const file = a._[0];
if (!file || !fs.existsSync(file)) { console.error("usage: inspect-output.mjs <video> [--width --height --fps --duration --tol --sheet --json]"); process.exit(1); }
const probe = ffprobe(file);
const v = probe.streams.find((s) => s.codec_type === "video");
const au = probe.streams.find((s) => s.codec_type === "audio");
const dur = +(probe.format.duration || v?.duration || 0);
const issues = [];
const add = (code, severity, detail) => issues.push({ code, severity, detail });
if (!v) add("NO_VIDEO_STREAM", "critical");

const tol = +(a.tol || 0.1);
const vfps = rate(v?.avg_frame_rate || v?.r_frame_rate);
if (a.width && v && +a.width !== v.width) add("WIDTH_MISMATCH", "critical", `${v.width} != ${a.width}`);
if (a.height && v && +a.height !== v.height) add("HEIGHT_MISMATCH", "critical", `${v.height} != ${a.height}`);
if (a.fps && vfps && Math.abs(vfps - +a.fps) > 0.01) add("FPS_MISMATCH", "high", `${vfps} != ${a.fps}`);
if (a.duration && Math.abs(dur - +a.duration) > tol) add("DURATION_MISMATCH", "high", `${dur.toFixed(3)}s vs ${a.duration}s`);
if (v && v.width % 2) add("ODD_DIMENSION", "high", "yuv420p encoders need even dimensions");
if (v && v.pix_fmt && !/yuv420p|yuva420p|rgba|pal8|bgra/.test(v.pix_fmt)) add("PIX_FMT_COMPAT", "medium", v.pix_fmt + " may not play on social/web players");
if (au && a.duration && Math.abs(+au.duration - +a.duration) > 0.25) add("AUDIO_DURATION_MISMATCH", "medium", `${(+au.duration).toFixed(2)}s`);

// per-frame luma stats (one pass): black, uniform (blank), frozen, duplicates
let perFrame = [];
if (v) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "signalstats,metadata=print:file=-", "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  let cur = null;
  for (const l of r.stdout.split("\n")) {
    if (l.startsWith("frame:")) { cur = { t: +(l.match(/pts_time:([\d.]+)/)?.[1] || 0) }; perFrame.push(cur); }
    else if (cur) { const m = l.match(/lavfi\.signalstats\.(YAVG|YMIN|YMAX|YDIF)=([\d.]+)/); if (m) cur[m[1]] = +m[2]; }
  }
}
const n = perFrame.length;
if (v && a.duration && a.fps) { const exp = Math.round(+a.duration * +a.fps); if (Math.abs(n - exp) > 1) add("FRAME_COUNT_MISMATCH", "high", `${n} frames, expected ${exp}`); }
const black = perFrame.filter((f) => f.YMAX <= 24);
const uniform = perFrame.filter((f) => f.YMAX - f.YMIN < 4 && f.YMAX > 24);
const dupes = perFrame.slice(1).filter((f) => f.YDIF < 0.02).length;
// longest frozen run (identical consecutive frames)
let run = 0, maxRun = 0, runStart = 0, maxStart = 0;
perFrame.forEach((f, i) => { if (i && f.YDIF < 0.02) { if (!run) runStart = perFrame[i - 1].t; run++; if (run > maxRun) { maxRun = run; maxStart = runStart; } } else run = 0; });
const fr = vfps || 30;
const spans = (arr) => { const out = []; arr.forEach((f) => { const l = out[out.length - 1]; if (l && f.t - l[1] <= 1.5 / fr) l[1] = f.t; else out.push([f.t, f.t]); }); return out.map(([s, e]) => [+s.toFixed(2), +e.toFixed(2)]); };
if (black.length) { const s = spans(black); const edgeOnly = s.every(([st, en]) => st < 0.05 || en > dur - 0.1); add("BLACK_FRAMES", edgeOnly && black.length < fr * 0.5 ? "low" : "high", { count: black.length, spans: s.slice(0, 6) }); }
if (uniform.length) add("BLANK_FRAMES", uniform.length > fr * 0.5 ? "high" : "low", { count: uniform.length, spans: spans(uniform).slice(0, 6) });
const holdSec = maxRun / fr;
if (n > 2 && dupes / (n - 1) > 0.97) add("STATIC_OUTPUT", "critical", "virtually every frame identical — animation not advancing (seek/timeline wiring?)");
else if (holdSec > Math.max(2.5, dur * 0.3)) add("LONG_FREEZE", "medium", { seconds: +holdSec.toFixed(2), from: maxStart, note: "intentional holds are fine; confirm it is designed" });

let sheet = null;
if (a.sheet && v) {
  sheet = path.resolve(a.sheet);
  const tw = v.height > v.width ? 240 : 400;
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", `fps=${(8 / Math.max(dur, 0.1)).toFixed(4)},scale=${tw}:-2,tile=4x2:padding=4:color=black`, "-frames:v", "1", sheet], { encoding: "utf8" });
  if (r.status !== 0) { add("SHEET_FAILED", "low", r.stderr.slice(0, 200)); sheet = null; }
}
const size = fs.statSync(file).size;
const report = {
  file, verdict: issues.some((i) => ["critical", "high"].includes(i.severity)) ? "FAIL" : "PASS",
  container: probe.format.format_name, codec: v?.codec_name, pix_fmt: v?.pix_fmt, width: v?.width, height: v?.height, fps: vfps,
  duration: +dur.toFixed(3), frames: n, audio: au ? { codec: au.codec_name, duration: +(+au.duration).toFixed(3) } : null,
  sizeMB: +(size / 1048576).toFixed(2), kbps: dur ? Math.round((size * 8) / dur / 1000) : null,
  dupRatio: n > 1 ? +(dupes / (n - 1)).toFixed(3) : 0, longestHoldSec: +holdSec.toFixed(2), sheet, issues
};
if (a.json) writeJSON(path.resolve(a.json), report);
line(`${report.verdict} ${path.basename(file)} ${report.codec} ${report.width}x${report.height}@${report.fps} ${report.duration}s ${n}f ${report.sizeMB}MB dup=${report.dupRatio} hold=${report.longestHoldSec}s${au ? " +audio" : ""}`);
issues.forEach((i) => line(`  ${i.severity.toUpperCase()} ${i.code} ${typeof i.detail === "object" ? JSON.stringify(i.detail) : i.detail || ""}`));
if (sheet) line("  sheet", path.relative(process.cwd(), sheet));
process.exit(report.verdict === "PASS" ? 0 : 2);
