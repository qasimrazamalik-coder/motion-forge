#!/usr/bin/env node
// Agent-level eval runner — runs each brief in evals/evals.json as a fresh headless Claude Code session in an empty
// directory, then grades what it can automatically: artifacts present, inspect-output on every MP4, QA scorecard,
// subagent count and full-render count vs the eval's budgets, cost/turns/time from the session result.
// Items in `must`/`must_not` that need eyes stay "manual" — the runner never pretends to judge taste.
//
//   node agent-evals.mjs [--only A,B] [--claude claude] [--timeout 1800] [--outdir evals/runs] [--model sonnet] [--mode full|baseline|qa]
//   --mode: ablation for the research track (baseline = no QA/critique/repair; qa = QA loop without the critic)
//   --budget-tokens N: fail an eval whose session used more than N tokens (token-efficiency regression gate)
//   node agent-evals.mjs --dry-run                 print the commands it would run
//   node agent-evals.mjs --parse transcript.jsonl  grade an existing stream-json transcript (no session)
//
// Requires: Claude Code CLI on PATH, logged in, with motion-forge installed (skill or plugin). Sessions run with
// --permission-mode acceptEdits and an allow-list of tools; review evals/runs/*/transcript.jsonl after each run.
// STATUS: written against the documented `claude -p --output-format stream-json` event shapes; not yet exercised
// end-to-end in CI (headless sessions could not run in the build environment). Treat the first run as a check of the runner too.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs, line, writeJSON } from "./lib/common.mjs";

const a = parseArgs();
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SKILL_DIR = path.resolve(HERE, "..");
const spec = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, "evals", "evals.json"), "utf8"));
const only = a.only ? String(a.only).split(",") : null;
const cases = spec.evals.filter((e) => !only || only.includes(e.id));
const CLAUDE = a.claude || "claude", TIMEOUT = (+a.timeout || 1800) * 1000;
const TOOLS = "Bash,Read,Write,Edit,Glob,Grep,Task,Agent,Skill,TodoWrite";
// ablation modes (MotionBench agent track): same brief, different access to the verification loop
const MODES = {
  full: "",
  baseline: "\n\n[Ablation run — baseline] Do not render QA stills, do not read contact sheets, do not run critique agents or a repair loop. Build the composition, render the final video once, deliver.",
  qa: "\n\n[Ablation run — QA only] Use stills QA (render.mjs --stills --score) and the repair loop, but do not use the visual-critic agent.",
};
const MODE = a.mode || "full";
if (!(MODE in MODES)) { console.error("--mode must be one of: " + Object.keys(MODES).join(", ")); process.exit(1); }

// ---- transcript parsing (stream-json: one JSON event per line)
export function parseTranscript(text) {
  const ev = text.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const tools = [], subagents = [], skills = [], bash = [];
  let result = null;
  for (const e of ev) {
    if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
      for (const c of e.message.content) if (c.type === "tool_use") {
        tools.push(c.name);
        if (c.name === "Task" || c.name === "Agent") subagents.push(c.input?.subagent_type || "general-purpose");
        if (c.name === "Skill") skills.push(c.input?.skill || c.input?.name);
        if (c.name === "Bash") bash.push(String(c.input?.command || ""));
      }
    }
    if (e.type === "result") result = e;
  }
  const renders = bash.filter((c) => /render\.mjs/.test(c));
  return {
    events: ev.length, toolCalls: tools.length, subagents, skills,
    fullRenders: renders.filter((c) => !/--stills|--perf/.test(c)).length, stillsRenders: renders.filter((c) => /--stills/.test(c)).length,
    inspects: bash.filter((c) => /inspect-output\.mjs/.test(c)).length,
    result: result ? { subtype: result.subtype, isError: !!result.is_error, turns: result.num_turns, durationMs: result.duration_ms, costUsd: result.total_cost_usd, usage: result.usage } : null,
  };
}

function walk(dir, out = []) { if (!fs.existsSync(dir)) return out; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === "node_modules" || e.name.startsWith(".git")) continue; const p = path.join(dir, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; }

function grade(ev, work, t) {
  const files = walk(work), rel = (f) => path.relative(work, f);
  const checks = [];
  const has = (re) => files.some((f) => re.test(rel(f)));
  const mp4s = files.filter((f) => /\.mp4$/i.test(f) && !/_frames|seg_/.test(f));
  // re-QA the composition the session left behind (stills + measured contrast) to auto-grade layout items
  let qaIssues = null;
  const comp = files.filter((f) => /index\.html$/.test(f) && !/node_modules|_grade/.test(f) && /MF\.compose|__MF/.test(fs.readFileSync(f, "utf8")))[0];
  if (comp) { const gd = path.join(work, "_grade"); spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts", "render.mjs"), comp, "--stills", "auto", "--score", "--outdir", gd], { encoding: "utf8", timeout: 600000 });
    try { qaIssues = JSON.parse(fs.readFileSync(path.join(gd, "report.json"), "utf8")).issues.map((i) => i.code); } catch { qaIssues = null; } }
  const none = (...codes) => (qaIssues ? !qaIssues.some((c) => codes.includes(c)) : null);
  for (const m of ev.must) {
    let auto = null;
    if (/safe zone/i.test(m)) auto = none("TEXT_OUTSIDE_SAFE_ZONE");
    else if (/orphan|clipped/i.test(m)) auto = none("TYPE_ORPHAN", "TEXT_CLIPPED_BY_FRAME", "TEXT_OVERFLOWS_BOX");
    else if (/overlap|collid/i.test(m)) auto = none("TEXT_OVERLAP");
    else if (/contrast|legib/i.test(m)) auto = none("LOW_CONTRAST");
    if (auto !== null) { checks.push({ item: m, kind: "must", result: auto }); continue; }
    if (/motionspec/i.test(m)) auto = has(/motionspec\.ya?ml$/i);
    else if (/contact sheet/i.test(m)) auto = has(/contact-sheet\.png$/);
    else if (/scorecard|qa\.md/i.test(m)) { const q = files.find((f) => /qa\.md$/.test(f)); const sc = q ? +(fs.readFileSync(q, "utf8").match(/(\d{2,3})\s*\/\s*100/) || [])[1] : NaN; auto = q ? (isNaN(sc) ? "present (score not parsed)" : sc >= 90) : false; }
    else if (/MP4|passes inspect/i.test(m)) {
      if (!mp4s.length) auto = false;
      else auto = mp4s.every((f) => spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts", "inspect-output.mjs"), f], { encoding: "utf8" }).status === 0);
    }
    checks.push({ item: m, kind: "must", result: auto === null ? "manual" : auto });
  }
  for (const m of ev.must_not || []) checks.push({ item: m, kind: "must_not", result: "manual" });
  const b = ev.budgets || {};
  if (b.subagents_max != null) checks.push({ item: `subagents ≤ ${b.subagents_max}`, kind: "budget", result: t.subagents.length <= b.subagents_max, actual: t.subagents.length });
  if (b.full_renders_max != null) checks.push({ item: `full renders ≤ ${b.full_renders_max}`, kind: "budget", result: t.fullRenders <= b.full_renders_max, actual: t.fullRenders });
  const autoFails = checks.filter((c) => c.result === false).length, manual = checks.filter((c) => c.result === "manual").length;
  return { checks, autoFails, manual, outputs: mp4s.map(rel) };
}

function report(id, ev, t, g) {
  line(`${g.autoFails ? "FAIL" : "PASS"} eval ${id} ${ev.name} — ${g.autoFails} auto-fail, ${g.manual} manual`);
  if (t.result) line(`  turns ${t.result.turns} · ${Math.round((t.result.durationMs || 0) / 1000)}s · $${(t.result.costUsd ?? 0).toFixed(2)} · subagents [${t.subagents.join(", ")}] · renders ${t.fullRenders} full / ${t.stillsRenders} stills`);
  g.checks.filter((c) => c.result !== true).forEach((c) => line(`  ${c.result === "manual" ? "MANUAL" : "FAIL  "} ${c.kind}: ${c.item}${c.actual != null ? " (actual " + c.actual + ")" : ""}`));
}

if (a.parse) {
  const t = parseTranscript(fs.readFileSync(path.resolve(a.parse), "utf8"));
  const ev = cases[0] || spec.evals[0], work = a.work ? path.resolve(a.work) : path.dirname(path.resolve(a.parse));
  const g = grade(ev, work, t); report(ev.id, ev, t, g); console.log(JSON.stringify(t, null, 1));
  process.exit(g.autoFails ? 2 : 0);
}

const outRoot = path.resolve(a.outdir || path.join(SKILL_DIR, "evals", "runs"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const results = [];
for (const ev of cases) {
  const work = path.join(outRoot, `${stamp}_${MODE}_${ev.id}`);
  const args = ["-p", ev.brief + MODES[MODE], "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowedTools", TOOLS, ...(a.model ? ["--model", a.model] : [])];
  if (a["dry-run"]) { line(`(cd ${work} && ${CLAUDE} ${args.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ")})`); continue; }
  fs.mkdirSync(work, { recursive: true });
  line(`… eval ${ev.id} ${ev.name} in ${path.relative(process.cwd(), work)}`);
  const transcript = path.join(work, "transcript.jsonl");
  const code = await new Promise((resolve) => {
    const out = fs.createWriteStream(transcript);
    const ch = spawn(CLAUDE, args, { cwd: work, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
    ch.stdout.pipe(out); ch.stderr.on("data", (d) => fs.appendFileSync(path.join(work, "stderr.log"), d));
    const timer = setTimeout(() => { ch.kill("SIGTERM"); fs.appendFileSync(path.join(work, "stderr.log"), `\n[agent-evals] timeout after ${TIMEOUT / 1000}s\n`); }, TIMEOUT);
    ch.on("error", (e) => { clearTimeout(timer); fs.appendFileSync(path.join(work, "stderr.log"), String(e)); resolve(127); });
    ch.on("close", (c) => { clearTimeout(timer); out.end(); resolve(c); });
  });
  const t = parseTranscript(fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8") : "");
  if (code === 127) line(`  could not start '${CLAUDE}' — is Claude Code installed and on PATH?`);
  const g = grade(ev, work, t);
  if (a["budget-tokens"] && t.result?.usage) { const used = (t.result.usage.input_tokens || 0) + (t.result.usage.output_tokens || 0) + (t.result.usage.cache_read_input_tokens || 0) + (t.result.usage.cache_creation_input_tokens || 0);
    g.checks.push({ item: `tokens ≤ ${a["budget-tokens"]}`, kind: "budget", result: used <= +a["budget-tokens"], actual: used }); if (used > +a["budget-tokens"]) g.autoFails++; }
  report(ev.id, ev, t, g);
  results.push({ id: ev.id, name: ev.name, mode: MODE, exitCode: code, transcript: t, grade: g, tokens: t.result?.usage ? (t.result.usage.input_tokens || 0) + (t.result.usage.output_tokens || 0) + (t.result.usage.cache_read_input_tokens || 0) + (t.result.usage.cache_creation_input_tokens || 0) : null });
}
if (!a["dry-run"]) {
  writeJSON(path.join(outRoot, `${stamp}_summary.json`), { when: stamp, results });
  line(`summary → ${path.relative(process.cwd(), path.join(outRoot, `${stamp}_summary.json`))}`);
  process.exit(results.some((r) => r.grade.autoFails || r.exitCode) ? 2 : 0);
}
