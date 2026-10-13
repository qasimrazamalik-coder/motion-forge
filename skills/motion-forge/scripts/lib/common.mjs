// Shared helpers for motion-forge scripts. Node >= 18, no npm dependencies of its own.
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MF_HOME = process.env.MF_HOME || path.join(os.homedir(), ".claude", "motion-forge");

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) out[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export function which(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8", shell: process.platform === "win32" });
  return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
}

/** Resolve a package from (1) cwd/project, (2) MF_NODE_PATH, (3) global npm root, (4) known tool dirs. */
export function resolvePackage(name, extraRoots = []) {
  const roots = [...extraRoots, process.cwd(), process.env.MF_NODE_PATH, SKILL_DIR].filter(Boolean);
  try { roots.push(execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000, shell: process.platform === "win32" }).trim()); } catch {}
  if (process.platform === "win32" && process.env.APPDATA) roots.push(path.join(process.env.APPDATA, "npm", "node_modules"));
  roots.push("/opt/npm-tools/node_modules", path.join(os.homedir(), ".npm-global/lib/node_modules"), "/usr/local/lib/node_modules", "/usr/lib/node_modules");
  for (const r of roots) {
    for (const base of [r, path.join(r, "node_modules")]) {
      const pj = path.join(base, name, "package.json");
      if (fs.existsSync(pj)) return { dir: path.dirname(pj), version: JSON.parse(fs.readFileSync(pj, "utf8")).version };
    }
    try { const req = createRequire(path.join(r, "noop.js")); const p = req.resolve(name + "/package.json"); return { dir: path.dirname(p), version: JSON.parse(fs.readFileSync(p, "utf8")).version }; } catch {}
  }
  return null;
}

export async function loadPlaywright() {
  const pkg = resolvePackage("playwright") || resolvePackage("playwright-core");
  if (!pkg) throw new Error("playwright not found. Install once: npm i -g playwright && npx playwright install chromium   (or set MF_NODE_PATH)");
  const entry = fs.existsSync(path.join(pkg.dir, "index.mjs")) ? path.join(pkg.dir, "index.mjs") : path.join(pkg.dir, "index.js");
  const mod = await import(pathToFileURL(entry).href);
  return { chromium: mod.chromium || mod.default?.chromium, version: pkg.version };
}

export const CHROMIUM_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--font-render-hinting=none", "--disable-lcd-text"];

export async function launchBrowser({ gpu = process.env.MF_GPU === "1" } = {}) {
  const { chromium } = await loadPlaywright();
  const args = gpu ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--hide-scrollbars", "--font-render-hinting=none"] : CHROMIUM_ARGS;
  const opts = { args };
  if (process.env.MF_CHROME) opts.executablePath = process.env.MF_CHROME;
  try { return await chromium.launch(opts); }
  catch (e) {
    try { return await chromium.launch({ ...opts, channel: "chrome" }); } catch {}
    throw new Error("Chromium launch failed: " + e.message.split("\n")[0] + "\nFix: npx playwright install chromium  (or set MF_CHROME=/path/to/chrome)");
  }
}

export const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".hdr": "application/octet-stream", ".ktx2": "image/ktx2" };

/** Local-only static server (127.0.0.1, random port). ES modules need http, not file://. */
export function serve(root, { host = "127.0.0.1", port = 0, routes = {}, transform = null } = {}) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (routes[p]) return routes[p](req, res);
    let f = path.join(root, p);
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    if (transform && /\.html?$/i.test(f)) return res.end(transform(fs.readFileSync(f, "utf8"), f));
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) })));
}

export function ffprobe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("ffprobe failed: " + r.stderr.trim());
  return JSON.parse(r.stdout);
}

export function fps(rate) { if (!rate) return null; const [a, b] = rate.split("/").map(Number); return b ? +(a / b).toFixed(3) : a; }

export function writeJSON(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

/** Compact, context-friendly line output. */
process.stdout.on("error", (e) => { if (e.code !== "EPIPE") throw e; });   // tolerate `| head`
export function line(...parts) { process.stdout.write(parts.join(" ") + "\n"); }

// Open a composition headlessly and return its meta (duration, fps, size, labels) — for tools that place things on its timeline.
export async function compMeta(comp, query = "") {
  const abs = path.resolve(comp), srv = await serve(path.dirname(abs)), browser = await launchBrowser();
  try {
    const p = await browser.newPage(); await p.addInitScript(() => { window.__MF_RENDER = true; });
    await p.goto(`${srv.url}/${path.basename(abs)}${query ? "?" + query : ""}`);
    await p.waitForFunction(() => !!window.__MF, null, { timeout: 20000 }); await p.evaluate(() => window.__MF.ready);
    return await p.evaluate(() => JSON.parse(JSON.stringify(window.__MF.meta)));
  } finally { await browser.close(); await srv.close(); }
}
