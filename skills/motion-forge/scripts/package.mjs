#!/usr/bin/env node
// Build a publishable repo from this skill: Claude Code plugin + marketplace layout, CI, installers.
// usage: package.mjs --out ../motion-forge-repo [--version 0.2.0] [--owner "Your Name"] [--repo user/motion-forge] [--zip]
//
// <out>/
//   .claude-plugin/plugin.json, marketplace.json   →  /plugin marketplace add <user>/<repo>  then  /plugin install motion-forge
//   skills/motion-forge/                            →  this skill (SKILL.md, scripts, runtime, templates, …)
//   agents/mf-*.md                                  →  plugin agents (namespaced motion-forge:mf-*)
//   .github/workflows/evals.yml                     →  CI regression on every push
//   install.sh, install.ps1, README.md, LICENSE      →  manual install without the plugin system
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, line, SKILL_DIR } from "./lib/common.mjs";

const a = parseArgs();
const out = path.resolve(a.out || path.join(SKILL_DIR, "..", "motion-forge-repo"));
const version = a.version || "0.2.0";
const owner = a.owner || "motion-forge authors";
const repo = a.repo || "your-user/motion-forge";
const skip = new Set(["node_modules", ".git", "out", "packaging", "runs"]);
fs.rmSync(out, { recursive: true, force: true });
const skillOut = path.join(out, "skills", "motion-forge");
fs.cpSync(SKILL_DIR, skillOut, { recursive: true, filter: (s) => !skip.has(path.basename(s)) && !/_frames$/.test(s) });
fs.mkdirSync(path.join(out, "agents"), { recursive: true });
for (const f of fs.readdirSync(path.join(SKILL_DIR, "agents"))) fs.copyFileSync(path.join(SKILL_DIR, "agents", f), path.join(out, "agents", f));
const short = "AI motion graphics and social video edits that check their own frames: kinetic type, promos, data charts, 3D reels, Reels/TikTok/Shorts edits with hooks and captions, VFX looks, optional AI assets, and DaVinci Resolve / Premiere Pro / CapCut hand-off — with frame-level QA and a self-repair loop.";
const plugin = { name: "motion-forge", version, description: short, author: { name: owner }, repository: `https://github.com/${repo}`, license: "MIT",
  keywords: ["motion-graphics", "ai-video", "video-editing", "reels", "tiktok", "youtube-shorts", "captions", "davinci-resolve", "premiere-pro", "capcut", "animation", "gsap", "threejs", "webgl", "kinetic-typography", "ffmpeg", "claude-code", "agent-skills"], skills: ["./skills/motion-forge"] };   // agents/ at the plugin root is auto-discovered
fs.mkdirSync(path.join(out, ".claude-plugin"), { recursive: true });
fs.writeFileSync(path.join(out, ".claude-plugin", "plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
fs.writeFileSync(path.join(out, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "motion-forge", owner: { name: owner },
  metadata: { description: "motion-forge: render-validated motion graphics for Claude Code", version },
  plugins: [{ name: "motion-forge", source: "./", description: plugin.description, version }] }, null, 2) + "\n");
fs.mkdirSync(path.join(out, ".github", "workflows"), { recursive: true });
fs.copyFileSync(path.join(SKILL_DIR, "packaging", "evals.yml"), path.join(out, ".github", "workflows", "evals.yml"));
if (fs.existsSync(path.join(SKILL_DIR, "packaging", "motionbench.yml"))) fs.copyFileSync(path.join(SKILL_DIR, "packaging", "motionbench.yml"), path.join(out, ".github", "workflows", "motionbench.yml"));
for (const f of ["LICENSE", "README.md"]) fs.copyFileSync(path.join(SKILL_DIR, f), path.join(out, f));
for (const f of ["CONTRIBUTING.md", "SECURITY.md", "CITATION.cff"]) if (fs.existsSync(path.join(SKILL_DIR, "packaging", f))) fs.copyFileSync(path.join(SKILL_DIR, "packaging", f), path.join(out, f));
if (fs.existsSync(path.join(SKILL_DIR, "packaging", "ROADMAP.md"))) fs.copyFileSync(path.join(SKILL_DIR, "packaging", "ROADMAP.md"), path.join(out, "ROADMAP.md"));
if (fs.existsSync(path.join(SKILL_DIR, "packaging", "research"))) fs.cpSync(path.join(SKILL_DIR, "packaging", "research"), path.join(out, "research"), { recursive: true });
if (fs.existsSync(path.join(SKILL_DIR, "packaging", "docs"))) fs.cpSync(path.join(SKILL_DIR, "packaging", "docs"), path.join(out, "docs"), { recursive: true });   // README demo GIFs (repo only, not the skill)
if (fs.existsSync(path.join(SKILL_DIR, "packaging", "env.example"))) fs.copyFileSync(path.join(SKILL_DIR, "packaging", "env.example"), path.join(out, ".env.example"));
if (fs.existsSync(path.join(SKILL_DIR, "packaging", "issue-templates"))) fs.cpSync(path.join(SKILL_DIR, "packaging", "issue-templates"), path.join(out, ".github", "ISSUE_TEMPLATE"), { recursive: true });
// root installers delegate to the skill's own installer (single source of truth)
fs.writeFileSync(path.join(out, "install.sh"), '#!/usr/bin/env bash\nexec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills/motion-forge/install.sh" "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(out, "install.ps1"), '& (Join-Path $PSScriptRoot "skills\\motion-forge\\install.ps1") @args\n');
fs.writeFileSync(path.join(out, ".gitignore"), "node_modules/\nout/\n*_frames/\n*_segments/\n*_work/\nvendor/\n.DS_Store\n.env\n.env.*\n!.env.example\n*.pem\n*.key\nassets-cache/\nbench-results/\n");
let n = 0; (function c(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? c(path.join(d, e.name)) : n++; })(out);
line(`packaged motion-forge v${version} → ${out} (${n} files)`);
if (a.zip) { const z = out.replace(/\/?$/, "") + ".zip"; fs.rmSync(z, { force: true });
  const r = spawnSync("zip", ["-qr", z, path.basename(out)], { cwd: path.dirname(out) }); line(r.status === 0 ? `  zip ${z}` : "  zip failed (zip not installed?)"); }
