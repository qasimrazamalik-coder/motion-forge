# Typography

## Fonts

- Bundled (OFL-1.1, safe to embed, see `assets/fonts/FONTS.md`): **MF Display** (Inter Display 300/500/700), **MF Text** (Inter 400), **MF Serif** (Lora variable 400–700, roman + italic — animatable via `font-variation-settings: "wght" var(--wght)`).
- Brand fonts from the project: verify the licence allows embedding/video use before using. Never pull fonts from a CDN at render time — vendor files locally.
- `MF.compose` loads **every** declared `@font-face` before frame 0 (lazy loading swaps glyphs mid-render). QA flags `FONT_MISSING` when a used family never loaded.
- Max two families. Contrast via weight/size/style, not via more fonts.

## Scale & set (1u = 1% of frame height; 16:9 at 1080p → 1u = 10.8px)

| Role | Size | Tracking | Leading |
|---|---|---|---|
| Display / hero | 11–16u | −0.035 to −0.055em | 0.9–0.98 |
| Headline | 6–9u | −0.02 to −0.035em | 1.0–1.05 |
| Body / caption | 2.2–2.6u (≥ 24px at 1080p) | 0 | 1.3–1.4 |
| Labels / small caps | 1.6–1.9u, uppercase | +0.08 to +0.14em | — |
| Numbers | `font-feature-settings: "tnum" 1` for anything that counts | | |

Social 9:16 sizes from width: display ≥ 18% of width, captions ≥ 4.2% of width; nothing smaller than ~42px at 1080w.

## Line breaking

- Set breaks by hand for display type (`<br>` — MF.split keeps them; QA treats them as designed).
- Body: `text-wrap: pretty` (paragraphs) or `balance` (2–3 line captions). QA flags `TYPE_ORPHAN` on `[data-mf-text]` blocks.
- Put `data-mf-text` on every text block you want checked for orphans; overflow/clipping is checked on all text.

## Animating text semantically

- Unit = meaning: words for statements, lines for paragraphs, chars only for short marks/wordmarks or when the concept is about letters.
- `MF.split(el, { by: "words" | "lines" | "chars", mask: true })` wraps units in overflow masks with ascender/descender padding and **preserves inline styling** (`<em>`, `<b>`, spans) and glued punctuation (`Faster<em>.</em>` stays one word).
- Reveal from the baseline: `yPercent: 105–110 → 0`, `expo.out`, stagger by reading order. Exit upward and faster.
- Variable weight/tracking moves (`--wght`, `letterSpacing: "0.12em" → "-0.04em"`) are signature moves — use once.
- Reading speed: the viewer needs ≈ 0.3 s per word after a line lands, minimum 1 s per line, before it moves again.

## Prevent

clipped glyphs (mask padding, check descenders on q/p/g/y) · orphans · layout shift when fonts load · baseline jumps
between split and unsplit states · low contrast on busy backgrounds (scrim) · text under platform UI (safe zones) ·
more than two families · centred long paragraphs.
