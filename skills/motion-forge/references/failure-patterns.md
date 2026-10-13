# Failure patterns (symptom → cause → fix)

Observed while building and testing this skill unless marked *(known)*. Validated lessons also live in the lesson store
(`lessons.mjs recall …`), which grows with use.

| Symptom | Root cause | Fix |
|---|---|---|
| Render says "setup/first frame failed: TypeError … at render" | exception in `setup()`/`render(t)` at t=0 | fix the line in the stack; render.mjs surfaces the rejected `__MF.ready` |
| Everything static in renders, preview looks fine | timeline not passed to `MF.compose({timeline})` | wire it (QA: `TIMELINE_NOT_WIRED`, inspect: `STATIC_OUTPUT`) |
| "MF: bad position 'act2-0.35'" | invalid position syntax | `"act2-=0.35"` (GSAP-compatible) |
| Glyphs swap/shift a few frames in | webfont loaded lazily after first frames | MF.compose preloads all declared faces; use `font-display: block`; never CDN fonts |
| `FONT_MISSING` but text renders in some font | family not declared or file 404 | local @font-face, check path; or bundled MF fonts |
| Scaled text looks soft or differs between renders of the same t | `translate3d` promotes a compositor layer; Chromium reuses raster at an old scale | 2D transforms (MF default); GSAP `force3D:false` (MF sets it) |
| Same t, slightly different screenshot pixels, identical DOM | Chromium glyph raster cache history (sub-perceptual AA) | not a defect; determinism check compares state, not screenshots |
| Split headline loses italic/colour, or "Faster ." gains a space | naive split flattened inline elements | MF.split keeps inline wrappers & glued punctuation |
| `<br>` design breaks vanish after split | split ignored BR | fixed in MF.split; QA exempts designed breaks from orphan checks |
| QA flags text clipped during a mask reveal | visible rect not intersected with mask | fixed: QA intersects with clipping ancestors |
| New element appears *over* an object it should emerge from behind | DOM order/z-index | explicit `z-index`; reveal from behind the occluder |
| Procedural lines fight the title | field has no type zone | in-shader scrim (attenuate lines under type), or aim camera away |
| 3D field fills the frame, no room for type; title on busy geometry | camera aimed at subject centre, too low | aim off-centre, raise/pull back, reserve sky for type |
| "Signal" row in 3D reads as scattered noise | per-instance random heights broke the line | uniform rule for the highlighted set so it reads as one shape |
| letter-spacing differs between MF and GSAP | GSAP treats bare numbers as px | pass `"0.12em"` strings |
| Counter labels flip before the matching visual change | counters derived from a different clock than the beat | derive both from the same label times |
| WebGL canvas blank in captures *(known)* | drawing buffer cleared after composite | `preserveDrawingBuffer: true`; draw inside `render(t)` |
| Banding in dark gradients after encode *(known)* | 8-bit H.264 quantisation | deterministic grain 1–2%, avoid huge smooth dark ramps |
| Text shimmer/flicker at 30fps *(known)* | sub-pixel motion on thin strokes | larger/heavier type for moving text, avoid slow sub-pixel drifts on hairlines |
| Video won't play on social *(known)* | odd dimensions, yuv444, high profile | even dims, yuv420p, `+faststart` (render.mjs defaults) |
| Playwright `waitForFunction` hangs/false on a rejected promise | predicate returned a Promise; Playwright awaited it | predicate returns a boolean; await `ready` separately |
| Portrait copy runs under the like/share rail; frame-edge check passes | only the frame edge was checked | `TEXT_OUTSIDE_SAFE_ZONE` (auto for 9:16); size display type to the safe column |
| `TEXT_OVERFLOWS_BOX` on words with a strike/underline child | scrollWidth counted decorative absolute children | QA compares the text range width to the box |
| Label/tag above a box vanishes once the box's wipe-out tween exists | `clip-path: inset(0%)` still clips overflow, and a `.to()` exit tween applies it from frame 0 | animate the exit on the box's parts (backing, accent), not on the wrapper that holds overflowing children |
| Contrast passes in CSS review, fails in `--score` | `color-mix()`/opacity/translucent backings change the rendered colour; small labels need 4.5:1, not 3:1 | trust the measured ratio; darken mutes (≈ #6B6862 on warm whites, ≈ #8E8A82 on near-black) |
| Text over a 3D/footage plate unreadable | busy pixels behind copy | reserve a clean band (move the subject: camera/object Y) + gradient scrim behind the type zone |
| QA flags hidden words as overlapping | descender padding of a split mask leaves a sliver | QA ignores slivers < 25% of the line height; if it still fires, the word really shows — check the mask height |

| Stray marks (a hook, a bar) where a hidden word used to be | descenders/ascenders overhang a tight line box (line-height < 1) and peek through the split mask's padding after a ±110% exit | MF engine now hides split units at ≥ 100%; with GSAP use ±130% or add `autoAlpha: 0` to the exit |
| Big numerals "overlap" the label above in QA, but not on screen | range boxes are the font content area (≈ 1.2 em); QA now collides line boxes | if it still fires, the line boxes really touch — add space |
| 3D frame differs only on its FIRST render after load (determinism FAIL) | lazy initialisation of a render target / post-processing program on first use | warm-up: render scene → target and the post pass once in setup |
| Post-processed (DOF) frame depends on seek order | a mesh at opacity 0 still writes depth (DOF reads it), or something calls `lookAt(camera)` before the camera is placed for this t | set `visible=false` instead of opacity 0; place the camera first in `render(t)` |
| Accumulated rotation/velocity in render() → nondeterministic | integrating state frame-by-frame (`rot += speed*dt`) | tween the ANGLE itself (piecewise ease with matched velocity) or bake a simulation with `MF.physics` and sample by t |
| Audio ducking "does nothing" after loudness normalisation | dynamic `loudnorm` re-raises the ducked music | two-pass: measure integrated LUFS, apply one static gain + limiter (sfx.mjs does this) |

