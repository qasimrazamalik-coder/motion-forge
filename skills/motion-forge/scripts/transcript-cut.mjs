#!/usr/bin/env node
// Edit video by editing text. Word timestamps → you delete words in a text file → the video is cut to match.
//   transcript-cut.mjs <in.mp4> --words words.json --script edited.txt --out out.mp4   cut to the edited script
//   transcript-cut.mjs <in.mp4> --words words.json --fillers --out out.mp4             just remove um/uh/like/you know…
//   transcript-cut.mjs <in.mp4> --asr --export-script script.txt                       transcribe (whisper.cpp) and write an editable script
// words.json: [{ "word": "hello", "start": 0.42, "end": 0.71 }] (whisper.cpp `-ojf` full JSON is also accepted)
// ASR: whisper.cpp (`whisper-cli` or `main`) with $WHISPER_MODEL. STATUS: the cutting is tested with a synthetic transcript; the ASR step is untested here.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, which, writeJSON, ffprobe } from "./lib/common.mjs";
const a = parseArgs();
const src = a._[0];
if (!src || !fs.existsSync(src)) { console.error("usage: transcript-cut.mjs <in> (--words w.json | --asr) [--script edited.txt | --fillers] [--out out.mp4] [--export-script s.txt]"); process.exit(1); }
const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");
function loadWords(f) { const j = JSON.parse(fs.readFileSync(f, "utf8"));
  if (Array.isArray(j)) return j.map((w) => ({ word: String(w.word ?? w.text).trim(), start: +w.start, end: +w.end }));
  // whisper.cpp -ojf: transcription[].tokens[] with offsets in ms
  const toks = (j.transcription || []).flatMap((seg) => seg.tokens || []).filter((t) => t.text && !/^\[_/.test(t.text));
  const words = []; for (const t of toks) { const s = t.offsets.from / 1000, e = t.offsets.to / 1000;
    if (/^\s/.test(t.text) || !words.length) words.push({ word: t.text.trim(), start: s, end: e }); else { words[words.length - 1].word += t.text; words[words.length - 1].end = e; } }
  return words.filter((w) => norm(w.word)); }
let words;
if (a.asr) {
  const bin = which("whisper-cli") || which("whisper-cpp") || which("main"); const model = process.env.WHISPER_MODEL;
  if (!bin || !model) { console.error("ASR needs whisper.cpp on PATH (whisper-cli) and WHISPER_MODEL=/path/ggml-base.en.bin — or pass --words from any ASR"); process.exit(2); }
  const wav = path.resolve(src.replace(/\.[^.]+$/, "") + ".16k.wav"); spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-ar", "16000", "-ac", "1", wav]);
  const base = wav.replace(/\.wav$/, ""); const r = spawnSync(bin, ["-m", model, "-f", wav, "-ojf", "-of", base, "-ml", "1"], { encoding: "utf8" });
  if (r.status !== 0) { console.error("whisper failed: " + (r.stderr || "").slice(0, 300)); process.exit(2); }
  words = loadWords(base + ".json"); writeJSON(src.replace(/\.[^.]+$/, "") + ".words.json", words);
} else if (a.words) words = loadWords(a.words);
else { console.error("need --words or --asr"); process.exit(1); }
if (a["export-script"]) { fs.writeFileSync(a["export-script"], words.map((w) => w.word).join(" ").replace(/([.!?])\s/g, "$1\n") + "\n"); line(`wrote editable script → ${a["export-script"]} (delete words/lines, then run with --script)`); if (!a.out) process.exit(0); }
// decide which words to keep
const FILL = new Set(["um", "uh", "erm", "er", "ah", "hmm", "mm", "like", "basically", "actually"]), PHRASES = [["you", "know"], ["i", "mean"], ["sort", "of"], ["kind", "of"]];
let keep = words.map(() => true);
if (a.script) {   // greedy in-order alignment: each script word consumes the next matching transcript word; unmatched transcript words are cut
  const target = fs.readFileSync(a.script, "utf8").split(/\s+/).map(norm).filter(Boolean); keep = words.map(() => false); let j = 0;
  for (const tw of target) { let k = j; while (k < words.length && norm(words[k].word) !== tw && k - j < 40) k++; if (k < words.length && norm(words[k].word) === tw) { keep[k] = true; j = k + 1; } }
}
if (a.fillers) { words.forEach((w, i) => { if (FILL.has(norm(w.word))) keep[i] = false; });
  for (let i = 0; i + 1 < words.length; i++) for (const p of PHRASES) if (norm(words[i].word) === p[0] && norm(words[i + 1].word) === p[1]) keep[i] = keep[i + 1] = false; }
// segments: runs of kept words, padded, merged when the gap is short
const pad = +(a.pad ?? 0.08), merge = +(a.merge ?? 0.35), D = +ffprobe(src).format.duration;
const segs = []; words.forEach((w, i) => { if (!keep[i]) return; const s = Math.max(0, w.start - pad), e = Math.min(D, w.end + pad); const last = segs[segs.length - 1];
  if (last && s - last[1] <= merge && keep[i - 1]) last[1] = e; else segs.push([s, e]); });
for (let i = segs.length - 1; i > 0; i--) if (segs[i][0] <= segs[i - 1][1]) { segs[i - 1][1] = Math.max(segs[i - 1][1], segs[i][1]); segs.splice(i, 1); }
const cut = words.filter((_, i) => !keep[i]).map((w) => w.word);
if (!a.out) { console.log(JSON.stringify({ segments: segs, removedWords: cut }, null, 1)); process.exit(0); }
if (!segs.length) { console.error("nothing left to keep"); process.exit(2); }
const out = path.resolve(a.out), hasA = (ffprobe(src).streams || []).some((s) => s.codec_type === "audio");
const parts = segs.map(([x, y], i) => `[0:v]trim=${x.toFixed(3)}:${y.toFixed(3)},setpts=PTS-STARTPTS[v${i}]` + (hasA ? `;[0:a]atrim=${x.toFixed(3)}:${y.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${(y - x - 0.012).toFixed(3)}:d=0.012[a${i}]` : ""));
const cat = segs.map((_, i) => `[v${i}]` + (hasA ? `[a${i}]` : "")).join("") + `concat=n=${segs.length}:v=1:a=${hasA ? 1 : 0}[v]` + (hasA ? "[a]" : "");
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-filter_complex", [...parts, cat].join(";"), "-map", "[v]", ...(hasA ? ["-map", "[a]", "-c:a", "aac"] : []), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { encoding: "utf8" });
if (r.status !== 0) { console.error("ffmpeg failed: " + r.stderr.slice(0, 400)); process.exit(2); }
const kept = segs.reduce((s, [x, y]) => s + y - x, 0);
writeJSON(out.replace(/\.[^.]+$/, "") + ".cuts.json", { segments: segs, removedWords: cut });
line(`PASS transcript-cut ${path.basename(src)} ${D.toFixed(1)}s → ${kept.toFixed(1)}s, ${segs.length} segments, ${cut.length} words removed${cut.length ? " (" + cut.slice(0, 6).join(" ") + (cut.length > 6 ? " …" : "") + ")" : ""} → ${path.relative(process.cwd(), out)}`);
