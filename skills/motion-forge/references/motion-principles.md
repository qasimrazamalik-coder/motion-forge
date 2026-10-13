# Motion principles

## Timing responds to meaning

Duration grows with **distance travelled**, **mass/scale** and **importance**; shrinks with **frequency** (repeated
UI) and **surrounding motion**. Starting points (MF.tokens.dur):

| Move | Duration | Ease family |
|---|---|---|
| micro UI / tick / colour change | 0.12–0.25 s | `power2.out` |
| word / line reveal (mask) | 0.7–1.0 s | `expo.out` (enter) |
| element exit | 0.3–0.45 s | `power3.in` (exit — faster than entry) |
| reposition / transform on screen | 0.6–1.1 s | `power3.inOut` / `cubic(0.2,0,0,1)` (snap) |
| full-frame wipe / scene change | 0.8–1.2 s | `power3.inOut` |
| camera drift / push | whole shot | `cubic(0.37,0,0.63,1)`, `sine.inOut` |
| settle / landing with weight | 0.4–0.7 s | `back.out(1.2–1.5)` — never on large type |

Never one ease everywhere. Pair: fast-out-slow-in for entries, slow-out-fast-in for exits, symmetric for transforms.
`linear` only for constant-rate things (tickers, progress, rotation in loops, mechanical stepping).

## Principles that matter on screen

- **Anticipation** sparingly — a small counter-move (2–4% scale/offset, 80–150 ms) before big transforms.
- **Overshoot & settle** for objects with mass; none for text baselines (reads as wobble).
- **Follow-through / overlap** — children trail parents by 40–120 ms; nothing starts and stops in perfect unison unless it's a deliberate "snap".
- **Stagger** encodes reading order: word 50–90 ms, line 90–140 ms, items 100–160 ms; from `start` for reading, `center` for emanation, `edges` for convergence. Total stagger span should stay < the move's duration.
- **Masking** beats fading: reveal through a mask/clip so type arrives from its own baseline.
- **Holds** — a resolved frame needs ≥ 1.0–1.5 s to be read (≥ 0.4 s per 3 words on social). Stillness is a tool.
- **Contrast of speed** — the climax should be the fastest or the slowest moment; uniform tempo is flat.
- **Continuity** — exits lead into entries: shared direction, shared element, matched cut on shape or colour.

## Cinematic time design (L2+ write it in the MotionSpec)

```
TOTAL 14s
ACT 1 statement (0–4.4)   beats: labels 0.2 · headline 0.4–1.5 · underline 1.45 · HOLD 2.2–4.0
ACT 2 evidence (4.4–9.6)  beats: underline→divider 4.4 · columns 5.2 · counters 5.3–7.0 · HOLD 7.0–9.2
ACT 3 resolve (9.6–14)    beats: divider→field 9.6 · lockup 10.2 · tagline 10.8 · HOLD 11.4–14 (end card ≥ 2s)
CLIMAX: field opening (9.6)  CONTINUITY: signal bar
```

Rules: each act has one job; label every act/beat in the timeline (`addLabel`) so renders sample them and reviewers
can talk about them; overlaps of 0.2–0.4 s between outgoing and incoming beats; end on a hold.

## Transitions (grammar, not effects)

| Transition | Use when | Avoid |
|---|---|---|
| Hard cut on beat | energy, sports, fashion, contrast | without a rhythmic reason |
| Mask/wipe along an axis | Swiss/editorial; axis = layout grid line | diagonal wipes for no reason |
| Shared-element morph | continuity device, UI, brand films | morphing unrelated shapes |
| Push (both scenes move) | sequence/progress narratives | mismatched speeds |
| Match cut (shape/colour/position) | concept links between scenes | approximate matches (feel like mistakes) |
| Dissolve | time passing, softness, luxury | as the default glue |
| Zoom-through | only with a real spatial story | as a "cool" default |

## Motion tokens (MF.tokens)

```
dur:     instant .12  xs .2  s .35  m .6  l .95  xl 1.4  hold 1.2
ease:    enter expo.out · exit power3.in · move power3.inOut · settle back.out(1.25) · soft sine.inOut
         snap cubic(0.2,0,0,1) · drift cubic(0.37,0,0.63,1) · linear none
stagger: tight .03 · word .06 · line .11 · item .14
```

Override per project in one place (top of the composition). Tokens make variations consistent; they don't replace
judgement — retime anything that feels wrong in the contact sheet or draft.

## 2.5D / camera (DOM)

Parallax tiers: background 0.2×, mid 0.5×, foreground 1× of camera travel; perspective 1200–2000 px for subtle depth.
One camera move per shot, eased, motivated (reveal, follow, emphasise). Random drift = no.
