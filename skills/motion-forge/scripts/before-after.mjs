#!/usr/bin/env node
// Side-by-side comparison video (before | after), labelled — for "watch it fix itself" clips, reviews and changelogs.
// usage: before-after.mjs <before.mp4> <after.mp4> --out out/compare.mp4 [--labels "Before,After"] [--stack h|v|auto] [--width 1920]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, ffprobe } from "./lib/common.mjs";

const a = parseArgs();
const [A, B] = a._;
if (!A || !B || !a.out) { console.error("usage: before-after.mjs <before.mp4> <after.mp4> --out compare.mp4 [--labels Before,After] [--stack h|v]"); process.exit(1); }
const pa = ffprobe(A), v = (pa.streams || []).find((s) => s.codec_type === "video") || {};
const portrait = v.height > v.width, stack = a.stack && a.stack !== "auto" ? a.stack : portrait ? "h" : "v";
const [la, lb] = String(a.labels || "Before,After").split(",");
const W = +a.width || (stack === "h" ? (portrait ? 1080 : 1920) : 1080);
const each = stack === "h" ? Math.floor(W / 2 / 2) * 2 : W;
const lab = (t, col) => `drawtext=text='${t.replace(/'/g, "")}':x=24:y=h-th-36:fontsize=h/18:fontcolor=white:box=1:boxcolor=${col}@0.9:boxborderw=12`;
const filt = (lbl) => [`[0:v]scale=${each}:-2,setsar=1,${lab(la, "0xD9342B")}[a]`, `[1:v]scale=${each}:-2,setsar=1,${lab(lb, "0x1E9E5A")}[b]`, `[a][b]${stack}stack=inputs=2[o]`].map((x) => (lbl ? x : x.replace(/,drawtext=[^\[]*/, ""))).join(";");
const run = (lbl) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", A, "-i", B, "-filter_complex", filt(lbl), "-map", "[o]", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-shortest", "-movflags", "+faststart", path.resolve(a.out)], { encoding: "utf8" });
fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
let r = run(true); if (r.status !== 0) r = run(false);   // drawtext needs fontconfig; fall back to unlabelled
if (r.status !== 0) { console.error("ffmpeg failed: " + r.stderr.slice(0, 300)); process.exit(2); }
line(`PASS before-after ${stack}stack → ${path.relative(process.cwd(), path.resolve(a.out))}`);
