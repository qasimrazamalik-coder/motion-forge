#!/usr/bin/env node
// Social edit engine: raw talking footage + word timings → a Reels / TikTok / Shorts edit, plus an EDL for Resolve,
// Premiere or CapCut (export-nle.mjs --edl).
//   hook cold open (best line pulled to the front) · jump cuts (pauses + fillers out) · punch-in zooms (alternating, harder
//   on emphasis words, optionally switched on the music's beats) · whoosh into the body · word-timed social captions in
//   platform safe zones · hook title · progress bar · loop ending · voice cleanup · music ducked under the voice · −14 LUFS.
// usage: social-edit.mjs <in.mp4> (--words w.json | --asr) --out reel.mp4
//          [--aspect 9:16|1:1|4:5|16:9] [--platform reels|tiktok|shorts] [--style highlight|word|karaoke|pop|box] [--upper]
//          [--hook auto|none|<sentence #>] [--hook-mode repeat|move] [--hook-title "text"] [--max-pause 0.35] [--aggressive]
//          [--punch 1.1] [--emphasis word,word] [--music track.wav] [--beat-zoom] [--whoosh hook|all|none] [--no-progress]
//          [--loop] [--no-clean] [--seconds N (render only the first N s: hook A/B)] [--nle out/nle] [--keep-work] [--dry]
// Writes next to --out: <name>.edit.json (EDL), <name>.srt, <name>.words.json (edited timeline), <name>.report.json.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, writeJSON, ffprobe, fps as fpsOf, which, SKILL_DIR } from "./lib/common.mjs";
import { loadWords, sentences, fillerMask, hookScore, remapWords, chunkWords, toSRT, norm, STRONG } from "./lib/words.mjs";

const a = parseArgs();
const srcIn = a._[0];
if (!srcIn || !fs.existsSync(srcIn) || !a.out) { console.error("usage: social-edit.mjs <in.mp4> (--words w.json | --asr) --out reel.mp4 [--aspect 9:16] [--hook auto] [--music m.wav] [--nle out/nle] …"); process.exit(1); }
const S = (f) => path.join(SKILL_DIR, "scripts", f);
const run = (args, what, opts = {}) => { const r = spawnSync(args[0], args.slice(1), { encoding: "utf8", maxBuffer: 1 << 26, ...opts }); if (r.status !== 0) { console.error(`${what} failed: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-4).join(" | ")}`); process.exit(2); } return r; };
const ff = (args, what) => run(["ffmpeg", "-y", "-v", "error", ...args], what);
const out = path.resolve(a.out), base = out.replace(/\.[^.]+$/, ""), work = base + "_work";
fs.mkdirSync(work, { recursive: true });

// ---------- source + words
const probe = ffprobe(srcIn), vs = probe.streams.find((s) => s.codec_type === "video"), hasAudio = probe.streams.some((s) => s.codec_type === "audio");
const FPS = fpsOf(vs.avg_frame_rate || vs.r_frame_rate) || 30, srcDur = +probe.format.duration;
let words;
if (a.asr) { run([process.execPath, S("transcript-cut.mjs"), srcIn, "--asr", "--export-script", path.join(work, "script.txt")], "asr (whisper.cpp)"); words = loadWords(srcIn.replace(/\.[^.]+$/, "") + ".words.json"); }
else if (a.words) words = loadWords(a.words); else { console.error("need --words w.json (any ASR) or --asr (whisper.cpp)"); process.exit(1); }
if (!words.length) { console.error("no words in transcript"); process.exit(1); }

// ---------- output geometry (+ smart reframe when the aspect changes)
const [aw, ah] = String(a.aspect || `${vs.width}:${vs.height}`).split(":").map(Number), even = (x) => Math.round(x / 2) * 2;
// delivery size: social platforms expect 1080-wide portrait / 1920-wide landscape; a reframed 608×1080 crop is scaled up to that
const sameAspect = Math.abs(aw / ah - vs.width / vs.height) < 0.01, srcLong = Math.max(vs.width, vs.height), long = a["keep-size"] ? srcLong : srcLong >= 1000 ? 1920 : srcLong;
const W = a["keep-size"] && sameAspect ? vs.width : aw <= ah ? even(long * aw / ah) : long, H = a["keep-size"] && sameAspect ? vs.height : aw <= ah ? long : even(long * ah / aw);
let src = path.resolve(srcIn);
if (!sameAspect && !a.dry) {
  const rf = path.join(work, "reframed.mp4");
  if (!fs.existsSync(rf) || a.force) run([process.execPath, S("reframe.mjs"), src, "--aspect", `${aw}:${ah}`, "--out", rf], "reframe");
  src = rf;
}
const snap = (t) => Math.round(t * FPS) / FPS;   // every edit point on the source frame grid

// ---------- what to keep: words minus fillers, pauses longer than --max-pause cut out
const maxPause = +(a["max-pause"] ?? 0.35), pad = +(a.pad ?? 0.07);
const cutW = fillerMask(words, { aggressive: !!a.aggressive });
function segsFor(i0, i1) {   // kept speech between word indices → [{in,out}] merged across short pauses
  const segs = [];
  for (let i = i0; i <= i1; i++) { if (cutW[i]) continue; const w = words[i], s = Math.max(0, w.start - pad), e = Math.min(srcDur, w.end + pad), last = segs.at(-1);
    if (last && s - last.out <= maxPause && !cutW.slice(last.i1 + 1, i).some(Boolean)) { last.out = e; last.i1 = i; } else segs.push({ in: s, out: e, i0: i, i1: i }); }
  return segs.map((s) => ({ ...s, in: snap(s.in), out: snap(s.out) })).filter((s) => s.out - s.in >= 2 / FPS);
}
const sents = sentences(words);
let hookIdx = -1;
if (a.hook !== "none" && sents.length > 1) {
  if (a.hook && a.hook !== "auto" && a.hook !== true) hookIdx = Math.max(0, Math.min(sents.length - 1, +a.hook));
  else { const sc = sents.map((s, i) => ({ i, ...hookScore(s, i, sents.length) })).sort((x, y) => y.score - x.score); hookIdx = sc[0].i; }
}
const hookMode = a["hook-mode"] || "repeat";
const hookSegs = hookIdx >= 0 ? segsFor(sents[hookIdx].i0, sents[hookIdx].i1).map((s) => ({ ...s, hook: true })) : [];
let body = segsFor(0, words.length - 1);
if (hookIdx >= 0 && (hookMode === "move" || hookIdx === 0)) body = body.flatMap((s) => {   // remove the hook's span from the body
  const h0 = hookSegs[0].in, h1 = hookSegs.at(-1).out; if (s.out <= h0 || s.in >= h1) return [s];
  return [s.in < h0 ? { ...s, out: h0 } : null, s.out > h1 ? { ...s, in: h1 } : null].filter((x) => x && x.out - x.in >= 2 / FPS); });
let segs = [...hookSegs, ...body];

// ---------- punch-ins: alternate per cut, harder on emphasis words; optional switch on the music's beats
const punch = +(a.punch ?? 1.1), emph = new Set(String(a.emphasis || "").split(",").map(norm).filter(Boolean));
const isEmph = (w) => emph.has(norm(w.word)) || /\d/.test(w.word) || /!$/.test(w.word) || (w.word.length > 2 && w.word === w.word.toUpperCase() && /[A-Z]/.test(w.word)) || (!emph.size && STRONG.includes(norm(w.word)));
let beats = null;
if (a.music && a["beat-zoom"]) { const bj = path.join(work, "beats.json"); run([process.execPath, S("beats.mjs"), path.resolve(a.music), "--out", bj], "beats"); beats = JSON.parse(fs.readFileSync(bj, "utf8")).beats; }
if (beats) {   // split long segments at the beat nearest their middle (output time), so the zoom changes ON the beat
  const res = []; let at = 0;
  for (const s of segs) { const d = s.out - s.in, mid = at + d / 2;
    const b = d > 2.4 ? beats.filter((x) => x > at + 0.8 && x < at + d - 0.8).sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid))[0] : null;
    if (b != null) { const cut = snap(s.in + (b - at)); res.push({ ...s, out: cut, beatSplit: true }, { ...s, in: cut, onBeat: b }); } else res.push(s);
    at += d; }
  segs = res;
}
segs.forEach((s, i) => { const ws = words.filter((w) => (w.start + w.end) / 2 >= s.in && (w.start + w.end) / 2 < s.out);
  s.emphasis = ws.filter(isEmph).map((w) => w.word);
  s.zoom = s.hook ? +(punch * 1.04).toFixed(3) : i % 2 ? punch : 1;
  if (s.emphasis.length) s.zoom = Math.max(s.zoom, +(punch + 0.08).toFixed(3)); });

// --seconds: keep only the first N seconds of the edit (hook A/B previews)
if (a.seconds) { const lim = +a.seconds, keep = []; let at = 0; for (const s of segs) { if (at >= lim) break; const d = Math.min(s.out - s.in, lim - at); keep.push({ ...s, out: snap(s.in + d) }); at += d; } segs = keep; }
const outDur = +segs.reduce((n, s) => n + (s.out - s.in), 0).toFixed(3);
if (!(outDur > 0.3)) { console.error(`nothing left to edit: ${segs.length} segments, ${outDur}s (check the word timings, --max-pause or --seconds)`); process.exit(2); }
const hookEnd = +hookSegs.reduce((n, s) => n + (s.out - s.in), 0).toFixed(3);
const editWords = remapWords(words.filter((_, i) => !cutW[i]), segs);
if (a.dry) { line(`plan: ${segs.length} segments, ${srcDur.toFixed(1)}s → ${outDur}s, hook "${hookIdx >= 0 ? sents[hookIdx].text : "-"}" (${hookEnd}s), ${words.length - editWords.length} words cut, zooms ${segs.map((s) => s.zoom).join(" ")}`); process.exit(0); }

// ---------- picture + voice: one trim/zoom/concat pass
const fg = [], vlab = [], fo = 0.008;   // 8 ms audio fades at every cut: no clicks
segs.forEach((s, i) => {
  const z = s.zoom, d = s.out - s.in;
  fg.push(`[0:v]trim=start=${s.in}:end=${s.out},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},scale=${Math.round(W * z / 2) * 2}:${Math.round(H * z / 2) * 2},crop=${W}:${H}:(iw-${W})/2:(ih-${H})*0.4,setsar=1[v${i}]`);
  if (hasAudio) fg.push(`[0:a]atrim=start=${s.in}:end=${s.out},asetpts=PTS-STARTPTS,afade=t=in:d=${fo},afade=t=out:st=${Math.max(0, d - fo).toFixed(4)}:d=${fo}[a${i}]`);
  vlab.push(`[v${i}]` + (hasAudio ? `[a${i}]` : ""));
});
const clean = a.clean === false || a["no-clean"] ? "" : ",highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=90:makeup=2";
fg.push(`${vlab.join("")}concat=n=${segs.length}:v=1:a=${hasAudio ? 1 : 0}[cv]${hasAudio ? "[ca]" : ""}`);
if (hasAudio) fg.push(`[ca]aformat=sample_rates=48000:channel_layouts=stereo${clean}[vo]`);
const cutV = path.join(work, "cut.mp4"), voice = path.join(work, "voice.wav");
ff(["-i", src, "-filter_complex", fg.join(";"), "-map", "[cv]", "-r", String(FPS), "-c:v", "libx264", "-crf", "14", "-preset", "fast", "-pix_fmt", "yuv420p", "-an", cutV,
  ...(hasAudio ? ["-map", "[vo]", "-ar", "48000", voice] : [])], "cut");

// ---------- graphics overlay (captions + hook title + progress) rendered by the captions-social composition, QA on
const gfx = path.join(work, "gfx");
run([process.execPath, S("scaffold.mjs"), "captions-social", gfx, "--width", String(W), "--height", String(H), "--fps", String(Math.round(FPS)), "--duration", String(outDur), "--force"], "scaffold captions");
const hookTitle = a["hook-title"] && a["hook-title"] !== true ? String(a["hook-title"]) : null;
writeJSON(path.join(gfx, "data.json"), { words: editWords, style: a.style || "highlight", platform: a.platform || "reels", uppercase: !!a.upper, maxWords: +(a["max-words"] || 0),
  hook: hookTitle ? { text: hookTitle, until: hookEnd || 2.2 } : null, progress: false, duration: outDur });   // progress bar is drawn by ffmpeg below: a bar that moves every frame would defeat render dedupe (≈5× faster captions)
const gfxMov = path.join(work, "gfx.mov");
const gr = spawnSync(process.execPath, [S("render.mjs"), path.join(gfx, "index.html"), "--out", gfxMov, "--formats", "prores", "--force"], { encoding: "utf8" });
const gfxLine = (gr.stdout || "").split("\n").filter((l) => /PASS|FAIL|WARN|HIGH|CRITICAL|issue/i.test(l)).slice(0, 4).join(" | ");
if (gr.status !== 0 || !fs.existsSync(gfxMov)) { console.error(`captions render failed: ${(gr.stdout + gr.stderr).split("\n").slice(0, 6).join(" | ")}`); process.exit(2); }
fs.rmSync(gfxMov.replace(/\.mov$/, "_alpha.webm"), { force: true }); fs.rmSync(gfxMov.replace(/\.mov$/, "_frames"), { recursive: true, force: true });

// ---------- sound: whoosh into the body (and on beat zooms with --whoosh all), music ducked, −14 LUFS; stems for the NLE
const cues = []; const wmode = a.whoosh || "hook";
if (wmode !== "none" && hookEnd > 0.5) cues.push({ t: Math.max(0, hookEnd - 0.45), sfx: "whoosh", gain: -4, why: "hook → body" });
if (wmode === "all") { let at = 0; for (const s of segs) { if (s.onBeat != null || (s.zoom !== 1 && at > hookEnd + 0.1)) cues.push({ t: Math.max(0, at - 0.45), sfx: "whoosh", gain: -10, why: "punch-in" }); at += s.out - s.in; } }
const cuesF = path.join(work, "cues.json"); fs.writeFileSync(cuesF, JSON.stringify(cues));
const mix = path.join(work, "mix.wav"), stems = path.join(work, "stems");
run([process.execPath, S("sfx.mjs"), "-", "--duration", String(outDur), "--out", mix, "--cues", cuesF, "--stems", stems, ...(hasAudio ? ["--voice", voice] : []), ...(a.music ? ["--music", path.resolve(a.music)] : [])], "sound mix");

// ---------- final: picture + overlay (+ loop dissolve back to the first frame) + mix
const loop = !!a.loop, lf = 0.3;
const progress = !(a.progress === false || a["no-progress"]), bh = Math.max(4, Math.round(Math.min(W, H) * 0.009 / 2) * 2), by = H > W ? 0 : H - bh;   // top on 9:16 (bottom sits under platform UI)
const ovChain = progress ? `[0:v][1:v]overlay=format=auto:eof_action=pass,drawbox=x=0:y=${by}:w=iw:h=${bh}:color=black@0.35:t=fill[ov0];color=c=0xFFD45C:s=${W}x${bh}:r=${FPS}:d=${outDur}[bar];[ov0][bar]overlay=x='-w+w*t/${outDur}':y=${by}:eval=frame:shortest=1`
  : `[0:v][1:v]overlay=format=auto:eof_action=pass`;
const vf = loop ? `${ovChain}[ov];[ov]split[m][f];[f]trim=end_frame=1,loop=loop=${Math.round(lf * FPS)}:size=1,setpts=N/${FPS}/TB[first];[m][first]xfade=transition=fade:duration=${lf}:offset=${Math.max(0, outDur - lf).toFixed(3)},format=yuv420p[v]`
  : `${ovChain},format=yuv420p[v]`;
ff(["-i", cutV, "-i", gfxMov, "-i", mix, "-filter_complex", vf, "-map", "[v]", "-map", "2:a", "-r", String(FPS), "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-t", String(outDur), "-movflags", "+faststart", out], "final");

// ---------- sidecars: SRT, edited words, EDL (for export-nle), report
const cuesCap = chunkWords(editWords, { maxWords: a.style === "word" ? 1 : +(a["max-words"] || 4) });
fs.writeFileSync(base + ".srt", toSRT(cuesCap)); writeJSON(base + ".words.json", editWords);
const rel = (f) => path.relative(path.dirname(out), f).replace(/\\/g, "/");
const markers = [{ t: 0, name: "hook", note: hookIdx >= 0 ? sents[hookIdx].text : "" }, ...(hookEnd ? [{ t: hookEnd, name: "body" }] : [])];
let at = 0; segs.forEach((s) => { if (s.onBeat != null) markers.push({ t: +at.toFixed(3), name: "beat zoom" }); at += s.out - s.in; });
const edl = { name: path.basename(base), fps: FPS, width: W, height: H, duration: outDur,
  clips: segs.map((s, i) => ({ name: `${s.hook ? "hook" : "cut"}${i + 1}`, src: rel(src), in: s.in, out: s.out, zoom: s.zoom !== 1 ? s.zoom : undefined })),
  overlays: [{ name: "captions+hook", file: rel(gfxMov), start: 0, dur: outDur, alpha: true }],
  audio: [...(fs.existsSync(path.join(stems, "music.wav")) ? [{ file: rel(path.join(stems, "music.wav")), start: 0, role: "music" }] : []), ...(fs.existsSync(path.join(stems, "sfx.wav")) ? [{ file: rel(path.join(stems, "sfx.wav")), start: 0, role: "sfx" }] : [])],
  markers, srt: rel(base + ".srt"),
  note: "Source clips carry the RAW camera audio; the cleaned, mastered mix is in the rendered reel (voice cleanup = highpass + afftdn + compressor)." };
writeJSON(base + ".edit.json", edl);
const insp = spawnSync(process.execPath, [S("inspect-output.mjs"), out], { encoding: "utf8" });
const report = { source: path.resolve(srcIn), out, width: W, height: H, fps: FPS, sourceDuration: +srcDur.toFixed(3), duration: outDur, segments: segs.length,
  wordsCut: cutW.filter(Boolean).length, fillersCut: words.filter((_, i) => cutW[i]).map((w) => w.word), hook: hookIdx >= 0 ? { sentence: sents[hookIdx].text, seconds: hookEnd, mode: hookMode } : null,
  zooms: segs.map((s) => s.zoom), beatZooms: segs.filter((s) => s.onBeat != null).length, cues, captions: gfxLine, inspect: (insp.stdout || "").split("\n")[0] };
writeJSON(base + ".report.json", report);
if (a.nle) run([process.execPath, S("export-nle.mjs"), "--edl", base + ".edit.json", "--out", path.resolve(a.nle)], "export-nle");
if (!a["keep-work"]) { fs.rmSync(cutV, { force: true }); fs.rmSync(gfx, { recursive: true, force: true }); }
line(`PASS social-edit ${path.basename(srcIn)} ${srcDur.toFixed(1)}s → ${outDur}s ${W}x${H} · ${segs.length} cuts · ${report.wordsCut} words out${report.fillersCut.length ? ` (${report.fillersCut.slice(0, 4).join(", ")}${report.fillersCut.length > 4 ? "…" : ""})` : ""} · hook ${report.hook ? `"${report.hook.sentence.slice(0, 50)}" ${hookEnd}s` : "none"} · ${report.beatZooms} beat zooms → ${path.relative(process.cwd(), out)}`);
if (/FAIL|HIGH|CRITICAL/.test(gfxLine)) line(`  captions QA: ${gfxLine}`);
line(`  ${report.inspect}`);
