#!/usr/bin/env node
// Validated-lesson memory for motion-forge. Store: $MF_HOME/lessons.jsonl (+ preferences.json).
// Seeded once from <skill>/memory/lessons.seed.jsonl. Lessons are conclusions, never reasoning transcripts.
//
//   lessons.mjs recall "<task words>" [--category c] [--limit 5] [--all]      relevance-ranked validated lessons (compact)
//   lessons.mjs add --category render --symptom "..." --root-cause "..." --fix "..." --verification "..." \
//                   [--scope general|project:<name>|template:<id>] [--confidence 0.8] [--reuse "when ..."] [--context "..."]
//                   (no --verification  => status=candidate, not recalled by default)
//   lessons.mjs promote <id> --verification "..."      candidate -> validated
//   lessons.mjs hit <id>                                 record a successful reuse (raises rank)
//   lessons.mjs obsolete <id> --reason "..."             retire (kept for audit, never recalled)
//   lessons.mjs prune [--max 150] [--dry]                dedupe/merge near-duplicates, drop stale candidates, cap size
//   lessons.mjs stats | list [--status s]
//   lessons.mjs pref set <key> <value> --explicit        durable preference (requires --explicit: user stated it)
//   lessons.mjs pref get [key] | pref rm <key>
import fs from "node:fs";
import path from "node:path";
import { parseArgs, MF_HOME, SKILL_DIR, line } from "./lib/common.mjs";

const a = parseArgs();
const [cmd, ...rest] = a._;
const STORE = path.join(MF_HOME, "lessons.jsonl"), PREFS = path.join(MF_HOME, "preferences.json");
const SEED = path.join(SKILL_DIR, "memory", "lessons.seed.jsonl");
const CATEGORIES = ["render", "timing", "easing", "typography", "composition", "color", "threejs", "webgl", "gsap", "performance", "export", "audio", "assets", "qa", "workflow", "creative"];
fs.mkdirSync(MF_HOME, { recursive: true });
if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, fs.existsSync(SEED) ? fs.readFileSync(SEED, "utf8") : "");

const load = () => fs.readFileSync(STORE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const save = (rows) => { const tmp = STORE + ".tmp"; fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "")); fs.renameSync(tmp, STORE); };
const STOP = new Set("the a an and or of to in on for with is are be it this that when from by as at not no use using".split(" "));
const toks = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9.#+-]+/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
const jacc = (x, y) => { let i = 0; x.forEach((w) => y.has(w) && i++); return i / (x.size + y.size - i || 1); };
const text = (l) => [l.category, l.context, l.symptom, l.root_cause, l.fix, l.reuse_condition].join(" ");
const today = () => new Date().toISOString().slice(0, 10);
const score = (l, q) => { const ageDays = (Date.now() - Date.parse(l.date)) / 864e5; return (q ? jacc(q, toks(text(l))) * 3 : 0) + (l.confidence || 0.5) + Math.min(l.hits || 0, 10) * 0.08 - Math.min(ageDays / 365, 1) * 0.3; };
const compact = (l) => `[${l.id}] (${l.category}${l.scope && l.scope !== "general" ? ", " + l.scope : ""}, c=${l.confidence}) ${l.symptom} → ${l.fix}${l.reuse_condition ? " | when: " + l.reuse_condition : ""}`;

const rows = load();
switch (cmd) {
  case "recall": {
    const q = toks(rest.join(" ") + " " + (a.category || ""));
    let pool = rows.filter((l) => l.status === "validated" || (a.all && l.status !== "obsolete"));
    if (a.category) pool = pool.filter((l) => l.category === a.category);
    if (a.scope) pool = pool.filter((l) => !l.scope || l.scope === "general" || l.scope === a.scope);
    const ranked = pool.map((l) => [score(l, q), l]).filter(([s, l]) => !q.size || jacc(q, toks(text(l))) > 0 || a.category).sort((x, y) => y[0] - x[0]).slice(0, +(a.limit || 5));
    if (!ranked.length) line("no relevant lessons"); else ranked.forEach(([, l]) => line(compact(l)));
    break;
  }
  case "add": {
    for (const k of ["category", "symptom", "root-cause", "fix"]) if (!a[k]) { console.error("missing --" + k); process.exit(1); }
    if (!CATEGORIES.includes(a.category)) { console.error("category must be one of: " + CATEGORIES.join(",")); process.exit(1); }
    const l = { id: "L" + Date.now().toString(36).slice(-6), date: today(), category: a.category, context: a.context || "", symptom: a.symptom, root_cause: a["root-cause"], fix: a.fix,
      verification: a.verification || "", scope: a.scope || "general", confidence: Math.max(0.1, Math.min(1, +(a.confidence || (a.verification ? 0.75 : 0.4)))),
      reuse_condition: a.reuse || "", status: a.verification ? "validated" : "candidate", hits: 0, version: 1 };
    const t = toks(text(l)); const dup = rows.find((r) => r.status !== "obsolete" && r.category === l.category && jacc(t, toks(text(r))) > 0.6);
    if (dup) { dup.hits = (dup.hits || 0) + 1; dup.confidence = +Math.min(1, dup.confidence + 0.05).toFixed(2); dup.version = (dup.version || 1) + 1; dup.date = today();
      if (l.verification && dup.status === "candidate") { dup.status = "validated"; dup.verification = l.verification; }
      save(rows); line(`merged into existing ${dup.id} (near-duplicate); confidence=${dup.confidence}`); }
    else { rows.push(l); save(rows); line(`added ${l.id} status=${l.status}`); }
    break;
  }
  case "promote": { const l = rows.find((r) => r.id === rest[0]); if (!l || !a.verification) { console.error("need <id> and --verification"); process.exit(1); }
    l.status = "validated"; l.verification = a.verification; l.confidence = Math.max(l.confidence, 0.75); l.version++; save(rows); line("promoted " + l.id); break; }
  case "hit": { const l = rows.find((r) => r.id === rest[0]); if (!l) process.exit(1); l.hits = (l.hits || 0) + 1; l.last_used = today(); save(rows); line(`hit ${l.id} (${l.hits})`); break; }
  case "obsolete": { const l = rows.find((r) => r.id === rest[0]); if (!l) process.exit(1); l.status = "obsolete"; l.obsolete_reason = a.reason || ""; l.version++; save(rows); line("obsoleted " + l.id); break; }
  case "prune": {
    const max = +(a.max || 150); let removed = [], merged = [];
    const live = rows.filter((r) => r.status !== "obsolete");
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const x = live[i], y = live[j]; if (x._gone || y._gone || x.category !== y.category) continue;
      if (jacc(toks(text(x)), toks(text(y))) > 0.6) { const [keep, drop] = score(x) >= score(y) ? [x, y] : [y, x];
        keep.hits = (keep.hits || 0) + (drop.hits || 0); keep.confidence = +Math.min(1, Math.max(keep.confidence, drop.confidence) + 0.03).toFixed(2); drop._gone = true; merged.push(drop.id + "→" + keep.id); }
    }
    live.forEach((r) => { if (!r._gone && r.status === "candidate" && (Date.now() - Date.parse(r.date)) / 864e5 > 60 && !(r.hits > 0)) { r._gone = true; removed.push(r.id + " (stale candidate)"); } });
    let kept = rows.filter((r) => !r._gone);
    const obs = kept.filter((r) => r.status === "obsolete"); if (obs.length > 30) { obs.sort((x, y) => Date.parse(x.date) - Date.parse(y.date)).slice(0, obs.length - 30).forEach((r) => { r._gone = true; removed.push(r.id + " (old obsolete)"); }); kept = kept.filter((r) => !r._gone); }
    const liveKept = kept.filter((r) => r.status !== "obsolete"); if (liveKept.length > max) liveKept.map((r) => [score(r), r]).sort((x, y) => x[0] - y[0]).slice(0, liveKept.length - max).forEach(([, r]) => { r._gone = true; removed.push(r.id + " (cap)"); });
    kept = kept.filter((r) => !r._gone).map((r) => { delete r._gone; return r; });
    if (!a.dry) save(kept);
    line(`${a.dry ? "[dry] " : ""}prune: ${rows.length} → ${kept.length}; merged ${merged.length}; removed ${removed.length}`); [...merged, ...removed].slice(0, 20).forEach((m) => line("  " + m));
    break;
  }
  case "stats": { const by = {}; rows.forEach((r) => { by[r.status] = (by[r.status] || 0) + 1; }); line(`lessons ${rows.length} ${JSON.stringify(by)} store=${STORE}`); break; }
  case "list": rows.filter((r) => !a.status || r.status === a.status).forEach((r) => line(r.status.padEnd(9), compact(r))); break;
  case "pref": {
    const prefs = fs.existsSync(PREFS) ? JSON.parse(fs.readFileSync(PREFS, "utf8")) : {};
    const [sub, key, ...val] = rest;
    if (sub === "set") { if (!a.explicit) { console.error("refusing: durable preferences require --explicit (the user stated it as a standing preference, not inferred from one brief)"); process.exit(1); }
      prefs[key] = { value: val.join(" "), date: today() }; fs.writeFileSync(PREFS, JSON.stringify(prefs, null, 2)); line("pref set " + key); }
    else if (sub === "rm") { delete prefs[key]; fs.writeFileSync(PREFS, JSON.stringify(prefs, null, 2)); line("pref removed " + key); }
    else { const ks = key ? [key] : Object.keys(prefs); if (!ks.length) line("no durable preferences"); ks.forEach((k) => prefs[k] && line(`${k}: ${prefs[k].value}`)); }
    break;
  }
  default: console.error("commands: recall add promote hit obsolete prune stats list pref"); process.exit(1);
}
