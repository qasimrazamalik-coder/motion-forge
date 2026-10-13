#!/usr/bin/env node
// VFX finishing pack: film grain, glow/bloom, halation tint, chromatic aberration, vignette, light leaks, glitch hits,
// letterbox, colour looks. Pure ffmpeg, seeded → the same input + flags always give the same frames (no AI, no network).
// Works on any video: motion-forge renders, footage, social-edit reels.
// usage: vfx.mjs <in.mp4> --out out.mp4 [--look film|cinematic|dream|vhs|glitch|punchy|clean]
//          [--grain 0..1] [--glow 0..1] [--ca px] [--vignette 0..1] [--leak 0..1] [--glitch "t1,t2,…"|beats.json]
//          [--letterbox 2.39] [--warm -1..1] [--seed 7] [--crf 18] [--list]
//   A look sets defaults; any explicit flag overrides it. Audio is copied untouched.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, ffprobe, fps as fpsOf } from "./lib/common.mjs";

const LOOKS = {
  clean:     { why: "no grade, light grain only", grain: 0.15 },
  film:      { why: "35 mm feel: grain, soft halation, gentle vignette, lifted blacks", grain: 0.45, glow: 0.25, vignette: 0.35, warm: 0.15, lift: 0.04 },
  cinematic: { why: "film + 2.39 letterbox + teal/orange split", grain: 0.3, glow: 0.2, vignette: 0.4, letterbox: 2.39, split: 0.5, lift: 0.03 },
  dream:     { why: "bloom, warm leaks, soft contrast", glow: 0.7, leak: 0.5, warm: 0.3, grain: 0.2, vignette: 0.25, soft: 0.25 },
  vhs:       { why: "chroma bleed, noise, scan softness", ca: 3, grain: 0.7, soft: 0.5, vignette: 0.3, sat: 0.85 },
  glitch:    { why: "RGB split + noise bursts on cuts/beats", ca: 2, glitchAuto: true, grain: 0.25 },
  punchy:    { why: "social: crisp, saturated, slight glow", sat: 1.18, contrast: 1.08, glow: 0.15, sharpen: 0.6 },
};
const a = parseArgs();
if (a.list) { for (const [k, v] of Object.entries(LOOKS)) line(`${k.padEnd(10)} ${v.why}`); process.exit(0); }
const src = a._[0];
if (!src || !fs.existsSync(src) || !a.out) { console.error("usage: vfx.mjs <in.mp4> --out out.mp4 [--look film|cinematic|dream|vhs|glitch|punchy|clean] [--grain 0.4] [--glow 0.3] [--ca 2] [--vignette 0.3] [--leak 0.4] [--glitch 1.2,3.4] [--letterbox 2.39] [--seed 7] | --list"); process.exit(1); }
const look = LOOKS[a.look] || (a.look ? (console.error(`unknown look "${a.look}" (vfx.mjs --list)`), process.exit(1)) : {});
const num = (k, d = 0) => (a[k] != null && a[k] !== true ? +a[k] : look[k] != null ? +look[k] : d);
const P = ffprobe(src), v = P.streams.find((s) => s.codec_type === "video"), hasA = P.streams.some((s) => s.codec_type === "audio");
const W = v.width, H = v.height, FPS = fpsOf(v.avg_frame_rate || v.r_frame_rate) || 30, D = +P.format.duration || +v.duration || NaN, seed = Math.round(num("seed", 7)), u = Math.min(W, H) / 100;
if (!(D > 0)) { console.error("vfx: can't read the input's duration (remux it first: ffmpeg -i in -c copy fixed.mp4)"); process.exit(2); }
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// deterministic glitch times: explicit list, a beats.json, or (glitch look) seeded picks
let glitchT = [];
if (a.glitch && a.glitch !== true) glitchT = /\.json$/.test(a.glitch) ? (JSON.parse(fs.readFileSync(a.glitch, "utf8")).downbeats || []).slice(0, 24) : String(a.glitch).split(",").map(Number).filter((x) => x >= 0 && x < D);
else if (look.glitchAuto || a.glitch === true) { let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280); for (let t = 0.6; t < D - 0.3; t += 1.1 + rnd() * 1.8) glitchT.push(+t.toFixed(3)); }

const chain = [], pre = [];
let cur = "[0:v]", n = 0; const nx = () => `[v${++n}]`;
const add = (f) => { const o = nx(); chain.push(`${cur}${f}${o}`); cur = o; };
// colour: lift, contrast, saturation, warmth, teal/orange split
const sat = num("sat", 1), contrast = num("contrast", 1), lift = num("lift", 0), warm = num("warm", 0), split = num("split", 0);
if (sat !== 1 || contrast !== 1) add(`eq=saturation=${sat}:contrast=${contrast}`);
if (lift) add(`curves=all='0/${lift.toFixed(3)} 1/1'`);
if (warm) add(`colortemperature=temperature=${Math.round(6500 - warm * 1800)}`);
if (split) add(`colorbalance=rs=${(-0.08 * split).toFixed(3)}:bs=${(0.1 * split).toFixed(3)}:rh=${(0.08 * split).toFixed(3)}:bh=${(-0.08 * split).toFixed(3)}`);
const soft = num("soft", 0); if (soft) add(`gblur=sigma=${(soft * u * 0.25).toFixed(2)}`);
const sharpen = num("sharpen", 0); if (sharpen) add(`unsharp=5:5:${sharpen.toFixed(2)}`);
// glow / halation: blurred highlights screened back, warm-tinted
const glow = clamp(num("glow", 0), 0, 1);
if (glow) { const g = nx(), b = nx(), h = nx(); chain.push(`${cur}split${g}${b}`, `${b}curves=all='0/0 0.6/0 1/1',gblur=sigma=${(u * 1.6).toFixed(1)},colorbalance=rh=0.12:bh=-0.06${h}`, `${g}${h}blend=all_mode=screen:all_opacity=${(glow * 0.75).toFixed(2)}`); const o = nx(); chain[chain.length - 1] += o; cur = o; }
// chromatic aberration
const ca = num("ca", 0); if (ca) add(`rgbashift=rh=${-Math.round(ca)}:bh=${Math.round(ca)}:rv=${Math.round(ca / 2)}`);
// light leaks: seeded drifting gradients, screened at low opacity
const leak = clamp(num("leak", 0), 0, 1);
if (leak) { const l = nx(); pre.push(`gradients=s=${W}x${H}:r=${FPS}:d=${D.toFixed(3)}:c0=0xff7a2e:c1=0xffd08a:c2=0x000000:c3=0x000000:nb_colors=4:speed=0.012:seed=${seed},format=yuv420p${l}`);
  const o = nx(); chain.push(`${cur}${l}blend=all_mode=screen:all_opacity=${(leak * 0.45).toFixed(2)}${o}`); cur = o; }
// glitch hits: 3-frame RGB split + noise burst at each time
for (const t of glitchT) { const t1 = (t + 3 / FPS).toFixed(3); add(`rgbashift=rh=${Math.round(u * 1.2)}:bh=${-Math.round(u * 1.2)}:enable='between(t,${t},${t1})'`); add(`noise=alls=60:allf=t:all_seed=${seed}:enable='between(t,${t},${t1})'`); }
// vignette, grain (seeded), letterbox
const vig = clamp(num("vignette", 0), 0, 1); if (vig) add(`vignette=angle=${(0.25 + vig * 0.5).toFixed(3)}`);
const grain = clamp(num("grain", 0), 0, 1); if (grain) add(`noise=alls=${Math.round(4 + grain * 16)}:allf=t:all_seed=${seed}`);
const lb = num("letterbox", 0); if (lb && W / H < lb) { const bar = Math.round((H - W / lb) / 2 / 2) * 2; add(`drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill,drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`); }
add("format=yuv420p");
const graph = [...pre, ...chain].join(";");
const out = path.resolve(a.out); fs.mkdirSync(path.dirname(out), { recursive: true });
const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", path.resolve(src), "-filter_complex", graph, "-map", cur, ...(hasA ? ["-map", "0:a", "-c:a", "copy"] : []),
  "-c:v", "libx264", "-preset", "medium", "-crf", String(a.crf || 18), "-r", String(FPS), "-movflags", "+faststart", out], { encoding: "utf8" });
if (r.status !== 0) { console.error("ffmpeg vfx failed: " + r.stderr.split("\n").slice(-4).join(" | ")); process.exit(2); }
const used = Object.entries({ grain, glow, ca, vignette: vig, leak, letterbox: lb, glitches: glitchT.length, sat, contrast, warm, split, soft }).filter(([, x]) => x && x !== 1).map(([k, x]) => `${k}=${+(+x).toFixed(2)}`);
fs.writeFileSync(out.replace(/\.[^.]+$/, "") + ".vfx.json", JSON.stringify({ src: path.resolve(src), look: a.look || null, seed, glitchT, graph }, null, 1));
line(`PASS vfx ${path.basename(src)} → ${path.relative(process.cwd(), out)} · ${a.look ? a.look + " · " : ""}${used.join(" ") || "no effects"} · seed ${seed}`);
