#!/usr/bin/env node
// Analyse pairwise ratings (rating.html CSVs): win rates per condition, Bradley–Terry strengths with bootstrap 95% CIs,
// inter-rater agreement (Fleiss' kappa over pairs rated by ≥2 raters), and — if --scores is given — Spearman correlation
// between human strength per video and the automated score (e.g. MotionBench / --score minContrast or QA issue count).
// usage: node analyze.mjs ratings_*.csv [--scores scores.json] [--out results.md]
//   scores.json: { "<condition or video id>": number }   (higher = better)
import fs from "node:fs";
const args = process.argv.slice(2), files = args.filter((x) => x.endsWith(".csv")), opt = (k) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : null; };
const rows = files.flatMap((f) => { const [h, ...ls] = fs.readFileSync(f, "utf8").trim().split(/\r?\n/); const c = h.split(","); return ls.map((l) => Object.fromEntries(l.split(",").map((v, i) => [c[i], v]))); });
if (!rows.length) { console.error("usage: node analyze.mjs ratings_*.csv [--scores s.json]"); process.exit(1); }
const conds = [...new Set(rows.flatMap((r) => [r.a_cond, r.b_cond]))];
// win rates (ties count half)
const wr = Object.fromEntries(conds.map((c) => { const rs = rows.filter((r) => r.a_cond === c || r.b_cond === c); const w = rs.reduce((s, r) => s + (r.winner === c ? 1 : r.winner === "tie" ? 0.5 : 0), 0); return [c, { n: rs.length, winRate: rs.length ? w / rs.length : null }]; }));
// Bradley–Terry via MM iterations (ties split)
function bt(rs) { const p = Object.fromEntries(conds.map((c) => [c, 1])); for (let it = 0; it < 200; it++) { for (const c of conds) { let w = 0, d = 0;
  for (const r of rs) { if (r.a_cond !== c && r.b_cond !== c) continue; const o = r.a_cond === c ? r.b_cond : r.a_cond; w += r.winner === c ? 1 : r.winner === "tie" ? 0.5 : 0; d += 1 / (p[c] + p[o]); }
  if (d > 0) p[c] = Math.max(1e-6, w / d); } const g = Math.exp(conds.reduce((s, c) => s + Math.log(p[c]), 0) / conds.length); for (const c of conds) p[c] /= g; } return p; }
const P = bt(rows);
let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const boots = Array.from({ length: 500 }, () => bt(rows.map(() => rows[Math.floor(rnd() * rows.length)])));
const ci = Object.fromEntries(conds.map((c) => { const v = boots.map((b) => Math.log(b[c])).sort((x, y) => x - y); return [c, [v[Math.floor(0.025 * v.length)], v[Math.floor(0.975 * v.length)]]]; }));
// Fleiss' kappa over items with ≥2 ratings; categories = winner condition or tie
const byItem = {}; rows.forEach((r) => (byItem[r.id] ||= []).push(r.winner));
const items = Object.values(byItem).filter((v) => v.length >= 2), cats = [...new Set(rows.map((r) => r.winner))];
let kappa = null;
if (items.length) { const n = Math.min(...items.map((v) => v.length)), its = items.map((v) => v.slice(0, n));
  const Pi = its.map((v) => { const cnt = cats.map((c) => v.filter((x) => x === c).length); return (cnt.reduce((s, x) => s + x * x, 0) - n) / (n * (n - 1)); });
  const pj = cats.map((c) => its.reduce((s, v) => s + v.filter((x) => x === c).length, 0) / (its.length * n));
  const Pbar = Pi.reduce((s, x) => s + x, 0) / Pi.length, Pe = pj.reduce((s, x) => s + x * x, 0); kappa = Pe < 1 ? (Pbar - Pe) / (1 - Pe) : 1; }
// Spearman vs automated scores
let rho = null; const sf = opt("scores");
if (sf) { const S = JSON.parse(fs.readFileSync(sf, "utf8")), ks = conds.filter((c) => c in S); const rank = (xs) => { const o = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = []; o.forEach(([, i], k) => (r[i] = k + 1)); return r; };
  if (ks.length >= 3) { const a = rank(ks.map((k) => Math.log(P[k]))), b = rank(ks.map((k) => S[k])), n = ks.length; rho = 1 - (6 * a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0)) / (n * (n * n - 1)); } }
const md = ["# Pairwise rating results", "", `${rows.length} judgements · ${new Set(rows.map((r) => r.rater)).size} raters · ${Object.keys(byItem).length} pairs`, "",
  "| Condition | Judgements | Win rate | Bradley–Terry log-strength (95% CI) |", "|---|---|---|---|",
  ...conds.sort((x, y) => P[y] - P[x]).map((c) => `| ${c} | ${wr[c].n} | ${(wr[c].winRate * 100).toFixed(1)}% | ${Math.log(P[c]).toFixed(2)} (${ci[c][0].toFixed(2)} … ${ci[c][1].toFixed(2)}) |`), "",
  `Inter-rater agreement (Fleiss' κ, ${items.length} multiply-rated pairs): ${kappa == null ? "n/a" : kappa.toFixed(2)}`,
  `Human strength vs automated score (Spearman ρ): ${rho == null ? "n/a (needs --scores with ≥3 conditions)" : rho.toFixed(2)}`].join("\n");
if (opt("out")) fs.writeFileSync(opt("out"), md + "\n");
console.log(md);
