#!/usr/bin/env node
// Optional Claude Code PostToolUse hook (Edit|Write|MultiEdit): after a composition file changes, run a fast QA pass
// (3 stills, no determinism re-seek) and stay SILENT on success. On failure it prints the issue lines to stderr and
// exits 2, which Claude Code feeds back to the model. Disable per session with MF_HOOK=0.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SKILL_DIR } from "./lib/common.mjs";

if (process.env.MF_HOOK === "0") process.exit(0);
let input = ""; try { input = fs.readFileSync(0, "utf8"); } catch { process.exit(0); }
let file; try { const j = JSON.parse(input); file = j.tool_input?.file_path || j.tool_input?.path; } catch { process.exit(0); }
if (!file) process.exit(0);
// edited file may be the composition itself or a script/style next to it
const candidates = [file, path.join(path.dirname(file), "index.html")].filter((f) => /\.html?$/.test(f) && fs.existsSync(f));
const comp = candidates.find((f) => /MF\.compose\s*\(/.test(fs.readFileSync(f, "utf8")));
if (!comp) process.exit(0);
const out = path.join(path.dirname(comp), "out", ".hook");
const r = spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts/render.mjs"), comp, "--stills", "auto", "--no-determinism", "--outdir", out], { encoding: "utf8", timeout: 120000 });
if (r.status === 0) process.exit(0);
const lines = (r.stdout || "").split("\n").filter((l) => /^(FAIL|\s+(CRITICAL|HIGH|MEDIUM)|\s+page errors)/.test(l)).slice(0, 8);
process.stderr.write(`motion-forge QA after editing ${path.basename(file)}:\n${lines.join("\n")}\n(full report: ${path.relative(process.cwd(), path.join(out, "report.json"))})\n`);
process.exit(2);
