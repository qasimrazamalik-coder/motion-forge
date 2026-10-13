#!/usr/bin/env node
// Sound design: procedural SFX (generated here, so no licensing questions) placed on the composition's timeline, mixed
// with music and voice-over, music ducked under the voice, loudness-normalised for social (-14 LUFS).
// usage: sfx.mjs <comp.html> --out out/mix.wav [--music track.wav] [--voice vo.wav] [--cues auto|cues.json] [--sfx-gain -6] [--lufs -14]
//   cues.json: [{ "t": 1.2, "sfx": "whoosh|hit|tick|rise|swell", "gain": 0 }]   auto = whoosh into + hit on every timeline label
//   --stems dir: also write sfx.wav and music.wav (ducked) with the same mastering gain, for NLE hand-off (export-nle.mjs)
//   --duration s: mix length when <comp> is "-" (no composition: e.g. social-edit.mjs mixing onto cut footage)
// Then: render.mjs <comp> --out film.mp4 --audio out/mix.wav
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, compMeta, MF_HOME } from "./lib/common.mjs";

const a = parseArgs();
const comp = a._[0];
if (!comp || !a.out) { console.error("usage: sfx.mjs <comp.html> --out mix.wav [--music m.wav] [--voice vo.wav] [--cues auto|cues.json]"); process.exit(1); }
const ff = (args, what) => { const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" }); if (r.status !== 0) { console.error(`ffmpeg ${what} failed: ${r.stderr.slice(0, 400)}`); process.exit(2); } };

// --- procedural library (cached in MF_HOME/sfx): 48 kHz stereo WAV
const LIB = path.join(MF_HOME, "sfx"); fs.mkdirSync(LIB, { recursive: true });
import { RECIPES } from "./lib/sfx-recipes.mjs";
for (const [k, rec] of Object.entries(RECIPES)) { const f = path.join(LIB, k + ".wav"); if (!fs.existsSync(f)) ff([...rec, "-ar", "48000", f], "sfx " + k); }

const meta = comp === "-" ? { duration: +a.duration, labels: {} } : await compMeta(comp);
const D = meta.duration;
let cues;
if (!a.cues || a.cues === "auto") {
  cues = [];
  for (const [name, t] of Object.entries(meta.labels || {})) { if (t <= 0.05 || t >= D - 0.05) continue;
    cues.push({ t: Math.max(0, t - 0.45), sfx: "whoosh", gain: -4, why: "into " + name }, { t, sfx: "hit", gain: -2, why: name }); }
} else cues = JSON.parse(fs.readFileSync(path.resolve(a.cues), "utf8"));
cues = cues.filter((c) => RECIPES[c.sfx] && c.t >= 0 && c.t < D).sort((x, y) => x.t - y.t);

// --- mix graph
const inputs = [], parts = [];
let n = 0;
const sfxGain = +(a["sfx-gain"] ?? -6);
cues.forEach((c) => { inputs.push("-i", path.join(LIB, c.sfx + ".wav")); const ms = Math.round(c.t * 1000);
  parts.push(`[${n}:a]adelay=${ms}|${ms},volume=${(sfxGain + (c.gain || 0)).toFixed(1)}dB[s${n}]`); n++; });
const sfxLabels = cues.map((_, i) => `[s${i}]`).join("");
let musicIdx = -1, voiceIdx = -1;
if (a.music) { inputs.push("-stream_loop", "-1", "-i", path.resolve(a.music)); musicIdx = n++; }
if (a.voice) { inputs.push("-i", path.resolve(a.voice)); voiceIdx = n++; }
inputs.push("-f", "lavfi", "-t", String(D), "-i", "anullsrc=r=48000:cl=stereo"); const silence = n++;
const bus = [`[${silence}:a]`];
const stems = a.stems ? path.resolve(a.stems) : null, stemMaps = [];
const tap = (label, name) => { if (!stems) return label; parts.push(`${label}asplit=2[${name}A][${name}S]`); stemMaps.push([`[${name}S]`, name]); return `[${name}A]`; };
if (cues.length) { parts.push(`${sfxLabels}amix=inputs=${cues.length}:normalize=0[sfx]`); bus.push(tap("[sfx]", "sfx")); }
if (musicIdx >= 0 && voiceIdx >= 0) {
  parts.push(`[${voiceIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[vo][vokey]`,
    `[${musicIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=-8dB[mus]`,
    `[mus][vokey]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=400[ducked]`);   // music dips under the voice
  bus.push(tap("[ducked]", "music"), "[vo]");
} else if (musicIdx >= 0) { parts.push(`[${musicIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=-6dB[mus]`); bus.push(tap("[mus]", "music")); }
else if (voiceIdx >= 0) { parts.push(`[${voiceIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo[vo]`); bus.push("[vo]"); }
const lufs = +(a.lufs ?? -14);
parts.push(`${bus.join("")}amix=inputs=${bus.length}:normalize=0:duration=first,atrim=0:${D},afade=t=out:st=${Math.max(0, D - 0.6)}:d=0.6[out]`);
const out = path.resolve(a.out); fs.mkdirSync(path.dirname(out), { recursive: true });
const raw = out.replace(/\.[^.]+$/, "") + ".raw.wav";
if (stems) fs.mkdirSync(stems, { recursive: true });
ff([...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-ar", "48000", "-ac", "2", raw,
  ...stemMaps.flatMap(([lab, name]) => ["-map", lab, "-t", String(D), "-ar", "48000", "-ac", "2", path.join(stems, name + ".raw.wav")])], "mix");
// two-pass, LINEAR loudness: measure, then one static gain + true-peak limiter. (Dynamic loudnorm would undo the ducking.)
const meas = spawnSync("ffmpeg", ["-hide_banner", "-i", raw, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const I = +((meas.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop() || "I: -23").match(/-?[\d.]+/)[0];
const gain = isFinite(I) && I > -70 ? lufs - I : 0;
ff(["-i", raw, "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=false`, "-ar", "48000", out], "loudness");
fs.rmSync(raw, { force: true });
for (const [, name] of stemMaps) { const r = path.join(stems, name + ".raw.wav"); ff(["-i", r, "-af", `volume=${gain.toFixed(2)}dB`, "-ar", "48000", path.join(stems, name + ".wav")], "stem " + name); fs.rmSync(r, { force: true }); }
fs.writeFileSync(out.replace(/\.[^.]+$/, "") + ".cues.json", JSON.stringify(cues, null, 1));
line(`PASS sfx ${path.basename(comp)} ${D}s — ${cues.length} cues${a.music ? " + music" : ""}${a.voice ? " + voice (music ducked)" : ""} → ${path.relative(process.cwd(), out)} (${lufs} LUFS)`);
