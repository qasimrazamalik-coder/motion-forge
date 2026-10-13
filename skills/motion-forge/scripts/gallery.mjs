#!/usr/bin/env node
// Template gallery page (static HTML) from templates/*/template.json + demo media in docs/ — for the repo's GitHub Pages.
// usage: gallery.mjs --docs <repo>/docs [--out <repo>/docs/index.html] [--site https://<user>.github.io/<repo>/] [--repo <user>/<repo>]
import fs from "node:fs";
import path from "node:path";
import { parseArgs, line, SKILL_DIR } from "./lib/common.mjs";
const a = parseArgs();
const docs = path.resolve(a.docs || path.join(SKILL_DIR, "packaging", "docs"));
const T = path.join(SKILL_DIR, "templates");
const repo = a.repo || "qasimrazamalik-coder/motion-forge", site = a.site || `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cards = fs.readdirSync(T).filter((d) => fs.existsSync(path.join(T, d, "template.json"))).sort().map((d) => {
  const j = JSON.parse(fs.readFileSync(path.join(T, d, "template.json"), "utf8")), media = ["gif", "mp4", "png"].map((x) => `${d}.${x}`).find((f) => fs.existsSync(path.join(docs, f)));
  const m = !media ? `<div class="ph">${esc(d)}</div>` : media.endsWith(".mp4") ? `<video src="${media}" autoplay muted loop playsinline></video>` : `<img src="${media}" alt="${esc(d)} demo" loading="lazy">`;
  const { width: w, height: h, duration } = j.defaults || {};
  return `<article>${m}<h2>${esc(d)}</h2><p>${esc(j.summary)}</p><code>scaffold.mjs ${esc(d)} my-project</code><small>${w}×${h} · ${duration}s${j.needs ? " · needs " + j.needs.map((n) => n.pkg).join(", ") : ""}</small></article>`;
});
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>motion-forge — AI motion graphics &amp; social video edits that check their own frames (Claude Code skill)</title>
<meta name="description" content="motion-forge is a free, open-source Claude Code skill for AI motion graphics and short-form video: kinetic typography, promos, data charts, 3D reels, Reels/TikTok/Shorts edits with hooks and captions, and DaVinci Resolve / Premiere Pro / CapCut hand-off. Every render is checked frame by frame and repaired.">
<meta name="keywords" content="motion graphics, AI video, Claude Code skill, Claude skills, agent skills, video automation, kinetic typography, Reels editor, TikTok captions, YouTube Shorts, DaVinci Resolve, Premiere Pro, CapCut, Remotion alternative, HyperFrames alternative, GSAP, Three.js, ffmpeg, Playwright">
<link rel="canonical" href="${site}">
<meta property="og:type" content="website"><meta property="og:title" content="motion-forge — AI-made video that checks its own work"><meta property="og:description" content="Render → QA → self-repair. Motion graphics, social edits and NLE timelines from Claude Code. Free, MIT."><meta property="og:url" content="${site}"><meta property="og:image" content="${site}social-preview.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="motion-forge — AI-made video that checks its own work"><meta name="twitter:image" content="${site}social-preview.png">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: "motion-forge", applicationCategory: "MultimediaApplication", operatingSystem: "Linux, macOS, Windows", license: "https://opensource.org/licenses/MIT", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, url: site, codeRepository: `https://github.com/${repo}`, description: "Claude Code skill for render-validated motion graphics, social video edits and NLE hand-off." })}</script>
<style>
:root{--bg:#F4F1EA;--fg:#17161A;--mute:#5F5C55;--line:#DDD8CC;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#EEEAE2;--mute:#A09B91;--line:#2A2A2E;--card:#1A1A1D}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
header{max-width:1100px;margin:0 auto;padding:48px 16px 8px}h1{font-size:40px;letter-spacing:-.03em;margin:0}header p{color:var(--mute);max-width:60ch}
main{max-width:1100px;margin:0 auto;padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
article img,article video,.ph{width:100%;aspect-ratio:16/10;object-fit:contain;background:#0d0d0f;display:block}.ph{display:grid;place-items:center;color:#888}
h2{font-size:18px;margin:14px 16px 4px}article p{margin:0 16px;color:var(--mute);font-size:14px;flex:1}
code{margin:12px 16px 4px;font-size:12px;background:var(--bg);padding:6px 8px;border-radius:6px;overflow-x:auto}small{margin:0 16px 14px;color:var(--mute)}
</style></head><body><header><h1>motion-forge</h1><p><b>AI-made motion graphics and social edits that check their own frames.</b> A Claude Code skill: brief → render → frame-level QA → self-repair → MP4 / alpha / ProRes, plus Reels/TikTok edits and Resolve · Premiere · CapCut timelines. <a href="https://github.com/${repo}">GitHub</a> · install: <code style="margin:0">/plugin marketplace add ${repo}</code></p><p>Templates below: every one renders deterministically and passes QA (safe zones, collisions, measured contrast). Contribute one: see CONTRIBUTING.md.</p></header>
<main>${cards.join("\n")}</main></body></html>`;
const out = path.resolve(a.out || path.join(docs, "index.html")); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html);
line(`PASS gallery ${cards.length} templates → ${path.relative(process.cwd(), out)}`);
