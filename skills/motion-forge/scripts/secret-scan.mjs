#!/usr/bin/env node
// Pre-publish guard: fails if the tree contains anything that looks like a credential, a private key, an .env file,
// a personal absolute path or generated junk. Run before every push (CI runs it too).
// usage: secret-scan.mjs [dir] [--allow path1,path2]
import fs from "node:fs";
import path from "node:path";
import { parseArgs, line } from "./lib/common.mjs";

const a = parseArgs(), root = path.resolve(a._[0] || "."), allow = new Set(String(a.allow || "").split(",").filter(Boolean));
const RULES = [
  ["private key", /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/], ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ["OpenAI/Anthropic key", /\bsk-(ant-)?[A-Za-z0-9_-]{24,}\b/], ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/], ["Stripe key", /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/],
  ["Replicate token", /\br8_[A-Za-z0-9]{30,}\b/], ["ElevenLabs key", /\bsk_[a-f0-9]{40,}\b/],
  ["fal key", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/], ["ElevenLabs/fal key literal", /\b(ELEVENLABS_API_KEY|FAL_KEY|REPLICATE_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_:-]{16,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/],
  ["personal path", /\/(home|Users)\/(?!runner\b|user\b|you\b|me\b|<)[a-z0-9_.-]+\/(?!\.\.)/i],
  ["sandbox path", /\/root\/\.claude|\/tmp\/claude-0|\/home\/claude\b/],
];
const SKIP_DIR = /^(\.git|node_modules|out|vendor)$/, BIN = /\.(png|jpe?g|gif|mp4|mov|webm|wav|mp3|woff2?|ttf|otf|zip|ico|pdf)$/i;
const BAD_FILES = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.keystore|credentials\.json)$/;
const hits = []; let n = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name), rel = path.relative(root, p).split(path.sep).join("/");
  if (allow.has(rel)) continue;
  if (e.isDirectory()) { if (!SKIP_DIR.test(e.name) && !/_frames$|_work$|_segments$/.test(e.name)) walk(p); continue; }
  n++;
  if (BAD_FILES.test(rel) && !/\.env\.example$/.test(rel)) { hits.push([rel, 0, "sensitive file type"]); continue; }
  if (BIN.test(e.name) || fs.statSync(p).size > 2e6) continue;
  const txt = fs.readFileSync(p, "utf8"); if (rel === "scripts/secret-scan.mjs" || rel.endsWith("/scripts/secret-scan.mjs")) continue;
  txt.split("\n").forEach((l, i) => { for (const [name, re] of RULES) if (re.test(l)) hits.push([rel, i + 1, name, l.trim().slice(0, 90)]); });
} })(root);
if (hits.length) { line(`FAIL secret-scan: ${hits.length} finding(s) in ${n} files`); hits.slice(0, 30).forEach(([f, ln, why, s]) => line(`  ${f}:${ln} ${why}${s ? " — " + s : ""}`)); process.exit(2); }
line(`PASS secret-scan: ${n} files, no credentials, keys, .env files or personal paths`);
