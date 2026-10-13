#!/usr/bin/env node
// Hook lab: the first 2 seconds decide reach. Score every sentence of the transcript as an opening line, take the top 3,
// and render a short A/B/C preview of each as a cold open (social-edit.mjs --hook N --seconds N), plus a side-by-side
// sheet to pick from. Titles: pass your own punchier on-screen lines with --titles "A|B|C" (the agent writes these),
// otherwise the spoken line is used as the title.
// usage: hooklab.mjs <in.mp4> --words w.json --out out/hooks [--aspect 9:16] [--seconds 8] [--titles "a|b|c"] [--n 3] [--score-only]
//        (any other flag is passed through to social-edit.mjs, e.g. --style word --platform tiktok --music m.wav)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, writeJSON, ffprobe, SKILL_DIR } from "./lib/common.mjs";
import { loadWords, sentences, hookScore } from "./lib/words.mjs";

const a = parseArgs(), src = a._[0];
if (!src || !fs.existsSync(src) || !a.words) { console.error("usage: hooklab.mjs <in.mp4> --words w.json --out out/hooks [--aspect 9:16] [--seconds 8] [--titles \"a|b|c\"] [--score-only]"); process.exit(1); }
const out = path.resolve(a.out || "out/hooks"); fs.mkdirSync(out, { recursive: true });
const S = (f) => path.join(SKILL_DIR, "scripts", f);
const words = loadWords(a.words), sents = sentences(words);
const ranked = sents.map((s, i) => ({ i, text: s.text, start: +s.start.toFixed(2), dur: +(s.end - s.start).toFixed(2), ...hookScore(s, i, sents.length) })).sort((x, y) => y.score - x.score);
const N = Math.min(+(a.n || 3), ranked.length), top = ranked.slice(0, N), titles = a.titles ? String(a.titles).split("|") : [];
writeJSON(path.join(out, "hooks.json"), { ranked, picked: top.map((t, k) => ({ variant: "ABC"[k] || String(k + 1), sentence: t.i, text: t.text, title: titles[k] || null, score: t.score, why: t.why })) });
line(`hook candidates (${sents.length} sentences):`); top.forEach((t, k) => line(`  ${"ABC"[k] || k + 1}  ${String(t.score).padStart(5)}  #${t.i} "${t.text.slice(0, 70)}"  [${t.why.join(", ")}]`));
if (a["score-only"]) process.exit(0);

// reframe once, shared by all variants
let input = path.resolve(src); const v = ffprobe(input).streams.find((s) => s.codec_type === "video");
if (a.aspect) { const [aw, ah] = String(a.aspect).split(":").map(Number);
  if (Math.abs(aw / ah - v.width / v.height) > 0.01) { const rf = path.join(out, "_reframed.mp4");
    if (!fs.existsSync(rf)) { const r = spawnSync(process.execPath, [S("reframe.mjs"), input, "--aspect", a.aspect, "--out", rf], { encoding: "utf8" }); if (r.status !== 0) { console.error("reframe failed: " + r.stderr); process.exit(2); } }
    input = rf; } }
const pass = Object.entries(a).filter(([k]) => !["_", "words", "out", "aspect", "seconds", "titles", "n", "score-only"].includes(k)).flatMap(([k, val]) => (val === true ? [`--${k}`] : [`--${k}`, String(val)]));
const vids = [];
top.forEach((t, k) => {
  const tag = "ABC"[k] || String(k + 1), o = path.join(out, `hook_${tag}.mp4`), title = titles[k] || t.text.replace(/[.!]$/, "");
  const r = spawnSync(process.execPath, [S("social-edit.mjs"), input, "--words", path.resolve(a.words), "--out", o, "--hook", String(t.i), "--hook-title", title, "--seconds", String(a.seconds || 8), ...pass], { encoding: "utf8" });
  line(`${r.status === 0 ? "PASS" : "FAIL"} hook ${tag}: ${(r.stdout || r.stderr).split("\n").find((l) => /PASS|fail/i.test(l))?.slice(0, 160) || ""}`);
  if (r.status === 0) vids.push(o);
});
// pick sheet: each variant at 0.4 s (title on) and 1.6 s, side by side
if (vids.length) {
  const ins = vids.flatMap((f) => ["-i", f]), H = 640;
  const parts = vids.map((_, i) => `[${i}:v]select='eq(n\\,12)+eq(n\\,48)',scale=-2:${H},tile=1x2[t${i}]`);
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...ins, "-filter_complex", parts.join(";") + ";" + vids.map((_, i) => `[t${i}]`).join("") + `hstack=inputs=${vids.length}[o]`, "-map", "[o]", "-frames:v", "1", "-vsync", "0", path.join(out, "pick-sheet.png")], { encoding: "utf8" });
  if (r.status === 0) line(`pick sheet → ${path.relative(process.cwd(), path.join(out, "pick-sheet.png"))} (columns A·B·C; rows 0.4 s / 1.6 s)`);
}
line(`${vids.length}/${top.length} hook variants → ${path.relative(process.cwd(), out)}  (post the variants as separate tests; keep the winner's line as the cold open)`);
