#!/usr/bin/env node
// One-line digest of any motion-forge report (render / stills / inspect / evals / motionbench) — read this, not the JSON.
// usage: report.mjs <report.json> [--codes] [--worst 5]
import fs from "node:fs";
const [f, ...rest] = process.argv.slice(2); if (!f) { console.error("usage: report.mjs <report.json> [--worst 5]"); process.exit(1); }
const r = JSON.parse(fs.readFileSync(f, "utf8")), n = +(rest[rest.indexOf("--worst") + 1] || 5);
if (r.results && r.passed != null) { console.log(`${r.failed ? "FAIL" : "PASS"} evals ${r.passed}/${r.passed + r.failed} (${r.skipped} skipped)${r.failed ? " · failed: " + r.results.filter((x) => x.pass === false).map((x) => x.id).join(",") : ""}`); process.exit(0); }
if (r.byMutation) { console.log(`MotionBench recall ${(r.recall * 100).toFixed(1)}% · false alarms ${r.falseAlarms.length} · weakest: ${r.byMutation.slice().sort((x, y) => x.recall - y.recall).slice(0, 2).map((b) => `${b.mutation} ${(b.recall * 100).toFixed(0)}%`).join(", ")}`); process.exit(0); }
const issues = r.issues || [], count = {}; issues.forEach((i) => (count[i.code] = (count[i.code] || 0) + 1));
const sev = (i) => ({ critical: 0, high: 1, medium: 2, low: 3 }[i.severity] ?? 4);
console.log(`${r.verdict || (issues.length ? "ISSUES" : "PASS")} ${r.mode || ""} ${r.comp || ""} · ${Object.entries(count).map(([k, v]) => `${k}×${v}`).join(" ") || "no issues"}`.replace(/\s+/g, " ").trim());
if (!rest.includes("--codes")) issues.slice().sort((x, y) => sev(x) - sev(y)).slice(0, n).forEach((i) => console.log(`  ${i.severity} ${i.code} ${i.el || ""} ${(i.text || "").slice(0, 50)}${i.times ? " @" + i.times.slice(0, 3).map((t) => +(+t).toFixed(2)).join(",") : ""}`));
