#!/usr/bin/env node
// AI assets for compositions and edits: images, video plates, voice-over, sound effects, music beds — through whichever
// provider is configured, with free deterministic fallbacks. Every asset is cached, costed and logged (assets.json).
//   assets.mjs doctor                                   which providers are ready (keys/binaries), nothing else
//   assets.mjs image "misty ocean at dawn, no text" --out assets/bg.png [--size 1920x1080] [--seed 7]
//   assets.mjs video "slow drifting nebula" --out assets/plate.mp4 [--duration 5]
//   assets.mjs voice "Did you know…" --out vo.wav [--voice <id|espeak voice>]
//   assets.mjs sfx "deep cinematic whoosh" --out whoosh.wav [--duration 2]
//   assets.mjs music "calm minor pad" --out bed.wav --duration 20
//   common: [--provider auto|fal|replicate|comfyui|eleven|piper|espeak|procedural] [--max-cost 0.50] [--dry-run] [--i-have-rights]
// Keys (env only, never pass them as flags): FAL_KEY · REPLICATE_API_TOKEN · ELEVENLABS_API_KEY · COMFY_URL + COMFY_WORKFLOW · PIPER_MODEL
// Guardrails: content denylist; likeness/style/brand prompts need --i-have-rights; cost cap; AI use recorded for disclosure.
import { parseArgs, line } from "./lib/common.mjs";
import { generate, PROVIDERS, available, COST } from "./lib/providers.mjs";

const a = parseArgs(), [kind, prompt] = a._;
if (!kind || kind === "doctor" || kind === "list") {
  for (const [k, list] of Object.entries(PROVIDERS)) line(`${k.padEnd(6)} ${list.map((p) => `${p.ok() ? "✓" : "·"} ${p.id}${COST[`${p.id}:${k}`] ? ` (~$${COST[`${p.id}:${k}`]})` : ""}`).join("   ")}`);
  line("✓ ready · not configured — set keys in your environment (see assets.mjs header). Procedural fallbacks always work.");
  process.exit(kind ? 0 : 1);
}
if (!PROVIDERS[kind] || !prompt || !a.out) { console.error(`usage: assets.mjs ${Object.keys(PROVIDERS).join("|")} "<prompt>" --out file [--provider auto] [--size WxH] [--duration s] [--seed n] [--max-cost $] [--dry-run]`); process.exit(1); }
const [width, height] = String(a.size || "1920x1080").split("x").map(Number);
try {
  const r = await generate({ kind, prompt: String(prompt), out: a.out, provider: a.provider, seed: a.seed != null ? +a.seed : 7, width, height, duration: +(a.duration || (kind === "music" ? 20 : 4)),
    voice: a.voice, maxCost: a["max-cost"] != null ? +a["max-cost"] : 1, dryRun: !!a["dry-run"], allowLikeness: !!a["i-have-rights"] });
  if (r.dryRun) line(`PLAN ${kind} via ${r.provider} (${r.model}) · ${r.cacheHit ? "cache hit, $0" : `~$${r.costEstimate}`} · nothing generated`);
  else line(`PASS ${kind} ${r.provider}/${r.model} → ${a.out} · ${r.cached ? "cached, $0" : `~$${r.costEstimate}`} · logged in assets.json${r.provider === "procedural" && available(kind).length === 1 ? " (fallback: no AI provider configured)" : ""}`);
} catch (e) { console.error(`FAIL ${kind}: ${e.message}`); process.exit(2); }
