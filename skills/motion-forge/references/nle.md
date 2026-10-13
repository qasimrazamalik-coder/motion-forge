# NLE hand-off and social editing — DaVinci Resolve · Premiere Pro · CapCut

Load when the user wants the piece edited, finished or delivered in an editing app, or wants a Reels / TikTok / Shorts
edit from raw footage. Section loading: `refs.mjs nle <section>`.

## Paths by app

| | Timeline import | Automation without clicks | UI-only steps (computer use) |
|---|---|---|---|
| Resolve **Free** | `timeline.fcpxml` or `timeline.otio` (File ▸ Import ▸ Timeline), `timeline_xmeml.xml` | `resolve_import.lua` in Workspace ▸ Console (Lua) — import, markers, render queue | subtitle import/style, grade, Fusion tweaks |
| Resolve **Studio** | same | `resolve_studio.py` (external Python API) | grade, Fusion |
| Premiere Pro | `timeline_xmeml.xml` (File ▸ Import) | `premiere_import.jsx` (ExtendScript; newer releases are moving to UXP — verify the version) | caption style, Essential Graphics, export preset |
| CapCut | none (no XML/OTIO import) | none | the whole assembly, from `capcut/layout.json` |

Produce the files with:
```
node $MF/scripts/layers.mjs <comp.html> --out out/layers            # alpha layer per element (ProRes 4444) + layers.json
node $MF/scripts/export-nle.mjs --layers out/layers/layers.json [--edl reel.edit.json] [--audio mix.wav:music] [--srt c.srt] --out out/nle [--media-root "D:/Projects/x/nle"]
node $MF/scripts/nle-check.mjs out/nle [--ref out/full.mp4]          # all three timelines agree to the frame; rebuild ≈ reference
```
`--media-root` = where the folder will live on the editing machine (paths inside the XML are absolute). Otherwise relink once
in the app (Resolve: Relink Media; Premiere: Link Media).

Studio-only Resolve features and the free replacements here: Smart Reframe → `reframe.mjs`; auto subtitles → whisper.cpp
words + `social-edit.mjs` captions / SRT; Voice Isolation → `social-edit.mjs` voice cleanup (highpass + afftdn + compressor).
As far as known — check the current Resolve feature list before telling a user something is Studio-only.

## Computer-use rules

Order of preference: **files → scripts → keyboard → mouse.** A screenshot costs ~1–2k image tokens and seconds; a timeline file costs one import.

1. **Budget.** Default 25 actions per UI task. Over budget → stop, report what's done and what's left. Never loop on a failing click.
2. **Orient once.** One full screenshot at the start, then **zoomed region** screenshots only (the panel you act on). No screenshot after every keypress: batch 3–8 actions, then one zoomed check.
3. **UI map cache.** After orienting, save positions of the panels/buttons you used to `$MF_HOME/ui-maps/<app>-<version>-<screenW>x<screenH>.json` (`{ "media_pool": [x,y,w,h], "render_button": [x,y] … }`). Reuse it next time; one mismatch → re-orient and overwrite.
4. **Shortcuts from the app, not from memory.** Read the app's own shortcut list once (Resolve: DaVinci Resolve ▸ Keyboard Customization; Premiere: Keyboard Shortcuts; CapCut: Settings ▸ Shortcuts) and cache the ones you need in the UI map. Common defaults (verify before use): split/blade at playhead `Ctrl/Cmd+B` (Resolve, CapCut), add edit `Ctrl/Cmd+K` (Premiere); import `Ctrl/Cmd+I`; undo `Ctrl/Cmd+Z`.
5. **Verify by output, not by looking at the UI.** Export/render, then `inspect-output.mjs` + its contact sheet. A timeline screenshot proves little.
6. **Safety.** Work on a duplicate timeline/project. Save before risky steps. Never confirm delete/overwrite/replace dialogs or sign-in/payment prompts without the user. Request access to the editing app only.
7. **Hand mechanical UI to `mf-nle-operator`** with an exact step list and budget; it returns a ≤150-word verdict, not screenshots.

## Resolve

- Free: Workspace ▸ Console ▸ Lua → paste `resolve_import.lua` (or Workspace ▸ Scripts after copying it to the Resolve scripts folder). It imports `timeline.fcpxml`, sets resolution/fps, adds markers, and has the render queue lines commented out.
- Subtitles: File ▸ Import ▸ Subtitle → `media/<name>.srt`, drag to the timeline; or keep the burned social captions (alpha layer) on V2.
- Alpha layers import as ProRes 4444 with straight/premultiplied alpha — if edges look dark, set the clip's Alpha Mode in Clip Attributes (verify per version).
- Deliver page: H.264/H.265, 1080×1920 for 9:16, 30 fps; the Lua file shows `SetRenderSettings` + `AddRenderJob`.

## Premiere Pro

- File ▸ Import → `timeline_xmeml.xml` builds a sequence with every layer on its own track, markers included; zooms come through as Motion ▸ Scale.
- `premiere_import.jsx` does the same plus marker repair and SRT import, run from the ExtendScript Debugger (VS Code) or a JSX launcher panel. Untested here.
- Captions: Captions/Text panel ▸ Import captions from file (SRT), then a caption style; or keep the alpha caption layer.

## CapCut

- No timeline import exists, so `export-nle.mjs` writes `capcut/`: numbered clips **already cut and zoomed** (drop them in order), overlays with alpha plus `_key00FF00.mp4` twins for Chroma key, audio stems, `captions.srt`, `layout.json` (start times, tracks, canvas) and a README with the steps.
- Assembly by computer use: set ratio → import folder → drag `main` clips in number order → overlays at their `start` on tracks above → audio → captions import → export. Menu names change between versions and platforms: read them from the screen, use `layout.json` for the numbers.
- Features move between CapCut free and paid tiers; don't promise one without checking the installed version.

## Social edit grammar

Rules of thumb (practice, not measured here):
- **Hook first.** The strongest line in the first 1–2 s (`hooklab.mjs` scores lines and renders A/B/C cold opens; the agent writes punchier on-screen titles with `--titles`). Repeat it in place or move it (`--hook-mode`).
- **Rhythm.** Jump cut every 2–4 s; pauses > 0.35 s and fillers out; punch-in 8–12% on alternate cuts, ~18% on emphasis words; switch zooms on the music's beats (`--beat-zoom`).
- **Captions.** 1–4 words per cue, active word highlighted, inside the platform safe zone (`--platform reels|tiktok|shorts` — approximate, UIs change), stroke + shadow because the footage is unknown.
- **Sound.** Voice cleaned, music ~−20 dB under voice (ducked), whoosh only at real transitions (`--whoosh hook`), −14 LUFS.
- **Finish.** Progress bar at the top on 9:16 (the bottom is under platform UI), loop ending (`--loop`) so the replay feels seamless, 1080×1920 30 fps H.264.

```
node $MF/scripts/social-edit.mjs talk.mp4 --words talk.words.json --out reel.mp4 --aspect 9:16 --platform reels --style highlight --music bed.wav --beat-zoom --loop --nle out/nle
node $MF/scripts/hooklab.mjs talk.mp4 --words talk.words.json --out out/hooks --aspect 9:16 --titles "A|B|C" --seconds 8
```
Words come from any ASR as `[{word,start,end}]` or whisper.cpp `-ojf` JSON (`--asr` runs whisper.cpp if installed).

## Agents for editing

- `mf-editor` (sonnet): reads the transcript, picks the hook and titles, emphasis words, style and platform; writes the command lines. Doesn't render.
- `mf-runner` (haiku): runs `social-edit` / `hooklab` / `export-nle` / `nle-check` and returns the verdict.
- `mf-critic-lite` (haiku): checks the reel's contact sheet (`inspect-output.mjs --sheet`) for caption collisions, safe zones, black frames.
- `mf-nle-operator` (sonnet, computer use): only the UI-only steps, with a step list and an action budget.
