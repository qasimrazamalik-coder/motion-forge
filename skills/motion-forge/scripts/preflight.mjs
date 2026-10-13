#!/usr/bin/env node
// Detects what this machine can actually do. Caches to $MF_HOME/env.json (reuse for 24h unless --fresh).
// usage: preflight.mjs [--project dir] [--fresh] [--json]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { parseArgs, which, resolvePackage, launchBrowser, writeJSON, line, MF_HOME, SKILL_DIR } from "./lib/common.mjs";

const a = parseArgs();
const cache = path.join(MF_HOME, "env.json");
const project = path.resolve(a.project || process.cwd());
if (!a.fresh && fs.existsSync(cache)) {
  const c = JSON.parse(fs.readFileSync(cache, "utf8"));
  if (Date.now() - c.checkedAt < 864e5 && c.project === project) { print(c, true); process.exit(c.ok ? 0 : 2); }
}
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 15000 }); return r.status === 0 ? (r.stdout || r.stderr).trim() : null; };
const env = { checkedAt: Date.now(), project, platform: `${os.platform()}-${os.arch()}`, node: process.version };
env.ffmpeg = which("ffmpeg") ? run("ffmpeg", ["-version"])?.split("\n")[0].replace(/ Copyright.*/, "") : null;
env.ffprobe = !!which("ffprobe");
if (env.ffmpeg) {
  const enc = run("ffmpeg", ["-hide_banner", "-encoders"]) || "";
  env.encoders = ["libx264", "libx265", "libvpx-vp9", "prores_ks", "gif", "libwebp", "aac"].filter((e) => enc.includes(" " + e + " "));
  env.drawtext = (run("ffmpeg", ["-hide_banner", "-filters"]) || "").includes("drawtext");
}
env.claude = which("claude") ? run("claude", ["--version"]) : null;
const pw = resolvePackage("playwright") || resolvePackage("playwright-core");
env.playwright = pw ? pw.version : null;
env.browser = null;
if (pw) {
  try {
    const b = await launchBrowser(); const p = await b.newPage();
    env.browser = { version: b.version(), ...(await p.evaluate(async () => {
      const c = document.createElement("canvas"); const gl = c.getContext("webgl2");
      let webgpu = false; try { webgpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch {}
      return { webgl2: !!gl, webgl: !!(gl || document.createElement("canvas").getContext("webgl")), maxTexture: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : null,
        maxViewport: gl ? Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)) : null, webgpu };
    })) };
    // 4K capability: can the page rasterize a 3840x2160 screenshot?
    await p.setViewportSize({ width: 3840, height: 2160 }); const shot = await p.screenshot({ type: "png" }); env.browser.can4k = shot.length > 0;
    await b.close();
  } catch (e) { env.browserError = e.message.split("\n")[0]; }
}
// libraries: project first, then global; skill never bundles them
const lib = (n) => { const r = resolvePackage(n, [project]); return r ? { version: r.version, dir: r.dir } : null; };
env.libs = { three: lib("three"), gsap: lib("gsap"), postprocessing: lib("postprocessing") };
const vend = path.join(project, "vendor"); if (fs.existsSync(vend)) env.vendor = fs.readdirSync(vend);
// related skills/agents already installed (reuse instead of duplicating)
const home = os.homedir(), found = [];
const scan = (dir, depth = 0) => { if (depth > 6 || !fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
  const p = path.join(dir, e.name); if (e.isDirectory()) { if (!["node_modules", ".git", "references", "assets", "templates"].includes(e.name)) scan(p, depth + 1); }
  else if ((e.name === "SKILL.md" || (dir.endsWith("agents") && e.name.endsWith(".md"))) && !p.startsWith(SKILL_DIR)) {
    const head = fs.readFileSync(p, "utf8").slice(0, 600); const name = head.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const desc = (head.match(/^description:\s*(.+)$/m)?.[1] || "").slice(0, 300);
    if (name && !name.startsWith("mf-") && (/three|webgl|gsap|shader|remotion|hyperframes|r3f|lottie|motion|animat/i.test(name) || /three\.?js|webgl|gsap|remotion|hyperframes|motion graphics|kinetic typography|shader/i.test(desc)))
      found.push({ name, kind: e.name === "SKILL.md" ? "skill" : "agent", path: p.replace(home, "~") }); } } };
[path.join(home, ".claude/skills"), path.join(home, ".claude/agents"), path.join(home, ".claude/plugins"), path.join(project, ".claude")].forEach((d) => scan(d));
env.relatedSkills = [...new Map(found.map((f) => [f.kind + f.name, f])).values()].slice(0, 40);
env.mfAgents = fs.existsSync(path.join(home, ".claude/agents")) ? fs.readdirSync(path.join(home, ".claude/agents")).filter((f) => f.startsWith("mf-")) : [];
env.fonts = which("fc-list") ? (run("fc-list", [":", "family"]) || "").split("\n").length : null;
env.ok = !!(env.ffmpeg && env.ffprobe && env.browser);
env.missing = [!env.ffmpeg && "ffmpeg", !env.ffprobe && "ffprobe", !env.playwright && "playwright (npm i -g playwright)", pw && !env.browser && "chromium (npx playwright install chromium)"].filter(Boolean);
writeJSON(cache, env);
print(env, false);
process.exit(env.ok ? 0 : 2);

function print(e, cached) {
  if (a.json) return line(JSON.stringify(e));
  line(`${e.ok ? "READY" : "DEGRADED"}${cached ? " (cached)" : ""} node ${e.node} | ${e.ffmpeg || "NO ffmpeg"} | playwright ${e.playwright || "MISSING"}`);
  if (e.browser) line(`  chromium ${e.browser.version} webgl2=${e.browser.webgl2} webgpu=${e.browser.webgpu} maxTex=${e.browser.maxTexture} 4k=${e.browser.can4k}`);
  if (e.browserError) line("  browser error:", e.browserError);
  line(`  encoders: ${(e.encoders || []).join(",")}  drawtext=${e.drawtext}`);
  line(`  three=${e.libs?.three?.version || "-"} gsap=${e.libs?.gsap?.version || "-"}${e.vendor ? " vendor=" + e.vendor.join(",") : ""}`);
  line(`  mf agents: ${e.mfAgents?.length ? e.mfAgents.join(",") : "none installed"} | claude ${e.claude || "-"}`);
  if (e.relatedSkills?.length) line(`  related installed: ${e.relatedSkills.map((s) => s.kind[0] + ":" + s.name).join(", ").slice(0, 400)}`);
  if (e.missing?.length) line("  MISSING:", e.missing.join("; "));
}
