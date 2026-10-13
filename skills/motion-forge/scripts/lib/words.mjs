// Word-timed transcripts: load (plain array or whisper.cpp -ojf), sentences, fillers, cue chunking (same rules as the
// runtime's MF.chunkWords), SRT, remapping onto an edited timeline, and hook scoring for hooklab / social-edit.
import fs from "node:fs";

export const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");
export const FILLERS = new Set(["um", "uh", "erm", "er", "ah", "hmm", "mm", "uhm", "umm"]);
export const SOFT_FILLERS = new Set(["like", "basically", "actually", "literally"]);   // only cut with --aggressive
export const FILLER_PHRASES = [["you", "know"], ["i", "mean"], ["sort", "of"], ["kind", "of"]];

export function loadWords(f) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  if (Array.isArray(j)) return j.map((w) => ({ word: String(w.word ?? w.text).trim(), start: +w.start, end: +w.end })).filter((w) => w.word);
  const toks = (j.transcription || []).flatMap((seg) => seg.tokens || []).filter((t) => t.text && !/^\[_/.test(t.text));
  const words = [];
  for (const t of toks) { const s = t.offsets.from / 1000, e = t.offsets.to / 1000;
    if (/^\s/.test(t.text) || !words.length) words.push({ word: t.text.trim(), start: s, end: e }); else { words.at(-1).word += t.text; words.at(-1).end = e; } }
  return words.filter((w) => norm(w.word));
}

export function sentences(words) {   // [{i0, i1, start, end, text}] split on . ! ? or a pause > 0.7 s
  const out = []; let i0 = 0;
  words.forEach((w, i) => { const next = words[i + 1];
    if (!next || /[.!?…]$/.test(w.word) || next.start - w.end > 0.7) { out.push({ i0, i1: i, start: words[i0].start, end: w.end, text: words.slice(i0, i + 1).map((x) => x.word).join(" ") }); i0 = i + 1; } });
  return out;
}

export function fillerMask(words, { aggressive = false } = {}) {   // true = cut this word
  const cut = words.map((w) => FILLERS.has(norm(w.word)) || (aggressive && SOFT_FILLERS.has(norm(w.word))));
  for (let i = 0; i + 1 < words.length; i++) for (const p of FILLER_PHRASES)
    if (norm(words[i].word) === p[0] && norm(words[i + 1].word) === p[1] && (aggressive || /,$/.test(words[i + 1].word) || /,$/.test(words[i - 1]?.word || ""))) cut[i] = cut[i + 1] = true;
  return cut;
}

export function chunkWords(words, o = {}) {   // identical rules to MF.chunkWords in the runtime
  const maxW = o.maxWords || 4, maxC = o.maxChars || 26, gap = o.gap || 0.35, cues = []; let cur = [];
  const flush = () => { if (!cur.length) return; cues.push({ start: cur[0].start, end: cur.at(-1).end, text: cur.map((w) => w.text).join(" "), words: cur.slice() }); cur = []; };
  for (const w of words) { const t = String(w.word ?? w.text).trim(); if (!t) continue;
    const ww = { text: t, start: +w.start, end: +w.end }, prev = cur.at(-1);
    if (cur.length && (cur.length >= maxW || cur.map((x) => x.text).join(" ").length + 1 + t.length > maxC || ww.start - prev.end > gap || /[.!?…]$/.test(prev.text))) flush();
    cur.push(ww); }
  flush();
  cues.forEach((c, i) => { const next = cues[i + 1]; c.end = Math.min(Math.max(c.end + 0.08, c.start + (o.minDur || 0.45)), next ? next.start : Infinity); });
  return cues;
}

const ts = (s) => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
export const toSRT = (cues) => cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");

// segments = [{in, out}] in source seconds, played in order → map source words into the edited timeline
export function remapWords(words, segs) {
  const out = []; let at = 0;
  for (const s of segs) {
    for (const w of words) { const mid = (w.start + w.end) / 2; if (mid >= s.in && mid < s.out) out.push({ word: w.word, start: +(at + Math.max(0, w.start - s.in)).toFixed(3), end: +(at + Math.min(s.out, w.end) - s.in).toFixed(3) }); }
    at += s.out - s.in;
  }
  return out;
}

// hook score for a sentence: curiosity, stakes, specificity, direct address, a sensible length. Heuristic, not a model.
export const STRONG = ["never", "always", "secret", "mistake", "wrong", "stop", "nobody", "everyone", "worst", "best", "only", "truth", "actually", "why", "how", "what", "instead", "hidden", "free", "fast", "easy", "hard", "money", "lost", "failed", "changed", "warning", "don't", "dont", "biggest", "real"];
export function hookScore(s, idx, total) {
  const ws = s.text.split(/\s+/).map(norm).filter(Boolean), n = ws.length, why = [];
  let sc = 0;
  if (n >= 5 && n <= 16) { sc += 2; why.push("length"); } else if (n < 4 || n > 26) sc -= 2;
  if (/\?$/.test(s.text.trim())) { sc += 2; why.push("question"); }
  if (/\d/.test(s.text)) { sc += 1.5; why.push("number"); }
  const strong = ws.filter((w) => STRONG.includes(w)); if (strong.length) { sc += Math.min(3, strong.length * 1.2); why.push("strong:" + strong.slice(0, 3).join("/")); }
  if (ws.some((w) => w === "you" || w === "your" || w === "you're")) { sc += 1; why.push("you"); }
  if (ws.includes("but") || ws.includes("instead") || ws.includes("until")) { sc += 0.8; why.push("contrast"); }
  if (/^(so|and|um|uh|well|okay|ok|like)\b/i.test(s.text)) sc -= 1.2;   // weak openers
  if (idx === 0) sc -= 0.5;   // the opening line is already first; a cold open should bring something forward
  const dur = s.end - s.start; if (dur > 6) sc -= 1;
  return { score: +sc.toFixed(2), why };
}
