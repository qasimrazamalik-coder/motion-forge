# Research kit: render-in-the-loop verification for agentic motion graphics

The question: **does checking rendered frames inside an AI agent's loop make agent-made motion graphics measurably better?** And how far can automated checks stand in for human judgement?

## What is here

| Piece | Status | How to run |
|---|---|---|
| MotionBench, detector track: planted defects × all templates; recall and false-alarm rate of the QA | ✅ results in `motionbench-results.md` | `node skills/motion-forge/scripts/motionbench.mjs --out bench-results` |
| Ablation, agent track: same briefs with `baseline` (no QA), `qa` (QA + repair) and `full` (QA + repair + critic) | 🔜 harness ready, needs live Claude Code runs | `node skills/motion-forge/scripts/agent-evals.mjs --mode baseline` (repeat for `qa` and `full`) |
| Human preference study: pairwise A/B, randomised order and side | 🔜 needs raters | host `rating.html` with `pairs.json` and the videos on any static server; raters download a CSV |
| Analysis: win rates, Bradley–Terry with bootstrap CIs, Fleiss' κ, Spearman vs automated scores | ✅ tested on synthetic data | `node analyze.mjs ratings_*.csv --scores scores.json --out study-results.md` |
| Preprint draft | 🔜 detector results in; agent and human sections pending | `paper.md` |

## Protocol (agent + human tracks)

1. **Briefs.** Use the 6 in `skills/motion-forge/evals/evals.json`, then extend to about 30 across the categories: kinetic type, promo, data, UI, 3D, lower third.
2. **Runs.** Three seeds per brief × three modes. Keep every transcript and output (`evals/runs/`).
3. **Automated scores** per output:
   - QA issue counts by severity
   - minimum measured contrast
   - safe-zone and collision violations
   - determinism
   - tokens, cost and wall time, from the transcript
4. **Pairs.** For each brief, compare full vs baseline, qa vs baseline and full vs qa. Present them blind, with randomised side.
5. **Raters.** At least 5. Instruct them to judge craft (legibility, layout, timing, polish), not topic. Overlap at least 30% of pairs so κ can be computed.
6. **Analysis.**
   - Bradley–Terry strengths per mode with 95% bootstrap CIs.
   - Fleiss' κ for rater agreement.
   - Spearman ρ between the human strength per video and each automated score. This tests whether the cheap checks predict human preference.
7. **Report.** Effect sizes with CIs, and cost per point of preference gained (tokens, time). Report failures honestly.

## Threats to validity (write these into the paper)

- The benchmark's defects are synthetic. Real first-draft defects may differ in kind and frequency.
- Templates and QA come from the same authors, so the detectors may be tuned to the templates. Mitigate with briefs that start from `base`, and with third-party compositions.
- A single model family is used as the agent.
- Raters may recognise house style. Randomise and blind as above.
