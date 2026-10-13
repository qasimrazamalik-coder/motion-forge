#!/usr/bin/env node
// Load one section of a reference instead of the whole file (≈200–400 tokens instead of ≈1.5k).
// usage: refs.mjs                      index of every reference: file → section headings
//        refs.mjs <file> <section>      print one section (case-insensitive substring of its heading)
import fs from "node:fs";
import path from "node:path";
import { SKILL_DIR } from "./lib/common.mjs";
const R = path.join(SKILL_DIR, "references"), [file, sec] = process.argv.slice(2);
if (!file) { for (const f of fs.readdirSync(R).sort()) { const hs = fs.readFileSync(path.join(R, f), "utf8").split("\n").filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim());
  console.log(`${f.replace(/\.md$/, "").padEnd(18)} ${hs.join(" · ")}`); } process.exit(0); }
const fp = path.join(R, file.endsWith(".md") ? file : file + ".md"); if (!fs.existsSync(fp)) { console.error("no reference " + file); process.exit(1); }
const lines = fs.readFileSync(fp, "utf8").split("\n");
if (!sec) { console.log(lines.filter((l) => /^#{1,3} /.test(l)).join("\n")); process.exit(0); }
const i = lines.findIndex((l) => /^## /.test(l) && l.toLowerCase().includes(sec.toLowerCase()));
if (i < 0) { console.error(`no section "${sec}" in ${file}; sections: ` + lines.filter((l) => /^## /.test(l)).map((l) => l.slice(3)).join(" · ")); process.exit(1); }
let j = i + 1; while (j < lines.length && !/^## /.test(lines[j])) j++;
console.log(lines.slice(i, j).join("\n").trim());
