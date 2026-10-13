#!/usr/bin/env node
// Deterministic regression harness for motion-forge (the scripted half of the eval suite; evals/evals.json holds the
// agent-level briefs and rubrics). Renders every template/fixture, validates outputs, and proves QA catches planted bugs.
// usage: run-evals.mjs [--only A,B,...] [--full] [--work dir]
//   default = quick mode: half-scale + JPEG draft capture for videos (stills are always full-res PNG).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, resolvePackage, writeJSON, line, SKILL_DIR, MF_HOME } from "./lib/common.mjs";

const a = parseArgs();
const only = a.only ? String(a.only).split(",") : null;
const work = path.resolve(a.work || path.join(MF_HOME, "evals-work", new Date().toISOString().replace(/[:.]/g, "-")));
fs.mkdirSync(work, { recursive: true });
const S = (f) => path.join(SKILL_DIR, "scripts", f);
const node = (script, args, opts = {}) => { const r = spawnSync(process.execPath, [S(script), ...args], { encoding: "utf8", cwd: work, timeout: opts.timeout || 900000, env: { ...process.env, ...(opts.env || {}) } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "").split("\n").filter((l) => !/^\s*frame /.test(l)).join("\n") }; };
const vid = a.full ? [] : ["--scale", "0.5", "--fast"];
const results = [];
const rec = (id, name, checks, extra = {}) => { const pass = checks.every((c) => c.ok); results.push({ id, name, pass, checks, ...extra });
  line(`${pass ? "PASS" : "FAIL"} ${id} ${name}`); checks.filter((c) => !c.ok || a.verbose).forEach((c) => line(`   ${c.ok ? "ok " : "XX "} ${c.what}${c.detail ? " — " + c.detail : ""}`)); };
const report = (dir) => { try { return JSON.parse(fs.readFileSync(dir, "utf8")); } catch { return null; } };
const require_md5 = (f) => { const r = spawnSync("ffmpeg", ["-v", "error", "-i", f, "-map", "0:v", "-f", "framemd5", "-"], { encoding: "utf8" }); return r.status === 0 ? r.stdout.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop().trim()).join("|") : "ERR:" + f; };
const codes = (rep) => new Set((rep?.issues || []).map((i) => i.code));
const copyFixture = (name, dest) => { fs.cpSync(path.join(SKILL_DIR, "evals", "fixtures", name), dest, { recursive: true });
  fs.copyFileSync(path.join(SKILL_DIR, "runtime", "mf-runtime.js"), path.join(dest, "mf-runtime.js"));
  fs.cpSync(path.join(SKILL_DIR, "assets", "fonts"), path.join(dest, "fonts"), { recursive: true }); };

function renderCase(id, name, dir, { w, h, fps, dur, video = true, perf = 0 }) {
  const checks = [];
  const st = node("render.mjs", [path.join(dir, "index.html"), "--stills", "auto", "--score", "--outdir", path.join(dir, "out/frames")]);
  const srep = report(path.join(dir, "out/frames/report.json"));
  checks.push({ what: "stills render + in-page QA clean", ok: st.code === 0, detail: st.code ? st.out.split("\n").slice(0, 4).join(" | ") : `${srep?.outputs?.length} frames` });
  checks.push({ what: "deterministic re-seek", ok: !codes(srep).has("NONDETERMINISTIC_FRAME") });
  checks.push({ what: "measured text contrast meets WCAG on every settled text block", ok: !codes(srep).has("LOW_CONTRAST"), detail: (srep?.issues || []).filter((i) => i.code === "LOW_CONTRAST").map((i) => `${i.el} ${i.contrast}:1`).slice(0, 3).join(", ") });
  checks.push({ what: "contact sheet produced", ok: fs.existsSync(path.join(dir, "out/frames/contact-sheet.png")) });
  let vrep = null;
  if (video) {
    const out = path.join(dir, "out/video.mp4");
    const v = node("render.mjs", [path.join(dir, "index.html"), "--out", out, ...vid]);
    checks.push({ what: "video render", ok: v.code === 0, detail: v.code ? v.out.split("\n").slice(0, 3).join(" | ") : "" });
    const sc = a.full ? 1 : 0.5;
    const io = node("inspect-output.mjs", [out, "--width", String(w * sc), "--height", String(h * sc), "--fps", String(fps), "--duration", String(dur), "--json", path.join(dir, "out/inspect.json")]);
    vrep = report(path.join(dir, "out/inspect.json"));
    checks.push({ what: "delivery metadata (dims/fps/duration/frames) + no black/blank/static", ok: io.code === 0, detail: io.out.split("\n")[0] });
  }
  let perfRep = null;
  if (perf) { const p = node("render.mjs", [path.join(dir, "index.html"), "--perf", String(perf), "--outdir", path.join(dir, "out/perf")]);
    perfRep = report(path.join(dir, "out/perf/report.json"));
    checks.push({ what: "realtime playback without errors", ok: p.code === 0, detail: perfRep?.perf ? `fps=${perfRep.perf.fpsAvg} p95=${perfRep.perf.frameP95}ms janky=${perfRep.perf.over33ms} heap=${perfRep.perf.heapMB}MB` : p.out.split("\n")[0] }); }
  const seekP95 = srep?.stats?.seekP95;
  checks.push({ what: "seek cost p95 < 120ms (render-loop budget)", ok: seekP95 == null || seekP95 < 120, detail: `p95=${seekP95}ms` });
  rec(id, name, checks, { stills: srep?.outputs?.slice(-1)[0], video: vrep, perf: perfRep?.perf, seek: srep?.stats });
}

const want = (id) => !only || only.includes(id);
const scaffold = (tpl, dir, extra = [], env = {}) => node("scaffold.mjs", [tpl, dir, "--force", ...extra], { env });

if (want("A")) { const d = path.join(work, "A-kinetic"); scaffold("kinetic-type", d); renderCase("A", "kinetic typography (16:9)", d, { w: 1920, h: 1080, fps: 30, dur: 10 });
  const d2 = path.join(work, "A2-social"); scaffold("social-916", d2); renderCase("A2", "social 9:16 kinetic", d2, { w: 1080, h: 1920, fps: 30, dur: 8 }); }
if (want("B")) { const d = path.join(work, "B-mark"); const s = scaffold("gsap", d); renderCase("B", `mark reveal (${/vendored gsap/.test(s.out) ? "GSAP engine" : "MF engine"})`, d, { w: 1920, h: 1080, fps: 30, dur: 5 }); }
if (want("C")) {
  const d = path.join(work, "C-webgl"); scaffold("webgl", d); renderCase("C", "WebGL2 shader scene", d, { w: 1920, h: 1080, fps: 30, dur: 8 });
  const d3 = path.join(work, "C3-three"); const s = scaffold("threejs", d3);
  if (/vendored three/.test(s.out)) renderCase("C3", "Three.js scene", d3, { w: 1920, h: 1080, fps: 30, dur: 8 });
  else { results.push({ id: "C3", name: "Three.js scene", pass: null, skipped: "three not installed locally (npm i three, or MF_NODE_PATH)" }); line("SKIP C3 Three.js scene — three not found locally"); }
}
if (want("D")) { const d = path.join(work, "D-brand"); copyFixture("brand-film", d); renderCase("D", "multi-act brand film (continuity device)", d, { w: 1920, h: 1080, fps: 30, dur: 14 }); }
if (want("E")) { const d = path.join(work, "E-perf"); scaffold("webgl", d); renderCase("E", "performance: realtime WebGL playback", d, { w: 1920, h: 1080, fps: 30, dur: 8, video: false, perf: 4 }); }
if (want("F")) {
  const checks = [], base = path.join(work, "F-recovery");
  const stage = (label, patch) => { const d = path.join(base, label); copyFixture("recovery-broken", d); const f = path.join(d, "index.html");
    let src = fs.readFileSync(f, "utf8"); for (const [x, y] of patch) src = src.replace(x, y); fs.writeFileSync(f, src);
    const r = node("render.mjs", [f, "--stills", "auto", "--outdir", path.join(d, "out")]); return { r, rep: report(path.join(d, "out/report.json")) }; };
  const s1 = stage("1-as-is", []);
  checks.push({ what: "crash detected and surfaced with a source location (undefined __dbg in render)", ok: s1.r.code === 3 && /first frame failed/.test(s1.r.out) && /at render/.test(s1.r.out), detail: s1.r.out.split("\n")[0].slice(0, 160) });
  const noCrash = [["window.__dbg.frames++;", ""]];
  const s2 = stage("2-crash-fixed", noCrash); const c2 = codes(s2.rep);
  for (const c of ["TIMELINE_NOT_WIRED", "FONT_MISSING", "REQUEST_FAILED", "IMAGE_FAILED", "NONDETERMINISTIC_FRAME"]) checks.push({ what: `detects ${c}`, ok: c2.has(c) });
  const s3 = stage("3-wired", [...noCrash, ["  // timeline: tl", "  , timeline: tl //"]]);   // leading comma: render() precedes it in the literal
  const c3 = codes(s3.rep);
  for (const c of ["NAN_VALUE", "TEXT_CLIPPED_BY_FRAME"]) checks.push({ what: `detects ${c} once the timeline runs`, ok: c3.has(c), detail: s3.r.code === 3 ? s3.r.out.split("\n")[0] : "" });
  const d4 = path.join(base, "4-reference-fix"); fs.mkdirSync(d4, { recursive: true }); copyFixture("recovery-fixed", d4);
  const r4 = node("render.mjs", [path.join(d4, "index.html"), "--stills", "auto", "--outdir", path.join(d4, "out")]);
  checks.push({ what: "reference repair renders clean (regression gate goes green)", ok: r4.code === 0, detail: r4.out.split("\n").slice(0, 3).join(" | ") });
  rec("F", "recovery: planted defects are detected, repair passes", checks);
}

if (want("G")) {   // template library v2 — each one renders clean, scores clean, and (where it matters) delivers correctly
  const env = {};
  const d1 = path.join(work, "G-promo"); scaffold("promo", d1); renderCase("G1", "promo (data-driven, multi-aspect)", d1, { w: 1920, h: 1080, fps: 30, dur: 12, video: false });
  const d2 = path.join(work, "G-barrace"); scaffold("bar-race", d2); renderCase("G2", "data chart: bar race", d2, { w: 1920, h: 1080, fps: 30, dur: 14, video: false });
  const d3 = path.join(work, "G-walkthrough"); scaffold("ui-walkthrough", d3); renderCase("G3", "UI walkthrough", d3, { w: 1920, h: 1080, fps: 30, dur: 14, video: false });
  const d4 = path.join(work, "G-whatif"); const s4 = scaffold("whatif-3d", d4, [], env);
  if (/vendored three/.test(s4.out)) renderCase("G4", "what-if 3D reel (Three.js)", d4, { w: 1080, h: 1920, fps: 30, dur: 15, video: false });
  else { results.push({ id: "G4", name: "what-if 3D reel", pass: null, skipped: "three not installed locally" }); line("SKIP G4 what-if 3D — three not found locally"); }
  const d5 = path.join(work, "G-lowerthird"); scaffold("lower-thirds", d5);
  const checks = [];
  for (const st of ["bar", "card", "minimal"]) { const r = node("render.mjs", [path.join(d5, "index.html"), "--stills", "2.5", "--score", "--query", "style=" + st, "--outdir", path.join(d5, "out", st)]);
    checks.push({ what: `style ${st}: stills + QA + contrast clean`, ok: r.code === 0 && !codes(report(path.join(d5, "out", st, "report.json"))).has("LOW_CONTRAST"), detail: r.out.split("\n")[0] }); }
  const av = node("render.mjs", [path.join(d5, "index.html"), "--out", path.join(d5, "out/lt.mp4"), "--formats", "alpha", "--scale", "0.5"]);
  const tags = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream_tags=alpha_mode", "-of", "csv=p=0", path.join(d5, "out/lt_alpha.webm")], { encoding: "utf8" }).stdout.trim();
  checks.push({ what: "alpha delivery: VP9 webm carries an alpha channel", ok: av.code === 0 && tags === "1", detail: `alpha_mode=${tags || "none"}` });
  const fr = path.join(d5, "out/alpha_probe.png");
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-c:v", "libvpx-vp9", "-ss", "2.5", "-i", path.join(d5, "out/lt_alpha.webm"), "-frames:v", "1", "-vf", "crop=8:8:0:0,format=rgba", "-f", "rawvideo", fr]);
  const px = fs.existsSync(fr) ? fs.readFileSync(fr) : null;
  checks.push({ what: "alpha delivery: background really transparent (corner alpha = 0)", ok: !!px && px[3] === 0, detail: px ? `corner rgba=${[...px.subarray(0, 4)]}` : "no frame" });
  rec("G5", "lower-thirds pack (3 styles, alpha)", checks);
}
if (want("H")) {   // pipelines: one brief → all formats, CSV batch, beat analysis, brand kit
  const checks = [], d = path.join(work, "H-pipelines"); scaffold("promo", d);
  const v = node("variants.mjs", [path.join(d, "index.html"), "--out", path.join(d, "out/promo"), "--aspects", "16:9,9:16,1:1,4:5", "--stills"]);
  checks.push({ what: "variants: 4 aspects re-compose and pass QA", ok: v.code === 0, detail: v.out.split("\n").filter((l) => /PASS|FAIL/.test(l)).slice(0, 5).join(" | ") });
  fs.writeFileSync(path.join(d, "rows.csv"), 'slug,brand,headline,points[],cta\nacme,Acme,Ship the report before lunch,Drafts itself|Checks every figure|Sends on time,acme.example\nnorth,Northwind,Close the month in a day,Matches receipts|Flags outliers|Explains changes,northwind.example\n');
  const b = node("batch.mjs", [path.join(d, "index.html"), "--csv", path.join(d, "rows.csv"), "--out", path.join(d, "out/batch"), "--aspects", "9:16,1:1", "--stills"]);
  checks.push({ what: "batch: 2 CSV rows × 2 aspects render clean", ok: b.code === 0, detail: b.out.split("\n").filter((l) => /PASS|FAIL|rows?/.test(l)).slice(-1)[0] });
  const wav = path.join(d, "click120.wav");   // synthetic 120 BPM click track: a tone burst every 0.5 s
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=1000:duration=12", "-af", "volume='if(lt(mod(t,0.5),0.04),1,0)':eval=frame", path.join(d, "click120.wav")]);
  const bt = node("beats.mjs", [wav, "--out", path.join(d, "beats.json")]); const bj = report(path.join(d, "beats.json"));
  checks.push({ what: "beats: 120 BPM click track detected within 2%", ok: bt.code === 0 && bj && Math.abs(bj.bpm - 120) / 120 < 0.02, detail: bj ? `bpm=${bj.bpm} conf=${bj.confidence}` : bt.out.split("\n")[0] });
  fs.writeFileSync(path.join(d, "brand.json"), JSON.stringify({ name: "Eval Co", colors: { ground: "#0F1A2B", ink: "#F2F4F8", mute: "#A9B4C6", signal: "#FFB020" } }));
  const bc = node("brand.mjs", ["check", path.join(d, "brand.json")]), ba = node("brand.mjs", ["apply", path.join(d, "brand.json"), d]);
  const css = fs.existsSync(path.join(d, "brand.css")) ? fs.readFileSync(path.join(d, "brand.css"), "utf8") : "";
  checks.push({ what: "brand: check passes and apply writes --mf-* vars", ok: bc.code === 0 && ba.code === 0 && /--mf-signal: #FFB020/.test(css), detail: bc.out.split("\n")[0] });
  const br = node("render.mjs", [path.join(d, "index.html"), "--stills", "auto", "--score", "--outdir", path.join(d, "out/branded")]);
  checks.push({ what: "branded render passes QA + measured contrast", ok: br.code === 0 && !codes(report(path.join(d, "out/branded/report.json"))).has("LOW_CONTRAST"), detail: br.out.split("\n")[0] });
  rec("H", "pipelines: variants · batch · beats · brand", checks);
}
if (want("I")) {   // golden-frame regression + QA catches the v2 defect classes
  const checks = [], d = path.join(work, "I-golden"); scaffold("kinetic-type", d);
  const gdir = path.join(SKILL_DIR, "evals", "goldens", "kinetic-type");
  const g1 = node("golden.mjs", [path.join(d, "index.html"), "--dir", gdir, "--times", "auto", "--width", "640"]);
  checks.push({ what: "kinetic-type matches its stored goldens", ok: g1.code === 0, detail: g1.out.split("\n")[0] });
  const f = path.join(d, "index.html"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("--signal: var(--mf-signal, #E0421C)", "--signal: var(--mf-signal, #1C6BE0)"));
  const gdir2 = path.join(work, "I-goldens-copy"); fs.cpSync(gdir, gdir2, { recursive: true });
  const g2 = node("golden.mjs", [f, "--dir", gdir2, "--times", "auto", "--width", "640"]);
  checks.push({ what: "planted colour change (accent red → blue) is caught as DRIFT", ok: g2.code === 2, detail: g2.out.split("\n")[0] });
  const p = path.join(work, "I-planted"); scaffold("base", p);
  const pf = path.join(p, "index.html");
  fs.writeFileSync(pf, fs.readFileSync(pf, "utf8").replace('<div class="bar" id="bar"></div>', '<div class="bar" id="bar"></div>\n  <p id="collide" style="position:absolute;left:calc(var(--u)*8);bottom:calc(var(--u)*12);margin:0;font-size:calc(var(--u)*5)">Collides with the title</p>\n  <p id="faint" style="position:absolute;right:calc(var(--u)*8);top:calc(var(--u)*8);margin:0;font-size:calc(var(--u)*2.4);color:#2A2A28">Barely there</p>'));
  const r = node("render.mjs", [pf, "--stills", "auto", "--score", "--outdir", path.join(p, "out")]); const c = codes(report(path.join(p, "out/report.json")));
  checks.push({ what: "detects TEXT_OVERLAP (planted label over the title)", ok: c.has("TEXT_OVERLAP") });
  checks.push({ what: "detects LOW_CONTRAST (planted near-ground grey, measured from pixels)", ok: c.has("LOW_CONTRAST") });
  rec("I", "regression: goldens + planted v2 defects", checks);
}

if (want("J")) {   // v3 production + footage tools, each checked by measurement, not by exit code alone
  const checks = [], d = path.join(work, "J-v3"); scaffold("promo", d);
  const comp = path.join(d, "index.html"), ff = (args) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  const gray = (f, t, w, h) => spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 }).stdout;
  // motion blur: same frame with and without blur must differ where things move, and the video must keep its frame count
  node("render.mjs", [comp, "--out", path.join(d, "sharp.mp4"), "--from", "0.5", "--to", "1.2", "--scale", "0.5"]);
  const mb = node("render.mjs", [comp, "--out", path.join(d, "blur.mp4"), "--from", "0.5", "--to", "1.2", "--scale", "0.5", "--motion-blur", "4"]);
  const A = gray(path.join(d, "sharp.mp4"), 0.3, 240, 136), B = gray(path.join(d, "blur.mp4"), 0.3, 240, 136);
  let diff = 0; if (A && B && A.length === B.length) for (let i = 0; i < A.length; i++) diff += Math.abs(A[i] - B[i]) > 12 ? 1 : 0;
  const nf = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path.join(d, "blur.mp4")], { encoding: "utf8" }).stdout.trim();
  checks.push({ what: "motion blur: real sub-frame blur (moving pixels differ) and frame count kept", ok: mb.code === 0 && diff > 50 && +nf === 21, detail: `changed px=${diff}, frames=${nf}` });
  // render cache
  const c2 = node("render.mjs", [comp, "--out", path.join(d, "sharp.mp4"), "--from", "0.5", "--to", "1.2", "--scale", "0.5"]);
  checks.push({ what: "render cache: unchanged composition + flags → CACHED", ok: /^CACHED/.test(c2.out), detail: c2.out.split("\n")[0].slice(0, 80) });
  // sfx loudness
  ff(["-f", "lavfi", "-i", "sine=f=220:d=12", "-ar", "48000", path.join(d, "m.wav")]);
  const sx = node("sfx.mjs", [comp, "--out", path.join(d, "mix.wav"), "--music", path.join(d, "m.wav")]);
  const I = +((spawnSync("ffmpeg", ["-hide_banner", "-i", path.join(d, "mix.wav"), "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/I:\s+(-?[\d.]+) LUFS/g) || ["I: 0"]).pop().match(/-?[\d.]+/)[0]);
  checks.push({ what: "sfx: cues on labels, mix at −14 LUFS (±1)", ok: sx.code === 0 && Math.abs(I + 14) <= 1, detail: `${I} LUFS · ${sx.out.split("\n")[0].slice(0, 70)}` });
  // footage: silence cut, transcript cut, reframe, overlay
  ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=10", "-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*300*t)*(lt(mod(t,3.3),1.6))':d=10:s=48000", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(d, "talk.mp4")]);
  const sc = node("silence-cut.mjs", [path.join(d, "talk.mp4"), "--out", path.join(d, "talk_cut.mp4")]);
  const dur = +spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(d, "talk_cut.mp4")], { encoding: "utf8" }).stdout;
  checks.push({ what: "silence-cut: 10 s with 3 pauses → about 5.6 s of speech", ok: sc.code === 0 && Math.abs(dur - 5.6) < 0.4, detail: `${dur.toFixed(2)} s` });
  const words = "so um today I want to show you know how the render loop uh works".split(" ").map((w, i) => ({ word: w, start: 0.3 + i * 0.4, end: 0.62 + i * 0.4 }));
  fs.writeFileSync(path.join(d, "words.json"), JSON.stringify(words));
  const tc = node("transcript-cut.mjs", [path.join(d, "talk.mp4"), "--words", path.join(d, "words.json"), "--fillers", "--out", path.join(d, "t.mp4")]);
  const cj = report(path.join(d, "t.cuts.json"));
  checks.push({ what: "transcript-cut: fillers (um, you know, uh) removed, rest kept", ok: tc.code === 0 && cj && ["um", "you", "know", "uh"].every((w) => cj.removedWords.includes(w)) && !cj.removedWords.includes("render"), detail: cj ? cj.removedWords.join(" ") : tc.out.slice(0, 80) });
  ff(["-f", "lavfi", "-i", "color=c=0x202428:s=1280x720:r=30:d=8", "-f", "lavfi", "-i", "color=c=0xF0E6D0:s=180x200:r=30:d=8", "-filter_complex", "[0][1]overlay=x='if(lt(t,4),150+200*t,950-150*(t-4))':y=260", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(d, "subj.mp4")]);
  const rf = node("reframe.mjs", [path.join(d, "subj.mp4"), "--aspect", "9:16", "--out", path.join(d, "subj916.mp4")]);
  const centres = [1, 3, 5, 7].map((t) => { const g = gray(path.join(d, "subj916.mp4"), t, 406, 720); if (!g) return null; let s = 0, n = 0; for (let y = 0; y < 720; y += 8) for (let x = 0; x < 406; x++) if (g[y * 406 + x] > 150) { s += x; n++; } return n ? s / n / 406 : null; });
  checks.push({ what: "reframe: moving subject stays centred in the 9:16 crop (0.35–0.65)", ok: rf.code === 0 && centres.every((c) => c != null && c > 0.35 && c < 0.65), detail: centres.map((c) => (c == null ? "lost" : c.toFixed(2))).join(" ") });
  const ae = node("export-ae.mjs", [comp, "--out", path.join(d, "x.jsx"), "--video", path.join(d, "sharp.mp4")]);
  fs.copyFileSync(path.join(d, "x.jsx"), path.join(d, "x_check.js"));
  const syn = spawnSync(process.execPath, ["--check", path.join(d, "x_check.js")], { encoding: "utf8" });
  checks.push({ what: "export-ae: JSX generated with markers + animated nulls and parses", ok: ae.code === 0 && syn.status === 0 && /addNull/.test(fs.readFileSync(path.join(d, "x.jsx"), "utf8")), detail: ae.out.split("\n")[0].slice(0, 90) });
  const dr = node("directions.mjs", [comp, "--n", "2"]);
  checks.push({ what: "directions: two art directions render and pass QA", ok: dr.code === 0 && (dr.out.match(/PASS (editorial|night)/g) || []).length === 2, detail: dr.out.split("\n").slice(-1)[0].slice(0, 80) });
  rec("J", "v3 production + footage tools", checks);
}

if (want("K")) {   // v0.4: layers → NLE timelines, social captions, social edit, hook lab
  const ff = (args) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  const d = path.join(work, "K-nle"), checks = []; fs.rmSync(d, { recursive: true, force: true }); scaffold("promo", d);
  const comp = path.join(d, "index.html");
  const ly = node("layers.mjs", [comp, "--out", path.join(d, "out/layers"), "--scale", "0.5"]);
  const lj = report(path.join(d, "out/layers/layers.json"));
  checks.push({ what: "layers: one alpha layer per element in paint order, background opaque", ok: ly.code === 0 && lj && lj.layers.length >= 3 && lj.layers[0].layer === "background" && lj.layers.slice(1).every((l) => l.alpha), detail: lj ? lj.layers.map((l) => l.layer).join(" → ") : ly.out.slice(0, 90) });
  ff(["-f", "lavfi", "-i", "sine=f=220:d=12", "-ac", "2", "-ar", "48000", path.join(d, "bed.wav")]);
  fs.writeFileSync(path.join(d, "c.srt"), "1\n00:00:00,500 --> 00:00:02,000\nHello\n");
  const ex = node("export-nle.mjs", ["--layers", path.join(d, "out/layers/layers.json"), "--audio", path.join(d, "bed.wav") + ":music", "--srt", path.join(d, "c.srt"), "--out", path.join(d, "out/nle")]);
  node("render.mjs", [comp, "--out", path.join(d, "out/ref.mp4"), "--scale", "0.5", "--no-qa"]);
  const nc = node("nle-check.mjs", [path.join(d, "out/nle"), "--ref", path.join(d, "out/ref.mp4")]);
  const xl = spawnSync("xmllint", ["--noout", path.join(d, "out/nle/timeline.fcpxml"), path.join(d, "out/nle/timeline_xmeml.xml")], { encoding: "utf8" });
  checks.push({ what: "export-nle: FCPXML + xmeml + OTIO agree to the frame, rebuild ≈ full render (SSIM ≥ 0.95), CapCut pack complete", ok: ex.code === 0 && nc.code === 0 && (xl.error || xl.status === 0), detail: nc.out.split("\n").filter((l) => /rebuild|FAIL/.test(l)).join(" ").slice(0, 110) });
  // social captions template
  const dc = path.join(work, "K-caps"); scaffold("captions-social", dc);
  const cr = node("render.mjs", [path.join(dc, "index.html"), "--stills", "0.7,3.5", "--score", "--outdir", path.join(dc, "out/frames")]);
  const crep = report(path.join(dc, "out/frames/report.json"));
  checks.push({ what: "captions-social: word-timed captions + hook title + progress, no HIGH issues", ok: cr.code === 0 && crep && !crep.issues.some((i) => /high|critical/.test(i.severity)), detail: crep ? `${crep.issues.length} issues` : cr.out.slice(0, 80) });
  // social edit on synthetic speech: 3 sentences, a filler, a long pause
  const ds = path.join(work, "K-social"); fs.rmSync(ds, { recursive: true, force: true }); fs.mkdirSync(ds, { recursive: true });
  const txt = ["So um today we fix your edits.", "PAUSE", "Most people cut in the wrong order.", "Why does nobody talk about this?"];
  let t = 0.3; const words = [];
  for (const part of txt) { if (part === "PAUSE") { t += 1.4; continue; } for (const w of part.split(" ")) { const du = 0.2 + 0.03 * w.length; words.push({ word: w, start: +t.toFixed(3), end: +(t + du).toFixed(3) }); t += du + 0.06; } t += 0.45; }
  const D = +(t + 0.4).toFixed(2); fs.writeFileSync(path.join(ds, "words.json"), JSON.stringify(words));
  const expr = words.map((w) => `between(t,${w.start},${w.end})*sin(2*PI*190*t)*0.5`).join("+");
  ff(["-f", "lavfi", "-i", `color=c=0x2a3038:s=640x360:r=30:d=${D}`, "-f", "lavfi", "-i", `aevalsrc='${expr}':s=48000:d=${D}`, "-filter_complex", "[0]drawbox=x='240+150*sin(t)':y=80:w=120:h=240:color=0xd9b48c:t=fill[v]", "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(ds, "talk.mp4")]);
  const se = node("social-edit.mjs", [path.join(ds, "talk.mp4"), "--words", path.join(ds, "words.json"), "--out", path.join(ds, "reel.mp4"), "--aspect", "9:16", "--loop", "--nle", path.join(ds, "nle")]);
  const sr = report(path.join(ds, "reel.report.json"));
  const nc2 = node("nle-check.mjs", [path.join(ds, "nle")]);
  checks.push({ what: "social-edit: question hook pulled to the front, filler + long pause cut, 9:16, captions + SRT + EDL", ok: se.code === 0 && sr && /nobody/i.test(sr.hook?.sentence || "") && sr.fillersCut.includes("um") && sr.height > sr.width && sr.duration < D && fs.existsSync(path.join(ds, "reel.srt")) && /PASS/.test(sr.inspect), detail: sr ? `${D}s → ${sr.duration}s · hook "${sr.hook?.sentence}" · ${sr.inspect.slice(0, 50)}` : se.out.slice(0, 100) });
  checks.push({ what: "social-edit → export-nle (EDL): timelines agree, CapCut clips pre-cut to the frame", ok: nc2.code === 0, detail: nc2.out.split("\n").filter((l) => /capcut|FAIL/.test(l)).join(" ").slice(0, 100) });
  const hl = node("hooklab.mjs", [path.join(ds, "talk.mp4"), "--words", path.join(ds, "words.json"), "--out", path.join(ds, "hooks"), "--aspect", "9:16", "--seconds", "2.5", "--titles", "A|B|C"]);
  const nh = ["A", "B", "C"].filter((k) => fs.existsSync(path.join(ds, "hooks", `hook_${k}.mp4`))).length;
  checks.push({ what: "hooklab: 3 ranked cold-open variants + pick sheet", ok: hl.code === 0 && nh === 3 && fs.existsSync(path.join(ds, "hooks", "pick-sheet.png")), detail: hl.out.split("\n")[1]?.slice(0, 90) });
  rec("K", "v0.4 layers, NLE timelines, social edit, hook lab", checks);
}

if (want("L")) {   // v0.5: speed engine, VFX, AI assets (fallbacks + mocked adapters + guardrails), audit, prompt coach, secret scan
  const ff = (args) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  const md5 = (f) => require_md5(f);
  const d = path.join(work, "L-v05"), checks = []; fs.rmSync(d, { recursive: true, force: true }); scaffold("captions-social", d);
  const dj = JSON.parse(fs.readFileSync(path.join(d, "data.json"), "utf8")); dj.progress = false; fs.writeFileSync(path.join(d, "data.json"), JSON.stringify(dj));
  const comp = path.join(d, "index.html"), t0 = Date.now();
  const oldR = node("render.mjs", [comp, "--out", path.join(d, "old.mp4"), "--capture", "pw", "--no-dedupe", "--no-qa", "--workers", "1", "--force", "--to", "3"]); const tOld = Date.now() - t0, t1 = Date.now();
  const newR = node("render.mjs", [comp, "--out", path.join(d, "new.mp4"), "--no-qa", "--workers", "1", "--force", "--to", "3"]); const tNew = Date.now() - t1;
  const reused = +((newR.out.match(/(\d+)\/\d+ frames reused/) || [])[1] || 0);
  checks.push({ what: "speed: dedupe + CDP capture give identical frames, fewer captures, faster", ok: oldR.code === 0 && newR.code === 0 && md5(path.join(d, "old.mp4")) === md5(path.join(d, "new.mp4")) && reused > 30 && tNew < tOld, detail: `${(tOld / 1000).toFixed(1)}s → ${(tNew / 1000).toFixed(1)}s · ${reused} frames reused · ${md5(path.join(d, "old.mp4")) === md5(path.join(d, "new.mp4")) ? "identical" : "DIFFERENT"}` });
  const v1 = node("vfx.mjs", [path.join(d, "new.mp4"), "--out", path.join(d, "film1.mp4"), "--look", "film"]), v2 = node("vfx.mjs", [path.join(d, "new.mp4"), "--out", path.join(d, "film2.mp4"), "--look", "film"]);
  const looks = ["cinematic", "dream", "vhs", "glitch", "punchy", "clean"].map((l) => node("vfx.mjs", [path.join(d, "new.mp4"), "--out", path.join(d, `${l}.mp4`), "--look", l]).code);
  checks.push({ what: "vfx: every look renders; same input + seed → identical frames", ok: v1.code === 0 && v2.code === 0 && looks.every((c) => c === 0) && md5(path.join(d, "film1.mp4")) === md5(path.join(d, "film2.mp4")), detail: v1.out.split("\n")[0].slice(0, 90) });
  // assets: fallbacks, cache, guardrails, mocked paid adapters
  const home = path.join(d, "mfhome"), envA = { MF_HOME: home, FAL_KEY: "", REPLICATE_API_TOKEN: "", ELEVENLABS_API_KEY: "" };
  const kinds = [["image", "a.png"], ["video", "v.mp4"], ["sfx", "s.wav"], ["music", "m.wav"]].map(([k, f]) => node("assets.mjs", [k, "calm ocean, no text", "--out", path.join(d, "assets", f), "--duration", "2", "--size", "640x360"], { env: envA }).code);
  const again = node("assets.mjs", ["image", "calm ocean, no text", "--out", path.join(d, "assets", "a2.png"), "--size", "640x360"], { env: envA });
  const deny = node("assets.mjs", ["image", "nude person", "--out", path.join(d, "assets", "x.png")], { env: envA }), like = node("assets.mjs", ["image", "photo of Taylor Swift", "--out", path.join(d, "assets", "y.png")], { env: envA });
  const man = report(path.join(d, "assets", "assets.json"));
  checks.push({ what: "assets: free fallbacks for every kind, cached repeat, provenance log, content + likeness guardrails", ok: kinds.every((c) => c === 0) && /cached/.test(again.out) && deny.code !== 0 && like.code !== 0 && Array.isArray(man) && man.length >= 4, detail: `kinds ${kinds.join(",")} · repeat ${/cached/.test(again.out) ? "cached" : "NOT cached"} · deny ${deny.code} · likeness ${like.code}` });
  const mk = path.join(d, "mock.mjs");
  fs.writeFileSync(mk, `import { startMock } from ${JSON.stringify(path.join(SKILL_DIR, "evals", "fixtures", "mock-providers.mjs"))};
const m = await startMock(); Object.assign(process.env, { FAL_KEY: "mock-fal", FAL_BASE: m.url, REPLICATE_API_TOKEN: "mock-r8", REPLICATE_BASE: m.url, ELEVENLABS_API_KEY: "mock-el", ELEVENLABS_BASE: m.url, MF_HOME: ${JSON.stringify(path.join(d, "mockhome"))} });
const { generate } = await import(${JSON.stringify(path.join(SKILL_DIR, "scripts", "lib", "providers.mjs"))}); const res = [];
for (const [kind, provider, ext] of [["image","fal","png"],["image","replicate","png"],["video","fal","mp4"],["voice","eleven","wav"],["sfx","eleven","wav"]]) { try { await generate({ kind, provider, prompt: "test", out: ${JSON.stringify(path.join(d, "mock"))} + "/" + kind + "_" + provider + "." + ext, seed: 1, width: 640, height: 360, duration: 2, maxCost: 1 }); res.push("ok"); } catch (e) { res.push("ERR " + e.message); } }
let budget = "not enforced"; try { await generate({ kind: "video", provider: "fal", prompt: "x", out: ${JSON.stringify(path.join(d, "mock", "b.mp4"))}, seed: 2, maxCost: 0.01 }); } catch (e) { budget = /exceeds/.test(e.message) ? "enforced" : e.message; }
const auth = m.seen.filter((s) => ["/fal-ai", "/v1/models", "/v1/text", "/v1/sound"].some((p) => s.url.startsWith(p))).every((s) => s.auth); console.log(JSON.stringify({ res, budget, auth, calls: m.seen.length })); await m.close();`);
  const mr = spawnSync(process.execPath, [mk], { encoding: "utf8", timeout: 120000 }); let mj = null; try { mj = JSON.parse(mr.stdout.trim().split("\n").pop()); } catch {}
  checks.push({ what: "assets: fal / Replicate (with polling) / ElevenLabs adapters work against a mock API, auth sent, budget cap enforced", ok: !!mj && mj.res.every((r) => r === "ok") && mj.budget === "enforced" && mj.auth, detail: mj ? `${mj.res.join(",")} · budget ${mj.budget} · ${mj.calls} calls` : (mr.stderr || mr.stdout).slice(0, 100) });
  // audit + prompt coach + secret scan
  fs.writeFileSync(path.join(d, "bad.html"), '<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=X" rel=stylesheet></head><body><div id="stage"><h1 style="font-family:A">Hi</h1></div><script>const r=Math.random()</script></body></html>');
  const ab = node("audit.mjs", [path.join(d, "bad.html"), "--no-render"]), ag = node("audit.mjs", [comp, "--no-render"]);
  const sb = +((ab.out.match(/score (\d+)/) || [])[1] || 0), sg = +((ag.out.match(/score (\d+)/) || [])[1] || 0);
  checks.push({ what: "audit: flags randomness + CDN fonts in a bad comp; clean template scores higher", ok: /Math\.random/.test(ab.out) && /CDN/.test(ab.out) && sg > sb, detail: `bad ${sb}/100 · template ${sg}/100` });
  const pv = node("prompt-coach.mjs", ["make a cool video for my app", "--json"]), pg = node("prompt-coach.mjs", ['12 second 9:16 launch promo for Quire, a note app for students, headline "Write less.", calm premium editorial, brand colours #0b0410, MP4 + transparent webm, soft music, CTA visit quire.app', "--json"]);
  let jv = null, jg = null; try { jv = JSON.parse(pv.out); jg = JSON.parse(pg.out); } catch {}
  checks.push({ what: "prompt-coach: vague brief scores low with questions; complete brief scores ≥ 85", ok: !!jv && !!jg && jv.score < 30 && jv.missing.length >= 6 && jg.score >= 85, detail: jv && jg ? `${jv.score} → ${jg.score}` : pv.out.slice(0, 80) });
  const sd = path.join(d, "scan"); fs.mkdirSync(sd, { recursive: true }); fs.writeFileSync(path.join(sd, "ok.md"), "nothing secret here\n");
  const s1 = node("secret-scan.mjs", [sd]); fs.writeFileSync(path.join(sd, "leak.md"), "key: sk-ant-" + "a".repeat(30) + "\n"); const s2 = node("secret-scan.mjs", [sd]);
  checks.push({ what: "secret-scan: clean tree passes, planted key fails", ok: s1.code === 0 && s2.code === 2, detail: `${s1.code} / ${s2.code}` });
  rec("L", "v0.5 speed, VFX, AI assets, audit, prompt coach, secret scan", checks);
}

const summary = { when: new Date().toISOString(), mode: a.full ? "full" : "quick", work, passed: results.filter((r) => r.pass === true).length, failed: results.filter((r) => r.pass === false).length,
  skipped: results.filter((r) => r.pass === null).length, results };
writeJSON(path.join(work, "results.json"), summary);
writeJSON(path.join(MF_HOME, "evals-latest.json"), summary);
line(`\n${summary.failed ? "FAIL" : "PASS"} evals: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped → ${path.join(work, "results.json")}`);
process.exit(summary.failed ? 2 : 0);
