# Creative direction

## MotionSpec (write to `motionspec.yaml` before building)

```yaml
purpose:            # what the piece must achieve (launch, explain, sell, brand recall)
audience:           # who watches, where (feed, keynote, site hero, ad)
message:            # ONE sentence the viewer should leave with
duration: 12        # seconds — derive from platform + message density (≈2.5 words/s readable on screen)
aspect_ratio: "16:9" # 16:9 | 9:16 | 1:1 | 4:5 | custom
resolution: [1920, 1080]
fps: 30             # 30 default; 24 for filmic; 60 only for UI/interactive or fast motion that strobes at 30
delivery: [mp4]     # mp4 | webm | gif | png-seq | alpha-webm | interactive-html
visual_direction:   # concept + style family + 3 adjectives
brand_constraints:  # colours, fonts, logo rules, words to avoid
assets: []          # paths, with inspect-project metadata
references: []      # paths/urls → CreativeFingerprint if present
scenes: []          # acts → shots → beats (see motion-principles)
typography:         # families, roles, scale
motion_language:    # easing families, stagger system, transition grammar
camera:             # 2.5D/3D only
lighting:           # 3D only
audio:              # file, bpm/beats, hard-sync points
performance_target: offline   # offline | social | interactive | hero
must_include: []
must_avoid: []
```

Defaults when unstated: 16:9 1920×1080@30, MP4 H.264 yuv420p, 8–15 s for promos, 5 s for logo stings, 6–10 s social.
Explicit user requirements always win over defaults and over this document.

## From brief to concept (do this, briefly, before any code)

1. **Subject's world** — materials, vernacular, artefacts of the subject (a finance product → ledgers, rules, columns, tabular numerals; a coffee brand → pours, rings, steam, paper). Distinctive choices come from here, not from "motion graphics" clichés.
2. **One idea** — a visual metaphor or device that carries the message (e.g. *the underline becomes the divider becomes the field*). Write it in one sentence. If you can't, you don't have a concept yet.
3. **One continuity device** — an element, shape, colour or axis that survives transitions and ties acts together.
4. **Restraint budget** — one accent colour, one or two type families, one signature move. Everything else supports.

## Style families (vocabularies, not templates)

| Family | Vocabulary | Watch out for |
|---|---|---|
| Swiss editorial | grid, hairline rules, flush-left type, numbered labels, one signal colour | becoming a static slide; let rules and masks move |
| Cinematic minimal | dark field, slow push, long holds, single light source, large negative space | slowness without tension; add a precise climax |
| Luxury | high-contrast serif, generous tracking on small caps, slow eased reveals, warm neutrals | gold gradients, lens flares |
| Neo-brutalist | raw grids, oversized grotesk, hard cuts, flat saturated colour | noise without hierarchy |
| Technical-industrial | monospaced/tabular labels, measurements, schematic lines, stepped (linear) motion | fake HUD clutter |
| Scientific / cartographic | contours, fields, annotations, restrained palette, data honesty | decorative "data" that means nothing |
| Organic procedural | noise fields, growth, soft physics, natural palettes | screensaver aesthetics; anchor with type/composition |
| Retro-futurist | period type, grain, scanline restraint, limited palette | pastiche — borrow principles, not artefacts |
| Broadcast / sports | strong bars, kinetic data, snappy easing, high-contrast team colours | clutter in safe areas |
| Fashion film | editorial crops, flash cuts, serif + grotesk contrast, stillness | random speed ramps |
| Premium product launch | object hero, controlled light, macro detail, measured reveals | spinning product on gradient |
| Data visualization | honest scales, staged build, annotation-led | animating chartjunk |
| UI choreography | real layouts, shared-element transitions, physical easing, 60fps | fake UI that no product has |

Mix at most two. Name the family in the MotionSpec so reviewers can judge against it.

## Colour

- Build palettes as **roles**: ground, ink, mute, signal (+1 optional). Signal is reserved for the single most important thing on screen.
- Check contrast of text vs ground (≥4.5:1 for body, ≥3:1 for display ≥48px). Social: test at 25% scale.
- Avoid defaulting to: neon gradient on black, purple-blue SaaS gradients, glassmorphism stacks.
- Gradients must model light or material, not decorate. Add 1–2% deterministic grain to large flat dark fields to fight banding in H.264.

## Composition

- Work on an explicit grid (margins ≈ 7–9% of height; 12-col or modular). Align type and marks to it; break it once, on purpose.
- One focal point per beat. Control attention with scale, contrast, isolation and motion — in that order.
- Reserve negative space for type *before* placing imagery or 3D (aim cameras/fields away from type zones; add scrims inside shaders rather than boxes behind text).
- Diagonals and asymmetry for energy; centred symmetry for ceremony (logos, end cards).
- Every shot must "resolve": a frame you could print. Check the hold frames, not just the motion.

## Anti-generic checklist (reject on sight)

meaningless particles · neon glow blobs · random floating 3D primitives · glassmorphism stacks · arbitrary parallax ·
tutorial-default Three.js (spinning cube/torus, OrbitControls look) · stock SaaS bounce · generic zoom/fade between
everything · random per-letter scatter · effects without a concept · centred-everything layouts · lorem copy.

## Anti-mediocrity review (before approving finals)

Answer in writing, briefly. Any "no" → fix before delivery.
1. Is the concept legible without the voice-over? 2. Could this be mistaken for a template? 3. Is anything moving without
purpose? 4. Is the typography art-directed (scale contrast, rag, tracking, alignment) rather than set? 5. Is attention
controlled in every beat? 6. Are transitions conceptually connected (continuity device)? 7. Is pacing deliberate — are
there holds? 8. Enough contrast (value, scale, speed)? 9. Does every major shot resolve? 10. Over-designed anywhere?
11. Under-designed anywhere? 12. Would a senior motion designer spot a shortcut?
