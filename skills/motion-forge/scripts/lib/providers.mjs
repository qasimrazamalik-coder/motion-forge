// AI asset providers behind one contract. Optional: nothing here runs unless a provider is configured, and every kind has
// a free deterministic fallback, so motion-forge keeps working with zero keys and zero downloads.
//   generate({ kind, prompt, seed, width, height, duration, voice, provider, out, maxCost, dryRun, allowLikeness })
//   → { file, provider, model, cached, costEstimate, manifest }
// kinds: image · video · voice · sfx · music
// Guardrails: content policy check before any call · keys only from env, never logged · per-run cost cap (--max-cost,
// estimates) · cache by request hash (re-renders cost nothing) · provenance + licence manifest next to every asset.
// STATUS: fallbacks are tested; paid adapters are tested against a local mock of each API only (no real keys here).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { which, MF_HOME } from "./common.mjs";
import { RECIPES } from "./sfx-recipes.mjs";

const env = process.env;
const BASE = { fal: env.FAL_BASE || "https://fal.run", replicate: env.REPLICATE_BASE || "https://api.replicate.com", eleven: env.ELEVENLABS_BASE || "https://api.elevenlabs.io", comfy: env.COMFY_URL || "" };
// rough public list prices (USD) used ONLY for the budget cap; check the provider's pricing page — they change
export const COST = { "fal:image": 0.003, "replicate:image": 0.003, "fal:video": 0.2, "eleven:voice": 0.03, "eleven:sfx": 0.02, "comfyui:image": 0, "piper:voice": 0, "espeak:voice": 0, "procedural:*": 0 };

export const PROVIDERS = {
  image: [
    { id: "fal", model: env.FAL_IMAGE_MODEL || "fal-ai/flux/schnell", ok: () => !!env.FAL_KEY, licence: "per fal.ai / model licence (FLUX.1 [schnell]: Apache-2.0)", run: falImage },
    { id: "replicate", model: env.REPLICATE_IMAGE_MODEL || "black-forest-labs/flux-schnell", ok: () => !!env.REPLICATE_API_TOKEN, licence: "per Replicate / model licence", run: replicateImage },
    { id: "comfyui", model: "local workflow", ok: () => !!(env.COMFY_URL && env.COMFY_WORKFLOW), licence: "your local models' licences", run: comfyImage },
    { id: "procedural", model: "mf-gradient-plate", ok: () => true, licence: "generated here, no restrictions", run: proceduralImage },
  ],
  video: [
    { id: "fal", model: env.FAL_VIDEO_MODEL || "fal-ai/ltx-video", ok: () => !!env.FAL_KEY, licence: "per fal.ai / model licence", run: falVideo },
    { id: "procedural", model: "mf-drift-plate", ok: () => true, licence: "generated here, no restrictions", run: proceduralVideo },
  ],
  voice: [
    { id: "eleven", model: env.ELEVENLABS_MODEL || "eleven_multilingual_v2", ok: () => !!env.ELEVENLABS_API_KEY, licence: "per ElevenLabs plan terms; clone only voices you have consent for", run: elevenVoice },
    { id: "piper", model: path.basename(env.PIPER_MODEL || "piper"), ok: () => !!(which("piper") && env.PIPER_MODEL), licence: "per the Piper voice model card", run: piperVoice },
    { id: "espeak", model: "espeak-ng", ok: () => !!(which("espeak-ng") || which("espeak")), licence: "GPL-3.0 tool; output unrestricted", run: espeakVoice },
  ],
  sfx: [
    { id: "eleven", model: "sound-generation", ok: () => !!env.ELEVENLABS_API_KEY, licence: "per ElevenLabs plan terms", run: elevenSfx },
    { id: "procedural", model: "mf-sfx-recipes", ok: () => true, licence: "generated here, no restrictions", run: proceduralSfx },
  ],
  music: [
    { id: "procedural", model: "mf-pad-bed", ok: () => true, licence: "generated here, no restrictions", run: proceduralMusic },
  ],
};

// ---------------------------------------------------------------- guardrails
const DENY = /\b(nude|naked|nsfw|porn|sexual|explicit|gore|beheading|child|minor|underage|swastika|deepfake)\b/i;
const LIKENESS = /\b(photo|portrait|picture|video|voice|face) of [A-Z][a-z]+ [A-Z][a-z]+|\bin the style of [A-Z][a-z]+ [A-Z][a-z]+|\b(logo|trademark) of\b/;
export function policy(prompt, { allowLikeness = false } = {}) {
  if (DENY.test(prompt)) return { ok: false, reason: "prompt matches the content policy denylist (sexual, minors, gore, hate, deepfakes) — refused" };
  if (LIKENESS.test(prompt) && !allowLikeness) return { ok: false, reason: "prompt looks like a real person's likeness, a living artist's style or a brand mark — needs --i-have-rights (you confirm consent/licence)" };
  return { ok: true };
}
const SECRET_VARS = ["FAL_KEY", "REPLICATE_API_TOKEN", "ELEVENLABS_API_KEY"];
export const redact = (s) => { let out = String(s);
  for (const k of SECRET_VARS) { const v = env[k]; if (v && v.length >= 6) out = out.split(v).join("***"); for (const part of (v || "").split(":")) if (part.length >= 8) out = out.split(part).join("***"); }
  return out.replace(/(Key|Bearer|xi-api-key:?)\s+[\w.:-]{8,}/gi, "$1 ***").replace(/(FAL_KEY|API_TOKEN|API_KEY)=\S+/g, "$1=***"); };

// ---------------------------------------------------------------- main entry
export function available(kind) { return (PROVIDERS[kind] || []).filter((p) => p.ok()).map((p) => p.id); }
export async function generate(o) {
  const list = PROVIDERS[o.kind]; if (!list) throw new Error(`unknown kind ${o.kind} (image|video|voice|sfx|music)`);
  const pol = policy(o.prompt || "", { allowLikeness: o.allowLikeness }); if (!pol.ok) throw new Error(pol.reason);
  const want = list.filter((p) => p.ok() && (!o.provider || o.provider === "auto" || p.id === o.provider));
  if (!want.length) throw new Error(o.provider && o.provider !== "auto" ? `provider ${o.provider} is not configured for ${o.kind} (run assets.mjs doctor)` : o.kind === "voice" ? "no voice provider: install piper (+ PIPER_MODEL) or espeak-ng, or set ELEVENLABS_API_KEY" : `no provider available for ${o.kind}`);
  const p = want[0];
  const req = { kind: o.kind, provider: p.id, model: p.model, prompt: o.prompt || "", seed: o.seed ?? 7, width: o.width || 1920, height: o.height || 1080, duration: o.kind === "image" ? null : o.duration || 4, voice: o.voice || "" };
  const key = crypto.createHash("sha1").update(JSON.stringify(req)).digest("hex").slice(0, 16);
  const ext = { image: ".png", video: ".mp4", voice: ".wav", sfx: ".wav", music: ".wav" }[o.kind];
  const cacheDir = path.join(MF_HOME, "assets-cache"); fs.mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, key + ext), cost = COST[`${p.id}:${o.kind}`] ?? COST[`${p.id}:*`] ?? 0;
  if (o.dryRun) return { dryRun: true, provider: p.id, model: p.model, costEstimate: cost, cacheHit: fs.existsSync(cached) };
  let hit = fs.existsSync(cached) && fs.statSync(cached).size >= 64;
  if (!hit) {
    if (o.maxCost != null && cost > o.maxCost) throw new Error(`estimated cost $${cost} exceeds --max-cost $${o.maxCost} (use the procedural provider or raise the cap)`);
    const part = cached.replace(/(\.\w+)$/, ".part$1");   // write aside, validate, then publish: a half-finished download never becomes a cache hit
    fs.rmSync(part, { force: true });
    try { await p.run(req, part); } catch (e) { fs.rmSync(part, { force: true }); throw e; }
    if (!fs.existsSync(part) || fs.statSync(part).size < 64) { fs.rmSync(part, { force: true }); throw new Error(`${p.id} returned no usable ${o.kind}`); }
    fs.renameSync(part, cached);
  }
  const out = path.resolve(o.out); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(cached, out);
  const manifest = { file: path.basename(out), kind: o.kind, provider: p.id, model: p.model, prompt: req.prompt, seed: req.seed, size: `${req.width}x${req.height}`, duration: o.kind === "image" ? null : req.duration,
    licence: p.licence, aiGenerated: p.id !== "procedural", costEstimate: hit ? 0 : cost, cacheKey: key, created: new Date().toISOString() };
  appendManifest(path.dirname(out), manifest);
  return { file: out, provider: p.id, model: p.model, cached: hit, costEstimate: hit ? 0 : cost, manifest };
}
function appendManifest(dir, m) {   // assets.json: provenance of every generated asset in this folder (disclose AI use on delivery)
  const f = path.join(dir, "assets.json"); let all = []; try { all = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  all = all.filter((x) => x.file !== m.file); all.push(m); fs.writeFileSync(f, JSON.stringify(all, null, 1));
}

// ---------------------------------------------------------------- http helpers
async function http(url, { method = "POST", headers = {}, body, binary = false, timeout = 180000 } = {}) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), timeout);
  try { const r = await fetch(url, { method, headers: { ...(body && !(body instanceof Buffer) ? { "content-type": "application/json" } : {}), ...headers }, body: body && !(body instanceof Buffer) ? JSON.stringify(body) : body, signal: ctl.signal });
    if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}: ${redact((await r.text()).slice(0, 200))}`);
    return binary ? Buffer.from(await r.arrayBuffer()) : r.json(); }
  finally { clearTimeout(tm); }
}
const download = async (url, out) => fs.writeFileSync(out, await http(url, { method: "GET", binary: true }));
const toPng = (src, out) => { const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", src, out]); if (r.status !== 0) fs.copyFileSync(src, out); };

// ---------------------------------------------------------------- adapters
async function falImage(q, out) {
  const j = await http(`${BASE.fal}/${PROVIDERS.image[0].model}`, { headers: { Authorization: `Key ${env.FAL_KEY}` }, body: { prompt: q.prompt, image_size: { width: q.width, height: q.height }, seed: q.seed, num_images: 1, enable_safety_checker: true } });
  const url = j.images?.[0]?.url; if (!url) throw new Error("fal: no image in response"); const tmp = out + ".dl"; await download(url, tmp); toPng(tmp, out); fs.rmSync(tmp, { force: true });
}
async function replicateImage(q, out) {
  const ar = aspect(q.width, q.height);
  let j = await http(`${BASE.replicate}/v1/models/${PROVIDERS.image[1].model}/predictions`, { headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`, Prefer: "wait" }, body: { input: { prompt: q.prompt, aspect_ratio: ar, seed: q.seed, output_format: "png" } } });
  for (let i = 0; i < 60 && !["succeeded", "failed", "canceled"].includes(j.status); i++) { await new Promise((r) => setTimeout(r, 2000)); j = await http(j.urls.get, { method: "GET", headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` } }); }
  if (j.status !== "succeeded") throw new Error(`replicate: ${j.status} ${redact(j.error || "")}`);
  const url = Array.isArray(j.output) ? j.output[0] : j.output; const tmp = out + ".dl"; await download(url, tmp); toPng(tmp, out); fs.rmSync(tmp, { force: true });
}
async function comfyImage(q, out) {   // COMFY_WORKFLOW = API-format workflow JSON with {{prompt}}, {{seed}}, {{width}}, {{height}} placeholders
  const wf = JSON.parse(fs.readFileSync(env.COMFY_WORKFLOW, "utf8").replace(/"\{\{(seed|width|height)\}\}"/g, (m, k) => String(+q[k] || 0)).replace(/\{\{prompt\}\}/g, () => JSON.stringify(q.prompt).slice(1, -1)));
  const { prompt_id } = await http(`${BASE.comfy}/prompt`, { body: { prompt: wf } });
  for (let i = 0; i < 300; i++) { const h = await http(`${BASE.comfy}/history/${prompt_id}`, { method: "GET" }); const o = h[prompt_id]?.outputs;
    if (o) { const img = Object.values(o).flatMap((x) => x.images || [])[0]; if (img) { await download(`${BASE.comfy}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${img.type || "output"}`, out); return; } }
    await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error("comfyui: timed out");
}
async function falVideo(q, out) {
  const j = await http(`${BASE.fal}/${PROVIDERS.video[0].model}`, { headers: { Authorization: `Key ${env.FAL_KEY}` }, body: { prompt: q.prompt, seed: q.seed, aspect_ratio: aspect(q.width, q.height) } }, );
  const url = j.video?.url; if (!url) throw new Error("fal: no video in response"); await download(url, out);
}
async function elevenVoice(q, out) {
  const vid = q.voice || env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const mp3 = await http(`${BASE.eleven}/v1/text-to-speech/${vid}`, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY, accept: "audio/mpeg" }, body: { text: q.prompt, model_id: PROVIDERS.voice[0].model, seed: q.seed }, binary: true });
  fs.writeFileSync(out + ".mp3", mp3); wav(out + ".mp3", out); fs.rmSync(out + ".mp3", { force: true });
}
async function elevenSfx(q, out) {
  const mp3 = await http(`${BASE.eleven}/v1/sound-generation`, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY, accept: "audio/mpeg" }, body: { text: q.prompt, duration_seconds: Math.min(22, q.duration) }, binary: true });
  fs.writeFileSync(out + ".mp3", mp3); wav(out + ".mp3", out); fs.rmSync(out + ".mp3", { force: true });
}
function piperVoice(q, out) { const r = spawnSync("piper", ["--model", env.PIPER_MODEL, "--output_file", out], { input: q.prompt, encoding: "utf8" }); if (r.status !== 0) throw new Error("piper failed: " + r.stderr.slice(0, 200)); }
// espeak: text goes on stdin, so a line starting with "-" can never be read as an option
function espeakVoice(q, out) { const bin = which("espeak-ng") ? "espeak-ng" : "espeak"; const r = spawnSync(bin, ["-v", String(q.voice || "en-us").replace(/[^\w+-]/g, ""), "-s", "165", "-w", out, "--stdin"], { input: q.prompt, encoding: "utf8" }); if (r.status !== 0) throw new Error("espeak failed: " + r.stderr.slice(0, 200)); }

// ---------------------------------------------------------------- free deterministic fallbacks
function seeded(seed) { let s = (seed * 2654435761) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function paletteFrom(prompt, seed) {   // prompt words nudge the palette; same prompt + seed → same plate
  const r = seeded(seed + [...prompt].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)); const hue = (/ocean|sea|blue|night|space/i.test(prompt) ? 215 : /sun|fire|warm|desert|orange/i.test(prompt) ? 22 : /forest|green|nature/i.test(prompt) ? 140 : r() * 360);
  const hsl = (h, s, l) => { const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); return [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join(""); };
  return [hsl(hue, 0.55, 0.12), hsl((hue + 25) % 360, 0.6, 0.32), hsl((hue + 330) % 360, 0.5, 0.55), hsl(hue, 0.4, 0.06)];
}
function ff(args, what) { const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8" }); if (r.status !== 0) throw new Error(`${what}: ${r.stderr.slice(0, 200)}`); }
function proceduralImage(q, out) { const c = paletteFrom(q.prompt, q.seed);
  ff(["-f", "lavfi", "-i", `gradients=s=${q.width}x${q.height}:c0=0x${c[0]}:c1=0x${c[1]}:c2=0x${c[2]}:c3=0x${c[3]}:nb_colors=4:seed=${q.seed}:d=0.1`, "-vf", `noise=alls=6:allf=u:all_seed=${q.seed},gblur=sigma=${Math.round(Math.min(q.width, q.height) / 90)}`, "-frames:v", "1", out], "procedural image"); }
function proceduralVideo(q, out) { const c = paletteFrom(q.prompt, q.seed);
  ff(["-f", "lavfi", "-i", `gradients=s=${q.width}x${q.height}:r=30:d=${q.duration}:c0=0x${c[0]}:c1=0x${c[1]}:c2=0x${c[2]}:c3=0x${c[3]}:nb_colors=4:speed=0.008:seed=${q.seed}`, "-vf", `noise=alls=3:allf=t:all_seed=${q.seed},format=yuv420p`, "-c:v", "libx264", "-crf", "23", "-preset", "medium", out], "procedural video"); }
function proceduralSfx(q, out) {   // map the prompt to the nearest procedural recipe
  const k = /whoosh|swoosh|swipe|transition/i.test(q.prompt) ? "whoosh" : /hit|impact|boom|thud|punch/i.test(q.prompt) ? "hit" : /tick|click|tap|ui/i.test(q.prompt) ? "tick" : /rise|riser|build/i.test(q.prompt) ? "rise" : "swell";
  ff([...RECIPES[k], "-ar", "48000", out], "procedural sfx " + k); }
function proceduralMusic(q, out) {   // seeded minor-key pad bed: 4 chords, slow attack; a neutral bed for drafts, not a score
  const r = seeded(q.seed), roots = [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], base = 110 * Math.pow(2, Math.floor(r() * 5) / 12), bar = Math.max(1, q.duration / 4);
  const voice = (semi, i) => `0.08*sin(2*PI*${(base * Math.pow(2, semi / 12)).toFixed(3)}*t)`;
  const expr = roots.map((ch, i) => `between(t,${(i * bar).toFixed(3)},${((i + 1) * bar).toFixed(3)})*(${ch.map(voice).join("+")})`).join("+");
  ff(["-f", "lavfi", "-i", `aevalsrc='${expr}':s=48000:d=${q.duration}`, "-af", `afade=t=in:d=${Math.min(1.5, bar / 2)},afade=t=out:st=${Math.max(0, q.duration - 1.5)}:d=1.5,aecho=0.6:0.5:120:0.3,pan=stereo|c0=c0|c1=c0,volume=2`, "-ar", "48000", out], "procedural music"); }
function wav(src, out) { ff(["-i", src, "-ar", "48000", "-ac", "2", out], "decode audio"); }
function aspect(w, h) { const r = w / h; return r > 1.6 ? "16:9" : r > 1.2 ? "4:3" : r > 0.9 ? "1:1" : r > 0.7 ? "4:5" : "9:16"; }
