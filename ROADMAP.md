# motion-forge roadmap

Positioning: don't compete with Remotion / HyperFrames as a general video framework. Win on **verifiable quality**,
a **viral content engine**, and **research**. Effort and impact figures are estimates.

Status: ✅ done · 🔜 built, waiting on something outside this repo (live runs, raters) · ⬜ planned

## Done (v0.2)

- ✅ Cross-platform paths and Windows installer (Windows/macOS still untested)
- ✅ Plugin + marketplace packaging, GitHub Actions CI, README with demo GIFs, MIT licence
- ✅ Parallel rendering (`--workers`), live preview server with scrubber
- ✅ Golden-frame regression, pixel-measured contrast scoring, text-collision QA
- ✅ Burned-in captions (clean · box · karaoke · pop), brand kit, one brief → all aspect ratios, CSV batch, beat sync
- ✅ Templates: promo, bar-race, ui-walkthrough, lower-thirds (alpha), whatif-3d
- ✅ Agent-level eval runner (headless sessions; not yet run live)
- ✅ Token efficiency v1: compact script output, quiet progress when piped, `--thumb`, haiku `mf-runner` for mechanical runs, delegation rules

## 1. Quality: top of the league

| # | Item | Effort | Why |
|---|---|---|---|
| 1.1 | ✅ Real motion blur: average 8–16 sub-frames per frame (`--motion-blur 8`) | 1 day | Biggest single jump in "pro" feel; easy because rendering is deterministic |
| 1.2 | ✅ Camera language for 3D: depth of field + rack focus, seeded handheld shake (`MF.shake`); dolly/orbit presets ⬜ | 3–4 days | Cinematic depth in what-if and product scenes |
| 1.3 | ✅ Sound design: procedural SFX on every label, music ducked under voice-over, −14 LUFS (`sfx.mjs`) | 2–3 days | Sound is half of perceived quality |
| 1.4 | ✅ Baked physics (`MF.physics`, no dependency): what-if debris | 3–5 days | Falling, impacts, tides — still deterministic |
| 1.5 | ✅ After Effects bridge (`export-ae.mjs`; not yet run in AE) · ⬜ Lottie export | 1–2 weeks | Pro designers adopt tools that fit their pipeline |
| 1.6 | ✅ Brand kit drives shader/3D colours (`MF.cssColor`) | 1 day | Closes a known gap |

## 2. Virality

| # | Item | Effort | Why |
|---|---|---|---|
| 2.1 | ✅ "Watch it fix itself" debug render: QA boxes burned into a video, before/after side by side (`--qa-overlay`) | 1 day | The launch clip; nobody else can show this |
| 2.2 | ✅ One-command what-if reel (`whatif.mjs`, 4 scenes; voice-over path untested — no TTS here): script → 3D scene → free local voiceover (Kokoro/Piper) → word-timed captions → beat-synced music → 9:16 MP4 | 3–5 days | Content engine for Instagram; each reel advertises the repo |
| 2.3 | ✅ "Pick your favourite" (`directions.mjs`): 3 art directions as stills in ~1 min, render the chosen one | 2 days | The addictive loop |
| 2.4 | ✅ Template gallery page + CONTRIBUTING.md (weekly feature = your upkeep) | 2 days + upkeep | Contributors bring their audiences |
| 2.5 | ✅ Comparison clip (draft → QA → repaired) for the README and demos | 1 day | Shows the core idea in seconds |

## 3. Research (Master's in AI)

| # | Item | Effort | Output |
|---|---|---|---|
| 3.1 | ✅ MotionBench detector track (`motionbench.mjs`: 7 planted defects × 11 templates) · ⬜ 100-brief agent track | 2–3 weeks | Public benchmark repo |
| 3.2 | 🔜 Ablation (agent alone vs. render-in-the-loop QA vs. QA + critic): harness ready in `agent-evals.mjs --mode baseline\|qa\|full`; needs live runs | 1–2 weeks of runs | Core result |
| 3.3 | 🔜 Human preference study + automated-score ↔ human agreement: rating page and analysis ready in `research/`; needs raters | 1–2 weeks | Open question in the field |
| 3.4 | 🔜 Preprint "Render-in-the-loop verification for agentic motion graphics": draft in `research/paper.md` with the detector results; ablation and study sections fill in after 3.2–3.3 | 1–2 weeks | Citation + applications |
| 3.5 | ⬜ Learned legibility/aesthetic scorer (after 3.3 data exists) trained on rendered frames + ratings | 2–3 weeks | Better automatic critic |

## 4. Video editing (real footage)

| # | Item | Effort |
|---|---|---|
| 4.1 | ✅ Transcript cutting: whisper.cpp → edit the text → the video cuts to match | 3–4 days |
| 4.2 | ✅ Silence and filler-word removal | 1–2 days |
| 4.3 | ✅ Smart reframe 16:9 → 9:16 (motion/detail tracking, zero-lag smoothing; no MediaPipe needed) | 3–4 days |
| 4.4 | ✅ Alpha overlays onto footage (`overlay.mjs`) · ⬜ automatic b-roll choice from the transcript | 3–5 days |

## 5. Productivity

| # | Item | Effort |
|---|---|---|
| 5.1 | ✅ Timing editor in the preview: drag keyframes/labels, written back to source | 1 week |
| 5.2 | ✅ Draft-quality preview (`?q=draft`) (low-res live scrub while the agent edits) | 2–3 days |
| 5.3 | ✅ Render cache (whole output; per-segment ⬜) | 2–3 days |

## 6. Token efficiency and subagents

Done (v1):
- ✅ Render output compact: issues first, one line per output group, ids collapsed; no progress spam when piped
- ✅ `--thumb` for cheaper contact sheets (image tokens ≈ pixels / 750)
- ✅ `mf-runner` (haiku): runs mechanical command chains and exact edits, returns a ≤150-word verdict
- ✅ Delegation table: when a subagent pays for its ~5–15k overhead and when to do it yourself

Next:
- ✅ 6.1 `mf-runner` recipes (`recipes.mjs`): named chains (`stills+score`, `variants-check`, `final-delivery`) so the Director sends one word, not a command list
- ✅ 6.2 Section-level reference loading (`refs.mjs`): one file per topic section with a 1-line index, so loads are ~200–400 tokens instead of ~1.5k
- ✅ 6.3 `report.mjs <report.json> --codes`: a 1-line digest of any report, instead of inline node one-liners
- ✅ 6.4 Budget telemetry in agent-evals (`--budget-tokens`; untested live): tokens per eval, subagent count, image reads; regressions fail CI
- ✅ 6.5 Haiku-first critique (`mf-critic-lite`): a cheap pass flags obvious defects; the sonnet/opus critic runs only on frames still in doubt
- ✅ 6.6 Prompt-caching rules in the agent guide: keep SKILL.md and agent prompts stable, with dynamic content last, so repeated sessions hit the cache

## 7. Editing apps (DaVinci Resolve · Premiere Pro · CapCut) + social-style editing

Rule: **files first, scripts second, keyboard third, mouse clicks last.** Every screenshot costs about 1–2k tokens and 2–5 s; a timeline file costs about 1k tokens once. Nothing in this section has been run inside the real apps yet (none installed here): every file is validated for structure and frame-exact timing by `nle-check.mjs`, and the picture is rebuilt from the timeline and compared with the full render.

| # | Item | Status |
|---|---|---|
| 7.1 | Separate alpha layers per element in paint order (`layers.mjs`, ProRes 4444 or PNG; `?layer=` in the runtime; `--formats prores`) | ✅ recombines to SSIM 0.997–0.9997 vs the full render |
| 7.2 | `export-nle.mjs`: one timeline model → OTIO + FCPXML 1.8 (Resolve) + FCP7 XML (Premiere, also Resolve); layers on tracks, labels → markers, audio stems on audio tracks, SRT | ✅ structure + timing verified; 🔜 import in each app |
| 7.3 | Resolve Lua for the Free console (import, markers, render queue) + Python for Studio; Premiere ExtendScript importer | ✅ written, Python compiles; 🔜 run in the apps |
| 7.4 | Computer-use playbook for all three apps (`references/nle.md`): action budget, orient once + zoomed regions, cached UI map per app/version/screen, shortcuts read from the app, verify by the exported file, safety stops | ✅ written; 🔜 measured on a real machine |
| 7.5 | Social edit engine (`social-edit.mjs`): hook cold open, jump cuts (pauses + fillers), punch-ins (alternating, emphasis, on beats), whoosh into the body, progress bar, loop ending, voice cleanup, ducked music, −14 LUFS, EDL → NLEs · ⬜ speed ramps | ✅ on synthetic speech; 🔜 real footage |
| 7.6 | Social captions: `highlight` · `word` · karaoke · pop, words.json auto-chunking, per-platform safe zones (approximate), emoji fallback fonts, burned and as SRT (`captions-social` template) | ✅ |
| 7.7 | Hook lab (`hooklab.mjs`): score every line, 3 cold-open variants with agent-written titles, pick sheet | ✅ heuristic scorer; 🔜 validate against real retention data |
| 7.8 | Free replacements for Resolve Studio tools: `reframe.mjs` (Smart Reframe), whisper.cpp words → captions (auto subtitles), voice cleanup (Voice Isolation, much weaker) | ✅ (whisper.cpp path untested here) |
| 7.9 | Fusion `.setting` titles / Premiere MOGRTs so text stays editable natively | ⬜ can't be validated without the apps |
| 7.10 | Agents: `mf-editor` (sonnet plans the edit), `mf-nle-operator` (computer use, UI-only steps, action budget), mf-runner, mf-critic-lite | ✅ |
| 7.11 | CapCut: no timeline import exists → pack of pre-cut, pre-zoomed clips in order + key-colour twins of alpha layers + `layout.json` + README for a human or the operator | ✅ clips frame-checked |
| 7.12 | Premiere: Essential Graphics / captions styling via UXP when ExtendScript is retired | ⬜ |

## 8. v0.5 — speed, finishing, AI assets, coaching

| # | Item | Status |
|---|---|---|
| 8.1 | Render speed: skip frames whose document state is unchanged + CDP capture (4.7× on a caption overlay, 1.6× on kinetic type, bit-identical output) | ✅ measured |
| 8.2 | Hardware H.264 (`--encoder auto`: NVENC · QuickSync · VideoToolbox, falls back to x264) | ✅ fallback tested; 🔜 real GPUs |
| 8.3 | VFX finishing looks (`vfx.mjs`): film · cinematic · dream · vhs · glitch · punchy · clean, seeded and deterministic | ✅ |
| 8.4 | AI asset providers (`assets.mjs`): fal · Replicate · ElevenLabs · ComfyUI · Piper · espeak, procedural fallbacks, cache, cost cap, content policy, provenance | ✅ fallbacks + mocked APIs; 🔜 real keys |
| 8.5 | `audit.mjs` (compositions + any video) and `prompt-coach.mjs` (brief scoring + sharper prompts) | ✅ |
| 8.6 | Agents: mf-prompt-coach, mf-auditor, mf-asset-producer, mf-sound-designer (14 total) | ✅ |
| 8.7 | Guardrails: secret scan in CI, SECURITY.md, `.env.example`, redaction of keys in errors | ✅ |
| 8.8 | Per-segment render cache (re-render only changed seconds) | ⬜ |
| 8.9 | Learned craft judge from human ratings (needs 3.3 data) | ⬜ |

## Order of work

Done: 1.1, 2.1–2.5, 3.1, 4.x, 5.x, 6.x, 7.1–7.8, 7.10–7.11, 8.1–8.7. Next: import tests in Resolve / Premiere / CapCut on a real machine (fix what breaks) → social edit on real footage + whisper.cpp → 3.2–3.4 live studies → speed ramps → 7.9 Fusion / MOGRT templates
