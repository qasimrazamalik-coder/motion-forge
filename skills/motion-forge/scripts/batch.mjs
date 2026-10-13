#!/usr/bin/env node
// Data-driven batch: one composition × N rows of a CSV (or JSON array) → N personalised videos (× aspects).
// Columns map to the composition's data (MF.data): dotted headers nest ("cta.url"), `points[]`-style headers or a
// "|"-separated cell become arrays. A `slug` (or `id`) column names the outputs.
// usage: batch.mjs <comp.html> --csv rows.csv --out out/batch [--aspects 9:16,1:1] [--stills] [render flags…]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, writeJSON, line, SKILL_DIR } from "./lib/common.mjs";

const a = parseArgs();
const comp = a._[0], src = a.csv || a.json;
if (!comp || !src) { console.error("usage: batch.mjs <comp.html> --csv rows.csv --out out/batch [--aspects 9:16,1:1] [--stills]"); process.exit(1); }
function parseCSV(text) {   // RFC 4180: quotes, escaped quotes, commas/newlines inside quotes
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c; }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}
const raw = fs.readFileSync(src, "utf8");
let records;
if (/\.json$/i.test(src)) records = JSON.parse(raw);
else { const [head, ...body] = parseCSV(raw.replace(/^﻿/, ""));
  records = body.map((r) => { const o = {}; head.forEach((h, i) => { let v = (r[i] ?? "").trim(), key = h.trim(); if (!key) return;
    if (key.endsWith("[]")) { key = key.slice(0, -2); v = v ? v.split("|").map((x) => x.trim()) : []; } else if (v.includes("|")) v = v.split("|").map((x) => x.trim());
    let cur = o; const parts = key.split("."); parts.slice(0, -1).forEach((p) => (cur = cur[p] = cur[p] || {})); cur[parts.at(-1)] = v; }); return o; }); }
const compDir = path.dirname(path.resolve(comp)), dataDir = path.join(compDir, ".batch");
fs.rmSync(dataDir, { recursive: true, force: true }); fs.mkdirSync(dataDir, { recursive: true });
const out = path.resolve(a.out || "out/batch"); fs.mkdirSync(out, { recursive: true });
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const pass = ["fast", "scale", "workers", "crf", "formats", "short", "stills", "aspects"].flatMap((k) => (a[k] === undefined ? [] : a[k] === true ? [`--${k}`] : [`--${k}`, String(a[k])]));
const report = []; let failed = 0;
records.forEach((rec, i) => {
  const slug = slugify(rec.slug || rec.id || rec.brand || rec.headline || `row-${i + 1}`) || `row-${i + 1}`;
  const df = path.join(dataDir, `${String(i + 1).padStart(3, "0")}-${slug}.json`); writeJSON(df, rec);
  const q = "data=" + encodeURIComponent(path.relative(compDir, df).split(path.sep).join("/"));
  const t0 = Date.now();
  let r;
  if (a.aspects) r = spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts/variants.mjs"), comp, "--out", path.join(out, slug), "--query", q, ...pass.filter((x, j, arr) => x !== "--aspects" && arr[j - 1] !== "--aspects"), "--aspects", String(a.aspects)], { encoding: "utf8", timeout: 3600000 });
  else if (a.stills) r = spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts/render.mjs"), comp, "--stills", "auto", "--outdir", path.join(out, slug + "_frames"), "--query", q], { encoding: "utf8", timeout: 1800000 });
  else r = spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts/render.mjs"), comp, "--out", path.join(out, slug + ".mp4"), "--query", q, ...pass], { encoding: "utf8", timeout: 1800000 });
  const ok = r.status === 0; if (!ok) failed++;
  report.push({ row: i + 1, slug, ok, seconds: Math.round((Date.now() - t0) / 1000), data: path.relative(out, df), summary: (r.stdout || "").split("\n").filter((l) => /^(PASS|FAIL)/.test(l)).slice(-1)[0] || (r.stderr || "").split("\n")[0] });
  line(`${ok ? "PASS" : "FAIL"} ${String(i + 1).padStart(3)} ${slug}  ${report.at(-1).summary || ""}`);
});
writeJSON(path.join(out, "batch-report.json"), { comp, source: path.basename(src), rows: records.length, failed, report });
line(`${failed ? "FAIL" : "PASS"} batch: ${records.length - failed}/${records.length} rows → ${path.relative(process.cwd(), out)} (report: batch-report.json)`);
process.exit(failed ? 2 : 0);
