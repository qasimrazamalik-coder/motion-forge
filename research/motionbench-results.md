# MotionBench — detector track (2026-10-13)

Templates: 12 clean + 84 mutated renders. **Overall recall 100.0%**, **clean false-alarm rate 0.0%** (HIGH/CRITICAL issues on unmodified templates).

| Planted defect | Expected code | Detected | Recall | Missed on |
|---|---|---|---|---|
| headline pushed into the platform-UI margin (inside the frame, outside the safe area) | TEXT_OUTSIDE_SAFE_ZONE / TEXT_CLIPPED_BY_FRAME | 12/12 | 100% | — |
| headline half off the right edge | TEXT_CLIPPED_BY_FRAME / TEXT_OFFSCREEN_VISIBLE | 12/12 | 100% | — |
| a second label set on top of the headline | TEXT_OVERLAP | 12/12 | 100% | — |
| headline recoloured to within 12% of its background | LOW_CONTRAST | 12/12 | 100% | — |
| headline set in a font that is not loaded | FONT_MISSING | 12/12 | 100% | — |
| a style that changes randomly on every render | NONDETERMINISTIC_FRAME | 12/12 | 100% | — |
| a broken <img> reference | IMAGE_FAILED / REQUEST_FAILED | 12/12 | 100% | — |

No false alarms on clean templates.
