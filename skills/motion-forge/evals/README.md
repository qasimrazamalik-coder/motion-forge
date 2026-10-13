# motion-forge evals

Two layers:

1. **Deterministic harness** — `node scripts/run-evals.mjs` (quick: half-scale draft videos) or `--full`.
   Scaffolds every template and renders the fixtures, then checks: stills render + in-page QA, determinism, contact
   sheet, video encode, delivery metadata (dims/fps/duration/frame count, black/blank/static), seek cost, realtime perf,
   and that QA **detects** each planted defect in the recovery fixture and goes green on the reference repair.
   Results: `<work>/results.json` and `~/.claude/motion-forge/evals-latest.json`. Three.js case is skipped (not failed)
   when `three` isn't installed locally.

2. **Agent-level briefs** — `evals.json`: six briefs (A–F) with must / must-not / budgets (subagent count, render count).
   Run each in a fresh session and grade from the transcript + outputs. Token use and agent spawning are graded from the
   session transcript; the harness cannot measure them.

| Case | Covers |
|---|---|
| A / A2 | kinetic typography 16:9 and 9:16 |
| B | logo/mark reveal on the GSAP-compatible engine (GSAP if vendored) |
| C / C3 | raw WebGL2 shader scene / Three.js scene |
| D | 14 s three-act brand film with a continuity device (fixture) |
| E | realtime playback performance |
| F | recovery: crash → unwired timeline → NaN/clipping → reference repair |

## Eval F defects (graders only)

1. `window.__dbg.frames++` — undefined object crashes `render(t)` on frame 0.
2. `"Brandon Grotesque"` — font never declared/loaded (FONT_MISSING).
3. `assets/product-shot.png` — missing file (REQUEST_FAILED, IMAGE_FAILED).
4. `1920 / items.length` with an empty list → Infinity × 0 → NaN tween (NAN_VALUE, visible once wired).
5. `Math.random()` jitter in `render(t)` (NONDETERMINISTIC_FRAME).
6. `timeline: tl` commented out (TIMELINE_NOT_WIRED; renders would be static).
7. 15u `nowrap` headline wider than the frame (TEXT_CLIPPED_BY_FRAME).

Reference repair: `fixtures/recovery-fixed/index.html` (each fix commented).

## v2 cases (scripts/run-evals.mjs)

- **G1–G5** — template library: promo, bar-race, ui-walkthrough, whatif-3d (needs three), lower-thirds (3 styles + alpha WebM whose corner pixel must be transparent). Every stills pass runs with `--score`.
- **H** — pipelines: variants (4 aspects), CSV batch (2 rows × 2 aspects), beats on a synthetic 120 BPM click (±2%), brand check/apply + branded render.
- **I** — goldens for kinetic-type must match; a planted accent-colour change must be DRIFT; planted overlapping label → TEXT_OVERLAP; planted faint label → LOW_CONTRAST.
- **Agent level** — `scripts/agent-evals.mjs` runs each brief in `evals.json` headless and auto-grades artifacts, inspect-output, re-QA of the left-behind composition, and subagent/render budgets; taste items stay manual.
