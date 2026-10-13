# Three.js, WebGL & shaders

## Decide first

Use 3D only when depth, light or camera movement **is** the idea (architecture, product form, terrain, spatial data).
Full-frame procedural fields → raw WebGL2 fragment shader (`webgl` template: 1 draw call, no dependency).
Objects, lighting, shadows, cameras, glTF → Three.js (`threejs` template; needs `npm i three` locally — MIT).
Check preflight for installed Three.js/WebGL skills and the `mcp__Three_js_*`/threejs-devtools tools; use them for API specifics.

## Renderer baseline (template already does this)

`antialias: true, preserveDrawingBuffer: true` · `setPixelRatio(min(dpr, 2))` · `outputColorSpace = SRGBColorSpace` ·
`toneMapping = ACESFilmicToneMapping` (or `AgX`/`Neutral` for product colour accuracy), exposure 1.0–1.2 ·
colours from hex via `THREE.Color` (colour-managed) · `webglcontextlost` → `preventDefault` · dispose geometries,
materials, textures, render targets and the renderer on `pagehide`.

## Determinism

Drive everything from the MF timeline/`render(t)`: camera state, uniforms, instance matrices. No `Clock`, no
`AnimationMixer.update(delta)` — use `mixer.setTime(t)`. Seeded randomness only (`MF.rng`). Physics: precompute.

## Camera

- Lens choice is art direction: 24–35° FOV (long lens) = architectural/product calm; 50–70° = immersive/dynamic.
- One motivated move per shot: dolly/push (intimacy), crane (reveal scale), orbit ≤ 30° (form), track (follow). Ease the whole move (`cubic(0.45,0,0.25,1)`), avoid constant-speed spins.
- Compose for type: aim the camera off the subject (e.g. `lookAt` left of the field) so the frame keeps a clean zone; check stills before adding scrims.
- Keep horizon/verticals deliberate; small roll only with intent.

## Lighting

Key (low raking for texture & long shadows) + cool fill (hemisphere) + rim for silhouette. Fog colour = background
for depth without a horizon line. Shadows: one shadow-casting directional light, 1024–2048 map, tight shadow camera
bounds, small negative bias. Env maps (PMREM from a local HDR) for metals/glass — vendor the HDR.

## Materials & geometry

`MeshStandardMaterial`/`MeshPhysicalMaterial` with real roughness; avoid default grey + full metalness. Many similar
objects → `InstancedMesh` (1 draw call) with `instanceColor` for the signal subset. Merge static geometry. Textures: power-of-two,
≤ 2048 unless hero, KTX2 for many.

## Shaders (raw WebGL2 or ShaderMaterial)

- Antialias procedural lines with `fwidth` (`1 - smoothstep(.5*fw, 1.5*fw, dist)`), not fixed thresholds.
- Deterministic grain: `hash(gl_FragCoord.xy + floor(t*fps)*k)`, amplitude ≤ 0.02 — fights H.264 banding.
- Quiet the field under type with an in-shader scrim (attenuate line alpha in type zones) instead of opaque boxes.
- Uniforms come from the timeline (`state` object tweened like any target).
- Budget: fbm ≤ 5 octaves at 1080p for realtime; offline renders can afford more. Check compile errors in render reports (`PAGE_ERROR shader compile …`).

## Post-processing

Only when it serves the look (subtle bloom on emissive accents, film grain, vignette, DOF for product macro).
EffectComposer passes cost a full-screen draw each; prefer folding grain/vignette into the main shader or a single final pass.

## Performance (interactive / hero)

Targets: ≤ 100 draw calls, ≤ 500k triangles mid-range laptop, DPR ≤ 2 (≤ 1.5 on mobile), no per-frame allocations
(reuse Matrix4/Vector3), `instanceMatrix.setUsage(DynamicDrawUsage)` only if it changes. Measure: `render.mjs --perf 6`
and `stats()` (renderer.info). Headless numbers use SwiftShader (software) — compare relatively; use `MF_GPU=1` on a GPU machine for absolute numbers.

## Camera, depth of field, physics (v3)

- Handheld drift: `const [x, y, rot] = MF.shake(t, { amp: 0.03, freq: 0.9, seed })`. Pure function of t, seeded.
- Depth of field without addons: render the scene into a `WebGLRenderTarget` with a `DepthTexture`, then one full-screen disc-blur pass sized by the circle of confusion. The pass must apply `#include <tonemapping_fragment>` + `<colorspace_fragment>`, because the RT is linear. No MSAA on that target. Warm it up in setup. Reference implementation: the whatif-3d template.
- Physics: `const sim = MF.physics({ bodies, gravity, ground, restitution, duration })` simulates once at 240 Hz and stores snapshots. In render, `sim.at(t)` gives the poses, deterministic in any seek order. Collisions are listed in `sim.contacts` (use them for SFX cues).
- Preview speed: `renderer.setPixelRatio(MF.pixelRatio(2))` honours `?q=draft` (half resolution) in preview and is full resolution in renders.
- Brand colours into 3D: `MF.cssColor("--signal", "#E0421C")` → "#rrggbb", ready for THREE.Color or shader uniforms.
