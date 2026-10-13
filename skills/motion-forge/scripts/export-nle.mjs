#!/usr/bin/env node
// Turn motion-forge output into editable timelines for DaVinci Resolve, Adobe Premiere Pro and CapCut.
// Inputs (any mix):  --layers out/layers/layers.json   (from layers.mjs: background + alpha layers, labels → markers)
//                    --edl edit.json                   (from social-edit.mjs: footage cuts, zooms, overlays, audio, markers)
//                    --audio music.wav[@start][:role]  (repeatable via comma list; role = music|vo|sfx)
//                    --srt captions.srt                (subtitle track / caption import)
// Output dir (--out out/nle, default) gets:
//   media/                 every referenced file, copied once (so the folder can be zipped and moved)
//   timeline.otio          OpenTimelineIO  → Resolve 18.5+: File ▸ Import ▸ Timeline (also Premiere via OTIO plugins, Avid, Nuke)
//   timeline.fcpxml        FCPXML 1.8      → Resolve: File ▸ Import ▸ Timeline; Final Cut Pro
//   timeline_xmeml.xml     FCP7 XML (v5)   → Premiere Pro: File ▸ Import; Resolve also reads it
//   premiere_import.jsx    ExtendScript: imports the XML + SRT and adds markers (Premiere; run via VS Code ExtendScript or a JSX launcher)
//   resolve_import.lua     Resolve console (Free: Workspace ▸ Console ▸ Lua): import timeline, add markers, queue a render
//   resolve_studio.py      same through the external Python API (Resolve Studio only)
//   capcut/                CapCut has no timeline import: numbered assets + key-colour versions of alpha layers + layout.json + README
//   timeline.json          the shared model every exporter was written from (frames, not seconds)
// --media-root <dir>  write media paths as they will be on the editing machine (e.g. "D:/Projects/promo/nle"), default = this folder.
// Untested in the real applications here (none installed); every file is validated for structure and frame-exact timing.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, writeJSON, ffprobe, which } from "./lib/common.mjs";

const a = parseArgs();
if (!a.layers && !a.edl) { console.error("usage: export-nle.mjs --layers layers.json | --edl edit.json [--audio a.wav@0:music,vo.wav:vo] [--srt c.srt] [--out out/nle] [--media-root D:/x] [--name Promo] [--key-color 00FF00] [--only resolve,premiere,capcut]"); process.exit(1); }
const out = path.resolve(a.out || "out/nle"), mediaDir = path.join(out, "media");
fs.mkdirSync(mediaDir, { recursive: true });
const only = a.only ? String(a.only).split(",") : ["resolve", "premiere", "capcut"];
const root = String(a["media-root"] || out).replace(/\\/g, "/").replace(/\/$/, "");

// ---------- rates: integer fps or the NTSC family as exact rationals
const RATES = { 23.976: [24000, 1001], 29.97: [30000, 1001], 59.94: [60000, 1001], 47.952: [48000, 1001] };
function rateOf(f) { const k = Object.keys(RATES).find((r) => Math.abs(+r - f) < 0.01); return k ? { num: RATES[k][0], den: RATES[k][1], timebase: Math.round(f), ntsc: true } : { num: Math.round(f), den: 1, timebase: Math.round(f), ntsc: false }; }
const F = (sec, fps) => Math.round(sec * fps);

// ---------- media registry (copy once, stable names)
const media = new Map();
function addMedia(src, hint) {
  const absSrc = path.resolve(src); if (media.has(absSrc)) return media.get(absSrc);
  let name = hint || path.basename(absSrc);
  const taken = new Set([...media.values()].map((m) => m.name));   // two sources with one basename must not overwrite each other
  for (let k = 2; taken.has(name); k++) name = path.basename(absSrc).replace(/(\.[^.]+)?$/, `-${k}$1`);
  const dst = path.join(mediaDir, name);
  if (fs.statSync(absSrc).isDirectory()) fs.cpSync(absSrc, dst, { recursive: true }); else fs.copyFileSync(absSrc, dst);
  const p = fs.statSync(absSrc).isDirectory() ? null : ffprobe(absSrc);
  const v = p?.streams?.find((s) => s.codec_type === "video"), au = p?.streams?.find((s) => s.codec_type === "audio");
  const m = { id: "m" + (media.size + 1), name, file: dst, url: fileURL(`${root}/media/${name}`), path: `${root}/media/${name}`,
    duration: +(p?.format?.duration || 0), hasVideo: !!v, hasAudio: !!au, width: v?.width, height: v?.height, channels: au?.channels || 2, sampleRate: +(au?.sample_rate || 48000) };
  media.set(absSrc, m); return m;
}
function fileURL(p) { const s = p.replace(/\\/g, "/"); return "file://" + (/^[A-Za-z]:/.test(s) ? "/" + s : s).split("/").map((x, i) => (i === 0 ? x : encodeURIComponent(x).replace(/%3A/g, ":"))).join("/"); }

// ---------- build the shared timeline model (all positions in frames)
const T = { name: a.name || "motion-forge", fps: 30, width: 1920, height: 1080, durationF: 0, video: [], audio: [], markers: [], srt: null };
if (a.layers) {
  const L = JSON.parse(fs.readFileSync(a.layers, "utf8")), dir = path.dirname(path.resolve(a.layers));
  Object.assign(T, { name: a.name || L.title || T.name, fps: L.fps, width: L.width, height: L.height });
  const dF = F(L.duration, L.fps); T.durationF = Math.max(T.durationF, dF);
  for (const l of L.layers) {
    if (l.kind !== "video") { line(`skip ${l.layer}: PNG sequences are not placed on timelines (use --format prores in layers.mjs)`); continue; }
    const m = addMedia(path.join(dir, l.file));
    T.video.push([{ name: l.layer, media: m, start: 0, in: 0, dur: dF, alpha: l.alpha }]);
  }
  for (const [name, t] of Object.entries(L.labels || {})) T.markers.push({ name, frame: F(t, L.fps) });
}
if (a.edl) {
  const E = JSON.parse(fs.readFileSync(a.edl, "utf8")), dir = path.dirname(path.resolve(a.edl));
  if (!a.layers) Object.assign(T, { name: a.name || E.name || T.name, fps: E.fps, width: E.width, height: E.height });
  const fpsE = T.fps, rel = (f) => path.resolve(dir, f);
  // primary storyline: footage cuts in order, picture on V1, its sound on A1
  let at = 0; const v1 = [], a1 = [];
  for (const c of E.clips || []) {
    const m = addMedia(rel(c.src)), inF = F(c.in, fpsE), dur = F(c.out, fpsE) - inF;
    v1.push({ name: c.name || path.basename(c.src), media: m, start: at, in: inF, dur, zoom: c.zoom || null });
    if (m.hasAudio) a1.push({ name: c.name || path.basename(c.src), media: m, start: at, in: inF, dur, role: "dialogue" });
    at += dur;
  }
  if (v1.length) { v1.primary = true; T.video.unshift(v1); }
  if (a1.length) { a1.primary = true; T.audio.unshift(a1); }
  T.durationF = Math.max(T.durationF, at);
  for (const o of E.overlays || []) {   // graphics on their own tracks above
    const m = addMedia(rel(o.file)), s = F(o.start, fpsE), d = F(o.dur ?? m.duration, fpsE);
    T.video.push([{ name: o.name || path.basename(o.file), media: m, start: s, in: F(o.in || 0, fpsE), dur: d, alpha: o.alpha !== false }]); T.durationF = Math.max(T.durationF, s + d);
  }
  for (const au of E.audio || []) { const m = addMedia(rel(au.file)), s = F(au.start || 0, fpsE); T.audio.push([{ name: au.role || path.basename(au.file), media: m, start: s, in: 0, dur: F(au.dur ?? m.duration, fpsE), role: au.role || "music", gainDb: au.gainDb || 0 }]); }
  for (const mk of E.markers || []) T.markers.push({ name: mk.name, frame: F(mk.t, fpsE), note: mk.note || "" });
  if (E.srt && !a.srt) a.srt = rel(E.srt);
}
for (const spec of String(a.audio || "").split(",").filter(Boolean)) {   // file[@start][:role]
  const mm = spec.match(/^(.*?)(?:@([\d.]+))?(?::(music|vo|sfx|dialogue))?$/); const m = addMedia(mm[1]), s = F(+(mm[2] || 0), T.fps);
  T.audio.push([{ name: mm[3] || "audio", media: m, start: s, in: 0, dur: Math.min(F(m.duration, T.fps), Math.max(1, T.durationF - s)), role: mm[3] || "music" }]);
}
if (a.srt) { const m = addMedia(a.srt); T.srt = m; }
T.markers.sort((x, y) => x.frame - y.frame);
const R = rateOf(T.fps);
// frame → rational seconds string for FCPXML ("1001/30000s" multiples or "n/fps s")
const fx = (f) => (f === 0 ? "0s" : R.den === 1 ? (f % R.num === 0 ? `${f / R.num}s` : `${f}/${R.num}s`) : `${f * R.den}/${R.num}s`);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
writeJSON(path.join(out, "timeline.json"), { ...T, video: T.video.map((t) => t.map(({ media: m, ...c }) => ({ ...c, media: m.name }))), audio: T.audio.map((t) => t.map(({ media: m, ...c }) => ({ ...c, media: m.name }))), srt: T.srt?.name || null });
const written = [];

// ---------- OTIO
if (only.includes("resolve") || only.includes("premiere")) {
  const RT = (v) => ({ OTIO_SCHEMA: "RationalTime.1", rate: T.fps, value: v });
  const TR = (s, d) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: RT(s), duration: RT(d) });
  const track = (clips, kind, name) => { const children = []; let cur = 0;
    for (const c of clips) { if (c.start > cur) children.push({ OTIO_SCHEMA: "Gap.1", name: "", source_range: TR(0, c.start - cur), effects: [], markers: [], metadata: {} });
      children.push({ OTIO_SCHEMA: "Clip.1", name: c.name, source_range: TR(c.in, c.dur), effects: [], markers: [], metadata: { motion_forge: { alpha: !!c.alpha, zoom: c.zoom || null, role: c.role || null } },
        media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: c.media.url, available_range: c.media.duration ? TR(0, F(c.media.duration, T.fps)) : null, metadata: {}, name: c.media.name } });
      cur = c.start + c.dur; }
    return { OTIO_SCHEMA: "Track.1", name, kind, source_range: null, effects: [], markers: [], metadata: {}, children }; };
  const otio = { OTIO_SCHEMA: "Timeline.1", name: T.name, global_start_time: RT(0), metadata: { motion_forge: { width: T.width, height: T.height } },
    tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], metadata: {},
      markers: T.markers.map((m) => ({ OTIO_SCHEMA: "Marker.2", name: m.name, color: "RED", marked_range: TR(m.frame, 0), comment: m.note || "", metadata: {} })),
      children: [...T.video.map((t, i) => track(t, "Video", `V${i + 1} ${t[0].name}`)), ...T.audio.map((t, i) => track(t, "Audio", `A${i + 1} ${t[0].role || t[0].name}`))] } };
  writeJSON(path.join(out, "timeline.otio"), otio); written.push("timeline.otio");
}

// ---------- FCPXML 1.8 (primary storyline = V1 or a gap; everything else connected on lanes)
if (only.includes("resolve")) {
  const std = [[1920, 1080], [1280, 720], [3840, 2160]].some(([w, h]) => w === T.width && h === T.height);   // FCP only names standard formats
  const fmt = `<format id="r1"${std ? ` name="FFVideoFormat${T.height}p${String(Math.round(T.fps * 100) / 100).replace(".", "")}"` : ""} frameDuration="${fx(1)}" width="${T.width}" height="${T.height}"/>`;
  const assets = [...media.values()].filter((m) => m !== T.srt).map((m) => `<asset id="${m.id}" name="${esc(m.name)}" src="${esc(m.url)}" start="0s" duration="${fx(Math.max(1, F(m.duration, T.fps)))}" hasVideo="${m.hasVideo ? 1 : 0}" hasAudio="${m.hasAudio ? 1 : 0}"${m.hasVideo ? ' format="r1"' : ""}${m.hasAudio ? ` audioSources="1" audioChannels="${m.channels}" audioRate="${m.sampleRate}"` : ""}/>`);
  const clipX = (c, lane, offsetF, inner = "") => `<asset-clip ref="${c.media.id}" name="${esc(c.name)}"${lane != null ? ` lane="${lane}"` : ""} offset="${fx(offsetF)}" start="${fx(c.in)}" duration="${fx(c.dur)}"${c.media.hasVideo ? ' format="r1"' : ""} tcFormat="NDF"${c.media.hasVideo && c.media.hasAudio && lane > 0 ? ' audioRole="dialogue"' : ""}>${c.zoom ? `<adjust-transform scale="${c.zoom} ${c.zoom}"/>` : ""}${inner}</asset-clip>`;   // DTD: adjust-* before markers/anchored items
  const prim = T.video.find((t) => t.primary) || null;   // footage cuts become the primary storyline
  const conn = [];   // connected items with their timeline frame
  T.video.forEach((t, i) => { if (t === prim) return; t.forEach((c) => conn.push({ c, lane: prim ? i : i + 1, at: c.start })); });
  T.audio.forEach((t, i) => t.forEach((c) => { if (prim && t.primary) return; conn.push({ c, lane: -(i + 1), at: c.start }); }));
  const markX = (m, base) => `<marker start="${fx(base)}" duration="${fx(1)}" value="${esc(m.name)}"${m.note ? ` note="${esc(m.note)}"` : ""}/>`;
  let spine;
  if (prim) {   // children of a clip are positioned in that clip's SOURCE time: offset = in + (timeline frame - clip start)
    spine = prim.map((c, k) => { const last = k === prim.length - 1, owns = (f) => f >= c.start && (f < c.start + c.dur || last);
      const inner = T.markers.filter((m) => owns(m.frame)).map((m) => markX(m, c.in + m.frame - c.start)).join("") + conn.filter((x) => owns(x.at)).map((x) => clipX(x.c, x.lane, c.in + x.at - c.start)).join("");
      return clipX(c, null, c.start, inner); }).join("");
  } else spine = `<gap name="Gap" offset="0s" start="0s" duration="${fx(T.durationF)}">${T.markers.map((m) => markX(m, m.frame)).join("")}${conn.map((x) => clipX(x.c, x.lane, x.at)).join("")}</gap>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.8">\n<resources>${fmt}\n${assets.join("\n")}\n</resources>\n<library><event name="${esc(T.name)}"><project name="${esc(T.name)}"><sequence format="r1" duration="${fx(T.durationF)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k"><spine>${spine}</spine></sequence></project></event></library>\n</fcpxml>\n`;
  fs.writeFileSync(path.join(out, "timeline.fcpxml"), xml); written.push("timeline.fcpxml");
}

// ---------- FCP7 XML (xmeml v5): Premiere's native interchange, also read by Resolve
if (only.includes("premiere") || only.includes("resolve")) {
  const rate = `<rate><timebase>${R.timebase}</timebase><ntsc>${R.ntsc ? "TRUE" : "FALSE"}</ntsc></rate>`;
  const seen = new Set();
  const fileX = (m) => { if (seen.has(m.id)) return `<file id="${m.id}"/>`; seen.add(m.id);
    return `<file id="${m.id}"><name>${esc(m.name)}</name><pathurl>${esc(m.url)}</pathurl>${rate}<duration>${Math.max(1, F(m.duration, T.fps))}</duration><media>${m.hasVideo ? `<video><samplecharacteristics><width>${m.width}</width><height>${m.height}</height></samplecharacteristics></video>` : ""}${m.hasAudio ? `<audio><samplecharacteristics><depth>16</depth><samplerate>${m.sampleRate}</samplerate></samplecharacteristics><channelcount>${m.channels}</channelcount></audio>` : ""}</media></file>`; };
  let n = 0;
  const item = (c, kind) => { n++; const scale = c.zoom ? `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype><parameter><parameterid>scale</parameterid><name>Scale</name><value>${Math.round(c.zoom * 100)}</value></parameter></effect></filter>` : "";
    return `<clipitem id="ci${n}"><name>${esc(c.name)}</name><enabled>TRUE</enabled><duration>${Math.max(1, F(c.media.duration, T.fps))}</duration>${rate}<start>${c.start}</start><end>${c.start + c.dur}</end><in>${c.in}</in><out>${c.in + c.dur}</out>${fileX(c.media)}${kind === "audio" ? "<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>" : ""}${scale}</clipitem>`; };
  const vtracks = T.video.map((t) => `<track>${t.map((c) => item(c, "video")).join("")}<enabled>TRUE</enabled><locked>FALSE</locked></track>`).join("");
  const atracks = T.audio.map((t) => `<track>${t.map((c) => item(c, "audio")).join("")}<enabled>TRUE</enabled><locked>FALSE</locked></track>`).join("");
  const marks = T.markers.map((m) => `<marker><name>${esc(m.name)}</name><comment>${esc(m.note || "")}</comment><in>${m.frame}</in><out>-1</out></marker>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5">\n<sequence id="seq1"><name>${esc(T.name)}</name><duration>${T.durationF}</duration>${rate}<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>\n<media><video><format><samplecharacteristics>${rate}<width>${T.width}</width><height>${T.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>${vtracks}</video><audio>${atracks}</audio></media>${marks}</sequence>\n</xmeml>\n`;
  fs.writeFileSync(path.join(out, "timeline_xmeml.xml"), xml); written.push("timeline_xmeml.xml");
}

// ---------- Premiere ExtendScript
if (only.includes("premiere")) {
  const jsx = `// motion-forge → Premiere Pro. Run with the ExtendScript Debugger (VS Code) or any JSX runner, with a project open.
// Imports timeline_xmeml.xml (builds the sequence with every layer on its own track) and the SRT as captions, then
// re-adds markers in case the XML importer dropped them. Untested in Premiere here: check the console output.
(function () {
  var root = ${JSON.stringify(root)};
  var xml = new File(root + "/timeline_xmeml.xml");
  if (!xml.exists) { alert("timeline_xmeml.xml not found under " + root + " - re-run export-nle.mjs with --media-root"); return; }
  var before = app.project.sequences.numSequences;
  app.project.importFiles([xml.fsName], true, app.project.rootItem, false);
  var seq = app.project.sequences.numSequences > before ? app.project.sequences[app.project.sequences.numSequences - 1] : app.project.activeSequence;
  if (!seq) { $.writeln("motion-forge: sequence not created - import timeline_xmeml.xml via File > Import"); return; }
  app.project.openSequence(seq.sequenceID);
  var marks = ${JSON.stringify(T.markers.map((m) => ({ name: m.name, t: m.frame / T.fps, note: m.note || "" })))};
  if (seq.markers.numMarkers === 0) for (var i = 0; i < marks.length; i++) { var mk = seq.markers.createMarker(marks[i].t); mk.name = marks[i].name; mk.comments = marks[i].note; }
${T.srt ? `  var srt = new File(root + ${JSON.stringify("/media/" + T.srt.name)});
  if (srt.exists) { app.project.importFiles([srt.fsName], true, app.project.rootItem, false);
    $.writeln("motion-forge: SRT imported to the project bin - drag it onto the sequence (or Captions > Import), then set the caption style."); }
` : ""}  $.writeln("motion-forge: sequence '" + seq.name + "' ready - " + seq.videoTracks.numTracks + " video tracks, " + seq.markers.numMarkers + " markers.");
})();
`;
  fs.writeFileSync(path.join(out, "premiere_import.jsx"), jsx); written.push("premiere_import.jsx");
}

// ---------- Resolve: Lua (console, works in Free) + Python (Studio, external)
if (only.includes("resolve")) {
  const marks = T.markers.map((m) => ({ f: m.frame, name: m.name, note: m.note || "" }));
  const lua = `-- motion-forge → DaVinci Resolve (Free or Studio). Workspace > Console > Lua, paste this or use "Run Script".
-- Imports timeline.fcpxml into the current project, adds markers and (optionally) queues a render.
-- Untested in Resolve here: API names follow the Resolve scripting README (Help > Documentation > Developer).
local root = ${JSON.stringify(root)}
local resolve = Resolve()
local proj = resolve:GetProjectManager():GetCurrentProject()
if not proj then print("motion-forge: open or create a project first") return end
proj:SetSetting("timelineFrameRate", "${T.fps}")
proj:SetSetting("timelineResolutionWidth", "${T.width}")
proj:SetSetting("timelineResolutionHeight", "${T.height}")
local mp = proj:GetMediaPool()
local tl = mp:ImportTimelineFromFile(root .. "/timeline.fcpxml", { timelineName = ${JSON.stringify(T.name)}, importSourceClips = true })
if not tl then print("motion-forge: import failed - try File > Import > Timeline with timeline.fcpxml or timeline.otio") return end
proj:SetCurrentTimeline(tl)
local marks = { ${marks.map((m) => `{ ${m.f}, ${JSON.stringify(m.name)}, ${JSON.stringify(m.note)} }`).join(", ")} }
local start = tl:GetStartFrame()
for _, m in ipairs(marks) do tl:AddMarker(m[1], "Red", m[2], m[3], 1) end
${T.srt ? `print("motion-forge: subtitles - File > Import > Subtitle: " .. root .. ${JSON.stringify("/media/" + T.srt.name)} .. ", then drag onto the timeline")\n` : ""}-- render (uncomment):
-- proj:SetRenderSettings({ TargetDir = root .. "/render", CustomName = ${JSON.stringify(T.name)} })
-- proj:AddRenderJob(); proj:StartRendering()
print("motion-forge: timeline '" .. tl:GetName() .. "' ready, " .. tl:GetTrackCount("video") .. " video tracks")
`;
  fs.writeFileSync(path.join(out, "resolve_import.lua"), lua); written.push("resolve_import.lua");
  const py = `#!/usr/bin/env python3
# motion-forge → DaVinci Resolve Studio (external scripting needs Studio; in Free use resolve_import.lua in the console).
# Set RESOLVE_SCRIPT_API / RESOLVE_SCRIPT_LIB / PYTHONPATH as in the Resolve scripting README, Resolve open with a project.
# Untested in Resolve here.
import sys
try:
    import DaVinciResolveScript as dvr
except ImportError:
    sys.exit("DaVinciResolveScript not found - see Help > Documentation > Developer > Scripting README")
ROOT = ${JSON.stringify(root)}
resolve = dvr.scriptapp("Resolve")
proj = resolve.GetProjectManager().GetCurrentProject()
for k, v in {"timelineFrameRate": "${T.fps}", "timelineResolutionWidth": "${T.width}", "timelineResolutionHeight": "${T.height}"}.items():
    proj.SetSetting(k, v)
tl = proj.GetMediaPool().ImportTimelineFromFile(ROOT + "/timeline.fcpxml", {"timelineName": ${JSON.stringify(T.name)}, "importSourceClips": True})
if not tl:
    sys.exit("import failed - try timeline.otio or File > Import > Timeline")
proj.SetCurrentTimeline(tl)
for f, name, note in ${JSON.stringify(marks.map((m) => [m.f, m.name, m.note]))}:
    tl.AddMarker(f, "Red", name, note, 1)
if "--render" in sys.argv:
    proj.SetRenderSettings({"TargetDir": ROOT + "/render", "CustomName": ${JSON.stringify(T.name)}})
    proj.AddRenderJob(); proj.StartRendering()
print(f"motion-forge: timeline '{tl.GetName()}' ready, {tl.GetTrackCount('video')} video tracks")
`;
  fs.writeFileSync(path.join(out, "resolve_studio.py"), py); written.push("resolve_studio.py");
}

// ---------- CapCut pack (no timeline import exists: assets + layout for a human or the computer-use operator)
if (only.includes("capcut")) {
  const cc = path.join(out, "capcut"); fs.mkdirSync(cc, { recursive: true });
  const key = String(a["key-color"] || "00FF00").replace("#", ""), items = []; let k = 0;
  const ff = which("ffmpeg");
  const place = (c, track, kind) => { k++; const ext = path.extname(c.media.name), nm = `${String(k).padStart(2, "0")}_${track}_${c.name.replace(/[^\w-]+/g, "-")}${ext}`;
    const partial = c.in > 0 || c.dur < F(c.media.duration, T.fps) - 1 || c.zoom;
    if (partial && ff && c.media.hasVideo) {   // CapCut has no source in/out from a file: cut (and zoom) each clip so it drops straight in
      const z = c.zoom || 1, W = T.width, H = T.height;
      const r = spawnSync(ff, ["-y", "-v", "error", "-ss", (c.in / T.fps).toFixed(4), "-i", c.media.file, "-frames:v", String(c.dur), "-t", (c.dur / T.fps).toFixed(4),
        "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},scale=${Math.round(W * z / 2) * 2}:${Math.round(H * z / 2) * 2},crop=${W}:${H}:(iw-${W})/2:(ih-${H})*0.4,setsar=1`,
        "-c:v", "libx264", "-crf", "15", "-pix_fmt", "yuv420p", ...(c.media.hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]), path.join(cc, nm.replace(/\.[^.]+$/, ".mp4"))]);
      if (r.status !== 0) fs.copyFileSync(c.media.file, path.join(cc, nm));
    } else fs.copyFileSync(c.media.file, path.join(cc, nm));
    const cutDone = partial && fs.existsSync(path.join(cc, nm.replace(/\.[^.]+$/, ".mp4"))) && c.media.hasVideo;
    const it = { file: cutDone ? nm.replace(/\.[^.]+$/, ".mp4") : nm, track, kind, start: +(c.start / T.fps).toFixed(3), in: cutDone ? 0 : +(c.in / T.fps).toFixed(3), dur: +(c.dur / T.fps).toFixed(3), ...(cutDone ? { trimmed: true, zoomBaked: !!c.zoom } : {}) };
    if (c.alpha && ff) {   // a key-colour copy: works in every CapCut version via Chroma key, if alpha .mov is not honoured
      const kn = nm.replace(/\.[^.]+$/, `_key${key}.mp4`);
      const r = spawnSync(ff, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=0x${key}:s=${T.width}x${T.height}:r=${T.fps}:d=${c.media.duration || c.dur / T.fps}`, "-i", c.media.file, "-filter_complex", "[0][1]overlay=format=auto:shortest=1,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-an", path.join(cc, kn)]);
      if (r.status === 0) it.keyed = kn; }
    if (c.zoom && !cutDone) it.zoom = c.zoom; if (c.role) it.role = c.role; items.push(it); };
  T.video.forEach((t, i) => t.forEach((c) => place(c, i === 0 ? "main" : `overlay${i}`, "video")));
  T.audio.forEach((t, i) => { if (t.primary) return; t.forEach((c) => place(c, `audio${i + 1}`, "audio")); });   // footage sound rides inside the cut clips
  if (T.srt) fs.copyFileSync(T.srt.file, path.join(cc, "captions.srt"));
  const layout = { app: "CapCut", canvas: { width: T.width, height: T.height, ratio: ratio(T.width, T.height), fps: T.fps }, duration: +(T.durationF / T.fps).toFixed(3),
    order: "bottom → top; 'main' is the main track, overlayN go on overlay tracks in this order", items, markers: T.markers.map((m) => ({ name: m.name, t: +(m.frame / T.fps).toFixed(3) })), captions: T.srt ? "captions.srt" : null, keyColor: "#" + key };
  writeJSON(path.join(cc, "layout.json"), layout);
  fs.writeFileSync(path.join(cc, "README.md"), `# CapCut import — ${T.name}

CapCut cannot import XML/OTIO timelines, so this folder is laid out for a fast manual (or computer-use) assembly.
Canvas: ${T.width}×${T.height} (${layout.canvas.ratio}), ${T.fps} fps, ${layout.duration}s. Exact placements are in \`layout.json\`.

1. New project → set the ratio to **${layout.canvas.ratio}** (Ratio button above the player).
2. Import this whole folder (drag it into Media).
3. Drag the \`main\` file(s) onto the main track in number order, starting at 0:00.
4. For each \`overlayN\` file, drag it **above** the main track at its \`start\` time (layout.json), lowest N first.
   - If an alpha \`.mov\` shows a black box, delete it and use its \`_key${key}.mp4\` twin instead → Video ▸ Remove BG ▸ **Chroma key**, pick #${key}, intensity ~20, shadow ~10.
5. Audio files go on audio tracks at their \`start\` time.
${T.srt ? "6. Captions: Text ▸ Local captions ▸ Import → `captions.srt` (or Captions ▸ Import file), then apply a caption style.\n" : ""}
Menu names differ between CapCut versions and platforms — treat them as hints and verify. Untested in CapCut here.
`);
  written.push("capcut/ (" + items.length + " items)");
}
function ratio(w, h) { const g = (x, y) => (y ? g(y, x % y) : x), d = g(w, h); return `${w / d}:${h / d}`; }
line(`NLE export → ${path.relative(process.cwd(), out) || "."}: ${written.join(", ")} · ${T.video.length} video + ${T.audio.length} audio tracks, ${T.markers.length} markers, ${T.durationF} frames @ ${T.fps}`);
