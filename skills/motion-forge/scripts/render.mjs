#!/usr/bin/env node
// motion-forge renderer: deterministic frame-by-frame capture of a composition that implements window.__MF.
//
// Usage:
//   node render.mjs <comp.html> --out out/film.mp4 [--formats mp4,webm,gif,png,alpha,prores] [--fps 30] [--scale 1]
//                   [--from 0 --to 4] [--crf 18] [--audio track.wav] [--root dir] [--no-qa] [--fast (draft: jpeg capture)]
//                   [--workers N (parallel capture; default auto: up to 4 for clips >= 120 frames)]
//   node render.mjs <comp.html> --stills auto|0,1.2,3.5 --outdir out/frames      (representative frames + contact sheet)
//        [--score]  measured WCAG text contrast + layout metrics per still (LOW_CONTRAST issues, report.score)
//   video flags: [--motion-blur 8] sub-frames per frame (real shutter blur; S× capture time) [--shutter 180] degrees
//        [--qa-overlay]  burn QA findings (boxes + labels) into frames/videos — debug and "watch it fix itself" clips
//        [--thumb 320]  contact-sheet thumbnail width (smaller = fewer image tokens when an agent reads it)
//   speed: frames whose composition state is identical to the previous frame are not re-captured (holds, captions,
//        title cards); off automatically when the stage holds canvas/video/iframe, or with --no-dedupe. Capture goes
//        through CDP with optimizeForSpeed (≈30% faster than Playwright screenshots; --capture pw for the old path).
//        [--encoder auto|x264|nvenc|qsv|videotoolbox] hardware H.264 when the machine has it (auto tests, then falls back)
//   node render.mjs <comp.html> --perf 6                                          (realtime playback benchmark)
//
// Output: compact summary on stdout; full detail in <out>.report.json (or <outdir>/report.json).
// Exit code: 0 = no critical issues, 2 = critical issues (console/page errors, failed requests, NaN, missing fonts/images).
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs, launchBrowser, serve, writeJSON, line } from "./lib/common.mjs";
import { scoreFrame } from "./lib/score.mjs";

const args = parseArgs();
const comp = args._[0];
if (!comp || !fs.existsSync(comp)) { console.error("usage: render.mjs <composition.html> --out file.mp4 | --stills auto --outdir dir | --perf seconds"); process.exit(1); }
const compAbs = path.resolve(comp);
const root = path.resolve(args.root || path.dirname(compAbs));
const rel = path.relative(root, compAbs).split(path.sep).join("/");
const scale = +(args.scale || 1);
const mode = args.stills ? "stills" : args.perf ? "perf" : "video";
// H.264 encoder: libx264 by default (best quality per bit). --encoder auto tries hardware encoders with a 1-frame probe
// and falls back to x264, so it never fails on machines without a GPU.
function pickEncoder(want, fast) {
  const x264 = ["-c:v", "libx264", "-preset", args.preset || (fast ? "veryfast" : "medium"), "-crf", String(args.crf || 18)];
  const hw = { nvenc: ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", String(args.crf || 19)], qsv: ["-c:v", "h264_qsv", "-global_quality", String(args.crf || 20)],
    videotoolbox: ["-c:v", "h264_videotoolbox", "-q:v", "65"] };
  if (!want || want === "x264") return x264;
  const order = want === "auto" ? ["nvenc", "qsv", "videotoolbox"] : [want];
  for (const k of order) { if (!hw[k]) continue;
    const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1", ...hw[k], "-f", "null", "-"], { encoding: "utf8" });
    if (r.status === 0) return hw[k]; }
  return x264;
}

// render cache (video mode): same composition files + same flags → reuse the existing output instead of re-rendering
let inputHash = null;
if (mode === "video") {
  const crypto = await import("node:crypto"), h = crypto.createHash("sha1"), outBase = path.resolve(args.out || "out/render.mp4").replace(/\.[^.]+$/, "");
  // media written by our own tools (a sibling sidecar like x.report.json / x.vfx.json shares its base name) is output,
  // not input; any other media next to the comp (bg.png, footage) is input and must invalidate the cache when it changes
  const sidecars = new Map(); const generated = (d, name) => { if (!sidecars.has(d)) sidecars.set(d, fs.readdirSync(d).filter((f) => /\.(report|vfx|edit|cuts|cues)\.json$/.test(f)).map((f) => f.replace(/\.(report|vfx|edit|cuts|cues)\.json$/, "")));
    return sidecars.get(d).some((b) => name.startsWith(b)); };
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
    if (/^(out|node_modules|\.git)$|_frames$|_segments$|\.report\.json$/.test(e.name)) continue; const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (!p.startsWith(outBase) && !(/\.(mp4|webm|gif|mov|mkv|wav|mp3|png|jpe?g)$/i.test(e.name) && generated(d, e.name))) { h.update(path.relative(root, p)); h.update(fs.readFileSync(p)); } } };   // media next to the comp counts (a swapped bg.png must re-render); our own outputs don't
  walk(root);
  const flags = Object.fromEntries(Object.entries(args).filter(([k]) => !["_", "force", "out"].includes(k)).sort());
  h.update(JSON.stringify(flags)); if (args.audio && fs.existsSync(args.audio)) h.update(fs.readFileSync(args.audio));
  inputHash = h.digest("hex").slice(0, 16);
  const out0 = path.resolve(args.out || "out/render.mp4"), rep0 = out0.replace(/\.[^.]+$/, "") + ".report.json";
  if (!args.force && fs.existsSync(rep0)) { try { const r0 = JSON.parse(fs.readFileSync(rep0, "utf8"));
    if (r0.inputHash === inputHash && r0.verdict === "PASS" && (r0.outputs || []).every((o) => fs.existsSync(o))) {
      line(`CACHED video ${rel} — composition and flags unchanged since the last PASS render (${(r0.outputs || []).map((o) => path.relative(process.cwd(), o)).join(", ")}); --force to re-render`); process.exit(0); } } catch {} }
}
const log = { console: [], pageErrors: [], failedRequests: [], qa: [] };
const t0 = Date.now();
const srv = await serve(root);
const browser = await launchBrowser();
let exitCode = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  const fmtList = String(args.formats || path.extname(path.resolve(args.out || "out/render.mp4")).slice(1) || "mp4");   // same fallback as the video branch
  const wantsAlpha = mode === "video" && /(^|,)(alpha|png|prores)(,|$)/.test(fmtList);
  const openPage = async (primary) => {
    const p = await ctx.newPage();
    if (mode !== "perf") await p.addInitScript(() => { window.__MF_RENDER = true; });
    p.on("console", (m) => { if (["error", "warning"].includes(m.type()) && (primary || m.type() === "error")) log.console.push({ type: m.type(), text: m.text().slice(0, 300) }); });
    p.on("pageerror", (e) => log.pageErrors.push(String(e.message || e).slice(0, 300)));
    if (primary) { p.on("requestfailed", (r) => log.failedRequests.push({ url: r.url(), err: r.failure()?.errorText }));
      p.on("response", (r) => { if (r.status() >= 400) log.failedRequests.push({ url: r.url(), status: r.status() }); }); }
    // alpha deliveries: ?alpha=1 tells the runtime to clear html/body/#stage backgrounds and hide preview plates (.mf-plate)
    const q = [args.query, wantsAlpha ? "alpha=1" : ""].filter(Boolean).join("&");
    await p.goto(`${srv.url}/${rel}${q ? "?" + q : ""}`, { waitUntil: "load" });
    const ok = await p.waitForFunction(() => !!window.__MF, null, { timeout: 20000 }).then(() => true).catch(() => false);
    if (!ok) throw new Error("composition never exposed window.__MF (did it call MF.compose()?) " + JSON.stringify(log.pageErrors.slice(0, 3)));
    const readyErr = await p.evaluate(() => window.__MF.ready.then(() => null, (e) => String(e && e.stack ? e.stack.split("\n").slice(0, 2).join(" ") : e)));
    if (readyErr) throw new Error("composition setup/first frame failed: " + readyErr);
    if (mode === "video" && args.capture !== "pw" && scale === 1) {   // CDP ignores deviceScaleFactor < 1 (captures CSS px), so scaled drafts keep the Playwright path   // fast capture path: raw CDP screenshot, CSS animations frozen (they are not seekable)
      p._cdp = await ctx.newCDPSession(p);
      await p.addStyleTag({ content: "*,*::before,*::after{caret-color:transparent!important}" });
      if (wantsAlpha) await p._cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    }
    return p;
  };
  const page = await openPage(true);
  const meta = await page.evaluate(() => window.__MF.meta);
  const W = +(args.width || meta.width), H = +(args.height || meta.height), FPS = +(args.fps || meta.fps);
  const sizePage = async (p) => { await p.setViewportSize({ width: W, height: H }); await p.evaluate(() => window.dispatchEvent(new Event("resize"))); };
  await sizePage(page);
  const from = +(args.from || 0), to = Math.min(+(args.to || meta.duration), meta.duration);

  const qaAt = async (t, tag) => { await page.evaluate((x) => window.__MF.seek(x), t); const r = await page.evaluate(() => window.__MF.qa()); log.qa.push({ t: +t.toFixed(3), tag, issues: r.issues, canvases: r.canvases }); };
  const keyTimes = () => {
    const d = meta.duration, ts = new Map([[0, "open"], [d * 0.25, "q1"], [d * 0.5, "mid"], [d * 0.75, "q3"], [Math.max(0, d - 1 / FPS), "end"]]);
    Object.entries(meta.labels || {}).forEach(([k, v]) => { if (v > 0 && v < d) { ts.set(v, "label:" + k); ts.set(Math.min(d, v + 0.25), "after:" + k); } });
    return [...ts.entries()].sort((a, b) => a[0] - b[0]);
  };

  // --qa-overlay: burn this frame's QA findings into the picture (red = high/critical, amber = medium) + the safe area.
  // The overlay lives outside #stage and is ignored by QA and the determinism digest. For debug/launch videos, not deliveries.
  const overlay = async (p, t) => {   // QA + measured contrast (needs a clean screenshot first), then draw
    await p.evaluate(() => document.getElementById("__mfqa")?.remove());
    const sc = await scoreFrame(p, await p.screenshot({ type: "png" }), t);
    return p.evaluate(drawQaOverlay, sc.issues);
  };
  const drawQaOverlay = (extra) => {
    document.getElementById("__mfqa")?.remove();
    const r = window.__MF.qa(); r.issues = (r.issues || []).concat(extra || []); const st = document.getElementById("stage"), sr = st.getBoundingClientRect(), k = sr.width / st.offsetWidth;
    const o = document.createElement("div"); o.id = "__mfqa"; o.setAttribute("data-mf-qa-ignore", "");
    o.style.cssText = `position:fixed;left:${sr.left}px;top:${sr.top}px;width:${sr.width}px;height:${sr.height}px;pointer-events:none;z-index:2147483647;font:700 ${Math.round(22 * k)}px/1.2 system-ui,sans-serif`;
    const box = (q, col, label, dashed) => { const d = document.createElement("div");
      d.style.cssText = `position:absolute;left:${q[0] - sr.left}px;top:${q[1] - sr.top}px;width:${q[2] - q[0]}px;height:${q[3] - q[1]}px;border:${Math.max(2, 3 * k)}px ${dashed ? "dashed" : "solid"} ${col};box-sizing:border-box;background:${dashed ? "transparent" : col.replace("1)", "0.12)")}`;
      if (label) { const l = document.createElement("span"); l.textContent = label; l.style.cssText = `position:absolute;left:-3px;bottom:100%;background:${col};color:#fff;padding:2px 6px;white-space:nowrap`; d.appendChild(l); }
      o.appendChild(d); };
    (r.issues || []).forEach((i) => { if (!i.rect) return; const col = /high|critical/.test(i.severity) ? "rgba(235,40,40,1)" : "rgba(240,160,20,1)";
      (i.rects || []).forEach((q) => box(q, col, "", true)); box(i.rect, col, i.code.replace(/_/g, " ").toLowerCase()); });
    document.body.appendChild(o);
    return (r.issues || []).length;
  };
  let outputs = [], stats = null, perf = null;
  if (mode === "video") {
    const out = path.resolve(args.out || "out/render.mp4");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const formats = String(args.formats || path.extname(out).slice(1) || "mp4").split(",");
    const alpha = formats.includes("alpha") || formats.includes("png") || formats.includes("prores");
    const frames = Math.round((to - from) * FPS);
    if (!(frames > 0)) throw new Error(`nothing to render: --from ${from} --to ${to} gives ${frames} frames (duration ${meta.duration}s)`);
    const fast = !!args.fast && !alpha;   // draft: JPEG capture ≈2x faster; final deliveries use lossless PNG capture
    const framesDir = alpha ? out.replace(/\.[^.]+$/, "") + "_frames" : null;
    if (framesDir) fs.mkdirSync(framesDir, { recursive: true });
    const master = formats.includes("mp4") || !alpha ? out.replace(/\.[^.]+$/, ".mp4") : null;
    // parallel capture: N pages render contiguous frame ranges; each encodes its own segment, then a lossless concat.
    const cpus = (await import("node:os")).cpus().length;
    const workers = Math.max(1, Math.min(frames, args.workers ? +args.workers : frames >= 120 ? Math.min(4, Math.max(1, Math.floor(cpus / 2))) : 1));
    if (!args["no-qa"]) for (const [t, tag] of keyTimes()) if (t >= from && t <= to) await qaAt(t, tag);
    const segDir = master ? out.replace(/\.[^.]+$/, "") + "_segments" : null;
    if (segDir) { fs.rmSync(segDir, { recursive: true, force: true }); fs.mkdirSync(segDir, { recursive: true }); }
    const bounds = Array.from({ length: workers }, (_, k) => [Math.floor((k * frames) / workers), Math.floor(((k + 1) * frames) / workers)]);
    let done = 0, reused = 0;
    // frame dedupe: hash every attribute + text node of the whole document (inline styles, classes, SVG attrs, CSS vars,
    // <style> text), every CSS rule (catches CSSRulePlugin-style rule edits) and the running-animation count. Anything the
    // hash can't see — canvas/video/iframe/embed, animated images (gif/apng/webp/svg), shadow roots — returns null for that
    // frame, which forces a real capture. Off entirely with --no-dedupe or --qa-overlay.
    const dedupe = !args["no-dedupe"] && !args["qa-overlay"];
    const stateHash = () => {
      if (document.querySelector("canvas,video,iframe,object,embed,img[src$='.gif' i],img[src$='.apng' i],img[src$='.webp' i],img[src$='.svg' i],img[src^='data:image/gif' i]")) return null;
      let h = 2166136261; const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
      for (const el of document.querySelectorAll("*")) { if (el.shadowRoot) return null; if (el.id === "__mfqa") continue; mix("<" + el.tagName); for (const at of el.attributes) mix(at.name + "=" + at.value);
        for (const n of el.childNodes) if (n.nodeType === 3) mix(n.data); }
      for (const sh of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) { try { for (const r of sh.cssRules) mix(r.cssText); } catch { mix("x-origin"); } }
      const an = document.getAnimations ? document.getAnimations() : []; mix("A" + an.length); for (const x of an) mix(String(x.currentTime));
      return h >>> 0; };
    // Playwright's animations:"disabled" semantics on the CDP path: finite CSS/Web animations jump to their end, infinite ones cancel
    const settle = () => { if (!document.getAnimations) return; for (const x of document.getAnimations()) { try { const e = x.effect && x.effect.getComputedTiming().endTime; if (e === Infinity) x.cancel(); else x.finish(); } catch {} } };
    // motion blur: S sub-frames per frame across the shutter (180° = half a frame, centred), averaged by ffmpeg tmix —
    // deterministic because every sub-frame is a pure function of t. Cost: S× capture time.
    const S = alpha ? 1 : Math.max(1, Math.min(32, Math.round(+args["motion-blur"] || 1))), shutter = Math.min(360, Math.max(1, +args.shutter || 180)) / 360;
    if (alpha && args["motion-blur"]) line("  note: --motion-blur is ignored for alpha/png deliveries (render the alpha pass without blur)");
    const blurVf = S > 1 ? `tmix=frames=${S},select='eq(mod(n\\,${S})\\,${S - 1})',setpts=N/${FPS}/TB,` : "";
    const enc = pickEncoder(args.encoder, fast);
    const encodeArgs = (seg) => ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", fast ? "mjpeg" : "png", "-framerate", String(FPS * S), "-i", "-",
      "-vf", `${blurVf}scale=${W * scale}:${H * scale}:flags=lanczos,format=yuv420p`, ...enc, "-r", String(FPS), seg];
    const segFiles = [];
    await Promise.all(bounds.map(async ([i0, i1], k) => {
      const p = k === 0 ? page : await openPage(false);
      if (k !== 0) await sizePage(p);
      let ff = null, ffErr = "";
      if (master && !alpha) { const seg = path.join(segDir, `seg_${String(k).padStart(3, "0")}.mp4`); segFiles[k] = seg;
        ff = spawn("ffmpeg", encodeArgs(seg), { stdio: ["pipe", "ignore", "pipe"] }); ff.stderr.on("data", (d) => (ffErr += d)); }
      for (let i = i0; i < i1; i++) {
        for (let j = 0; j < S; j++) {
          const t = Math.min(meta.duration, Math.max(0, from + (i + (S > 1 ? ((j + 0.5) / S - 0.5) * shutter : 0)) / FPS));
          await p.evaluate((x) => window.__MF.seek(x), t);
          if (args["qa-overlay"] && j === 0) await overlay(p, t);   // once per frame; sub-frames reuse it
          let buf;
          const h = dedupe ? await p.evaluate(stateHash) : null;
          if (h != null && h === p._lastHash && p._lastBuf) { buf = p._lastBuf; reused++; }
          else {
            if (p._cdp) await p.evaluate(settle);
            buf = p._cdp ? Buffer.from((await p._cdp.send("Page.captureScreenshot", fast ? { format: "jpeg", quality: 92, optimizeForSpeed: true } : { format: "png", optimizeForSpeed: true })).data, "base64")
              : await p.screenshot(fast ? { type: "jpeg", quality: 92, animations: "disabled", caret: "hide" } : { type: "png", omitBackground: alpha, animations: "disabled", caret: "hide" });
            p._lastHash = h; p._lastBuf = buf;
          }
          if (framesDir) fs.writeFileSync(path.join(framesDir, `f_${String(i).padStart(5, "0")}.png`), buf);
          if (ff && !ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
        }
        if (++done % Math.max(1, Math.round(FPS * 2)) === 0 && process.stderr.isTTY) process.stderr.write(`\r  frame ${done}/${frames} (${workers} worker${workers > 1 ? "s" : ""})`);   // progress only for humans: piped into an agent it is pure token cost
      }
      if (ff) { ff.stdin.end(); const code = await new Promise((r) => ff.on("close", r)); if (code !== 0) throw new Error(`ffmpeg segment ${k} failed: ` + ffErr.slice(0, 300)); }
      if (k !== 0) await p.close();
    }));
    if (process.stderr.isTTY) process.stderr.write(`\r  frame ${frames}/${frames} (${workers} worker${workers > 1 ? "s" : ""})\n`);
    if (master) {
      const tmp = master + ".tmp.mp4";
      let enc;
      if (alpha) enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(framesDir, "f_%05d.png"), "-vf", `scale=${W * scale}:${H * scale}:flags=lanczos,format=yuv420p`,
        "-c:v", "libx264", "-preset", args.preset || "medium", "-crf", String(args.crf || 18), "-r", String(FPS), tmp], { encoding: "utf8" });
      else { const list = path.join(segDir, "list.txt"); fs.writeFileSync(list, segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
        enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", tmp], { encoding: "utf8" }); }
      if (enc.status !== 0) throw new Error("ffmpeg assemble failed: " + enc.stderr.slice(0, 300));
      const fin = ["-y", "-loglevel", "error", "-i", tmp];
      if (args.audio) fin.push("-i", path.resolve(args.audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest");
      else fin.push("-c", "copy");
      fin.push("-movflags", "+faststart", master);
      const r2 = spawnSync("ffmpeg", fin, { encoding: "utf8" }); if (r2.status !== 0) throw new Error("ffmpeg mux failed: " + r2.stderr.slice(0, 300));
      fs.rmSync(tmp, { force: true }); if (segDir) fs.rmSync(segDir, { recursive: true, force: true });
      outputs.push(master);
    }
    const run = (a, o) => { const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...a, o], { encoding: "utf8" }); if (r.status !== 0) throw new Error("ffmpeg failed for " + o + ": " + r.stderr.slice(0, 300)); outputs.push(o); };
    const base = out.replace(/\.[^.]+$/, "");
    if (formats.includes("webm") && master) run(["-i", master, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-row-mt", "1", "-an"], base + ".webm");
    if (formats.includes("gif") && master) run(["-i", master, "-vf", `fps=${Math.min(FPS, 20)},scale=${Math.min(W, 720)}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`], base + ".gif");
    if (formats.includes("alpha")) run(["-framerate", String(FPS), "-i", path.join(framesDir, "f_%05d.png"), "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", "-auto-alt-ref", "0"], base + "_alpha.webm");
    // ProRes 4444 with alpha: the interchange format Resolve, Premiere and CapCut all read (transparent WebM is not reliable there)
    if (formats.includes("prores")) run(["-framerate", String(FPS), "-i", path.join(framesDir, "f_%05d.png"), "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", "-qscale:v", "9", ...(args.audio ? [] : [])], base + ".mov");
    if (formats.includes("png")) outputs.push(framesDir + "/");
    stats = await page.evaluate(() => window.__MF.stats());
    stats.capture = { frames: frames * S, reused, dedupe: dedupe && reused > 0 ? true : dedupe ? "no static frames" : false, method: page._cdp ? "cdp" : "playwright", encoder: enc[1] };
  } else if (mode === "stills") {
    const outdir = path.resolve(args.outdir || "out/frames");
    fs.mkdirSync(outdir, { recursive: true });
    for (const f of fs.readdirSync(outdir)) if (/^\d\d_.*\.png$|^contact-sheet\.png$|^determinism_[ab]\.png$/.test(f)) fs.rmSync(path.join(outdir, f));   // no stale frames from earlier runs
    const times = args.stills === "auto" || args.stills === true ? keyTimes() : String(args.stills).split(",").map((s) => [+s, "t" + s]);
    const files = [];
    for (const [t, tag] of times) {
      await qaAt(t, tag);
      const f = path.join(outdir, `${String(files.length).padStart(2, "0")}_${t.toFixed(2)}s_${tag.replace(/[^\w.-]/g, "_")}.png`);
      if (args["qa-overlay"]) await overlay(page, t);
      const shot = await page.screenshot({ path: f, type: "png", animations: "disabled", caret: "hide" });
      if (args["qa-overlay"]) await page.evaluate(() => document.getElementById("__mfqa")?.remove());
      files.push(f);
      if (args.score) { const sc = await scoreFrame(page, shot, t); (log.score ||= []).push({ t, tag, ...sc.metrics }); if (sc.issues.length) log.qa.push({ t, tag: "score", issues: sc.issues }); }
    }
    // determinism: re-seek a mid frame after visiting other times. Compare the composition STATE (inline styles, text,
    // canvas pixels) — not page screenshots, whose glyph anti-aliasing varies with Chromium raster-cache history.
    if (files.length > 2 && !args["no-determinism"]) {
      const mid = times[Math.floor(times.length / 2)][0];
      const digest = () => page.evaluate(() => {
        let h = 2166136261; const mix = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } };
        const stage = document.getElementById("stage") || document.body; const diffs = [];
        stage.querySelectorAll("*").forEach((el) => { const st = el.getAttribute("style") || ""; mix(el.tagName + st); diffs.push((el.id || el.className || el.tagName) + "|" + st);
          el.childNodes.forEach((n) => { if (n.nodeType === 3) { mix(n.data); diffs.push("#text|" + n.data); } }); });
        stage.querySelectorAll("canvas").forEach((c) => { try { const d = c.toDataURL("image/png"); mix(d); diffs.push("canvas|" + d.length + "|" + d.slice(-64)); } catch (e) { mix("tainted"); } });
        return { h: h >>> 0, diffs };
      });
      await page.evaluate((x) => window.__MF.seek(x), mid);
      const d1 = await digest();
      await page.evaluate((x) => window.__MF.seek(x), meta.duration * 0.9);
      await page.evaluate((x) => window.__MF.seek(x), 0);
      await page.evaluate((x) => window.__MF.seek(x), mid);
      const d2 = await digest();
      if (d1.h !== d2.h) {
        const changed = d1.diffs.map((l, i) => (l !== d2.diffs[i] ? l.split("|")[0] + ": " + l.split("|").slice(1).join("|").slice(0, 60) + " ≠ " + (d2.diffs[i] || "").split("|").slice(1).join("|").slice(0, 60) : null)).filter(Boolean).slice(0, 3);
        log.qa.push({ t: mid, tag: "determinism", issues: [{ code: "NONDETERMINISTIC_FRAME", severity: "high", text: `same t produced different state (${changed.join(" ; ")}) — remove Math.random/Date.now/accumulated rAF state; use MF.rng(seed) and t` }] });
      }
    }
    // contact sheet (labelled), downscaled for cheap visual review
    const sheet = path.join(outdir, "contact-sheet.png");
    // image tokens ≈ px/750: the default sheet (4×480 px) is ~1.6k tokens; --thumb 320 roughly halves it for quick checks
    const cols = Math.min(4, files.length), tw = +args.thumb || (H > W ? 270 : 480);
    const inputs = files.flatMap((f) => ["-i", f]);
    const filt = files.map((f, i) => `[${i}:v]scale=${tw}:-2,drawtext=text='${path.basename(f).split("_").slice(1, 3).join(" ").replace(/'/g, "")}':x=8:y=8:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4[v${i}]`).join(";");
    const layout = files.map((_, i) => `${(i % cols)}_${Math.floor(i / cols)}`).map((p) => { const [c, r] = p.split("_").map(Number); return `${c ? Array.from({ length: c }, () => "w0").join("+") : 0}_${r ? Array.from({ length: r }, () => "h0").join("+") : 0}`; }).join("|");
    let r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${filt};${files.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=black`, sheet], { encoding: "utf8" });
    if (r.status !== 0 && files.length === 1) fs.copyFileSync(files[0], sheet);
    else if (r.status !== 0) {
      // drawtext may be unavailable (no fontconfig) — retry without labels
      const filt2 = files.map((f, i) => `[${i}:v]scale=${tw}:-2[v${i}]`).join(";");
      r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${filt2};${files.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=black`, sheet], { encoding: "utf8" });
    }
    outputs = [...files, fs.existsSync(sheet) ? sheet : null].filter(Boolean);
    stats = await page.evaluate(() => window.__MF.stats());
  } else {
    // realtime perf: let the preview loop run, sample frame intervals + heap
    const secs = +args.perf || 6;
    perf = await page.evaluate(async (secs) => {
      const iv = []; let last = performance.now(); const end = last + secs * 1000; let longTasks = 0;
      try { new PerformanceObserver((l) => (longTasks += l.getEntries().length)).observe({ entryTypes: ["longtask"] }); } catch {}
      await new Promise((res) => { (function f(now) { iv.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else res(); })(performance.now()); });
      iv.shift(); iv.sort((a, b) => a - b);
      const q = (p) => +iv[Math.min(iv.length - 1, Math.floor(p * iv.length))].toFixed(2);
      return { frames: iv.length, fpsAvg: +(iv.length / secs).toFixed(1), frameP50: q(0.5), frameP95: q(0.95), frameMax: q(1), over33ms: iv.filter((x) => x > 33.4).length, longTasks,
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, extra: window.__MF.stats() };
    }, secs);
    perf.note = "headless software GL (SwiftShader) unless MF_GPU=1 — treat absolute fps as a lower bound; compare runs relatively";
  }

  // ------------------------------------------------------------ verdict
  const allIssues = log.qa.flatMap((q) => q.issues.map((i) => ({ ...i, t: q.t })));
  // an element with an id is one issue even if its text changes (counters, years)
  const dedup = new Map(); allIssues.forEach((i) => { const k = i.code + "|" + (i.el || "") + "|" + (/#/.test(i.el || "") ? "" : (i.text || i.font || i.src || "")); if (!dedup.has(k)) dedup.set(k, { ...i, times: [i.t] }); else dedup.get(k).times.push(i.t); });
  const issues = [...dedup.values()];
  const errors = [...log.pageErrors.map((e) => ({ code: "PAGE_ERROR", severity: "critical", text: e })),
    ...log.console.filter((c) => c.type === "error").map((c) => ({ code: "CONSOLE_ERROR", severity: "critical", text: c.text })),
    ...log.failedRequests.map((r) => ({ code: "REQUEST_FAILED", severity: "critical", text: r.url.replace(srv.url, "") + " " + (r.status || r.err) }))];
  const all = [...errors, ...issues];
  const critical = all.filter((i) => i.severity === "critical" || i.severity === "high");
  exitCode = critical.length ? 2 : 0;
  const report = { comp: rel, mode, inputHash, meta: { ...meta, renderWidth: W * scale, renderHeight: H * scale, fps: FPS, from, to }, outputs, stats, perf,
    verdict: critical.length ? "FAIL" : "PASS", issues: all, ...(log.score ? { score: log.score } : {}), warnings: log.console.filter((c) => c.type === "warning").slice(0, 20), elapsedSec: +((Date.now() - t0) / 1000).toFixed(1) };
  const reportPath = mode === "video" ? path.resolve(args.out || "out/render.mp4").replace(/\.[^.]+$/, "") + ".report.json" : path.join(path.resolve(args.outdir || "out/" + mode), "report.json");
  writeJSON(reportPath, report);

  line(`${report.verdict} ${mode} ${rel} ${W * scale}x${H * scale}@${FPS} ${meta.duration}s engine=${meta.engine} in ${report.elapsedSec}s`);
  if (stats && stats.seekP95 != null) line(`  seek p50=${stats.seekP50}ms p95=${stats.seekP95}ms${stats.capture ? ` · capture ${stats.capture.method}, ${stats.capture.reused}/${stats.capture.frames} frames reused${stats.capture.dedupe === false ? " (dedupe off)" : ""}, ${stats.capture.encoder}` : ""}`);
  if (perf) line(`  perf fps=${perf.fpsAvg} p95=${perf.frameP95}ms janky=${perf.over33ms} longTasks=${perf.longTasks} heap=${perf.heapMB}MB`);
  // compact by design: an agent reads this — issues first, then one line per output group (full list in the report JSON)
  all.slice(0, 8).forEach((i) => line(`  ${i.severity.toUpperCase()} ${i.code} ${i.el || ""} ${(i.text || i.font || i.src || i.prop || "").toString().slice(0, 70)}${i.times ? " @" + i.times.slice(0, 3).map((x) => +(+x).toFixed(2)).join(",") + "s" : ""}`));
  if (all.length > 8) line(`  …${all.length - 8} more issues`);
  const pngs = outputs.filter((o) => /\.png$/.test(o) && !/contact-sheet/.test(o)), others = outputs.filter((o) => !pngs.includes(o));
  if (pngs.length > 3 && !args.verbose) line(`  out ${pngs.length} frames → ${path.relative(process.cwd(), path.dirname(pngs[0])) || "."}/`);
  else pngs.forEach((o) => line("  out", path.relative(process.cwd(), o)));
  others.forEach((o) => line("  out", path.relative(process.cwd(), o)));
  line("  report", path.relative(process.cwd(), reportPath));
} catch (e) {
  line("FAIL render-error", e.message.split("\n").slice(0, 3).join(" | "));
  if (log.pageErrors.length) line("  page errors:", log.pageErrors.slice(0, 3).join(" | "));
  exitCode = 3;
} finally {
  await browser.close();
  await srv.close();
}
process.exit(exitCode);
