#!/usr/bin/env node
// Beat / tempo / onset analysis for audio sync (no dependencies: ffmpeg decode + JS spectral flux).
// usage: beats.mjs <audio> [--out beats.json] [--min 70 --max 180] [--bpm 128 (known tempo: only fit the phase)]
// Output: { bpm, confidence, duration, beats:[s…], downbeats:[s…] (every 4th, phase-fitted), onsets:[strongest hits s…] }
// Use in a composition: const B = MF.beats(await MF.loadJSON("beats.json")); tl.to(x, {...}, B.at(8));
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, writeJSON, line } from "./lib/common.mjs";

const a = parseArgs();
const file = a._[0];
if (!file || !fs.existsSync(file)) { console.error("usage: beats.mjs <audio> [--out beats.json] [--bpm N] [--min 70 --max 180]"); process.exit(1); }
const SR = 22050, N = 1024, HOP = 256;
const dec = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
if (dec.status !== 0) { console.error("ffmpeg decode failed: " + dec.stderr); process.exit(1); }
const pcm = new Float32Array(dec.stdout.buffer, dec.stdout.byteOffset, dec.stdout.byteLength >> 2);
const duration = pcm.length / SR;

// --- radix-2 FFT magnitude
function fftMag(re) { const n = re.length, im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
  const m = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) m[i] = Math.log1p(100 * Math.hypot(re[i], im[i])); return m; }

// --- onset strength envelope: half-wave rectified log-spectral flux
const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const frames = Math.max(0, Math.floor((pcm.length - N) / HOP));
const env = new Float64Array(frames); let prev = null;
for (let f = 0; f < frames; f++) { const buf = new Float64Array(N); for (let i = 0; i < N; i++) buf[i] = pcm[f * HOP + i] * win[i];
  const mag = fftMag(buf); if (prev) { let s = 0; for (let k = 1; k < mag.length; k++) { const d = mag[k] - prev[k]; if (d > 0) s += d; } env[f] = s; } prev = mag; }
// detrend (subtract local mean) and normalise
const fps = SR / HOP, w = Math.round(fps * 0.5), on = new Float64Array(frames);
for (let f = 0; f < frames; f++) { let s = 0, c = 0; for (let k = Math.max(0, f - w); k < Math.min(frames, f + w); k++) { s += env[k]; c++; } on[f] = Math.max(0, env[f] - s / c); }
const mx = Math.max(...on, 1e-9); for (let f = 0; f < frames; f++) on[f] /= mx;

// --- tempo: autocorrelation of the envelope over the BPM range, weighted toward ~120 (resolves octave ambiguity)
const minB = +(a.min || 70), maxB = +(a.max || 180);
let bpm, conf = 1;
if (a.bpm) bpm = +a.bpm;
else {
  let best = -1, bestLag = 0, scores = [];
  for (let lag = Math.floor((60 * fps) / maxB); lag <= Math.ceil((60 * fps) / minB); lag++) {
    let s = 0; for (let f = lag; f < frames; f++) s += on[f] * on[f - lag];
    const b = (60 * fps) / lag, prior = Math.exp(-0.5 * Math.pow(Math.log2(b / 120) / 0.9, 2));
    const v = (s / (frames - lag)) * prior; scores.push(v); if (v > best) { best = v; bestLag = lag; }
  }
  // parabolic refinement of the peak lag
  const i = bestLag - Math.floor((60 * fps) / maxB), y0 = scores[i - 1] ?? scores[i], y1 = scores[i], y2 = scores[i + 1] ?? scores[i];
  const off = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  bpm = (60 * fps) / (bestLag + (Math.abs(off) < 1 ? off : 0));
  const sorted = [...scores].sort((x, y) => y - x); conf = +Math.min(1, (sorted[0] - sorted[Math.floor(sorted.length / 2)]) / (sorted[0] || 1)).toFixed(2);
}
// --- phase: choose the grid offset that collects the most onset energy
const period = (60 / bpm) * fps;
let bestPhase = 0, bestSum = -1;
for (let ph = 0; ph < period; ph += 0.25) { let s = 0; for (let t = ph; t < frames; t += period) { const k = Math.round(t); s += on[k] || 0; } if (s > bestSum) { bestSum = s; bestPhase = ph; } }
const beatsArr = []; for (let t = bestPhase; t < frames; t += period) beatsArr.push(+((t * HOP) / SR + N / 2 / SR).toFixed(3));
// downbeats: phase within the bar with the most energy
let dbPhase = 0, dbBest = -1;
for (let k = 0; k < 4; k++) { let s = 0; for (let i = k; i < beatsArr.length; i += 4) s += on[Math.round((beatsArr[i] * SR) / HOP)] || 0; if (s > dbBest) { dbBest = s; dbPhase = k; } }
const downbeats = beatsArr.filter((_, i) => i % 4 === dbPhase);
// strongest onsets (peaks above 0.5, ≥ 150 ms apart)
const peaks = []; for (let f = 1; f < frames - 1; f++) if (on[f] > 0.5 && on[f] >= on[f - 1] && on[f] > on[f + 1]) peaks.push([f, on[f]]);
const onsets = []; peaks.sort((x, y) => y[1] - x[1]).forEach(([f]) => { const t = (f * HOP) / SR + N / 2 / SR; if (onsets.every((o) => Math.abs(o - t) > 0.15)) onsets.push(+t.toFixed(3)); });
onsets.sort((x, y) => x - y);
const out = { source: path.basename(file), duration: +duration.toFixed(3), bpm: +bpm.toFixed(2), confidence: conf, beats: beatsArr, downbeats, onsets: onsets.slice(0, 64) };
const outPath = path.resolve(a.out || path.join(path.dirname(file), "beats.json"));
writeJSON(outPath, out);
line(`BEATS ${out.source} ${out.duration}s bpm=${out.bpm} conf=${out.confidence} beats=${beatsArr.length} downbeats=${downbeats.length} onsets=${onsets.length} → ${path.relative(process.cwd(), outPath)}`);
