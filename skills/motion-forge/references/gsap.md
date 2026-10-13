# GSAP & timelines

## Engine choice

`MF.timeline()` returns a **paused GSAP timeline** when `window.gsap` is loaded, otherwise the built-in MF engine with
the same core API. Verified parity: the `gsap` and `kinetic-type` templates render matching frames under MF and GSAP 3.15.

- Use GSAP when the project already depends on it, the user asks, or you need its plugins (MotionPath, SplitText, Flip, MorphSVG, DrawSVG, ScrollTrigger for interactive work).
- Licence: GSAP (incl. former Club plugins) ships under GreenSock's no-charge *Standard License* — free for most commercial use but **not OSI open source**; mention it when delivering to clients with licence policies. Vendor it locally (`scaffold.mjs` copies `dist/gsap.min.js` from a local `npm i gsap`). Never load from a CDN at render time.
- If installed skills cover GSAP in depth (preflight lists them), consult them for plugin specifics instead of guessing.

## Portable subset (works identically on both engines)

`to / from / fromTo / set / addLabel / add(childTimeline, pos) / duration()` · vars: `duration, ease, stagger (number |
{each|amount, from}), delay, onUpdate` · props: `x, y, xPercent, yPercent, scale, scaleX, scaleY, rotate, opacity,
autoAlpha, clipPath: "inset(…)", letterSpacing: "0.1em", CSS custom props "--name", colours, strokeDashoffset`, plain
object numbers (shader uniforms, camera state).
Position strings: `0.5`, `"<"`, `">"`, `"<0.2"`, `"+=0.3"`, `"-=0.3"`, `"label"`, `"label+=0.3"`, `"label-=0.3"`.
(`"label-0.3"` is NOT valid — a real bug this skill hit; the MF engine throws a descriptive error.)

Eases: `none, power1–4, sine, expo, circ, back(n), elastic(a,p)` with `.in/.out/.inOut`; custom curves via
`MF.ease("cubic(x1,y1,x2,y2)")` (a function — both engines accept functions).
Units: always pass CSS lengths with units as strings when the unit isn't px (`"0.12em"`); bare numbers mean px in GSAP.

MF-only: `clip: [t,r,b,l]` shorthand, `blur`. GSAP-only: plugins, `repeat/yoyo` (avoid in renders; express cycles as math of t).

## Structure standard

```js
const T = MF.tokens;                                   // centralised timing/ease tokens — no magic numbers inline
const intro = MF.timeline();  intro.addLabel("in", 0) …;   // one sub-timeline per act/scene
const outro = MF.timeline();  …
tl.add(intro, 0).addLabel("act2", 4.4).add(outro, "act2")  // master timeline composes acts with labels
MF.compose({ timeline: tl, … });                        // only the master is wired; children are nested
```

- Labels on every act and transformation (renders sample them; reviewers reference them).
- Overlap deliberately with position params instead of delays sprinkled on tweens.
- No `onComplete` side effects that change visuals — renders seek non-linearly; use `onUpdate(easedProgress)` that is a pure function of progress.
- One owner per property per time range; conflicting tweens on the same prop at the same time = bug.
- Interactive pages: `const ctx = gsap.context(() => {...})`, `ctx.revert()` on unmount; kill ScrollTriggers; remove listeners.
- Renders: GSAP is configured with `force3D:false` by MF (crisper, history-free text raster).
