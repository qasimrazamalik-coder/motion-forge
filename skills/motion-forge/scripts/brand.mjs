#!/usr/bin/env node
// Brand kit → every composition on-brand. Templates read --mf-* CSS variables with built-in fallbacks; this writes
// brand.css (vars + @font-face) and copies brand assets into the project.
//   brand.mjs init [brand.json]              starter kit to fill in
//   brand.mjs check <brand.json>             validate + contrast report (WCAG)
//   brand.mjs apply <brand.json> <project>   write <project>/brand.css and <project>/brand/* (logo, fonts)
// brand.json: { "name", "colors": { "ground","ink","mute","signal","accent"? }, "fonts": { "display"|"text"|"serif": { "family", "file"?, "weight"?, "style"? } },
//               "logo": "logo.svg"?, "captions": { "style": "clean|box|karaoke|pop", "fg"?, "bg"? } }
import fs from "node:fs";
import path from "node:path";
import { parseArgs, line } from "./lib/common.mjs";

const a = parseArgs();
const [cmd, file, project] = a._;
const hex = (c) => { const m = String(c || "").trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i); if (!m) return null; let h = m[1]; if (h.length === 3) h = h.split("").map((x) => x + x).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (x, y) => { const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p); return (l1 + 0.05) / (l2 + 0.05); };

if (cmd === "init") {
  const out = path.resolve(file || "brand.json");
  if (fs.existsSync(out)) { console.error(out + " exists"); process.exit(1); }
  fs.writeFileSync(out, JSON.stringify({ name: "Your Brand", colors: { ground: "#F2EEE5", ink: "#1B1A17", mute: "#6F6C65", signal: "#D6452B" },
    fonts: { display: { family: "MF Display" }, text: { family: "MF Text" }, serif: { family: "MF Serif" } }, logo: null, captions: { style: "karaoke" } }, null, 2) + "\n");
  line("wrote " + out + " — set colours, and for brand fonts add { \"family\": \"Brand Sans\", \"file\": \"fonts/BrandSans-Bold.woff2\", \"weight\": 700 }");
  process.exit(0);
}
if (!["check", "apply"].includes(cmd) || !file) { console.error("usage: brand.mjs init|check|apply <brand.json> [project]"); process.exit(1); }
const kitPath = path.resolve(file), kitDir = path.dirname(kitPath);
const kit = JSON.parse(fs.readFileSync(kitPath, "utf8"));
const problems = [], notes = [];
const C = kit.colors || {};
for (const k of ["ground", "ink", "signal"]) if (!hex(C[k])) problems.push(`colors.${k} missing or not #hex`);
if (!problems.length) {
  const g = hex(C.ground), checks = [["ink", 4.5, "body text"], ["signal", 3, "display/accent text"], ["mute", 4.5, "small labels (WCAG body-text threshold)"]];
  for (const [k, min, use] of checks) if (hex(C[k])) { const r = contrast(hex(C[k]), g); (r < min ? problems : notes).push(`${k} on ground ${r.toFixed(2)}:1 (${use} needs ≥ ${min}:1)`); }
  // templates invert surfaces (ink fields, end cards): signal must also survive on ink
  if (hex(C.signal) && hex(C.ink)) { const r = contrast(hex(C.signal), hex(C.ink)); notes.push(`signal on ink ${r.toFixed(2)}:1${r < 3 ? " — WEAK on inverted scenes (ink fields/end cards); set colors.accent for those or pick a darker signal" : ""}`); }
}
const fonts = kit.fonts || {};
for (const [role, f] of Object.entries(fonts)) {
  if (!f || !f.family) { problems.push(`fonts.${role}.family missing`); continue; }
  if (f.file && !fs.existsSync(path.resolve(kitDir, f.file))) problems.push(`fonts.${role}.file not found: ${f.file}`);
  if (f.file) notes.push(`fonts.${role}: confirm the licence allows embedding in video/web (${path.basename(f.file)})`);
  if (!f.file && !/^MF (Display|Text|Serif)$/.test(f.family)) notes.push(`fonts.${role}: "${f.family}" has no file — renders fall back unless it is installed system-wide (prefer shipping the file)`);
}
if (kit.logo && !fs.existsSync(path.resolve(kitDir, kit.logo))) problems.push("logo not found: " + kit.logo);
if (kit.logo && /\.svg$/i.test(kit.logo) && /<script/i.test(fs.readFileSync(path.resolve(kitDir, kit.logo), "utf8"))) problems.push("logo SVG contains <script> — strip it before use");
line(`${problems.length ? "FAIL" : "PASS"} brand ${kit.name || "(unnamed)"}`);
problems.forEach((p) => line("  PROBLEM " + p)); notes.forEach((n) => line("  note " + n));
if (cmd === "check") process.exit(problems.length ? 2 : 0);
if (problems.length) process.exit(2);

const dest = path.resolve(project || ".");
const bdir = path.join(dest, "brand"); fs.mkdirSync(bdir, { recursive: true });
const faces = [], vars = [];
const fmt = (f) => ({ ".woff2": "woff2", ".woff": "woff", ".ttf": "truetype", ".otf": "opentype" }[path.extname(f).toLowerCase()] || "woff2");
for (const [role, f] of Object.entries(fonts)) {
  let family = f.family;
  if (f.file) { const base = path.basename(f.file); fs.copyFileSync(path.resolve(kitDir, f.file), path.join(bdir, base)); family = `Brand ${role}`;
    faces.push(`@font-face { font-family: "${family}"; src: url("brand/${base}") format("${fmt(base)}"); font-weight: ${f.weight || "100 900"}; font-style: ${f.style || "normal"}; font-display: block; }`); }
  vars.push(`  --mf-font-${role}: "${family}";`);
}
for (const k of ["ground", "ink", "mute", "signal", "accent"]) if (C[k]) vars.push(`  --mf-${k}: ${C[k]};`);
const cap = kit.captions || {};
if (cap.fg) vars.push(`  --mf-cap-fg: ${cap.fg};`); if (cap.bg) vars.push(`  --mf-cap-bg: ${cap.bg};`);
let logoNote = "";
if (kit.logo) { const base = "logo" + path.extname(kit.logo); fs.copyFileSync(path.resolve(kitDir, kit.logo), path.join(bdir, base)); vars.push(`  --mf-logo: url("brand/${base}");`); logoNote = ` logo → brand/${base}`; }
fs.writeFileSync(path.join(dest, "brand.css"), `/* generated by brand.mjs from ${path.basename(kitPath)} — ${kit.name || ""} */\n${faces.join("\n")}\n:root, #stage {\n${vars.join("\n")}\n}\n`);
fs.writeFileSync(path.join(bdir, "brand.json"), JSON.stringify(kit, null, 2));
line(`  applied → ${path.relative(process.cwd(), path.join(dest, "brand.css"))} (${vars.length} vars, ${faces.length} font faces)${logoNote}`);
