# QA: visual, technical, performance — and the repair loop

## Gates (in order; a later gate never excuses an earlier failure)

1. **Render gate** — `render.mjs --stills auto` exit 0 (no CRITICAL/HIGH in-page issues, no console/page errors, no failed requests, deterministic).
2. **Visual gate** — scorecard below on the contact sheet + any doubtful full frames + transition boundaries (`--stills t-0.1,t,t+0.1`).
3. **Delivery gate** — `inspect-output.mjs` PASS with expected width/height/fps/duration (+ audio).
4. **Performance gate** — interactive/hero only: `render.mjs --perf 6` within budget.

## Issue codes (render.mjs / inspect-output.mjs)

| Code | Sev | Usual cause → fix |
|---|---|---|
| PAGE_ERROR / CONSOLE_ERROR | crit | exception, shader compile, 404 → read message & location; fix source |
| REQUEST_FAILED / IMAGE_FAILED | crit | missing/misnamed asset, remote URL → vendor locally, fix path (inspect-project lists broken refs) |
| FONT_MISSING | high | family not declared/loaded, typo → @font-face + local file, or bundled MF fonts |
| TEXT_CLIPPED_BY_FRAME | high | overset type, nowrap, transform pushing off-frame → resize, wrap, reposition |
| TEXT_OUTSIDE_SAFE_ZONE | high (9:16) / med | copy under platform UI or outside title-safe → resize to the safe column (`safeZones` in compose; auto for portrait) |
| TEXT_OVERFLOWS_BOX | med | text wider than its box (incl. split `[data-mf-text]` blocks) → width/size/break |
| TYPE_ORPHAN | med | last word alone → manual `<br>`, `text-wrap: pretty/balance`, edit copy |
| TEXT_OVERLAP | high | two visible text blocks collide (captions over copy, label over title) → reposition per `.has-captions` / aspect; `data-mf-overlap-ok` only for designed overprints |
| LOW_CONTRAST | med/high | (`--score`) measured from pixels: < 4.5:1 body, < 3:1 large (≥ 32px or ≥ 24px bold) → darker mute, backing/scrim, larger size. Dimmed (<95% opacity) text is not scored |
| (debug) `--qa-overlay` | — | burns every finding (boxes + labels, incl. measured contrast) into stills/videos; `recipes.mjs debug <comp>` |
| DRIFT (golden.mjs) | — | frames differ from reviewed goldens → if intended, review and `--update`; otherwise bisect the change |
| NAN_VALUE | crit | division by zero / undefined in tween values → guard inputs |
| TIMELINE_NOT_WIRED | crit | timeline built but not passed to compose / not `.add()`ed |
| NONDETERMINISTIC_FRAME | high | Math.random/Date/rAF-accumulated state → MF.rng + t |
| WEBGL_CONTEXT_LOST | crit | GPU memory/too many contexts → one context, dispose, smaller targets |
| PAGE_SCROLLBARS | med | content larger than stage → overflow hidden on stage, fix layout |
| BLACK_FRAMES / BLANK_FRAMES | high/low | late init, missing first frame, fade-from-black longer than intended (edges only = low) |
| STATIC_OUTPUT | crit | seek not driving visuals (render(t) ignores t, timeline not wired) |
| LONG_FREEZE | med | unintended stall; designed holds are fine — confirm against beat plan |
| *_MISMATCH | high | wrong --fps/--duration/size, timeline shorter/longer than MotionSpec |

## Visual scorecard (finals; write it in `out/qa.md`)

```
Art Direction /10 · Composition /10 · Typography /10 · Motion & Timing /10 · Transitions /10
Visual Coherence /10 · Technical Quality /10 · Performance /10 · Delivery Validation /10 · Originality /10
```
Pass: ≥ 90 total, no creative category < 8, no open CRIT/HIGH. Score from rendered frames, never from code.
For every point withheld, name the frame/time and the fix. Then run the anti-mediocrity review (creative-direction.md).

What to look for in frames: focal point per beat · grid alignment · rag & breaks · contrast of type on ground ·
mask padding (descenders) · mid-transition frames that look broken (half-states are part of the film) · end hold
resolves · colour banding in dark gradients · aliasing on thin lines · safe zones (`?guides=1` preview or 9:16 rules).

## Performance budgets

| Mode | Budget |
|---|---|
| offline video | seek p95 < 120 ms (render throughput); determinism |
| social | as offline + readability at 25% scale + compression-safe (no hairlines, grain on gradients) |
| interactive web | frame p95 ≤ 16.7 ms on target GPU; 0 long tasks after load; heap stable over 6 s; ≤ 100 draw calls |
| hero | interactive budget + time-to-first-frame < 1.5 s, assets < 2 MB critical path |

Headless perf uses software GL: treat as relative. Rank findings CRITICAL / HIGH / MEDIUM / LOW with measured evidence.

## Repair loop (bounded)

```
gate fails → read the code + 1-line message (report JSON for detail, not the whole log)
→ root cause (failure-patterns.md if unclear) → cheapest capable fixer (you for 1-line fixes; mf-engineer for scoped code;
  escalate per agents.md) → minimal fix (no rewrites) → re-run ONLY the failing gate (stills at the failing t, or
  --from/--to) → pass? continue : attempt 2 → still failing? escalate tier once → still failing? stop, report precisely
  (what, why, what works instead).
```
After the fix: if a cheap check would have caught it earlier, add it (a `data-mf-text`, an `--stills` time, a QA rule) and
record a lesson (`lessons.mjs add … --verification`).
