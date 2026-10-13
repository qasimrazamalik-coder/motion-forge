#!/usr/bin/env node
// Prompt coach: score a brief before any work starts, list what's missing, and write a sharper prompt with the gaps
// filled by sensible defaults in [brackets] (edit or accept). One good brief saves whole revision rounds.
//   prompt-coach.mjs "<brief>" [--for motion|social|image|video|voice|sfx|music] [--save brief.md] [--json]
//   --for image|video: rewrites into a provider-ready prompt (subject · setting · composition · light · lens · style ·
//   palette · negatives) for assets.mjs; --for social: a social-edit/hooklab command plan.
import fs from "node:fs";
import { parseArgs, line } from "./lib/common.mjs";

const a = parseArgs(), brief = String(a._[0] || (a.file ? fs.readFileSync(a.file, "utf8") : "")).trim();
if (!brief) { console.error('usage: prompt-coach.mjs "<brief>" [--for motion|social|image|video|voice|sfx|music] [--save brief.md] [--json]'); process.exit(1); }
const b = brief.toLowerCase();
const kind = a.for || (/\b(reel|tiktok|shorts|talking|footage|vlog|podcast|interview)\b/.test(b) ? "social" : /\b(image|photo|picture|thumbnail|poster)\b/.test(b) && !/\bvideo|animation|motion\b/.test(b) ? "image" : "motion");
const has = (re) => re.test(b), find = (re) => (brief.match(re) || [])[1];

const CHECKS = {
  motion: [
    ["goal", 15, /\b(promo|launch|explain|teaser|ad|announce|sting|intro|opener|tutorial|reveal|brand film|reel|story)\b/, "What is it for? (launch promo, explainer, logo sting…)", "[launch promo]"],
    ["duration", 12, /\b\d+(\.\d+)?\s*(s|sec|second|seconds|min)\b/, "How long?", "[12 seconds]"],
    ["format", 12, /\b(9:16|16:9|1:1|4:5|vertical|horizontal|square|reels?|tiktok|shorts|youtube|story)\b/, "Which aspect / platform?", "[9:16 for Reels + 16:9]"],
    ["copy", 14, /["“'][^"”']{3,}["”']|\b(text|headline|tagline|copy|says?)\b/, "What exact words appear on screen?", '["<headline>", "<CTA>"]'],
    ["audience", 8, /\b(audience|customers?|users?|developers?|founders?|clients?|students?|viewers|parents|teams?|buyers|owners)\b/, "Who is watching?", "[small-business owners]"],
    ["style", 12, /\b(minimal|editorial|bold|playful|calm|premium|cinematic|retro|brutalist|corporate|warm|dark|light|like|style|feel|mood)\b/, "What should it feel like? (2–3 adjectives or a reference)", "[calm, premium, editorial]"],
    ["brand", 10, /\b(brand|logo|colou?rs?|#[0-9a-f]{3,6}|font|palette|guidelines?)\b/, "Brand colours, fonts or logo?", "[brand.json or 2 hex colours]"],
    ["deliverables", 7, /\b(mp4|webm|gif|alpha|transparent|prores|png|4k|1080)\b/, "Which files?", "[MP4 1080p + transparent WebM]"],
    ["audio", 5, /\b(music|sound|sfx|voice|vo|narration|silent|audio)\b/, "Music, SFX or voice-over?", "[music bed + subtle SFX]"],
    ["cta", 5, /\b(cta|call to action|link|visit|download|sign ?up|book|buy|follow)\b/, "What should viewers do at the end?", "[visit <site>]"],
  ],
  social: [
    ["footage", 18, /\.(mp4|mov)|\bfootage|clip|recording|video\b/, "Which footage file?", "[talk.mp4]"],
    ["platform", 14, /\b(reels?|tiktok|shorts|youtube|linkedin|instagram)\b/, "Which platform?", "[Reels]"],
    ["length", 12, /\b\d+\s*(s|sec|seconds|min)\b/, "Target length?", "[30–45 s]"],
    ["hook", 14, /\bhook|first (line|second)|open(s|ing)? (with|on)\b/, "Any line you want as the hook, or let hooklab pick?", "[hooklab picks; I approve]"],
    ["transcript", 12, /\bwords?\.json|transcript|srt|whisper\b/, "Do you have word timings (words.json / SRT) or should whisper.cpp run?", "[--asr]"],
    ["style", 10, /\b(caption|subtitle|karaoke|highlight|word by word|bold|minimal)\b/, "Caption style?", "[highlight]"],
    ["music", 8, /\b(music|beat|song|track)\b/, "Music track (licensed) or none?", "[procedural bed]"],
    ["tone", 6, /\b(funny|serious|calm|energetic|educational|motivational)\b/, "Tone?", "[energetic, clear]"],
    ["editor", 6, /\b(resolve|premiere|capcut|davinci)\b/, "Finish in an editor too?", "[none]"],
  ],
  image: [
    ["subject", 22, /\w{4,}/, "Main subject?", "[subject]"], ["setting", 12, /\b(in|on|at|inside|over|under)\b/, "Where?", "[setting]"],
    ["composition", 12, /\b(close-?up|wide|aerial|top-?down|centered|rule of thirds|negative space|portrait|landscape)\b/, "Framing?", "[wide shot, negative space on the left for title]"],
    ["light", 12, /\b(light|lit|sunset|golden|dawn|night|neon|studio|soft|hard|backlit|rim)\b/, "Lighting?", "[soft morning light]"],
    ["style", 14, /\b(photo|photoreal|illustration|3d|render|watercolor|isometric|flat|film|35mm|anime|minimal)\b/, "Medium/style?", "[photoreal, 35 mm]"],
    ["palette", 10, /\b(colou?rs?|palette|tones?|#[0-9a-f]{3,6}|teal|orange|blue|warm|cool|pastel|monochrome)\b/, "Palette?", "[cool blues, one warm accent]"],
    ["format", 8, /\b(16:9|9:16|1:1|4:5|\d{3,4}x\d{3,4})\b/, "Aspect?", "[16:9]"],
    ["negatives", 10, /\bno (text|logo|watermark|people)|without\b/, "What must NOT appear?", "[no text, no logos, no watermark]"],
  ],
};
CHECKS.video = [...CHECKS.image.filter(([k]) => k !== "negatives"), ["motion", 14, /\b(slow|pan|dolly|orbit|push|drift|zoom|tracking|static|timelapse)\b/, "Camera/motion?", "[slow push-in]"], ["negatives", 8, /\bno (text|logo|watermark)|without\b/, "Exclusions?", "[no text, no logos]"]];
CHECKS.voice = [["script", 40, /\w{12,}/, "The exact script?", "[script]"], ["voice", 20, /\b(male|female|warm|deep|young|calm|energetic|accent|urdu|english|arabic)\b/, "Voice character + language?", "[warm, calm, English]"], ["pace", 20, /\b(slow|fast|pace|wpm|pause)\b/, "Pace?", "[~150 wpm, pauses at full stops]"], ["rights", 20, /\b(my voice|consent|licensed|stock)\b/, "If cloning: whose voice, with consent?", "[stock voice — no cloning]"]];
CHECKS.sfx = [["sound", 40, /\w{4,}/, "What sound?", "[sound]"], ["character", 30, /\b(deep|bright|soft|punchy|cinematic|subtle|metallic|airy|bassy)\b/, "Character?", "[subtle, airy]"], ["length", 30, /\b\d+(\.\d+)?\s*(s|sec)\b/, "Length?", "[0.8 s]"]];
CHECKS.music = [["mood", 35, /\b(calm|tense|uplifting|dark|happy|epic|minimal|lofi|ambient)\b/, "Mood?", "[calm, uplifting]"], ["tempo", 25, /\b\d+\s*bpm|slow|fast|tempo\b/, "Tempo?", "[100 bpm]"], ["length", 20, /\b\d+\s*(s|sec|min)\b/, "Length?", "[30 s]"], ["licence", 20, /\b(licen[cs]e|royalty|commercial|own)\b/, "Commercial use needed?", "[yes — procedural or licensed only]"]];

const list = CHECKS[kind] || CHECKS.motion, got = [], miss = [];
for (const [k, w, re, q, def] of list) (has(re) ? got : miss).push({ k, w, q, def });
const score = Math.round((got.reduce((n, x) => n + x.w, 0) / list.reduce((n, x) => n + x[1], 0)) * 100);
const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";

let improved;
if (kind === "image" || kind === "video") {
  const parts = { subject: brief.replace(/\s+/g, " ").replace(/[.]+$/, "") };
  for (const m of miss) parts[m.k] = m.def;
  improved = [parts.subject, parts.setting, parts.composition, parts.light, parts.style, parts.palette, parts.motion, parts.format].filter(Boolean).join(", ") + (parts.negatives ? `. Avoid: ${parts.negatives.replace(/^\[|\]$/g, "")}` : "");
  improved += `\n\nRun: node $MF/scripts/assets.mjs ${kind} "<prompt above>" --out assets/${kind === "image" ? "bg.png" : "plate.mp4"} --size ${/9:16/.test(b) ? "1080x1920" : "1920x1080"} --seed 7 --dry-run   (then without --dry-run)`;
} else if (kind === "social") {
  const file = find(/(\S+\.(?:mp4|mov))/i) || "talk.mp4", plat = (find(/\b(reels?|tiktok|shorts)\b/i) || "reels").toLowerCase().replace(/s$/, "s");
  improved = `${brief}\n\nAdd: ${miss.map((m) => `${m.k}: ${m.def}`).join(" · ") || "nothing — the brief is complete"}\n\nPlan:\n1. node $MF/scripts/hooklab.mjs ${file} --words ${file.replace(/\.\w+$/, ".words.json")} --out out/hooks --aspect 9:16 --score-only\n2. node $MF/scripts/social-edit.mjs ${file} --words ${file.replace(/\.\w+$/, ".words.json")} --out out/reel.mp4 --aspect 9:16 --platform ${/tiktok/.test(plat) ? "tiktok" : /short/.test(plat) ? "shorts" : "reels"} --style highlight --loop\n3. node $MF/scripts/audit.mjs out/reel.mp4`;
} else {
  improved = `/motion-forge ${brief.replace(/^\/motion-forge\s*/, "")}${miss.length ? "\n" + miss.map((m) => `- ${m.k === "cta" ? "CTA" : m.k[0].toUpperCase() + m.k.slice(1)}: ${m.def}`).join("\n") : ""}`;
}
const result = { kind, score, grade, have: got.map((x) => x.k), missing: miss.map((m) => ({ field: m.k, ask: m.q, default: m.def })), improved };
if (a.json) { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); process.exit(0); }
line(`BRIEF ${kind} · ${score}/100 (${grade}) · has: ${result.have.join(", ") || "—"}`);
if (miss.length) { line("missing (ask only what changes the build; otherwise accept the default):"); miss.sort((x, y) => y.w - x.w).forEach((m) => line(`  - ${m.k}: ${m.q}  default ${m.def}`)); }
line("\nsharper prompt:\n" + improved);
if (a.save) { fs.writeFileSync(a.save, `# Brief (${kind}, ${score}/100)\n\n${improved}\n`); line(`\nsaved → ${a.save}`); }
