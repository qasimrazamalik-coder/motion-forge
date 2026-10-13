#!/usr/bin/env node
// MotionBench (detector track): how reliably does motion-forge's QA catch real layout/render defects, and how often
// does it cry wolf? Every template is rendered clean (false-alarm check) and with planted defects, each with a known
// expected issue code (recall check). The defects are planted after setup through a wrapper on MF.compose, so they apply
// to any composition without editing its source.
// usage: motionbench.mjs [--templates a,b] [--mutations m1,m2] [--work dir] [--out bench-results]
//   prints a per-mutation recall table and the clean false-alarm rate; writes results.json + results.md
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, writeJSON, SKILL_DIR, MF_HOME } from "./lib/common.mjs";

const a = parseArgs();
const S = (f) => path.join(SKILL_DIR, "scripts", f);
const ALL_T = fs.readdirSync(path.join(SKILL_DIR, "templates")).filter((d) => fs.existsSync(path.join(SKILL_DIR, "templates", d, "template.json"))).sort();
const TEMPLATES = a.templates ? String(a.templates).split(",") : ALL_T;
// mutation → expected QA codes (any of them counts as a detection)
const MUT = {
  offsafe:  { expect: ["TEXT_OUTSIDE_SAFE_ZONE", "TEXT_CLIPPED_BY_FRAME"], what: "headline pushed into the platform-UI margin (inside the frame, outside the safe area)" },
  clip:     { expect: ["TEXT_CLIPPED_BY_FRAME", "TEXT_OFFSCREEN_VISIBLE"], what: "headline half off the right edge" },
  overlap:  { expect: ["TEXT_OVERLAP"], what: "a second label set on top of the headline" },
  contrast: { expect: ["LOW_CONTRAST"], what: "headline recoloured to within 12% of its background" },
  font:     { expect: ["FONT_MISSING"], what: "headline set in a font that is not loaded" },
  nondet:   { expect: ["NONDETERMINISTIC_FRAME"], what: "a style that changes randomly on every render" },
  image:    { expect: ["IMAGE_FAILED", "REQUEST_FAILED"], what: "a broken <img> reference" },
};
const MUTS = a.mutations ? String(a.mutations).split(",") : Object.keys(MUT);
const work = path.resolve(a.work || path.join(MF_HOME, "motionbench-work"));
const outDir = path.resolve(a.out || "bench-results");
fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });

// injected after mf-runtime.js: wraps MF.compose so the defect is planted once the composition has built its DOM
const inject = (m) => `<script>/* motionbench mutation: ${m} */
(function () { var M = ${JSON.stringify(m)}, c = MF.compose;
  function target() { var st = document.getElementById("stage"); var list = st.querySelectorAll("[data-mf-text], h1, h2, .title, .headline");
    for (var i = 0; i < list.length; i++) { if (list[i].textContent.trim().length > 2) return list[i]; } return st.querySelector("p, div"); }
  MF.compose = function (cfg) { var setup = cfg.setup, render = cfg.render;
    cfg.setup = async function () { if (setup) await setup.apply(this, arguments); var el = target(), st = document.getElementById("stage"); if (!el) return;
      var W = st.offsetWidth, rg = document.createRange(); rg.selectNodeContents(el); var r = rg.getBoundingClientRect(), sr = st.getBoundingClientRect(), k = sr.width / W;   // the TEXT's box, not the block's
      var left = (r.left - sr.left) / k, width = r.width / k;
      // move the whole top-level layer that holds the headline (moving the text inside its own reveal mask would only hide it)
      var layer = el; while (layer.parentElement && layer.parentElement !== st) layer = layer.parentElement;
      if (M === "offsafe") layer.style.translate = (0.01 * W - left) + "px 0px";
      if (M === "clip") layer.style.translate = (W - left - width * 0.5) + "px 0px";
      if (M === "overlap") { var d = document.createElement("div"); d.textContent = "Overlapping label"; var cs = getComputedStyle(el);
        d.style.cssText = "position:absolute;left:" + left + "px;top:" + ((r.top - sr.top) / k + (r.height / k) * 0.25) + "px;font:600 " + Math.max(24, parseFloat(cs.fontSize) * 0.6) + "px sans-serif;color:" + cs.color + ";white-space:nowrap;z-index:9";
        st.appendChild(d); }
      if (M === "contrast") { var bg = (function (n) { for (; n; n = n.parentElement) { var b = getComputedStyle(n).backgroundColor; if (b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)) return b; } return "rgb(0,0,0)"; })(el);
        el.style.setProperty("color", "color-mix(in srgb, " + bg + " 88%, " + getComputedStyle(el).color + ")", "important");
        el.querySelectorAll("*").forEach(function (x) { x.style.setProperty("color", "inherit", "important"); }); }
      if (M === "font") { el.style.fontFamily = "NoSuchFontXYZ"; el.querySelectorAll("*").forEach(function (x) { x.style.fontFamily = "NoSuchFontXYZ"; }); }
      if (M === "image") { var im = document.createElement("img"); im.src = "bench-missing-image.png"; im.style.cssText = "position:absolute;left:0;top:0;width:10px;height:10px"; st.appendChild(im); }
    };
    if (M === "nondet") { var n = 0; cfg.render = function () { if (render) render.apply(this, arguments); var el = target(); if (el) el.style.letterSpacing = (Math.random() * 0.02).toFixed(4) + "em"; }; }
    return c(cfg); };
})();</script>`;

const rows = [];
const libs = process.env.MF_NODE_PATH ? {} : {};
for (const t of TEMPLATES) {
  const base = path.join(work, t);
  const sc = spawnSync(process.execPath, [S("scaffold.mjs"), t, base, "--force"], { encoding: "utf8", env: process.env });
  if (sc.status !== 0 || (/needs/.test(fs.readFileSync(path.join(SKILL_DIR, "templates", t, "template.json"), "utf8")) && !fs.existsSync(path.join(base, "vendor")))) { line(`SKIP ${t} (scaffold failed or library missing)`); continue; }
  for (const m of ["clean", ...MUTS]) {
    const d = path.join(work, `${t}__${m}`); fs.rmSync(d, { recursive: true, force: true }); fs.cpSync(base, d, { recursive: true });
    const f = path.join(d, "index.html");
    if (m !== "clean") fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('<script src="mf-runtime.js"></script>', `<script src="mf-runtime.js"></script>\n${inject(m)}`));
    const r = spawnSync(process.execPath, [S("render.mjs"), f, "--stills", "auto", "--score", "--thumb", "240", "--outdir", path.join(d, "out")], { encoding: "utf8", timeout: 600000 });
    let rep = null; try { rep = JSON.parse(fs.readFileSync(path.join(d, "out", "report.json"), "utf8")); } catch {}
    const codes = [...new Set((rep?.issues || []).map((i) => i.code))], sev = (rep?.issues || []).filter((i) => /high|critical/.test(i.severity)).map((i) => i.code);
    const crashed = !rep;
    const row = { template: t, mutation: m, crashed, exit: r.status, codes, highCodes: [...new Set(sev)] };
    if (m === "clean") row.falseAlarm = row.highCodes.length > 0 || crashed;
    else row.detected = !crashed && MUT[m].expect.some((c) => codes.includes(c));
    rows.push(row);
    line(`${m === "clean" ? (row.falseAlarm ? "FALSE-ALARM" : "clean-ok   ") : row.detected ? "DETECTED   " : "MISSED     "} ${t.padEnd(15)} ${m.padEnd(9)} ${codes.join(",") || "-"}`);
  }
}
// --- summary
const byMut = MUTS.map((m) => { const rs = rows.filter((r) => r.mutation === m); const hit = rs.filter((r) => r.detected).length; return { mutation: m, what: MUT[m].what, n: rs.length, detected: hit, recall: rs.length ? +(hit / rs.length).toFixed(3) : null, missed: rs.filter((r) => !r.detected).map((r) => r.template) }; });
const clean = rows.filter((r) => r.mutation === "clean"), fa = clean.filter((r) => r.falseAlarm);
const totalMut = byMut.reduce((s, b) => s + b.n, 0), totalHit = byMut.reduce((s, b) => s + b.detected, 0);
const summary = { when: new Date().toISOString(), templates: TEMPLATES.length, runs: rows.length, recall: totalMut ? +(totalHit / totalMut).toFixed(3) : null,
  falseAlarmRate: clean.length ? +(fa.length / clean.length).toFixed(3) : null, falseAlarms: fa.map((r) => ({ template: r.template, codes: r.highCodes })), byMutation: byMut, rows };
writeJSON(path.join(outDir, "results.json"), summary);
const md = [`# MotionBench — detector track (${summary.when.slice(0, 10)})`, "", `Templates: ${clean.length} clean + ${totalMut} mutated renders. **Overall recall ${(summary.recall * 100).toFixed(1)}%**, **clean false-alarm rate ${(summary.falseAlarmRate * 100).toFixed(1)}%** (HIGH/CRITICAL issues on unmodified templates).`, "",
  "| Planted defect | Expected code | Detected | Recall | Missed on |", "|---|---|---|---|---|",
  ...byMut.map((b) => `| ${b.what} | ${MUT[b.mutation].expect.join(" / ")} | ${b.detected}/${b.n} | ${(b.recall * 100).toFixed(0)}% | ${b.missed.join(", ") || "—"} |`), "",
  fa.length ? `False alarms: ${fa.map((r) => `${r.template} (${r.highCodes.join(", ")})`).join("; ")}` : "No false alarms on clean templates."].join("\n");
fs.writeFileSync(path.join(outDir, "results.md"), md + "\n");
line(`\nMotionBench: recall ${(summary.recall * 100).toFixed(1)}% over ${totalMut} planted defects · false alarms ${fa.length}/${clean.length} clean templates → ${path.relative(process.cwd(), path.join(outDir, "results.md"))}`);
