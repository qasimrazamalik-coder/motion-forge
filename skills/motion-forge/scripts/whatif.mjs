#!/usr/bin/env node
// One command → a finished "What if…?" reel (9:16): 3D scene, hook, event, fact cards timed to reading speed (or to the
// voice-over), optional local TTS voice-over with word-timed captions, procedural SFX, music ducked under the voice,
// QA stills, video, delivery check.
// usage: whatif.mjs --question "the Moon disappeared tonight?" --event "Gone." --facts facts.json --out out/moon.mp4
//          [--scene moon|spin|sun|impact] [--handle @you] [--follow "Follow for the next What if"] [--music track.wav]
//          [--tts auto|none|"<cmd with {text} and {out}>"] [--quality draft|final] [--dir work/moon] [--data data.json]
// facts.json: [{ "big": "1/3", "text": "…", "look": "tide|dark|wobble|freeze|still|none" }]  (max 3)
// TTS auto: $MF_TTS template, else piper ($PIPER_MODEL), else espeak-ng, else macOS `say`. None found → no voice-over, on-screen text only.
// STATUS: the no-voice path is tested end to end; the TTS engines are not installed in the build environment, so the voice path is untested.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, which, SKILL_DIR, ffprobe } from "./lib/common.mjs";

const a = parseArgs();
const S = (f) => path.join(SKILL_DIR, "scripts", f);
const node = (script, args) => { const r = spawnSync(process.execPath, [S(script), ...args], { encoding: "utf8", env: process.env }); return { code: r.status, out: ((r.stdout || "") + (r.stderr || "")).trim() }; };
let data = a.data ? JSON.parse(fs.readFileSync(path.resolve(a.data), "utf8")) : {};
if (a.question) data.question = a.question;
if (a.event) data.event = a.event;
if (a.facts) data.facts = JSON.parse(fs.existsSync(a.facts) ? fs.readFileSync(a.facts, "utf8") : a.facts);
if (a.scene) data.scene = a.scene;
if (a.handle) data.handle = a.handle;
if (a.follow) data.follow = a.follow;
data = { kicker: "What if", event: "Gone.", follow: "Follow for the next What if", handle: "@yourchannel", scene: "moon", facts: [], captionStyle: "box", ...data };
if (!data.question || !data.facts.length || !a.out) { console.error("usage: whatif.mjs --question \"…?\" --facts facts.json --out reel.mp4 [--scene moon|spin|sun|impact] [--music m.wav] [--tts auto|none]"); process.exit(1); }
data.facts = data.facts.slice(0, 3);
const out = path.resolve(a.out), dir = path.resolve(a.dir || out.replace(/\.[^.]+$/, "") + "_project");
fs.mkdirSync(dir, { recursive: true });

// --- voice-over (optional)
function ttsCommand() {
  const mode = a.tts || "auto";
  if (mode === "none") return null;
  if (mode !== "auto") return mode;
  if (process.env.MF_TTS) return process.env.MF_TTS;
  if (which("piper") && process.env.PIPER_MODEL) return `echo {text} | piper --model "${process.env.PIPER_MODEL}" --output_file {out}`;
  if (which("espeak-ng")) return `espeak-ng -s 165 -w {out} {text}`;
  if (process.platform === "darwin" && which("say")) return `say -o {out}.aiff {text} && ffmpeg -loglevel error -y -i {out}.aiff {out}`;
  return null;
}
const tts = ttsCommand();
const lines = [`${data.kicker} ${data.question}`, data.event, ...data.facts.map((f) => f.text), data.follow];
const vo = [];
if (tts) {
  const vdir = path.join(dir, "vo"); fs.mkdirSync(vdir, { recursive: true });
  lines.forEach((txt, i) => { const f = path.join(vdir, `l${i}.wav`), q = JSON.stringify(txt);
    const r = spawnSync(process.platform === "win32" ? "cmd" : "sh", process.platform === "win32" ? ["/c", tts.replaceAll("{text}", q).replaceAll("{out}", f)] : ["-c", tts.replaceAll("{text}", q).replaceAll("{out}", f)], { encoding: "utf8" });
    const dur = r.status === 0 && fs.existsSync(f) ? +ffprobe(f).format?.duration || 0 : 0;
    vo.push({ file: f, text: txt, dur }); });
  if (vo.some((v) => !v.dur)) { line("  note: TTS failed for some lines → continuing without voice-over"); vo.length = 0; }
}
// --- pacing: each fact card stays up for reading time (≈3.6 words/s + settle) or its voice line, whichever is longer
const words = (s) => String(s).split(/\s+/).filter(Boolean).length;
const FACT = Math.min(6.5, Math.max(2.45, ...data.facts.map((f, i) => Math.max(words(f.text) / 3.6 + 0.9, vo.length ? vo[i + 2].dur + 0.6 : 0))));
data.factDur = +FACT.toFixed(2);
const DUR = +(5.0 + data.facts.length * FACT + 2.4).toFixed(1);

// --- captions from the voice lines (on-screen copy already carries the words when there is no voice)
const starts = [0.3, 3.9, ...data.facts.map((_, i) => 5.05 + i * FACT), 5.15 + data.facts.length * FACT + 0.3];
if (vo.length) {
  const ts = (x) => { const ms = Math.round(x * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  fs.writeFileSync(path.join(dir, "captions.srt"), vo.map((v, i) => `${i + 1}\n${ts(starts[i])} --> ${ts(Math.min(DUR, starts[i] + v.dur))}\n${v.text}\n`).join("\n"));
  data.captions = "captions.srt";
  const inputs = vo.flatMap((v) => ["-i", v.file]), f = vo.map((_, i) => `[${i}:a]aresample=48000,adelay=${Math.round(starts[i] * 1000)}:all=1[v${i}]`).join(";");
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${f};${vo.map((_, i) => `[v${i}]`).join("")}amix=inputs=${vo.length}:normalize=0,atrim=0:${DUR}[o]`, "-map", "[o]", path.join(dir, "vo.wav")]);
} else data.captions = null;

// --- build, check, render
let r = node("scaffold.mjs", ["whatif-3d", dir, "--force", "--duration", String(DUR), "--title", "What if " + data.question.replace(/\?$/, "")]);
if (r.code !== 0) { console.error(r.out); process.exit(2); }
if (!fs.existsSync(path.join(dir, "vendor", "three.module.js"))) { console.error("FAIL whatif — three.js not found locally: run `npm i three` in your project (or set MF_NODE_PATH to a folder with node_modules/three)"); process.exit(2); }
fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(data, null, 2));
const comp = path.join(dir, "index.html");
r = node("render.mjs", [comp, "--stills", "auto", "--score", "--thumb", "270", "--outdir", path.join(dir, "out/frames")]);
line(r.out.split("\n").slice(0, 4).join("\n"));
if (r.code !== 0) { line(`FAIL whatif — fix the issues above (copy too long? shorten the question/facts), sheet: ${path.relative(process.cwd(), path.join(dir, "out/frames/contact-sheet.png"))}`); process.exit(2); }
const mix = path.join(dir, "mix.wav");
const sfxArgs = [comp, "--out", mix]; if (a.music) sfxArgs.push("--music", path.resolve(a.music)); if (vo.length) sfxArgs.push("--voice", path.join(dir, "vo.wav"));
r = node("sfx.mjs", sfxArgs); line(r.out.split("\n")[0]);
const final = a.quality === "final";
r = node("render.mjs", [comp, "--out", out, "--audio", mix, ...(final ? ["--motion-blur", "4"] : ["--scale", "0.5", "--fast"])]);
line(r.out.split("\n").slice(0, 3).join("\n"));
if (r.code !== 0) process.exit(2);
const sc = final ? 1 : 0.5;
r = node("inspect-output.mjs", [out, "--width", String(1080 * sc), "--height", String(1920 * sc), "--fps", "30", "--duration", String(DUR), "--sheet", out.replace(/\.[^.]+$/, "") + "_sheet.png"]);
line(r.out.split("\n")[0]);
line(`${r.code === 0 ? "PASS" : "FAIL"} whatif "${data.question}" — ${DUR}s, scene ${data.scene}, ${data.facts.length} facts × ${FACT.toFixed(1)}s, voice-over ${vo.length ? "yes" : "no (no TTS engine; --tts to set one)"}, ${final ? "final (motion blur)" : "draft (half-res)"} → ${path.relative(process.cwd(), out)}`);
process.exit(r.code === 0 ? 0 : 2);
