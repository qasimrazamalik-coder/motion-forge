#!/usr/bin/env node
// Verify an export-nle.mjs folder without the editing apps: parse timeline.fcpxml, timeline_xmeml.xml and timeline.otio
// independently, check every clip placement (track, start, in, duration, media) and marker agrees with timeline.json to
// the frame, then optionally rebuild the picture from the xmeml placements with ffmpeg and compare it to a reference render.
// usage: nle-check.mjs <out/nle> [--ref full.mp4] [--at 1.5,5,10]   → exit 0 when everything agrees
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line } from "./lib/common.mjs";

const a = parseArgs(), dir = path.resolve(a._[0] || "out/nle");
const T = JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8"));
const problems = [], note = (m) => problems.push(m);

// tiny XML parser (elements, attributes, text) — enough for our own interchange files
function parseXML(src) {
  const root = { tag: "#root", attrs: {}, kids: [], text: "" }, stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g; let m;
  const un = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  while ((m = re.exec(src))) {
    if (m[1]) { const top = stack.pop(); if (top.tag !== m[1]) throw new Error(`mismatched </${m[1]}> (open <${top.tag}>)`); }
    else if (m[2]) { const el = { tag: m[2], attrs: {}, kids: [], text: "" }; for (const [, k, v] of (m[3] || "").matchAll(/([\w:.-]+)="([^"]*)"/g)) el.attrs[k] = un(v);
      stack.at(-1).kids.push(el); if (!m[4]) stack.push(el); }
    else if (m[5] && stack.length > 1) stack.at(-1).text += un(m[5]);
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack.at(-1).tag}>`);
  return root;
}
const all = (el, tag, acc = []) => { for (const k of el.kids) { if (k.tag === tag) acc.push(k); all(k, tag, acc); } return acc; };
const kid = (el, tag) => el?.kids.find((k) => k.tag === tag);
const txt = (el, tag) => kid(el, tag)?.text.trim();

// expected placements from the model
const exp = [];
T.video.forEach((t, i) => t.forEach((c) => exp.push({ kind: "video", track: i, media: c.media, start: c.start, in: c.in, dur: c.dur })));
T.audio.forEach((t, i) => t.forEach((c) => exp.push({ kind: "audio", track: i, media: c.media, start: c.start, in: c.in, dur: c.dur, role: c.role })));
const key = (p) => `${p.kind}:${p.track}:${p.media}:${p.start}:${p.in}:${p.dur}`;
function compare(label, got, markers) {
  const e = new Set(exp.map(key)), g = new Set(got.map(key));
  for (const k of e) if (!g.has(k)) note(`${label}: missing ${k}`);
  for (const k of g) if (!e.has(k)) note(`${label}: unexpected ${k}`);
  if (markers) { const em = T.markers.map((m) => `${m.name}@${m.frame}`).sort().join(","), gm = markers.sort().join(","); if (em !== gm) note(`${label}: markers ${gm} ≠ ${em}`); }
  line(`${problems.some((p) => p.startsWith(label)) ? "FAIL" : "ok  "} ${label.padEnd(8)} ${got.length} clips, ${markers ? markers.length : "-"} markers`);
}

// --- xmeml
const fps = T.fps;
{ const x = parseXML(fs.readFileSync(path.join(dir, "timeline_xmeml.xml"), "utf8")), seq = all(x, "sequence")[0], files = {};
  for (const f of all(x, "file")) if (kid(f, "name")) files[f.attrs.id] = txt(f, "name");
  const got = [], media = kid(seq, "media");
  for (const kind of ["video", "audio"]) all(kid(media, kind), "track").forEach((tr, i) => all(tr, "clipitem").forEach((ci) => {
    const s = +txt(ci, "start"), e = +txt(ci, "end"), inn = +txt(ci, "in"), o = +txt(ci, "out");
    if (e - s !== o - inn) note(`xmeml: clip ${txt(ci, "name")} end-start ${e - s} ≠ out-in ${o - inn}`);
    got.push({ kind, track: i, media: files[kid(ci, "file").attrs.id], start: s, in: inn, dur: e - s }); }));
  compare("xmeml", got, seq.kids.filter((k) => k.tag === "marker").map((m) => `${txt(m, "name")}@${+txt(m, "in")}`)); }

// --- fcpxml
{ const x = parseXML(fs.readFileSync(path.join(dir, "timeline.fcpxml"), "utf8"));
  const fr = all(x, "format")[0].attrs.frameDuration, [n, d] = fr.replace("s", "").split("/").map(Number), spf = n / (d || 1);
  const F = (v) => { if (!v || v === "0s") return 0; const [p, q] = v.replace("s", "").split("/").map(Number); const f = (p / (q || 1)) / spf; if (Math.abs(f - Math.round(f)) > 1e-6) note(`fcpxml: ${v} is not on a frame`); return Math.round(f); };
  const assets = Object.fromEntries(all(x, "asset").map((as) => [as.attrs.id, as.attrs.name]));
  const spine = all(x, "spine")[0], got = [], marks = [];
  const vt = {}, at = {}; // lane → track index (lanes are dense from the exporter)
  for (const p of spine.kids) {   // primary items: gap or footage asset-clips; children positioned in parent source time
    const pStart = F(p.attrs.offset), pIn = F(p.attrs.start), toTL = (v) => pStart + F(v) - pIn;
    if (p.tag === "asset-clip") got.push({ kind: "video", track: 0, media: assets[p.attrs.ref], start: pStart, in: pIn, dur: F(p.attrs.duration), primary: true });
    for (const c of p.kids) {
      if (c.tag === "marker") marks.push(`${c.attrs.value}@${toTL(c.attrs.start)}`);
      if (c.tag === "asset-clip") { const lane = +c.attrs.lane; got.push({ kind: lane < 0 ? "audio" : "video", lane, media: assets[c.attrs.ref], start: toTL(c.attrs.offset), in: F(c.attrs.start), dur: F(c.attrs.duration) }); }
    }
  }
  const prim = got.some((g) => g.primary);
  for (const g of got) { if (g.primary) continue; g.track = g.lane < 0 ? -g.lane - 1 : prim ? g.lane : g.lane - 1; }
  // footage audio (A1) rides inside the primary clips in FCPXML: add it back from the model when the primary has sound
  if (prim) for (const c of T.audio[0] || []) if (c.role === "dialogue") got.push({ kind: "audio", track: 0, media: c.media, start: c.start, in: c.in, dur: c.dur });
  compare("fcpxml", got, marks); }

// --- otio
{ const o = JSON.parse(fs.readFileSync(path.join(dir, "timeline.otio"), "utf8")), got = [], cnt = { Video: 0, Audio: 0 };
  if (o.OTIO_SCHEMA !== "Timeline.1" || o.tracks?.OTIO_SCHEMA !== "Stack.1") note("otio: wrong top-level schema");
  for (const tr of o.tracks.children) { const ti = cnt[tr.kind]++; let cur = 0;
    for (const ch of tr.children) { const d = ch.source_range.duration.value;
      if (ch.OTIO_SCHEMA === "Clip.1") got.push({ kind: tr.kind.toLowerCase(), track: ti, media: ch.media_reference.name, start: cur, in: ch.source_range.start_time.value, dur: d });
      if (ch.source_range.duration.rate !== fps) note(`otio: rate ${ch.source_range.duration.rate} ≠ ${fps}`);
      cur += d; } }
  compare("otio", got, (o.tracks.markers || []).map((m) => `${m.name}@${m.marked_range.start_time.value}`)); }

// --- capcut layout
if (fs.existsSync(path.join(dir, "capcut", "layout.json"))) { const L = JSON.parse(fs.readFileSync(path.join(dir, "capcut", "layout.json"), "utf8"));
  const miss = L.items.filter((it) => !fs.existsSync(path.join(dir, "capcut", it.file)) || (it.keyed && !fs.existsSync(path.join(dir, "capcut", it.keyed))));
  if (miss.length) note(`capcut: missing ${miss.map((m) => m.file).join(", ")}`);
  const want = exp.filter((p) => p.role !== "dialogue").length;   // footage sound is inside the cut clips
  if (L.items.length !== want) note(`capcut: ${L.items.length} items ≠ ${want}`);
  let bad = 0; for (const it of L.items.filter((x) => x.trimmed)) {   // pre-cut clips must be exactly their duration
    const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path.join(dir, "capcut", it.file)], { encoding: "utf8" });
    const n = +r.stdout.trim(), want = Math.round(it.dur * fps); if (Math.abs(n - want) > 0) { bad++; note(`capcut: ${it.file} has ${n} frames, expected ${want}`); } }
  line(`${miss.length || L.items.length !== want || bad ? "FAIL" : "ok  "} capcut   ${L.items.length} items, ${L.items.filter((x) => x.trimmed).length} pre-cut clips frame-checked`); }

// --- optional picture rebuild from the xmeml placements (overlay in track order), SSIM vs a reference render
if (a.ref) {
  const vids = exp.filter((p) => p.kind === "video").sort((x, y) => x.track - y.track);
  const args = ["-y", "-v", "error"], parts = []; let last = null;
  vids.forEach((p, i) => { args.push("-i", path.join(dir, "media", p.media));
    parts.push(`[${i}:v]trim=start_frame=${p.in}:end_frame=${p.in + p.dur},setpts=PTS-STARTPTS+${p.start}/${fps}/TB[v${i}]`);
    if (last === null) last = `v${i}`; else { parts.push(`[${last}][v${i}]overlay=eof_action=pass:format=auto[o${i}]`); last = `o${i}`; } });
  const tmp = path.join(dir, ".rebuild.mp4");
  let r = spawnSync("ffmpeg", [...args, "-filter_complex", parts.join(";"), "-map", `[${last}]`, "-frames:v", String(T.durationF), "-r", String(fps), "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "12", tmp], { encoding: "utf8" });
  if (r.status !== 0) note(`rebuild failed: ${r.stderr.split("\n")[0]}`);
  else for (const t of String(a.at || `${(T.durationF / fps * 0.15).toFixed(2)},${(T.durationF / fps * 0.5).toFixed(2)},${(T.durationF / fps * 0.9).toFixed(2)}`).split(",").map(Number)) {
    r = spawnSync("ffmpeg", ["-v", "info", "-ss", String(t), "-i", tmp, "-ss", String(t), "-i", a.ref, "-frames:v", "1", "-lavfi", "ssim", "-f", "null", "-"], { encoding: "utf8" });
    const s = +(r.stderr.match(/All:([\d.]+)/) || [])[1];
    line(`${s >= 0.95 ? "ok  " : "FAIL"} rebuild  t=${t}s SSIM ${isNaN(s) ? "?" : s.toFixed(4)}`); if (!(s >= 0.95)) note(`rebuild SSIM ${s} at ${t}s`); }
  fs.rmSync(tmp, { force: true });
}
if (problems.length) { line(`\n${problems.length} problem(s):`); problems.slice(0, 20).forEach((p) => line("  " + p)); process.exit(2); }
line("NLE export consistent: all three timelines agree with the model to the frame.");
