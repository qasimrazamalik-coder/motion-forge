#!/usr/bin/env node
// Golden-frame regression: render fixed frames of a composition and compare them with stored references.
// usage: golden.mjs <comp.html> --dir <goldens/name> [--times 0.5,2,4.4 | auto] [--update] [--width 960]
//   --update   (re)write the goldens (do this only after a reviewed, intentional visual change)
// Compares at a reduced width with a tolerant metric (luma SSIM + share of pixels whose R, G or B changed strongly —
// so hue changes count, not just brightness), so sub-perceptual
// anti-aliasing noise passes but real layout/colour/timing drift fails. Exit 0 match · 2 drift · 1 setup error.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, writeJSON, line, SKILL_DIR, MF_HOME } from "./lib/common.mjs";

const a = parseArgs();
const comp = a._[0];
if (!comp || !a.dir) { console.error("usage: golden.mjs <comp.html> --dir <goldens dir> [--times auto|t1,t2] [--update]"); process.exit(1); }
const gdir = path.resolve(a.dir), width = +(a.width || 960);
const manifestPath = path.join(gdir, "golden.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
const times = a.times && a.times !== "auto" ? String(a.times) : manifest && !a.update ? manifest.times.join(",") : "auto";
const tmp = fs.mkdtempSync(path.join(fs.existsSync(MF_HOME) ? MF_HOME : path.dirname(gdir), "golden-"));
const r = spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts/render.mjs"), comp, "--stills", times, "--outdir", tmp, "--no-determinism"], { encoding: "utf8", timeout: 300000 });
const shots = fs.existsSync(tmp) ? fs.readdirSync(tmp).filter((f) => /^\d\d_.*\.png$/.test(f)).sort() : [];
if (!shots.length) { line("FAIL golden render produced no frames", (r.stdout || "").split("\n")[0]); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }
const tOf = (f) => +f.split("_")[1].replace("s", "");
const shrink = (src, dst) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", `scale=${width}:-2:flags=area`, dst]);

if (a.update || !manifest) {
  fs.mkdirSync(gdir, { recursive: true });
  for (const f of fs.readdirSync(gdir)) if (f.endsWith(".png")) fs.rmSync(path.join(gdir, f));
  shots.forEach((f) => shrink(path.join(tmp, f), path.join(gdir, `t${tOf(f).toFixed(2)}.png`)));
  writeJSON(manifestPath, { comp: path.basename(comp), width, times: shots.map(tOf), updated: new Date().toISOString().slice(0, 10) });
  fs.rmSync(tmp, { recursive: true, force: true });
  line(`UPDATED ${shots.length} goldens → ${path.relative(process.cwd(), gdir)}`);
  process.exit(0);
}
const results = [];
for (const f of fs.readdirSync(gdir)) if (f.startsWith("DRIFT_")) fs.rmSync(path.join(gdir, f));   // stale evidence from earlier runs
for (const f of shots) {
  const t = tOf(f), ref = path.join(gdir, `t${t.toFixed(2)}.png`), cur = path.join(tmp, `cur_${t.toFixed(2)}.png`);
  shrink(path.join(tmp, f), cur);
  if (!fs.existsSync(ref)) { results.push({ t, status: "MISSING_GOLDEN" }); continue; }
  const s = spawnSync("ffmpeg", ["-hide_banner", "-i", cur, "-i", ref, "-lavfi", "ssim", "-f", "null", "-"], { encoding: "utf8" });
  const ssim = +((s.stderr.match(/All:([\d.]+)/) || [])[1] || 0);
  const d = spawnSync("ffmpeg", ["-hide_banner", "-i", cur, "-i", ref, "-filter_complex", "[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_mode=difference,lutrgb=r='if(gt(val,64),255,0)':g='if(gt(val,64),255,0)':b='if(gt(val,64),255,0)',format=gray,lut=y='if(gt(val,20),255,0)',signalstats,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8" });
  const strongPct = +(((+((d.stdout.match(/YAVG=([\d.]+)/) || [])[1] || 0)) / 255) * 100).toFixed(3);
  const drift = ssim < 0.985 || strongPct > 0.25;
  results.push({ t, ssim: +ssim.toFixed(4), strongPct, status: drift ? "DRIFT" : "MATCH" });
  if (drift) fs.copyFileSync(cur, path.join(gdir, `DRIFT_t${t.toFixed(2)}.png`));
}
fs.rmSync(tmp, { recursive: true, force: true });
const bad = results.filter((x) => x.status !== "MATCH");
writeJSON(path.join(gdir, "last-check.json"), { when: new Date().toISOString(), results });
line(`${bad.length ? "DRIFT" : "MATCH"} ${path.basename(gdir)}: ${results.length - bad.length}/${results.length} frames match` + (bad.length ? "" : `, min ssim ${Math.min(...results.map((x) => x.ssim)).toFixed(4)}`));
bad.forEach((x) => line(`  ${x.status} t=${x.t}s ssim=${x.ssim ?? "-"} strong=${x.strongPct ?? "-"}%  (see DRIFT_t${x.t.toFixed(2)}.png vs t${x.t.toFixed(2)}.png)`));
process.exit(bad.length ? 2 : 0);
