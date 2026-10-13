// Automated visual scoring for one rendered frame — runs in the page against the frame's own screenshot (no deps).
// Text contrast is MEASURED from pixels, not read from CSS: for every settled text block it samples the rendered
// background under the text, mixes the text colour by its effective opacity, and computes the WCAG ratio.
// Thresholds: 4.5:1 body text, 3:1 large text (≥ 24px bold-ish or ≥ 32px). Text with a text-shadow/backing that
// still measures low is reported, with the shadow noted. Also returns layout metrics (text coverage, edge margin).
export async function scoreFrame(page, pngBuffer, t) {
  const pe = await page.evaluate(() => { const st = document.createElement("style"); st.id = "__mf_pe"; st.textContent = "*{pointer-events:auto !important}"; document.head.appendChild(st); });
  try { return await page.evaluate(async ({ b64, t }) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const stage = document.getElementById("stage") || document.body, sr = stage.getBoundingClientRect();
    const k = img.naturalWidth / sr.width;   // screenshot pixels per CSS px (deviceScaleFactor / page scale)
    const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const opac = (e) => { let o = 1; for (let n = e; n && n !== document.body; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
    const issues = [], blocks = [];
    let minEdge = Infinity, textArea = 0;
    stage.querySelectorAll("*").forEach((e) => {
      if (e.closest("[data-mf-qa-ignore],.mf-ui")) return;
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
      if (!own) return;
      const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none") return;
      const o = opac(e); if (o < 0.95) return;                      // mid-transition or deliberately dimmed: not a reading moment
      const rg = document.createRange(); rg.selectNodeContents(e); const r = rg.getBoundingClientRect();
      let x0 = Math.max(r.left, sr.left), y0 = Math.max(r.top, sr.top), x1 = Math.min(r.right, sr.right), y1 = Math.min(r.bottom, sr.bottom);
      for (let an = e.parentElement; an && an !== stage; an = an.parentElement) {   // only what clipping ancestors let through
        const ac = getComputedStyle(an); if (ac.overflow !== "visible" || (ac.clipPath && ac.clipPath !== "none")) { const ab = an.getBoundingClientRect(); let q = { l: ab.left, t: ab.top, r: ab.right, b: ab.bottom };
          const m = ac.clipPath && ac.clipPath.match(/^inset\(([^)]*)\)/);   // clip-path reveals: shrink by the inset
          if (m) { const v = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/), px = (s, ref) => (/%$/.test(s) ? parseFloat(s) / 100 * ref : parseFloat(s) || 0);
            const T = v[0], R = v[1] || T, B = v[2] || T, Lf = v[3] || R; q = { l: ab.left + px(Lf, ab.width), t: ab.top + px(T, ab.height), r: ab.right - px(R, ab.width), b: ab.bottom - px(B, ab.height) }; }
          x0 = Math.max(x0, q.l); y0 = Math.max(y0, q.t); x1 = Math.min(x1, q.r); y1 = Math.min(y1, q.b); } }
      if (x1 - x0 < 4 || y1 - y0 < Math.max(4, 0.6 * r.height)) return;   // mostly masked: not a reading moment
      const stack = document.elementsFromPoint((x0 + x1) / 2, (y0 + y1) / 2);      // hidden under an opaque layer (next screen, wipe)?
      for (const n of stack) { if (n === e || n.contains(e) || e.contains(n)) break; const bg = getComputedStyle(n).backgroundColor.match(/[\d.]+/g), nb = n.getBoundingClientRect();
        if (bg && (bg[3] === undefined || +bg[3] > 0.5) && nb.left <= x0 + 1 && nb.top <= y0 + 1 && nb.right >= x1 - 1 && nb.bottom >= y1 - 1) return; }
      // computed colour is rgb()/rgba(), or color(srgb r g b / a) in 0–1 when it came from color-mix()
      const srgb = /^color\(srgb/.test(cs.color), m = cs.color.replace(/^color\(srgb/, "").match(/[\d.]+(e-?\d+)?/g); if (!m) return;
      const [cr, cg, cb] = m.slice(0, 3).map((x) => (srgb ? +x * 255 : +x)), ca = m[3] !== undefined ? +m[3] : 1;
      // sample the frame under the text box
      const px = Math.round((x0 - sr.left) * k), py = Math.round((y0 - sr.top) * k), pw = Math.max(1, Math.round((x1 - x0) * k)), ph = Math.max(1, Math.round((y1 - y0) * k));
      const data = cx.getImageData(px, py, pw, ph).data, Ls = [];
      const step = Math.max(1, Math.floor(Math.sqrt((pw * ph) / 4000)));
      for (let yy = 0; yy < ph; yy += step) for (let xx = 0; xx < pw; xx += step) { const i = (yy * pw + xx) * 4; Ls.push(L(data[i], data[i + 1], data[i + 2])); }
      const Lt = L(cr, cg, cb);
      Ls.sort((a, b) => Math.abs(b - Lt) - Math.abs(a - Lt));      // pixels least like the text = background
      const bgSet = Ls.slice(0, Math.max(1, Math.floor(Ls.length * 0.4))).sort((a, b) => a - b);
      const Lbg = bgSet[Math.floor(bgSet.length / 2)];
      const a = o * ca, LtEff = Lt * a + Lbg * (1 - a);            // translucent text sits partly in its background
      const c = ratio(LtEff, Lbg);
      const size = parseFloat(cs.fontSize) * (sr.width / (stage.offsetWidth || sr.width)), bold = parseInt(cs.fontWeight, 10) >= 600;
      const large = size >= 32 || (bold && size >= 24), need = large ? 3 : 4.5;
      const label = (e.id ? "#" + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""));
      blocks.push({ el: label, text: e.textContent.trim().slice(0, 30), contrast: +c.toFixed(2), need, px: Math.round(size) });
      if (c < need) issues.push({ code: "LOW_CONTRAST", severity: c < need * 0.6 ? "high" : "medium", el: label, text: e.textContent.trim().slice(0, 30),
        contrast: +c.toFixed(2), need, note: cs.textShadow !== "none" ? "has text-shadow (measured without it)" : undefined, rect: [x0, y0, x1, y1].map(Math.round) });
      minEdge = Math.min(minEdge, (x0 - sr.left) / sr.width, (y0 - sr.top) / sr.height, (sr.right - x1) / sr.width, (sr.bottom - y1) / sr.height);
      textArea += (x1 - x0) * (y1 - y0);
    });
    const worst = blocks.slice().sort((p, q) => p.contrast / p.need - q.contrast / q.need)[0] || null;
    return { t, issues, metrics: { textBlocks: blocks.length, minContrast: worst ? worst.contrast : null, worst, textCoverage: +(textArea / (sr.width * sr.height)).toFixed(3), minEdgeMargin: isFinite(minEdge) ? +minEdge.toFixed(3) : null } };
  }, { b64: pngBuffer.toString("base64"), t }); }
  finally { await page.evaluate(() => document.getElementById("__mf_pe")?.remove()); }
}
