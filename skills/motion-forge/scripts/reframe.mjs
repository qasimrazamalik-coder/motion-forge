#!/usr/bin/env node
// Smart reframe: 16:9 footage → 9:16 / 1:1 / 4:5 by following the subject, not centre-cropping.
// Subject estimate per analysis frame = weighted centroid of motion energy (frame difference) blended with edge/detail
// energy, then smoothed (dead-zone + critically-damped follow) so the virtual camera moves like an operator, not a tracker.
// usage: reframe.mjs <in.mp4> --aspect 9:16 --out out.mp4 [--track track.json] [--smooth 0.6] [--deadzone 0.06] [--save-track t.json]
//   --track: your own subject path [{ "t": 0, "x": 0.5 }] (x as fraction of width), e.g. from a face tracker — overrides auto.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, writeJSON, ffprobe } from "./lib/common.mjs";
const a = parseArgs();
const src = a._[0];
if (!src || !fs.existsSync(src) || !a.out) { console.error("usage: reframe.mjs <in> --aspect 9:16 --out out.mp4 [--track t.json] [--smooth 0.6]"); process.exit(1); }
const pr = ffprobe(src), vs = pr.streams.find((s) => s.codec_type === "video"), W = vs.width, H = vs.height, D = +pr.format.duration;
const [aw, ah] = String(a.aspect || "9:16").split(":").map(Number);
let cw = Math.round((H * aw) / ah / 2) * 2, ch = H;
if (cw > W) { cw = W; ch = Math.round((W * ah) / aw / 2) * 2; }
const RATE = 10, AW = 160, AH = Math.round((AW * H) / W / 2) * 2;
let track;
if (a.track) track = JSON.parse(fs.readFileSync(a.track, "utf8"));
else {
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", src, "-vf", `fps=${RATE},scale=${AW}:${AH},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 }).stdout;
  const N = Math.floor(raw.length / (AW * AH)); track = [];
  let prev = null;
  for (let f = 0; f < N; f++) {
    const fr = raw.subarray(f * AW * AH, (f + 1) * AW * AH); let sw = 0, sx = 0;
    for (let y = 1; y < AH - 1; y++) for (let x = 1; x < AW - 1; x++) { const i = y * AW + x;
      const motion = prev ? Math.abs(fr[i] - prev[i]) : 0, edge = Math.abs(fr[i + 1] - fr[i - 1]) + Math.abs(fr[i + AW] - fr[i - AW]);
      const w = motion * 3 + edge * 0.25; if (w > 12) { sw += w; sx += w * x; } }
    track.push({ t: f / RATE, x: sw > 0 ? sx / sw / AW : (track.length ? track[track.length - 1].x : 0.5), conf: sw });
    prev = fr;
  }
}
// smoothing: dead-zone, then critically damped spring toward the target (a camera operator, not a tracker)
// Offline, so the camera may "anticipate": run the spring forward and backward and average (zero-phase → no lag).
const smooth = +(a.smooth ?? 0.6), dz = +(a.deadzone ?? 0.06), omega = 2 + (1 - smooth) * 8, dt = 1 / RATE;
const spring = (xs) => { let pos = xs[0] ?? 0.5, vel = 0, tgt = pos; return xs.map((x) => { if (Math.abs(x - tgt) > dz) tgt = x; const acc = omega * omega * (tgt - pos) - 2 * omega * vel; vel += acc * dt; pos += vel * dt; return pos; }); };
const raw = track.map((p) => p.x), fwd = spring(raw), bwd = spring(raw.slice().reverse()).reverse();
const path_ = track.map((p, i) => ({ t: p.t, x: (fwd[i] + bwd[i]) / 2 }));
const half = cw / W / 2, cx = (x) => Math.round(Math.min(W - cw, Math.max(0, (Math.min(1 - half, Math.max(half, x)) - half) * W)) / 2) * 2;
if (a["save-track"]) writeJSON(a["save-track"], path_);
// apply: crop x driven by sendcmd at the analysis rate (crop accepts runtime x commands)
const cmd = path.resolve(a.out).replace(/\.[^.]+$/, "") + ".crop.cmd";
fs.writeFileSync(cmd, path_.map((p) => `${p.t.toFixed(3)} crop x ${cx(p.x)};`).join("\n") + "\n");
const y0 = Math.round((H - ch) / 2 / 2) * 2;
fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", `sendcmd=f='${cmd.replace(/'/g, "\\'")}',crop=${cw}:${ch}:${cx(path_[0]?.x ?? 0.5)}:${y0}`, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", path.resolve(a.out)], { encoding: "utf8" });
if (r.status !== 0) { console.error("ffmpeg failed: " + r.stderr.slice(0, 400)); process.exit(2); }
fs.rmSync(cmd, { force: true });
const xs = path_.map((p) => p.x); line(`PASS reframe ${path.basename(src)} ${W}x${H} → ${cw}x${ch} (${a.aspect || "9:16"}), ${a.track ? "given track" : "auto subject track"} x∈[${Math.min(...xs).toFixed(2)}, ${Math.max(...xs).toFixed(2)}] → ${path.relative(process.cwd(), path.resolve(a.out))}`);
