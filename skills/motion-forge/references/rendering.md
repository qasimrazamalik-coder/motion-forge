# Rendering & delivery

## Render contract (every composition)

```js
const tl = MF.timeline();                     // MF engine, or a paused GSAP timeline if GSAP is loaded
MF.compose({
  width, height, fps, duration,               // duration optional if the timeline defines it
  setup() { /* split text, build tl, init GL — fonts are already loaded */ },
  timeline: tl,                               // REQUIRED if you built one (QA: TIMELINE_NOT_WIRED)
  render(t, info) { /* draw Canvas/WebGL from t only */ },
  labels: { act1: 0, act2: 4.4 },            // optional; timeline labels are added automatically
  stats: () => ({ drawCalls: … })             // optional, shows up in reports
});
```

- **Determinism**: every pixel is a function of `t`. Use `MF.rng(seed)` (never `Math.random`), frame-locked noise (`floor(t*fps)`), no `Date.now`, no state accumulated across frames (physics → precompute or integrate from 0 deterministically). `render.mjs --stills` re-seeks a mid frame and compares state (`NONDETERMINISTIC_FRAME`).
- Draw only inside `render(t)`; no private rAF loops. Preview mode loops automatically (space pause, ←/→ frame step, `?t=2.5` park, `?guides=1` safe zones).
- WebGL: `preserveDrawingBuffer: true`, clamp DPR ≤ 2, handle `webglcontextlost`.
- 2D transforms only unless you need real 3D (`translate3d` layer promotion makes scaled text blurry/history-dependent). Under GSAP the runtime sets `force3D: false`.
- Everything local: vendor libraries/fonts/images into the project. Remote URLs = `REMOTE_DEPENDENCY` risk and nondeterministic renders.

## Commands

| Goal | Command |
|---|---|
| representative frames + contact sheet + QA | `render.mjs comp.html --stills auto --outdir out/frames` (key times: open, 25/50/75%, every label and label+0.25s, end) |
| specific frames (transition boundaries) | `render.mjs comp.html --stills 4.2,4.4,4.6 --outdir out/t` |
| draft video | `render.mjs comp.html --out out/draft.mp4 --scale 0.5 --fast` |
| final | `render.mjs comp.html --out out/film.mp4 --formats mp4,webm,gif` |
| prores | `--formats prores` → ProRes 4444 `.mov` with alpha (editors: Resolve, Premiere, Final Cut). `?layer=<name>` renders one layer only (`__MF.meta.layers` lists them in paint order; `layers.mjs` renders all) |
| alpha | `--formats alpha` (VP9 WebM with alpha + PNG frames). render.mjs adds `?alpha=1`: the runtime clears html/body/#stage backgrounds and hides `.mf-plate` preview plates (see lower-thirds) |
| image sequence | `--formats png` |
| with audio | `--audio track.wav` (AAC 192k, `-shortest`) |
| partial | `--from 4 --to 8` |
| realtime perf | `render.mjs comp.html --perf 6 --outdir out/perf` |
| validate delivery | `inspect-output.mjs out/film.mp4 --width 1920 --height 1080 --fps 30 --duration 14 --sheet out/sheet.png` |

Exit codes: 0 pass · 2 HIGH/CRITICAL issues · 3 render error. Reports: `<out>.report.json`, `<outdir>/report.json`.

## Variants & aspect ratios

Size everything from a unit (`--u` = 1% of height, or of width for 9:16) so one composition re-frames. For multi-aspect
deliveries scaffold once, then **re-compose** per aspect (positions, line breaks, crops) — never letterbox or blindly
scale. Render each variant and run inspect-output on each.

| Platform | Frame | Safe area (keep text/logos inside) |
|---|---|---|
| Reels/TikTok/Shorts | 1080×1920 | top 14%, bottom 20%, right 16% reserved |
| Feed square / portrait | 1080×1080 / 1080×1350 | 5% margin; captions ≥ 42px |
| 16:9 broadcast/web | 1920×1080 | title-safe 10%, action-safe 5% |

Social: high contrast, flat colour, no hairlines < 3px (compression), readable at 25% scale, H.264 yuv420p, ≤ 60s.

## Codecs

MP4/H.264 yuv420p CRF 18 (universal) · WebM VP9 CRF 30 (web) · GIF only when asked (≤ 720w, ≤ 20fps, palettegen)
· alpha → VP9 yuva420p WebM + PNG frames (ProRes 4444: `--formats prores`). Dimensions must be even.

## Resolution claims

4K: render with `--scale 2` from a 1920×1080 composition (or author at 3840×2160), then inspect-output with
`--width 3840 --height 2160`. Only claim 4K when that passes. Preflight reports whether the browser can rasterize 4K.

## Audio sync

- `ffprobe` the track; duration must match the composition (inspect-output flags `AUDIO_DURATION_MISMATCH`).
- Beats: if the user gives BPM, beat = 60/BPM. Otherwise estimate onsets: `ffmpeg -i a.wav -af "silencedetect=n=-30dB:d=0.1" -f null -` (gaps) or ask for cue points. Hard-sync only the 3–6 moments that matter (logo hit, cut, climax); let the rest breathe on the grid loosely. Put sync points in the MotionSpec as labels.

## Speed

Draft at `--scale 0.5 --fast` (≈4× faster); stills for iteration; full PNG-capture renders only for finals. ~4 fps at
1080p PNG capture in software GL — a 15 s film takes ~2 min; tell the user before long renders.

## Multi-format, data, captions, music (v2)

- **Frame & aspect** — `const FR = MF.frame({ width, height, fps })` reads `?w=&h=&fps=`, sets `data-aspect` (landscape/portrait/square/tall) and `--mf-u` (1% of the short side), `--mf-safe-*` on the stage. Lay out per `[data-aspect=…]` with `--mf-u`; `variants.mjs` renders each aspect.
- **Data** — `await MF.data(defaults, "data.json")`; `?data=<json file>` overrides (batch writes one per row). Keep copy out of markup so batch and variants can swap it.
- **Captions** — `compose({ captions: () => ({ srt, style, position, size }) })`; styles clean / box (default, readable on any ground) / karaoke / pop. Stage gets `.has-captions` → move copy up out of the caption band. TEXT_OVERLAP catches collisions.
- **Beats** — `beats.mjs track --out beats.json`; `const B = MF.beats(json)`; `B.after(t)`, `B.nearest(t)`, `B.bar(n)`, `B.bpm`. Snap entrances to beats, keep holds musical (2 or 4 beats).
- **Parallel render** — `--workers N` splits frames into segments, encodes in parallel, concatenates losslessly. Auto up to 4 for ≥120 frames; gain scales with cores (≈13% measured on 2 cores).
- **Preview** — `preview.mjs <dir> [--port 5173]`: static server with live reload; the page has a scrubber, label ticks and keeps its playhead across reloads.
- **Motion blur** — `--motion-blur N` renders N sub-frames across a 180° shutter (`--shutter` degrees) and averages them. Use it on finals (N=4 is a good default; capture costs N× more). It is ignored for alpha deliveries.
- **Render cache** — a video render whose composition files, flags and audio are unchanged since the last PASS prints `CACHED` and exits. `--force` re-renders.
- **Sound** — `sfx.mjs` places procedural whoosh/hit/tick/rise/swell on the timeline labels (or your `cues.json`), ducks music under the voice-over and masters to −14 LUFS. Then `render.mjs --audio mix.wav`.
- **Footage** — `silence-cut.mjs`, `transcript-cut.mjs`, `reframe.mjs`, `overlay.mjs` work on real video with ffmpeg only. Pair `overlay.mjs` with a `--formats alpha` render of the lower-thirds template. Full social edits: `social-edit.mjs` (see `references/nle.md`).
