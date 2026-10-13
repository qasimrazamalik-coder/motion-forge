# Render-in-the-Loop Verification for Agentic Motion Graphics

*Draft. Section 4 contains measured results; Sections 5–6 describe experiments whose infrastructure exists but which have not been run yet. Do not cite numbers that are not in Section 4.*

## Abstract

Language-model agents can now write motion graphics as code (HTML/CSS, WebGL, Three.js), but they write them blind: the agent never sees the frames it produces. We describe *motion-forge*, an agent skill that closes this loop. Every composition is a deterministic function of time. It is rendered headlessly, and each frame is checked by in-page detectors: safe areas, clipping, text collisions, missing fonts, pixel-measured contrast, failed assets and seek-order determinism. The detectors' findings drive a repair loop. We introduce **MotionBench**, a planted-defect benchmark for these detectors. On the detector track (7 defect classes × 11 compositions, 77 mutated and 11 clean renders) the final detectors reach 100% recall with no high-severity false alarms on clean compositions. A pilot run of the same benchmark exposed a real gap: text in the outer 5% of landscape frames was never checked. The benchmark caught it before the fix. We release the benchmark, the ablation harness and a pairwise human-rating kit, and outline the agent-level and human studies that remain.

## 1. Introduction

- Agent-authored video is growing fast (Remotion, HyperFrames and similar), but quality control is left to the human.
- Our claim: verification that *looks at rendered frames* is a cheap, model-agnostic way to raise the floor of agent output. It must be deterministic and measured from pixels where perception matters.
- Contributions:
  1. A render contract (visuals = f(t)) that makes frame-level checks and regression possible.
  2. A detector suite with a measured-contrast scorer.
  3. MotionBench, with its detector-track results.
  4. An ablation and human-study protocol with tooling.

## 2. System

- **Render contract.** `window.__MF.seek(t)` is pure. Determinism is verified by re-seeking a mid frame after visiting others and comparing the full DOM/canvas state digest.
- **Detectors (in-page).**
  - Visible text rect ∩ clipping ancestors, including `clip-path: inset()` reveals → frame clipping, platform safe areas (9:16 UI zones; 5% title-safe elsewhere), overflow, orphans.
  - Line-box collision between independent text blocks, with occlusion by opaque layers above.
  - Font availability through FontFaceSet.
  - NaN tween values, unwired timelines, failed images and requests, WebGL context loss.
- **Measured contrast.** For each settled text block (opacity ≥ 0.95), sample the rendered frame under the text box, estimate the background as the pixels least like the text colour, mix the text colour by its effective opacity, and compute the WCAG ratio (4.5:1 body, 3:1 large).
- **Loop.** Stills, then detectors, then a contact sheet for a (cheap → strong) visual critic, then repair, then re-check, then final render, then delivery inspection (dimensions, fps, duration, black or static frames).

## 3. MotionBench

- **Detector track.** For each composition we render a clean version and one version per planted defect. Defects are injected after the composition builds its DOM, through a wrapper on `MF.compose`, so the source stays untouched. The defect classes are:
  - safe-area breach
  - half off-frame
  - overlapping label
  - near-background text colour
  - unloaded font
  - per-render random style
  - broken image
- **Metrics.** Recall per class (a detection is any expected issue code). False-alarm rate = clean compositions with any HIGH/CRITICAL issue.
- **Agent track (planned).** About 30 briefs × 3 seeds × modes {baseline, qa, full}. Automated scores, plus cost (tokens, wall time) and human pairwise preference.

## 4. Results (detector track, measured)

11 compositions, 77 mutated + 11 clean renders (Linux, Playwright 1.56 headless Chromium, SwiftShader WebGL).

| Planted defect | Detected | Recall |
|---|---|---|
| Headline in the safe-area margin | 11/11 | 100% |
| Headline half off the right edge | 11/11 | 100% |
| Second label over the headline | 11/11 | 100% |
| Headline recoloured to within 12% of its background | 11/11 | 100% |
| Font not loaded | 11/11 | 100% |
| Random style on every render | 11/11 | 100% |
| Broken image reference | 11/11 | 100% |

High-severity false alarms on clean compositions: 0/11. A re-run on 2026-10-13 with a twelfth template (social captions) detected 84/84 planted defects with 0/12 false alarms (`motionbench-results.md`). Medium-severity notes appeared on two clean compositions: text reaching into the 5% title-safe margin, one case mid-entrance and one from a serif descender. The templates were adjusted afterwards.

**Development history (honest accounting).** The first pilot (2 compositions) scored 85.7% recall: the safe-area defect was missed on every landscape composition because title-safe was only enforced for portrait. Two benchmark bugs were then fixed in the mutation code, not in the detectors:
- Moving text inside its own reveal mask hid it instead of displacing it. The fix moves the top-level layer.
- The off-frame displacement was measured on the block box, not the text box.

The final numbers are therefore in-distribution: the detectors and mutations were developed by the same authors on the same compositions. Section 7 discusses this threat.

## 5. Agent-level ablation (protocol; not yet run)

Run `agent-evals.mjs --mode baseline|qa|full` over the briefs, with 3 seeds each. Report:
- automated scores
- issue counts at delivery
- tokens and time per run
- pairwise human preference (Section 6)

Hypotheses:
- H1: qa > baseline on human preference.
- H2: full ≥ qa at higher cost.
- H3: automated scores rank-correlate with human strength (ρ > 0.5).

## 6. Human study (protocol; not yet run)

- Blind pairwise A/B with randomised order and side (`rating.html`).
- At least 5 raters, with at least 30% overlap.
- Analysis with `analyze.mjs`: Bradley–Terry with bootstrap CIs, Fleiss' κ, Spearman ρ against automated scores.

## 7. Limitations and threats to validity

- The defects are synthetic and in-distribution.
- There is a single agent family.
- Contrast estimation assumes a roughly uniform local background. It can under-report over busy footage, where a backing or scrim is the right fix anyway.
- WebGL runs on SwiftShader: correct, but slow.
- Goldens are Chromium-version sensitive.
- Human judgement of "craft" is subjective; agreement statistics are reported for that reason.

## 8. Reproducibility

Everything runs offline with free tools (Node, Playwright/Chromium, ffmpeg).

```
node skills/motion-forge/scripts/motionbench.mjs --out bench-results
node skills/motion-forge/scripts/run-evals.mjs
```
