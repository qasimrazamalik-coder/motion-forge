#!/usr/bin/env node
// One composition → every delivery format. Renders the composition once per aspect via ?w=&h= (the composition must
// build its frame with MF.frame() and re-compose per [data-aspect]), then validates each output.
// usage: variants.mjs <comp.html> --out out/promo [--aspects 16:9,9:16,1:1,4:5] [--short 1080] [--stills] [render flags…]
//   --stills   only render QA stills per aspect (fast check before committing to videos)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, SKILL_DIR } from "./lib/common.mjs";

const a = parseArgs();
const comp = a._[0];
if (!comp) { console.error("usage: variants.mjs <comp.html> --out out/name [--aspects 16:9,9:16,1:1,4:5] [--short 1080] [--stills]"); process.exit(1); }
const out = path.resolve(a.out || "out/variant");
const short = +(a.short || 1080);
const even = (n) => Math.round(n / 2) * 2;
const sizeOf = (ar) => { const [x, y] = ar.split(":").map(Number); return x >= y ? [even((short * x) / y), short] : [short, even((short * y) / x)]; };
const pass = ["fast", "scale", "workers", "crf", "preset", "formats", "audio", "fps"].flatMap((k) => (a[k] === undefined ? [] : a[k] === true ? [`--${k}`] : [`--${k}`, String(a[k])]));
const extraQuery = a.query ? "&" + a.query : "";
let failures = 0; const rows = [];
for (const ar of String(a.aspects || "16:9,9:16,1:1,4:5").split(",")) {
  const [w, h] = sizeOf(ar), tag = ar.replace(":", "x");
  const q = `w=${w}&h=${h}${extraQuery}`;
  const args = a.stills ? [comp, "--stills", "auto", "--outdir", `${out}_${tag}_frames`, "--query", q] : [comp, "--out", `${out}_${tag}.mp4`, "--query", q, ...pass];
  const r = spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts/render.mjs"), ...args], { encoding: "utf8", timeout: 1800000 });
  const first = (r.stdout || "").split("\n")[0];
  const m = first.match(/ (\d+)x(\d+)@/); const got = m ? [+m[1], +m[2]] : null;
  const sc = +(a.scale || 1);
  const sizeOk = got && got[0] === w * sc && got[1] === h * sc;
  let verdict = r.status === 0 && sizeOk ? "PASS" : "FAIL";
  let insp = "";
  if (!a.stills && verdict === "PASS") {
    const dur = (r.stdout.match(/ ([\d.]+)s engine=/) || [])[1];
    const i = spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts/inspect-output.mjs"), `${out}_${tag}.mp4`, "--width", String(w * sc), "--height", String(h * sc), "--duration", dur || "0"], { encoding: "utf8" });
    insp = (i.stdout || "").split("\n")[0]; if (i.status !== 0) verdict = "FAIL";
  }
  if (verdict !== "PASS") failures++;
  rows.push({ aspect: ar, size: `${w}x${h}`, verdict });
  line(`${verdict} ${ar.padEnd(5)} ${w}x${h}${!sizeOk && got ? `  ✗ composition rendered ${got.join("x")} — it ignores ?w=&h= (build the frame with MF.frame())` : ""}`);
  (r.stdout || "").split("\n").slice(1).filter((l) => /CRITICAL|HIGH|MEDIUM|report|frames\/contact|_frames\/contact/.test(l)).slice(0, 5).forEach((l) => line("   " + l.trim()));
  if (insp) line("   " + insp);
}
line(`${failures ? "FAIL" : "PASS"} variants: ${rows.length - failures}/${rows.length}`);
process.exit(failures ? 2 : 0);
