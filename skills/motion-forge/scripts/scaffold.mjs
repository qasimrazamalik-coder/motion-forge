#!/usr/bin/env node
// Create a self-contained composition project from a template.
// usage: scaffold.mjs <template> <dest> [--width 1920 --height 1080 --fps 30 --duration 10 --title "..."] [--brand brand.json] [--force]
// templates: base | kinetic-type | webgl | threejs | gsap | social-916   (scaffold.mjs --list)
// Copies runtime/mf-runtime.js + bundled OFL fonts into <dest>; vendors three/gsap from the local machine when the
// template needs them (never downloads). Prints next commands.
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolvePackage, line, SKILL_DIR } from "./lib/common.mjs";

const a = parseArgs();
const TPL = path.join(SKILL_DIR, "templates");
const list = fs.readdirSync(TPL).filter((d) => fs.existsSync(path.join(TPL, d, "template.json")));
if (a.list || !a._[0]) { list.forEach((t) => { const j = JSON.parse(fs.readFileSync(path.join(TPL, t, "template.json"), "utf8")); line(`${t.padEnd(13)} ${j.summary}`); }); process.exit(a.list ? 0 : 1); }
const [name, destArg] = a._;
if (!list.includes(name)) { console.error("unknown template " + name + "; one of " + list.join(", ")); process.exit(1); }
const dest = path.resolve(destArg || name);
if (fs.existsSync(dest) && fs.readdirSync(dest).length && !a.force) { console.error(dest + " exists and is not empty (use --force)"); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(path.join(TPL, name, "template.json"), "utf8"));
const vals = { WIDTH: a.width || meta.defaults.width, HEIGHT: a.height || meta.defaults.height, FPS: a.fps || meta.defaults.fps, DURATION: a.duration || meta.defaults.duration, TITLE: a.title || meta.defaults.title,
  GSAP_TAG: "<!-- GSAP not vendored: the MF engine runs this timeline (same API) -->" };
// resolve libraries first so templates can include their <script> tags only when the file really exists
const notes = [], vendorPlan = [];
for (const lib of meta.needs || []) {
  const pkg = resolvePackage(lib.pkg, [process.cwd(), dest]);
  const src = pkg && lib.files.map((f) => path.join(pkg.dir, f)).find((f) => fs.existsSync(f));
  if (src) { vendorPlan.push({ lib, pkg, src }); if (lib.pkg === "gsap") vals.GSAP_TAG = '<script src="vendor/gsap.min.js"></script>'; }
  else notes.push(`${lib.optional ? "optional" : "REQUIRED"}: ${lib.pkg} not found locally — run \`npm i ${lib.pkg}\` in ${path.relative(process.cwd(), dest) || "."} then re-run scaffold with --force, or place ${lib.files[0]} at vendor/${lib.as}. ${lib.license || ""}`);
}

const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (/\.(html|js|mjs|css|json|md)$/.test(src)) fs.writeFileSync(dst, fs.readFileSync(src, "utf8").replace(/\{\{(WIDTH|HEIGHT|FPS|DURATION|TITLE|GSAP_TAG)\}\}/g, (_, k) => vals[k]));
  else fs.copyFileSync(src, dst); };
(function walk(s, d) { for (const e of fs.readdirSync(s, { withFileTypes: true })) { if (e.name === "template.json") continue; const sp = path.join(s, e.name), dp = path.join(d, e.name); e.isDirectory() ? walk(sp, dp) : copy(sp, dp); } })(path.join(TPL, name), dest);
fs.copyFileSync(path.join(SKILL_DIR, "runtime", "mf-runtime.js"), path.join(dest, "mf-runtime.js"));
fs.mkdirSync(path.join(dest, "fonts"), { recursive: true });
for (const f of fs.readdirSync(path.join(SKILL_DIR, "assets", "fonts"))) fs.copyFileSync(path.join(SKILL_DIR, "assets", "fonts", f), path.join(dest, "fonts", f));

for (const { lib, pkg, src } of vendorPlan) {
  fs.mkdirSync(path.join(dest, "vendor"), { recursive: true }); fs.copyFileSync(src, path.join(dest, "vendor", lib.as)); notes.push(`vendored ${lib.pkg}@${pkg.version} → vendor/${lib.as}`);
  for (const extra of lib.extra || []) { const ep = path.join(pkg.dir, extra.from); if (fs.existsSync(ep)) fs.copyFileSync(ep, path.join(dest, "vendor", extra.as)); }
}
// brand kit: always ship a brand.css (empty = template defaults) so the <link> never 404s
if (a.brand) { const r = (await import("node:child_process")).spawnSync(process.execPath, [path.join(SKILL_DIR, "scripts/brand.mjs"), "apply", path.resolve(a.brand), dest], { encoding: "utf8" });
  notes.push(r.status === 0 ? "brand kit applied: " + path.basename(a.brand) : "BRAND KIT FAILED — " + (r.stdout || r.stderr).trim().split("\n").join(" | ")); }
else if (!fs.existsSync(path.join(dest, "brand.css"))) fs.writeFileSync(path.join(dest, "brand.css"), "/* no brand kit applied — template defaults. Apply one: node <skill>/scripts/brand.mjs apply brand.json . */\n");
line(`scaffolded ${name} → ${path.relative(process.cwd(), dest) || "."} (${vals.WIDTH}x${vals.HEIGHT}@${vals.FPS}, ${vals.DURATION}s)`);
notes.forEach((n) => line("  " + n));
line(`  preview: open ${path.relative(process.cwd(), path.join(dest, "index.html"))} via any static server (or render stills)`);
line(`  stills:  node ${path.join(SKILL_DIR, "scripts/render.mjs")} ${path.relative(process.cwd(), path.join(dest, "index.html"))} --stills auto --outdir ${path.relative(process.cwd(), path.join(dest, "out/frames"))}`);
