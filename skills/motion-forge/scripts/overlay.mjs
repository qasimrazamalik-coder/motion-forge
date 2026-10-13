#!/usr/bin/env node
// Composite motion-forge overlays (alpha WebM lower thirds, callouts, end cards) onto real footage at given times.
// usage: overlay.mjs <footage.mp4> --add "lt_alpha.webm@3.0,callout_alpha.webm@12.5" --out out.mp4 [--scale fit|none]
//   each overlay is scaled to the footage width (fit) unless --scale none; alpha WebMs are decoded with libvpx to keep transparency
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, ffprobe } from "./lib/common.mjs";
const a = parseArgs();
const src = a._[0];
if (!src || !fs.existsSync(src) || !a.add || !a.out) { console.error('usage: overlay.mjs <footage> --add "file@t,file2@t" --out out.mp4'); process.exit(1); }
const v = ffprobe(src).streams.find((s) => s.codec_type === "video"), W = v.width, H = v.height;
const items = String(a.add).split(",").map((x) => { const [f, t] = x.split("@"); return { f: path.resolve(f.trim()), t: +(t || 0) }; });
for (const it of items) if (!fs.existsSync(it.f)) { console.error("missing overlay " + it.f); process.exit(1); }
const inputs = ["-i", src], parts = []; let last = "[0:v]";
items.forEach((it, i) => {
  const alpha = /\.webm$/i.test(it.f);
  inputs.push(...(alpha ? ["-c:v", "libvpx-vp9"] : []), "-itsoffset", String(it.t), "-i", it.f);
  const sc = a.scale === "none" ? "" : `scale=${W}:${H}:force_original_aspect_ratio=decrease,`;
  parts.push(`[${i + 1}:v]${sc}format=yuva420p[o${i}]`, `${last}[o${i}]overlay=(W-w)/2:(H-h)/2:eof_action=pass:enable='gte(t,${it.t})'[b${i}]`);
  last = `[b${i}]`;
});
const out = path.resolve(a.out); fs.mkdirSync(path.dirname(out), { recursive: true });
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", parts.join(";"), "-map", last, "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", out], { encoding: "utf8" });
if (r.status !== 0) { console.error("ffmpeg failed: " + r.stderr.slice(0, 400)); process.exit(2); }
line(`PASS overlay ${path.basename(src)} + ${items.length} overlay${items.length > 1 ? "s" : ""} (${items.map((i) => path.basename(i.f) + "@" + i.t + "s").join(", ")}) → ${path.relative(process.cwd(), out)}`);
