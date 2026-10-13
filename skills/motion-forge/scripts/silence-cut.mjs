#!/usr/bin/env node
// Remove silences (and dead air) from talking-head / screen-recording footage. ffmpeg silencedetect → keep list → one
// trim+concat pass (frame-accurate, audio and video stay in sync).
// usage: silence-cut.mjs <in.mp4> --out out.mp4 [--threshold -35] (dB) [--min 0.45] (s of silence to cut) [--pad 0.12] (s kept around speech) [--dry]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, writeJSON, ffprobe } from "./lib/common.mjs";
const a = parseArgs();
const src = a._[0];
if (!src || !fs.existsSync(src) || (!a.out && !a.dry)) { console.error("usage: silence-cut.mjs <in> --out out.mp4 [--threshold -35] [--min 0.45] [--pad 0.12] [--dry]"); process.exit(1); }
const thr = +(a.threshold ?? -35), min = +(a.min ?? 0.45), pad = +(a.pad ?? 0.12);
const D = +ffprobe(src).format.duration;
const det = spawnSync("ffmpeg", ["-hide_banner", "-i", src, "-af", `silencedetect=noise=${thr}dB:d=${min}`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
const sil = []; let cur = null;
for (const l of det.split("\n")) { let m;
  if ((m = l.match(/silence_start: (-?[\d.]+)/))) cur = Math.max(0, +m[1]);
  if ((m = l.match(/silence_end: ([\d.]+)/)) && cur != null) { sil.push([cur, +m[1]]); cur = null; } }
if (cur != null) sil.push([cur, D]);
// keep = complement of (silence shrunk by pad)
const keep = []; let t = 0;
for (const [s, e] of sil) { const cs = s + pad, ce = e - pad; if (ce - cs < 0.05) continue; if (cs > t) keep.push([t, cs]); t = ce; }
if (t < D) keep.push([t, D]);
const kept = keep.reduce((s, [x, y]) => s + y - x, 0);
const plan = { source: src, duration: D, silences: sil, keep, keptSeconds: +kept.toFixed(2), removedSeconds: +(D - kept).toFixed(2) };
if (a.dry) { console.log(JSON.stringify(plan, null, 1)); process.exit(0); }
const out = path.resolve(a.out), hasA = (ffprobe(src).streams || []).some((s) => s.codec_type === "audio");
const parts = keep.map(([x, y], i) => `[0:v]trim=${x.toFixed(3)}:${y.toFixed(3)},setpts=PTS-STARTPTS[v${i}]` + (hasA ? `;[0:a]atrim=${x.toFixed(3)}:${y.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]` : ""));
const cat = keep.map((_, i) => `[v${i}]` + (hasA ? `[a${i}]` : "")).join("") + `concat=n=${keep.length}:v=1:a=${hasA ? 1 : 0}[v]` + (hasA ? "[a]" : "");
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-filter_complex", [...parts, cat].join(";"), "-map", "[v]", ...(hasA ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : []), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { encoding: "utf8" });
if (r.status !== 0) { console.error("ffmpeg failed: " + r.stderr.slice(0, 400)); process.exit(2); }
writeJSON(out.replace(/\.[^.]+$/, "") + ".cuts.json", plan);
line(`PASS silence-cut ${path.basename(src)} ${D.toFixed(1)}s → ${kept.toFixed(1)}s (${sil.length} silences, −${(D - kept).toFixed(1)}s) → ${path.relative(process.cwd(), out)}`);
