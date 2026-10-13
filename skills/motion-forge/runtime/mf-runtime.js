/*!
 * motion-forge runtime (MF) — deterministic, dependency-free motion runtime.
 * MIT. Classic script: exposes window.MF and, after MF.compose(), window.__MF (render contract).
 *
 * Render contract (used by scripts/render.mjs):
 *   window.__MF = { ready: Promise, meta: {width,height,fps,duration,labels}, seek(t): Promise, qa(): object, stats(): object }
 * Every visual state must be a pure function of time t. No Math.random, Date.now or rAF-delta state in visuals.
 */
(function (global) {
  "use strict";
  var VERSION = "1.0.0";

  // ---------------------------------------------------------------- easing
  function cubicBezier(x1, y1, x2, y2) {
    function a(p1, p2) { return 1 - 3 * p2 + 3 * p1; }
    function b(p1, p2) { return 3 * p2 - 6 * p1; }
    function c(p1) { return 3 * p1; }
    function calc(t, p1, p2) { return ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t; }
    function slope(t, p1, p2) { return 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1); }
    function solveX(x) {
      var t = x;
      for (var i = 0; i < 8; i++) {
        var s = slope(t, x1, x2); if (Math.abs(s) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / s;
      }
      if (t < 0 || t > 1 || !isFinite(t)) { var lo = 0, hi = 1; t = x;
        for (var j = 0; j < 30; j++) { var v = calc(t, x1, x2); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
      return t;
    }
    return function (x) { if (x <= 0) return 0; if (x >= 1) return 1; return calc(solveX(x), y1, y2); };
  }
  function inOutOf(fin) { return function (t) { return t < 0.5 ? fin(t * 2) / 2 : 1 - fin((1 - t) * 2) / 2; }; }
  function outOf(fin) { return function (t) { return 1 - fin(1 - t); }; }
  var BASE_IN = {
    power1: function (t) { return t * t; }, power2: function (t) { return t * t * t; },
    power3: function (t) { return t * t * t * t; }, power4: function (t) { return t * t * t * t * t; },
    quad: function (t) { return t * t; }, cubic: function (t) { return t * t * t; },
    quart: function (t) { return t * t * t * t; }, quint: function (t) { return t * t * t * t * t; },
    sine: function (t) { return 1 - Math.cos((t * Math.PI) / 2); },
    expo: function (t) { return t === 0 ? 0 : Math.pow(2, 10 * (t - 1)); },
    circ: function (t) { return 1 - Math.sqrt(1 - t * t); }
  };
  var easeCache = {};
  function parseEase(spec) {
    if (typeof spec === "function") return spec;
    if (spec == null || spec === "none" || spec === "linear") return function (t) { return t; };
    spec = String(spec).trim();
    if (easeCache[spec]) return easeCache[spec];
    var m, fn;
    if ((m = spec.match(/^cubic\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/))) {
      fn = cubicBezier(+m[1], +m[2], +m[3], +m[4]);
    } else if ((m = spec.match(/^back(?:\.(in|out|inOut))?(?:\(([-\d.]+)\))?$/))) {
      var s = m[2] ? +m[2] : 1.70158;
      var bin = function (t) { return t * t * ((s + 1) * t - s); };
      fn = m[1] === "in" ? bin : m[1] === "inOut" ? inOutOf(bin) : outOf(bin);
    } else if ((m = spec.match(/^elastic(?:\.(in|out|inOut))?(?:\(([-\d.]+)\s*(?:,\s*([-\d.]+))?\))?$/))) {
      var amp = Math.max(1, m[2] ? +m[2] : 1), per = m[3] ? +m[3] : 0.3;
      var s2 = (per / (2 * Math.PI)) * Math.asin(1 / amp);
      var eout = function (t) { return t === 0 || t === 1 ? t : amp * Math.pow(2, -10 * t) * Math.sin(((t - s2) * (2 * Math.PI)) / per) + 1; };
      fn = m[1] === "in" ? function (t) { return 1 - eout(1 - t); } : m[1] === "inOut" ? inOutOf(function (t) { return 1 - eout(1 - t); }) : eout;
    } else if ((m = spec.match(/^([a-z0-9]+)(?:\.(in|out|inOut))?$/))) {
      var bi = BASE_IN[m[1]];
      if (!bi) throw new Error("MF: unknown ease '" + spec + "'");
      fn = m[2] === "in" ? bi : m[2] === "inOut" ? inOutOf(bi) : outOf(bi);
    } else throw new Error("MF: unknown ease '" + spec + "'");
    easeCache[spec] = fn; return fn;
  }

  // ------------------------------------------------------------- utilities
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function toArray(targets) {
    if (targets == null) return [];
    if (typeof targets === "string") return Array.prototype.slice.call(document.querySelectorAll(targets));
    if (Array.isArray(targets)) { var out = []; targets.forEach(function (t) { out = out.concat(toArray(t)); }); return out; }
    if (typeof NodeList !== "undefined" && (targets instanceof NodeList || targets instanceof HTMLCollection)) return Array.prototype.slice.call(targets);
    return [targets];
  }
  function parseColor(v) {
    if (typeof v !== "string") return null;
    var s = v.trim(), m;
    if ((m = s.match(/^#([0-9a-f]{3,8})$/i))) {
      var h = m[1]; if (h.length === 3 || h.length === 4) h = h.split("").map(function (c) { return c + c; }).join("");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    if ((m = s.match(/^color\(srgb\s+([^)]+)\)$/))) {   // what getComputedStyle returns for color-mix() results
      var q = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return [q[0] * 255, q[1] * 255, q[2] * 255, q[3] === undefined ? 1 : q[3]];
    }
    if ((m = s.match(/^rgba?\(([^)]+)\)$/))) {
      var p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    return null;
  }
  function colorStr(c) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (+c[3].toFixed(4)) + ")"; }
  var isEl = function (o) { return typeof Element !== "undefined" && o instanceof Element; };

  // DOM property model ----------------------------------------------------
  var TRANSFORM_KEYS = { x: 0, y: 0, z: 0, xPercent: 0, yPercent: 0, rotate: 0, rotation: 0, rotateX: 0, rotateY: 0, scale: 1, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 };
  var DOM_DEFAULTS = { opacity: null, blur: 0, clip: null, letterSpacing: null, autoAlpha: null };
  var states = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function domState(el) { var s = states.get(el); if (!s) { s = {}; states.set(el, s); } return s; }

  function readBase(target, prop) {
    if (isEl(target)) {
      if (prop in TRANSFORM_KEYS) return TRANSFORM_KEYS[prop];
      if (prop === "opacity" || prop === "autoAlpha") { var o = parseFloat(getComputedStyle(target).opacity); return isNaN(o) ? 1 : o; }
      if (prop === "blur") return 0;
      if (prop === "clip" || prop === "clipPath") return [0, 0, 0, 0];
      if (prop === "letterSpacing") { var ls = parseFloat(getComputedStyle(target).letterSpacing); var fs = parseFloat(getComputedStyle(target).fontSize) || 16; return isNaN(ls) ? 0 : ls / fs; }
      if (prop.indexOf("--") === 0) { var cv = getComputedStyle(target).getPropertyValue(prop).trim(); var pc = parseColor(cv); return pc || (cv === "" ? 0 : parseFloat(cv)); }
      var cs = getComputedStyle(target)[prop]; var col = parseColor(cs); if (col) return col; var n = parseFloat(cs); return isNaN(n) ? 0 : n;
    }
    var v = target[prop]; var c2 = parseColor(v); return c2 || (typeof v === "number" ? v : 0);
  }
  function normValue(v, base) {
    if (Array.isArray(v)) return v.slice();
    var c = parseColor(v); if (c) return c;
    if (typeof v === "string" && /^inset\(/.test(v)) { var parts = v.slice(6, -1).split(/\s+round\s+/), nums = parts[0].trim().split(/\s+/).map(parseFloat);
      while (nums.length < 4) nums.push(nums[nums.length === 3 ? 1 : nums.length === 2 ? 0 : 0]);
      if (parts[1]) nums.push(parseFloat(parts[1])); return nums; }   // CSS inset() shorthand (+ "round Npx" as a 5th value, px)
    if (typeof v === "string") {
      var m = v.match(/^([+-])=([-\d.]+)$/);
      if (m) return (typeof base === "number" ? base : 0) + (m[1] === "+" ? 1 : -1) * parseFloat(m[2]);
      return parseFloat(v);
    }
    return v;
  }
  function interp(a, b, p) {
    if (Array.isArray(a) || Array.isArray(b)) { a = Array.isArray(a) ? a : [a, a, a, a]; b = Array.isArray(b) ? b : [b, b, b, b];
      var r = []; for (var i = 0; i < Math.max(a.length, b.length); i++) r.push(lerp(a[i] == null ? 0 : a[i], b[i] == null ? 0 : b[i], p)); return r; }
    return lerp(a, b, p);
  }
  var nanLog = [];
  function applyProps(target, props) {
    for (var k in props) { var v = props[k];
      if (typeof v === "number" && !isFinite(v)) nanLog.push({ target: describe(target), prop: k });
      else if (Array.isArray(v) && v.some(function (x) { return !isFinite(x); })) nanLog.push({ target: describe(target), prop: k }); }
    if (!isEl(target)) { for (var p in props) { var val = props[p]; target[p] = Array.isArray(val) && val.length === 4 && parseColor(String(target[p] || "")) ? colorStr(val) : val; } return; }
    var st = domState(target), dirtyT = false;
    for (var key in props) {
      var v2 = props[key];
      if (key in TRANSFORM_KEYS) { st[key] = v2; dirtyT = true; }
      else if (key === "opacity") target.style.opacity = +v2.toFixed(4);
      else if (key === "autoAlpha") { target.style.opacity = +v2.toFixed(4); target.style.visibility = v2 <= 0.0001 ? "hidden" : "inherit"; }
      else if (key === "blur") target.style.filter = v2 > 0.01 ? "blur(" + v2.toFixed(2) + "px)" : "";
      else if (key === "clip" || key === "clipPath") target.style.clipPath = "inset(" + v2.slice(0, 4).map(function (n) { return n.toFixed(3) + "%"; }).join(" ") + (v2.length > 4 ? " round " + v2[4].toFixed(2) + "px" : "") + ")";
      else if (key === "letterSpacing") target.style.letterSpacing = v2.toFixed(4) + "em";
      else if (key.indexOf("--") === 0) target.style.setProperty(key, Array.isArray(v2) ? colorStr(v2) : String(+v2.toFixed(4)));
      else if (Array.isArray(v2)) target.style[key] = colorStr(v2);
      else target.style[key] = /^(width|height|top|left|right|bottom|fontSize|borderRadius|padding|margin)/.test(key) ? v2.toFixed(3) + "px" : String(v2);
    }
    if (dirtyT) {
      var tf = "";
      if (st.xPercent || st.yPercent) tf += "translate(" + (st.xPercent || 0) + "%," + (st.yPercent || 0) + "%) ";
      // 2D translate unless real 3D is used: translate3d promotes a compositor layer whose raster scale Chromium caches
      // across scale changes → blurry / history-dependent text pixels (caught by the determinism check).
      if (st.z || st.rotateX || st.rotateY) tf += "translate3d(" + (st.x || 0).toFixed(3) + "px," + (st.y || 0).toFixed(3) + "px," + (st.z || 0).toFixed(3) + "px)";
      else tf += "translate(" + (st.x || 0).toFixed(3) + "px," + (st.y || 0).toFixed(3) + "px)";
      var rot = (st.rotate || 0) + (st.rotation || 0); if (rot) tf += " rotate(" + rot.toFixed(4) + "deg)";
      if (st.rotateX) tf += " rotateX(" + st.rotateX.toFixed(4) + "deg)";
      if (st.rotateY) tf += " rotateY(" + st.rotateY.toFixed(4) + "deg)";
      if (st.skewX || st.skewY) tf += " skew(" + (st.skewX || 0).toFixed(3) + "deg," + (st.skewY || 0).toFixed(3) + "deg)";
      var s = st.scale == null ? 1 : st.scale, sx = (st.scaleX == null ? 1 : st.scaleX) * s, sy = (st.scaleY == null ? 1 : st.scaleY) * s;
      if (sx !== 1 || sy !== 1) tf += " scale(" + sx.toFixed(5) + "," + sy.toFixed(5) + ")";
      target.style.transform = tf;
      // a split unit pushed fully out of its mask (|y/xPercent| ≥ 100) is hidden by intent — but descenders/ascenders that
      // overhang a tight line box would still peek through the mask's padding as stray marks. Hide it outright.
      if (/(^|\s)mf-(word|line|char)(\s|$)/.test(target.className) && target.parentElement && target.parentElement.style.overflow === "hidden")
        target.style.visibility = Math.abs(st.yPercent || 0) >= 100 || Math.abs(st.xPercent || 0) >= 100 ? "hidden" : "";
    }
  }
  function describe(t) {
    if (!isEl(t)) return "object";
    return t.tagName.toLowerCase() + (t.id ? "#" + t.id : "") + (t.className && typeof t.className === "string" ? "." + t.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  }

  // ------------------------------------------------------------- timeline
  var RESERVED = { duration: 1, ease: 1, stagger: 1, delay: 1, onUpdate: 1, immediateRender: 1, id: 1 };
  function staggerOffsets(n, st) {
    if (!st) return new Array(n).fill(0);
    if (typeof st === "number") st = { each: st };
    var each = st.each != null ? st.each : st.amount != null ? st.amount / Math.max(1, n - 1) : 0;
    var from = st.from || "start", out = [];
    var ease = st.ease ? parseEase(st.ease) : null, maxD = 0, ds = [];
    for (var i = 0; i < n; i++) {
      var d = from === "end" ? n - 1 - i : from === "center" ? Math.abs(i - (n - 1) / 2) : from === "edges" ? (n - 1) / 2 - Math.abs(i - (n - 1) / 2) : typeof from === "number" ? Math.abs(i - from) : i;
      ds.push(d); maxD = Math.max(maxD, d);
    }
    for (var j = 0; j < n; j++) out.push(ease && maxD > 0 ? ease(ds[j] / maxD) * maxD * each : ds[j] * each);
    return out;
  }

  function Timeline(opts) {
    opts = opts || {};
    this.defaults = opts.defaults || {};
    this.segments = [];   // {target, prop, start, dur, from, to, ease, kind}
    this.labels = {};
    this.updaters = [];   // {start, dur, fn}
    this._cursor = 0; this._prevStart = 0; this._prevEnd = 0; this._dirty = true; this._end = 0;
    this.isMF = true;
  }
  Timeline.prototype._pos = function (position) {
    if (position == null || position === "") return this._cursor;
    if (typeof position === "number") return position;
    var s = String(position).trim(), m;
    if (s === ">") return this._prevEnd;
    if (s === "<") return this._prevStart;
    if ((m = s.match(/^([<>])([+-]=?)?([-\d.]+)$/))) { var base = m[1] === "<" ? this._prevStart : this._prevEnd; var sign = m[2] && m[2][0] === "-" ? -1 : 1; return base + sign * +m[3]; }
    if ((m = s.match(/^([+-])=([-\d.]+)$/))) return this._cursor + (m[1] === "+" ? 1 : -1) * +m[2];
    if ((m = s.match(/^([A-Za-z_][\w-]*)(?:([+-])=([-\d.]+))?$/))) {
      if (!(m[1] in this.labels)) this.labels[m[1]] = this._cursor;
      return this.labels[m[1]] + (m[2] ? (m[2] === "+" ? 1 : -1) * +m[3] : 0);
    }
    throw new Error("MF: bad position '" + position + "' (use a number, '<', '>', '+=0.2', '-=0.2', 'label', 'label+=0.2', 'label-=0.2', '<0.2')");
  };
  Timeline.prototype._mark = function (start, end) { this._prevStart = start; this._prevEnd = end; this._cursor = Math.max(this._cursor, end); this._end = Math.max(this._end, end); this._dirty = true; };
  Timeline.prototype._tween = function (kind, targets, fromVars, toVars, position) {
    var vars = toVars || fromVars;
    var dur = vars.duration != null ? vars.duration : this.defaults.duration != null ? this.defaults.duration : 0.5;
    if (kind === "set") dur = 0;
    var ease = parseEase(vars.ease != null ? vars.ease : this.defaults.ease != null ? this.defaults.ease : "power2.out");
    var list = toArray(targets);
    if (!list.length) console.warn("MF: tween target not found:", targets);
    var start = this._pos(position) + (vars.delay || 0);
    var offs = staggerOffsets(list.length, vars.stagger), end = start;
    var self = this;
    list.forEach(function (t, i) {
      var s = start + offs[i];
      var props = {};
      Object.keys(vars).forEach(function (k) { if (!RESERVED[k]) props[k] = true; });
      if (fromVars && toVars) Object.keys(fromVars).forEach(function (k) { if (!RESERVED[k]) props[k] = true; });
      Object.keys(props).forEach(function (p) {
        var seg = { target: t, prop: p, start: s, dur: dur, ease: ease, kind: kind, rawFrom: null, rawTo: null };
        if (kind === "to" || kind === "set") seg.rawTo = toVars[p];
        else if (kind === "from") seg.rawFrom = fromVars[p];
        else { seg.rawFrom = fromVars[p]; seg.rawTo = toVars[p]; }
        seg.idx = i;
        self.segments.push(seg);
      });
      if (vars.onUpdate) self.updaters.push({ start: s, dur: dur, fn: vars.onUpdate, ease: ease, target: t, index: i });
      end = Math.max(end, s + dur);
    });
    this._mark(start, end);
    return this;
  };
  Timeline.prototype.to = function (t, v, p) { return this._tween("to", t, null, v, p); };
  Timeline.prototype.from = function (t, v, p) { return this._tween("from", t, v, null, p); };
  Timeline.prototype.fromTo = function (t, f, v, p) { return this._tween("fromTo", t, f, v, p); };
  Timeline.prototype.set = function (t, v, p) { return this._tween("set", t, null, v, p); };
  Timeline.prototype.addLabel = function (name, position) { this.labels[name] = this._pos(position); return this; };
  Timeline.prototype.call = function (fn, args, position) { // deterministic: fn(localProgressOfZeroLengthEvent) is invoked on every seek past position
    var s = this._pos(position); this.updaters.push({ start: s, dur: 0, fn: function () { fn.apply(null, args || []); }, ease: parseEase("none") }); this._mark(s, s); return this; };
  Timeline.prototype.add = function (child, position) {
    if (typeof child === "string") return this.addLabel(child, position);
    if (typeof child === "function") return this.call(child, [], position);
    var start = this._pos(position), self = this;
    child._nested = true;
    child._finalize();
    child.segments.forEach(function (sg) { var c = Object.assign({}, sg); c.start += start; self.segments.push(c); });
    child.updaters.forEach(function (u) { var c = Object.assign({}, u); c.start += start; self.updaters.push(c); });
    Object.keys(child.labels).forEach(function (l) { self.labels[l] = child.labels[l] + start; });
    this._mark(start, start + child.duration());
    return this;
  };
  Timeline.prototype.duration = function () { return this._end; };
  Timeline.prototype._finalize = function () {
    if (!this._dirty) return;
    // group by target+prop; resolve implicit from/to values in start order (GSAP-like chaining)
    var groups = new Map();
    this.segments.forEach(function (s) {
      var g = groups.get(s.target); if (!g) { g = {}; groups.set(s.target, g); }
      (g[s.prop] = g[s.prop] || []).push(s);
    });
    this._groups = [];
    var self = this;
    groups.forEach(function (byProp, target) {
      Object.keys(byProp).forEach(function (prop) {
        var segs = byProp[prop].sort(function (a, b) { return a.start - b.start; });
        var base = readBase(target, prop === "autoAlpha" ? "opacity" : prop), cur = base;
        segs.forEach(function (s) {
          if (s.kind === "to" || s.kind === "set") { s.from = cur; s.to = normValue(s.rawTo, cur); }
          else if (s.kind === "from") { s.from = normValue(s.rawFrom, cur); s.to = cur; }
          else { s.from = normValue(s.rawFrom, cur); s.to = normValue(s.rawTo, s.from); }
          cur = s.to;
        });
        self._groups.push({ target: target, prop: prop, segs: segs, base: base });
      });
    });
    this._dirty = false;
  };
  Timeline.prototype.valueAt = function (g, t) {
    var segs = g.segs, active = null;
    for (var i = 0; i < segs.length; i++) { if (segs[i].start <= t + 1e-9) active = segs[i]; else break; }
    if (!active) { var f = segs[0]; return f.kind === "from" || f.kind === "fromTo" ? f.from : g.base; } // from/fromTo render immediately
    if (active.dur <= 0) return active.to;
    var p = clamp((t - active.start) / active.dur, 0, 1);
    return interp(active.from, active.to, active.ease(p));
  };
  Timeline.prototype.seek = function (t) {
    this._finalize();
    var byTarget = new Map(), self = this;
    this._groups.forEach(function (g) {
      var props = byTarget.get(g.target); if (!props) { props = {}; byTarget.set(g.target, props); }
      props[g.prop] = self.valueAt(g, t);
    });
    byTarget.forEach(function (props, target) { applyProps(target, props); });
    this.updaters.forEach(function (u) {
      if (u.dur === 0) { if (t >= u.start) u.fn(); return; }
      var p = clamp((t - u.start) / u.dur, 0, 1);
      u.fn(u.ease(p), p, u.target, u.index);
    });
    this._time = t;
    return this;
  };
  Timeline.prototype.time = function () { return this._time || 0; };
  Timeline.prototype.progress = function (p) { return this.seek(p * this.duration()); };
  Timeline.prototype.pause = function () { return this; };
  Timeline.prototype.kill = function () { this.segments = []; this.updaters = []; this._groups = []; return this; };

  // ---------------------------------------------------------------- split
  // Splits text into masked units while preserving inline styling (<em>, <b>, <span class>) and glued punctuation
  // ("Faster<em>.</em>" stays one word). <br> is kept as a designed line break. by: "words" | "chars" | "lines".
  function split(el, opts) {
    el = toArray(el)[0]; opts = opts || {};
    var by = opts.by || "words", mask = opts.mask !== false;
    if (!el) throw new Error("MF.split: element not found");
    el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
    // words = [[{t, w}]] (fragments with wrapper clone or null), "\n" for <br>
    var words = [], cur = null;
    function flush() { if (cur && cur.length) words.push(cur); cur = null; }
    (function collect(node, wrapper) {
      Array.prototype.forEach.call(node.childNodes, function (ch) {
        if (ch.nodeType === 3) {
          var parts = ch.textContent.split(/(\s+)/);
          parts.forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { flush(); return; }
            cur = cur || []; var last = cur[cur.length - 1];
            if (last && last.w === wrapper) last.t += part; else cur.push({ t: part, w: wrapper });
          });
        } else if (ch.nodeType === 1 && ch.tagName === "BR") { flush(); words.push("\n"); }
        else if (ch.nodeType === 1) collect(ch, ch.cloneNode(false));
      });
    })(el, null);
    flush();
    el.textContent = "";
    var units = [];
    var frag = function (f, txt) { if (!f.w) return document.createTextNode(txt); var w = f.w.cloneNode(false); w.textContent = txt; return w; };
    var wrap = function (inner, cls) {
      var outer = document.createElement("span"); outer.className = "mf-" + cls + "-mask"; outer.setAttribute("aria-hidden", "true");
      outer.style.display = "inline-block"; outer.style.verticalAlign = "top";
      if (mask) { outer.style.overflow = "hidden"; outer.style.paddingBottom = "0.12em"; outer.style.marginBottom = "-0.12em"; outer.style.paddingTop = "0.06em"; outer.style.marginTop = "-0.06em"; }
      inner.style.display = "inline-block"; inner.className = "mf-" + cls;
      outer.appendChild(inner); return outer;
    };
    words.forEach(function (w, i) {
      if (w === "\n") { el.appendChild(document.createElement("br")); return; }
      if (by === "chars") {
        var wordBox = document.createElement("span"); wordBox.style.display = "inline-block"; wordBox.style.whiteSpace = "nowrap";
        w.forEach(function (f) { Array.from(f.t).forEach(function (chr) {
          var s = document.createElement("span"); s.appendChild(frag(f, chr));
          if (mask) wordBox.appendChild(wrap(s, "char")); else { s.style.display = "inline-block"; s.className = "mf-char"; wordBox.appendChild(s); }
          units.push(s); }); });
        el.appendChild(wordBox);
      } else { var s2 = document.createElement("span"); w.forEach(function (f) { s2.appendChild(frag(f, f.t)); }); el.appendChild(wrap(s2, "word")); units.push(s2); }
      if (i < words.length - 1 && words[i + 1] !== "\n") el.appendChild(document.createTextNode(" "));
    });
    // balance: split words are inline-blocks, which CSS text-wrap:balance ignores — emulate it by shrinking the
    // block to the narrowest width that keeps the same number of lines (evens the rag, kills single-word last lines)
    var cs0 = getComputedStyle(el), wantBalance = opts.balance === true || (opts.balance !== false && /balance/.test((cs0.textWrap || "") + " " + (cs0.textWrapStyle || "")));
    if (wantBalance && by !== "lines") {
      var masks = Array.prototype.slice.call(el.children).filter(function (c) { return c.nodeName !== "BR"; });
      var countLines = function () { var tops = {}; masks.forEach(function (m) { tops[Math.round(m.offsetTop)] = 1; }); return Object.keys(tops).length; };
      var n0 = countLines(), full = el.getBoundingClientRect().width;
      if (n0 > 1 && full > 0) {
        var widest = masks.reduce(function (w, m) { return Math.max(w, m.getBoundingClientRect().width); }, 0);
        var lo = Math.min(full, Math.max(full * 0.35, widest)), hi = full;   // never narrower than the longest word
        for (var it = 0; it < 14; it++) { var mid = (lo + hi) / 2; el.style.maxWidth = mid + "px"; if (countLines() > n0) lo = mid; else hi = mid; }
        el.style.maxWidth = Math.ceil(hi + 1) + "px";
        // still a single-word last line? pull the previous word down with a designed break if both fit on one line
        var lineOf = function (m) { return Math.round(m.offsetTop); };
        var last = masks[masks.length - 1], prev = masks[masks.length - 2];
        if (masks.length > 2 && lineOf(last) !== lineOf(prev)) {
          el.style.maxWidth = "";
          var br = document.createElement("br"); br.setAttribute("data-mf-auto", ""); el.insertBefore(br, prev);
          var ok = countLines() === n0 && lineOf(last) === lineOf(prev) && el.scrollWidth <= el.clientWidth + 1;
          if (!ok) { br.remove(); el.style.maxWidth = Math.ceil(hi + 1) + "px"; }
        }
      }
    }
    if (by === "lines") {
      // regroup measured word masks into line masks (keeps each word's styled fragments)
      var lines = [], lastTop = null, kids = Array.prototype.slice.call(el.childNodes);
      kids.forEach(function (k) {
        if (k.nodeName === "BR") { lastTop = null; return; }
        if (k.nodeType !== 1) return;
        var top = Math.round(k.offsetTop); if (top !== lastTop) { lines.push([]); lastTop = top; }
        lines[lines.length - 1].push(k.firstChild);
      });
      el.textContent = ""; units = [];
      lines.forEach(function (ws) {
        var line = document.createElement("span");
        ws.forEach(function (wd, j) { while (wd.firstChild) line.appendChild(wd.firstChild); if (j < ws.length - 1) line.appendChild(document.createTextNode(" ")); });
        var o = wrap(line, "line"); o.style.display = "block"; el.appendChild(o); units.push(line);
      });
    }
    return units;
  }

  // --------------------------------------------------------------- tokens
  var tokens = {
    dur: { instant: 0.12, xs: 0.2, s: 0.35, m: 0.6, l: 0.95, xl: 1.4, hold: 1.2 },
    ease: { enter: "expo.out", exit: "power3.in", move: "power3.inOut", settle: "back.out(1.25)", soft: "sine.inOut",
      snap: "cubic(0.2,0,0,1)", drift: "cubic(0.37,0,0.63,1)", linear: "none" },
    stagger: { tight: 0.03, word: 0.06, line: 0.11, item: 0.14 }
  };

  // ---------------------------------------------------------------- QA
  function effectiveOpacity(el) { var o = 1; while (el && el.nodeType === 1) { var cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") return 0; o *= parseFloat(cs.opacity); el = el.parentElement; } return o; }
  var fontCache = {};
  function fontAvailable(family) {
    if (family in fontCache) return fontCache[family];
    var generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|inherit|initial)$/i;
    if (generic.test(family)) return (fontCache[family] = true);
    // declared webfonts: trust the FontFaceSet status (measurement is unreliable for faces that are still loading)
    if (document.fonts && document.fonts.forEach) {
      var faces = []; document.fonts.forEach(function (f) { if (f.family.replace(/["']/g, "") === family) faces.push(f.status); });
      if (faces.length) return (fontCache[family] = faces.indexOf("loaded") >= 0);
    }
    var c = document.createElement("canvas").getContext("2d"), txt = "mmmmmmmmmlliWW@#0123456789";
    var res = ["monospace", "serif"].some(function (g) { c.font = "72px " + g; var w0 = c.measureText(txt).width; c.font = '72px "' + family + '", ' + g; return c.measureText(txt).width !== w0; });
    return (fontCache[family] = res);
  }
  var SAFE = { "9:16": [0.06, 0.14, 0.84, 0.80], "4:5": [0.05, 0.05, 0.95, 0.95], "1:1": [0.05, 0.05, 0.95, 0.95], "16:9": [0.05, 0.05, 0.95, 0.95] };  // l,t,r,b fractions
  // clipping box an ancestor imposes: its border box for overflow masks, shrunk by clip-path: inset(...) when present
  function clipBox(anc) {
    var cs = getComputedStyle(anc), clips = cs.overflow !== "visible" || cs.overflowX !== "visible", cp = cs.clipPath && cs.clipPath !== "none" ? cs.clipPath : null;
    if (!clips && !cp) return null;
    var r = anc.getBoundingClientRect(), b = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    var m = cp && cp.match(/^inset\(([^)]*)\)/);
    if (m) { var v = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/), px = function (s, ref) { return /%$/.test(s) ? parseFloat(s) / 100 * ref : parseFloat(s) || 0; };
      var t = v[0], rr = v[1] || t, bb = v[2] || t, l = v[3] || rr, w = r.width, h = r.height;
      b = { left: r.left + px(l, w), top: r.top + px(t, h), right: r.right - px(rr, w), bottom: r.bottom - px(bb, h) }; }
    return b;
  }
  function qa(stage, safeKind) {
    var W = innerWidth, H = innerHeight, issues = [];
    var safe = safeKind && SAFE[safeKind] ? SAFE[safeKind] : null;
    var root = stage || document.body;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), seen = new Set(), node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      var el = node.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      if (el.closest("[data-mf-qa-ignore],script,style,noscript")) continue;
      var op = effectiveOpacity(el); if (op < 0.05) continue;
      var r = document.createRange(); r.selectNodeContents(node); var rb = r.getBoundingClientRect();
      // visible rect = text rect ∩ every clipping ancestor (overflow masks, clip-path reveals) — masked reveals are not defects
      var rect = { left: rb.left, top: rb.top, right: rb.right, bottom: rb.bottom };
      for (var anc = el.parentElement; anc && anc !== root && anc !== document.body && anc !== document.documentElement; anc = anc.parentElement) {
        var ar = clipBox(anc);
        if (ar) { rect.left = Math.max(rect.left, ar.left); rect.top = Math.max(rect.top, ar.top); rect.right = Math.min(rect.right, ar.right); rect.bottom = Math.min(rect.bottom, ar.bottom); }
      }
      if (rect.right - rect.left <= 0.5 || rect.bottom - rect.top <= 0.5) continue;   // fully masked or empty
      var tol = 2;
      if (rect.left < -tol || rect.top < -tol || rect.right > W + tol || rect.bottom > H + tol) {
        var inside = !(rect.right < 0 || rect.bottom < 0 || rect.left > W || rect.top > H);
        issues.push({ code: inside ? "TEXT_CLIPPED_BY_FRAME" : "TEXT_OFFSCREEN_VISIBLE", severity: inside ? "high" : "low", el: describe(el), text: node.textContent.trim().slice(0, 40), rect: [rect.left, rect.top, rect.right, rect.bottom].map(Math.round) });
      }
      else if (safe && op >= 0.6 && (rect.left < safe[0] * W - tol || rect.top < safe[1] * H - tol || rect.right > safe[2] * W + tol || rect.bottom > safe[3] * H + tol))
        issues.push({ code: "TEXT_OUTSIDE_SAFE_ZONE", severity: safeKind === "9:16" ? "high" : "medium", el: describe(el), text: node.textContent.trim().slice(0, 40), rect: [rect.left, rect.top, rect.right, rect.bottom].map(Math.round) });
      // overflow of its own box (wrapping failure)
      var cs = getComputedStyle(el);
      // compare the TEXT's own width to the box (scrollWidth also counts decorative absolute children → false positives)
      if (cs.display !== "inline" && cs.overflow === "visible" && el.clientWidth > 0 && rb.width > el.clientWidth + 2 && !el.closest("[class*=mf-][class*=-mask]"))
        issues.push({ code: "TEXT_OVERFLOWS_BOX", severity: "medium", el: describe(el), text: node.textContent.trim().slice(0, 40), rect: [rb.left, rb.top, rb.right, rb.bottom].map(Math.round) });
      var fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      if (!fontAvailable(fam)) issues.push({ code: "FONT_MISSING", severity: "high", el: describe(el), font: fam });
    }
    // orphans: last word alone on its line, for any [data-mf-text] block (split or not); a designed <br> is exempt
    Array.prototype.forEach.call(root.querySelectorAll("[data-mf-text]"), function (host) {
      if (effectiveOpacity(host) < 0.05) return;
      // overset: the block's text is wider than its box (covers split text, whose units live in masks)
      var hcs = getComputedStyle(host), hr = document.createRange(); hr.selectNodeContents(host);
      var hw = hr.getBoundingClientRect().width, hb = host.getBoundingClientRect();
      if (hcs.display !== "inline" && host.clientWidth > 0 && hw > hb.width + 2 && !issues.some(function (i) { return i.code === "TEXT_OVERFLOWS_BOX" && i.el === describe(host); }))
        issues.push({ code: "TEXT_OVERFLOWS_BOX", severity: "medium", el: describe(host), text: host.textContent.trim().slice(0, 40), rect: [hb.left, hb.top, hb.left + hw, hb.bottom].map(Math.round) });
      var tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null), n, toks = [];
      while ((n = tw.nextNode())) {
        if (n.nodeType === 1) { if (n.nodeName === "BR") toks.push("BR"); continue; }
        var re = /\S+/g, m; while ((m = re.exec(n.textContent))) toks.push({ node: n, s: m.index, e: m.index + m[0].length, w: m[0] });
      }
      // group split fragments into layout units: a word mask, or the nowrap box that holds a word's char masks
      var unitOf = function (t) { var e = t.node.parentElement; var wm = e && e.closest(".mf-word-mask"); if (wm) return wm;
        var cm = e && e.closest(".mf-char-mask"); return cm ? cm.parentElement : null; };
      var words = [];
      toks.forEach(function (t) { if (t === "BR") { words.push("BR"); return; } t.unit = unitOf(t);
        var prev = words[words.length - 1]; if (prev && prev !== "BR" && t.unit && prev.unit === t.unit) { prev.w += t.w; return; } words.push(t); });
      var brBeforeLast = words.length > 1 && words[words.length - 2] === "BR";
      words = words.filter(function (t) { return t !== "BR"; });
      while (words.length && /^[.,;:!?…»”)\]]+$/.test(words[words.length - 1].w)) words.pop();   // glued punctuation belongs to the previous word
      if (words.length < 3 || brBeforeLast) return;
      // layout position (untransformed mask/unit box when split, text range otherwise) — mid-animation offsets are not orphans
      var top = function (t) { if (t.unit) return Math.round(t.unit.getBoundingClientRect().top);
        var r = document.createRange(); r.setStart(t.node, t.s); r.setEnd(t.node, t.e); return Math.round(r.getBoundingClientRect().top); };
      var last = words[words.length - 1], prev = words[words.length - 2];
      var tl1 = top(last), tp = top(prev);
      // a widow is a SHORT last line: a long final word on its own line ("themselves.") reads as a deliberate stack
      var wOf = function (t) { if (t.unit) return t.unit.getBoundingClientRect().width; var r = document.createRange(); r.setStart(t.node, t.s); r.setEnd(t.node, t.e); return r.getBoundingClientRect().width; };
      var hostW = host.getBoundingClientRect().width;
      if (Math.abs(tl1 - tp) > 2 && wOf(last) < 0.4 * hostW)
        issues.push({ code: "TYPE_ORPHAN", severity: "medium", el: describe(host), text: last.w, rect: (function (b) { return [b.left, b.top, b.right, b.bottom].map(Math.round); })(host.getBoundingClientRect()) });
    });
    // collisions: visible text blocks from different components overlapping each other (captions over copy, labels over titles)
    var blocks = [];
    var pe = document.createElement("style"); pe.textContent = "*{pointer-events:auto !important}"; document.head.appendChild(pe);   // hit-test everything
    var occluded = function (e, b) {   // under a large opaque layer (scene wipe, end card)? walk the hit-test stack above e
      var x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2; if (x < 0 || y < 0 || x > W || y > H) return false;
      var stack = document.elementsFromPoint(x, y);
      for (var k = 0; k < stack.length; k++) {
        var n = stack[k];
        if (n === e || n.contains(e) || e.contains(n)) return false;          // reached e (or its own box) first: visible
        var pc = parseColor(getComputedStyle(n).backgroundColor), alpha = pc ? pc[3] : 0, nb = n.getBoundingClientRect();
        var covers = nb.left <= b.left + 1 && nb.top <= b.top + 1 && nb.right >= b.right - 1 && nb.bottom >= b.bottom - 1;
        if (alpha > 0.5 && (covers || nb.width * nb.height > 0.4 * W * H)) return true;   // opaque layer above e that hides it (next screen, wipe, end card)
      }
      return false; };
    seen.forEach(function (e) {
      if (e.closest("[data-mf-overlap-ok],[data-mf-qa-ignore]") || effectiveOpacity(e) < 0.2) return;
      var host = e.closest("[data-mf-text]") || e.closest(".mf-captions") || e;
      var rr = document.createRange(); rr.selectNodeContents(e); var b = rr.getBoundingClientRect();
      // a range box is the font's content area (≈1.2em per line); display type set at line-height 0.9 has ink well inside it.
      // Collide line boxes, not content areas, or big numerals "overlap" the label above them.
      var lhPx = parseFloat(getComputedStyle(e).lineHeight), nLines = (function () { var tops = {}; Array.prototype.forEach.call(rr.getClientRects(), function (q) { tops[Math.round(q.top)] = 1; }); return Math.max(1, Object.keys(tops).length); })();
      if (lhPx > 0 && b.height > nLines * lhPx) { var trim = (b.height - nLines * lhPx) / 2; b = { left: b.left, right: b.right, top: b.top + trim, bottom: b.bottom - trim }; }
      for (var an = e.parentElement; an && an !== root && an !== document.body; an = an.parentElement) {
        var ab = clipBox(an); if (ab) b = { left: Math.max(b.left, ab.left), top: Math.max(b.top, ab.top), right: Math.min(b.right, ab.right), bottom: Math.min(b.bottom, ab.bottom) }; }
      var full = rr.getBoundingClientRect();
      // a sliver left by a mask (descender padding under a hidden word) carries no ink a viewer can read: ignore < 25% of the line
      if (b.right - b.left > 1 && b.bottom - b.top > Math.max(1, 0.25 * full.height) && !occluded(e, b)) blocks.push({ host: host, el: e, r: b });
    });
    pe.remove();
    var reported = {};
    for (var i = 0; i < blocks.length; i++) for (var j = i + 1; j < blocks.length; j++) {
      var A = blocks[i], Bk = blocks[j];
      if (A.host === Bk.host || A.host.contains(Bk.host) || Bk.host.contains(A.host)) continue;
      var ix = Math.min(A.r.right, Bk.r.right) - Math.max(A.r.left, Bk.r.left), iy = Math.min(A.r.bottom, Bk.r.bottom) - Math.max(A.r.top, Bk.r.top);
      if (ix <= 0 || iy <= 0) continue;
      var small = Math.min((A.r.right - A.r.left) * (A.r.bottom - A.r.top), (Bk.r.right - Bk.r.left) * (Bk.r.bottom - Bk.r.top));
      var key = describe(A.host) + "|" + describe(Bk.host);
      if ((ix * iy) / small > 0.04 && !reported[key]) { reported[key] = 1;
        issues.push({ code: "TEXT_OVERLAP", severity: "high", el: describe(A.host) + " × " + describe(Bk.host), text: (A.el.textContent.trim().slice(0, 20) + " × " + Bk.el.textContent.trim().slice(0, 20)),
          rect: [Math.max(A.r.left, Bk.r.left), Math.max(A.r.top, Bk.r.top), Math.min(A.r.right, Bk.r.right), Math.min(A.r.bottom, Bk.r.bottom)].map(Math.round),
          rects: [A.r, Bk.r].map(function (q) { return [q.left, q.top, q.right, q.bottom].map(Math.round); }) }); }
    }
    var de = document.documentElement;
    if (de.scrollWidth > W + 1 || de.scrollHeight > H + 1) issues.push({ code: "PAGE_SCROLLBARS", severity: "medium", detail: [de.scrollWidth, de.scrollHeight] });
    nanLog.splice(0).slice(0, 10).forEach(function (n) { issues.push({ code: "NAN_VALUE", severity: "critical", el: n.target, prop: n.prop }); });
    document.querySelectorAll("img").forEach(function (img) { if (!img.complete || img.naturalWidth === 0) issues.push({ code: "IMAGE_FAILED", severity: "critical", src: img.getAttribute("src") }); });
    var canv = document.querySelectorAll("canvas"); canv.forEach(function (cv) { if (cv.__mfContextLost) issues.push({ code: "WEBGL_CONTEXT_LOST", severity: "critical", el: describe(cv) }); });
    return { issues: issues, canvases: canv.length, viewport: [W, H] };
  }

  // ---------------------------------------------------------- frame/data
  // MF.frame(defaults): frame size from ?w=&h=&fps= (for multi-format variants) or defaults. Sets data-aspect and unit
  // vars on the stage so CSS can RE-COMPOSE per aspect ([data-aspect=portrait] …) instead of scaling.
  // Baked physics: simulate ONCE at a fixed step, store snapshots, sample by t. Renders stay a pure function of t (any seek
  // order gives the same pose) — never step a simulation inside render(). Spheres + ground plane + pairwise contacts.
  // MF.physics({ bodies:[{p:[x,y,z], v:[…], r, m}], gravity:[0,-9.8,0], ground:0, restitution:0.45, friction:0.2, duration, hz:240, events:[{t, body, impulse:[…]}] })
  //   → { at(t) → [{p:[x,y,z], v:[…]}], contacts: [{t, a, b}] }
  function physics(o) {
    o = o || {}; var hz = o.hz || 240, dt = 1 / hz, dur = o.duration || 5, g = o.gravity || [0, -9.8, 0], e = o.restitution == null ? 0.45 : o.restitution;
    var fr = o.friction == null ? 0.2 : o.friction, gy = o.ground == null ? null : o.ground;
    var B = (o.bodies || []).map(function (b) { return { p: b.p.slice(), v: (b.v || [0, 0, 0]).slice(), r: b.r || 0.5, m: b.m || 1, fixed: !!b.fixed }; });
    var ev = (o.events || []).slice().sort(function (x, y) { return x.t - y.t; }), ei = 0;
    var steps = Math.ceil(dur * hz), snaps = [], contacts = [], keep = Math.max(1, Math.round(hz / 120));   // store at 120 Hz
    var snap = function () { snaps.push(B.map(function (b) { return { p: b.p.slice(), v: b.v.slice() }; })); };
    snap();
    for (var s = 1; s <= steps; s++) {
      var t = s * dt;
      while (ei < ev.length && ev[ei].t <= t) { var E = ev[ei++], tb = B[E.body]; if (tb) for (var k = 0; k < 3; k++) tb.v[k] += (E.impulse[k] || 0) / tb.m; }
      B.forEach(function (b) { if (b.fixed) return; for (var k = 0; k < 3; k++) { b.v[k] += g[k] * dt; b.p[k] += b.v[k] * dt; }
        if (gy != null && b.p[1] - b.r < gy) { b.p[1] = gy + b.r; if (b.v[1] < 0) { if (b.v[1] < -0.5) contacts.push({ t: t, a: B.indexOf(b), b: "ground" }); b.v[1] = -b.v[1] * e; b.v[0] *= 1 - fr; b.v[2] *= 1 - fr; } } });
      for (var i = 0; i < B.length; i++) for (var j = i + 1; j < B.length; j++) {
        var A = B[i], C = B[j], d = [C.p[0] - A.p[0], C.p[1] - A.p[1], C.p[2] - A.p[2]], dist = Math.hypot(d[0], d[1], d[2]), min = A.r + C.r;
        if (dist > 0 && dist < min) {
          var n = d.map(function (x) { return x / dist; }), ia = A.fixed ? 0 : 1 / A.m, ic = C.fixed ? 0 : 1 / C.m, pen = (min - dist) / (ia + ic || 1);
          for (var q = 0; q < 3; q++) { A.p[q] -= n[q] * pen * ia; C.p[q] += n[q] * pen * ic; }
          var rv = (C.v[0] - A.v[0]) * n[0] + (C.v[1] - A.v[1]) * n[1] + (C.v[2] - A.v[2]) * n[2];
          if (rv < 0) { var jimp = -(1 + e) * rv / (ia + ic || 1); for (var w = 0; w < 3; w++) { A.v[w] -= jimp * n[w] * ia; C.v[w] += jimp * n[w] * ic; } if (-rv > 0.5) contacts.push({ t: t, a: i, b: j }); }
        }
      }
      if (s % keep === 0) snap();
    }
    var rate = hz / keep;
    return { contacts: contacts, rate: rate, at: function (t) {
      var f = Math.max(0, Math.min(snaps.length - 1, t * rate)), i0 = Math.floor(f), i1 = Math.min(snaps.length - 1, i0 + 1), u = f - i0;
      return snaps[i0].map(function (s0, k) { var s1 = snaps[i1][k]; return { p: [0, 1, 2].map(function (q) { return s0.p[q] + (s1.p[q] - s0.p[q]) * u; }), v: s0.v.slice() }; }); } };
  }

  // Seeded handheld camera shake (smooth value noise, a pure function of t): MF.shake(t, { amp: 0.02, freq: 1.3, seed: 7 }) → [x, y, rot]
  function shake(t, o) {
    o = o || {}; var amp = o.amp == null ? 0.02 : o.amp, f = o.freq || 1.3, sd = o.seed || 7;
    var h = function (n) { var x = Math.sin(n * 127.1 + sd * 311.7) * 43758.5453; return x - Math.floor(x); };
    var n1 = function (x, k) { var i = Math.floor(x), u = x - i; u = u * u * (3 - 2 * u); return (h(i + k * 57) * (1 - u) + h(i + 1 + k * 57) * u) * 2 - 1; };
    var oct = function (k) { return n1(t * f, k) * 0.7 + n1(t * f * 2.3, k + 9) * 0.3; };
    return [oct(1) * amp, oct(2) * amp, oct(3) * amp * 0.5];
  }

  // preview quality: ?q=draft → WebGL/Three.js templates render at half pixel ratio for fast scrubbing (renders ignore it)
  var quality = !global.__MF_RENDER && /[?&]q=draft\b/.test(location.search) ? "draft" : "full";
  function pixelRatio(max) { var dpr = global.devicePixelRatio || 1; return quality === "draft" ? Math.min(dpr, 1) * 0.5 : Math.min(dpr, max || 2); }
  // a CSS colour (custom property or literal) resolved to "#rrggbb" — lets WebGL/Three.js scenes follow the brand kit
  function cssColor(expr, fallback) {
    var probe = document.createElement("span"); probe.style.display = "none";
    probe.style.color = /^--/.test(expr) ? "var(" + expr + (fallback ? "," + fallback : "") + ")" : expr;
    (document.getElementById("stage") || document.body).appendChild(probe);
    var c = parseColor(getComputedStyle(probe).color); probe.remove();
    if (!c) return fallback || "#000000";
    return "#" + c.slice(0, 3).map(function (v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join("");
  }
  function frame(def) {
    def = def || {};
    var p = new URLSearchParams(location.search);
    var w = +(p.get("w") || def.width || 1920), h = +(p.get("h") || def.height || 1080), f = +(p.get("fps") || def.fps || 30);
    var r = w / h, aspect = r > 1.2 ? "landscape" : r < 0.7 ? "portrait" : r < 0.92 ? "tall" : "square";
    var safeKey = { portrait: "9:16", tall: "4:5", square: "1:1", landscape: "16:9" }[aspect];
    var sb = SAFE[safeKey];
    var info = { width: w, height: h, fps: f, aspect: aspect, safeZones: safeKey, u: Math.min(w, h) / 100, uw: w / 100, uh: h / 100,
      safe: { left: sb[0] * w, top: sb[1] * h, right: sb[2] * w, bottom: sb[3] * h, width: (sb[2] - sb[0]) * w, height: (sb[3] - sb[1]) * h } };
    var stage = toArray(def.stage || "#stage")[0];
    [document.documentElement, stage].forEach(function (el) { if (!el) return;
      el.setAttribute("data-aspect", aspect);
      el.style.setProperty("--mf-w", w + "px"); el.style.setProperty("--mf-h", h + "px");
      el.style.setProperty("--mf-u", info.u + "px"); el.style.setProperty("--mf-uw", info.uw + "px"); el.style.setProperty("--mf-uh", info.uh + "px");
      el.style.setProperty("--mf-safe-l", info.safe.left + "px"); el.style.setProperty("--mf-safe-t", info.safe.top + "px");
      el.style.setProperty("--mf-safe-r", (w - info.safe.right) + "px"); el.style.setProperty("--mf-safe-b", (h - info.safe.bottom) + "px"); });
    if (stage) { stage.style.width = w + "px"; stage.style.height = h + "px"; }
    return info;
  }
  function deepMerge(a, b) { Object.keys(b || {}).forEach(function (k) { var v = b[k];
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) deepMerge(a[k], v); else a[k] = v; }); return a; }
  // MF.data(defaults, file?): content for data-driven/batch renders. Loads ?data=<json> (batch.mjs) or `file`; merges over defaults.
  function data(defaults, file) {
    var src = new URLSearchParams(location.search).get("data") || file;
    var base = JSON.parse(JSON.stringify(defaults || {}));
    if (!src) return Promise.resolve(base);
    return fetch(src, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("MF.data: " + src + " → HTTP " + r.status); return r.json(); })
      .then(function (d) { return deepMerge(base, d); });
  }
  function loadText(url) { return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(url + " → HTTP " + r.status); return r.text(); }); }
  function loadJSON(url) { return loadText(url).then(JSON.parse); }

  // ------------------------------------------------------------- captions
  function parseTime(s) { var m = s.trim().replace(",", ".").split(":").map(parseFloat); return m.length === 3 ? m[0] * 3600 + m[1] * 60 + m[2] : m[0] * 60 + m[1]; }
  function parseCaptions(text) {   // SRT or WebVTT → [{start, end, text}]
    var cues = [];
    String(text).replace(/\r/g, "").split(/\n\n+/).forEach(function (block) {
      var lines = block.split("\n").filter(function (l) { return l.trim() && !/^WEBVTT/.test(l) && !/^\d+$/.test(l.trim()); });
      var ti = lines.findIndex(function (l) { return /-->/.test(l); });
      if (ti < 0) return;
      var parts = lines[ti].split("-->");
      cues.push({ start: parseTime(parts[0]), end: parseTime(parts[1].trim().split(/\s+/)[0]), text: lines.slice(ti + 1).join(" ").replace(/<[^>]+>/g, "").trim() });
    });
    return cues;
  }
  // caption styles: clean (shadow, for dark/busy footage) · box (default: legible on ANY background) · karaoke / pop
  // (boxed, active word highlighted). Override with --mf-cap-fg / --mf-cap-bg / --mf-cap-hi (brand kit sets them).
  var CAPTION_CSS = ".mf-captions{position:absolute;left:var(--mf-cap-l,8%);right:var(--mf-cap-r,8%);bottom:var(--mf-cap-b,9%);display:flex;justify-content:center;pointer-events:none;z-index:50}" +
    ".mf-captions .cap{max-width:100%;text-align:center;text-wrap:balance;font-family:var(--mf-font-display,\"MF Display\"),sans-serif;font-weight:700;letter-spacing:-0.01em;line-height:1.22;font-size:var(--mf-cap-size,calc(var(--mf-u,10.8px)*4.8));color:var(--mf-cap-fg,#fff)}" +
    ".mf-captions .w{display:inline-block;white-space:pre}" +
    ".mf-cap-clean .cap{text-shadow:0 0.04em 0.18em rgba(0,0,0,.6),0 0 0.05em rgba(0,0,0,.7)}" +
    ".mf-cap-box .cap,.mf-cap-karaoke .cap,.mf-cap-pop .cap{background:var(--mf-cap-bg,rgba(16,16,15,.88));padding:.26em .55em .3em;border-radius:.2em;-webkit-box-decoration-break:clone;box-decoration-break:clone}" +
    ".mf-cap-karaoke .w{opacity:.62} .mf-cap-karaoke .w.on,.mf-cap-karaoke .w.done{opacity:1} .mf-cap-karaoke .w.on,.mf-cap-pop .w.on{color:var(--mf-cap-hi,#FFD45C)}" +
    /* social styles: word = one big word at a time (stroke + shadow, no box); highlight = active word on a colour pill */
    ".mf-captions .cap{font-family:var(--mf-font-display,\"MF Display\"),sans-serif,\"Apple Color Emoji\",\"Segoe UI Emoji\",\"Noto Color Emoji\"}" +
    ".mf-cap-upper .cap{text-transform:uppercase;letter-spacing:0.01em}" +
    ".mf-cap-word .cap{font-size:var(--mf-cap-size,calc(var(--mf-u,10.8px)*10.5));font-weight:800;line-height:1.05;-webkit-text-stroke:calc(var(--mf-u,10.8px)*0.55) var(--mf-cap-stroke,#0d0d0f);paint-order:stroke fill;text-shadow:0 calc(var(--mf-u,10.8px)*0.5) calc(var(--mf-u,10.8px)*1.4) rgba(0,0,0,.45)}" +
    ".mf-cap-word .w.on{color:var(--mf-cap-hi,#FFD45C)}" +
    ".mf-cap-highlight .cap{font-size:var(--mf-cap-size,calc(var(--mf-u,10.8px)*6.6));font-weight:800;-webkit-text-stroke:calc(var(--mf-u,10.8px)*0.35) var(--mf-cap-stroke,#0d0d0f);paint-order:stroke fill;text-shadow:0 calc(var(--mf-u,10.8px)*0.3) calc(var(--mf-u,10.8px)*1) rgba(0,0,0,.4)}" +
    ".mf-cap-highlight .w{padding:0 .12em;border-radius:.16em} .mf-cap-highlight .w.on{background:var(--mf-cap-hi,#FFD45C);color:var(--mf-cap-on,#111);-webkit-text-stroke:0}";
  // social safe zones (approximate: platform UI overlays move between app versions — verify against a current screenshot)
  var CAP_PLATFORM = { tiktok: { b: "26%", l: "8%", r: "18%" }, reels: { b: "24%", l: "8%", r: "16%" }, shorts: { b: "22%", l: "8%", r: "16%" }, center: { b: "38%", l: "10%", r: "10%" } };
  // word-timed transcript → caption cues: break on max words / chars, sentence punctuation or a pause; hold short cues
  function chunkWords(words, o) {
    var maxW = o.maxWords || 4, maxC = o.maxChars || 26, gap = o.gap || 0.35, cues = [], cur = [];
    function flush() { if (!cur.length) return; cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(function (w) { return w.text; }).join(" "), words: cur.slice() }); cur = []; }
    words.forEach(function (w, i) { var t = String(w.word != null ? w.word : w.text).trim(); if (!t) return;
      var ww = { text: t, start: +w.start, end: +w.end }, prev = cur[cur.length - 1];
      if (cur.length && (cur.length >= maxW || cur.map(function (x) { return x.text; }).join(" ").length + 1 + t.length > maxC || ww.start - prev.end > gap || /[.!?…]$/.test(prev.text))) flush();
      cur.push(ww); });
    flush();
    cues.forEach(function (c, i) { var next = cues[i + 1], minEnd = c.start + (o.minDur || 0.45); var lim = next ? next.start : Infinity;
      c.end = Math.min(Math.max(c.end + 0.08, minEnd), lim); });   // never overlap the next cue
    return cues;
  }
  function makeCaptions(stage, cfg, fr) {
    if (!document.getElementById("mf-cap-css")) { var st = document.createElement("style"); st.id = "mf-cap-css"; st.textContent = CAPTION_CSS; document.head.appendChild(st); }
    var cues = (cfg.cues || []).map(function (c) {
      var words = c.words || null;
      if (!words) {   // distribute word timings by length when the transcript has no word-level times
        var ws = c.text.split(/\s+/).filter(Boolean), total = ws.reduce(function (n, w) { return n + w.length + 2; }, 0), acc = 0, dur = c.end - c.start;
        words = ws.map(function (w) { var s0 = c.start + (acc / total) * dur; acc += w.length + 2; return { text: w, start: s0, end: c.start + (acc / total) * dur }; });
      }
      return { start: c.start, end: c.end, words: words };
    });
    var box = document.createElement("div"); box.className = "mf-captions mf-cap-" + (cfg.style || "box") + (cfg.uppercase ? " mf-cap-upper" : "");
    stage.classList.add("has-captions");
    var aspect = fr ? fr.aspect : null;
    if (aspect === "portrait") { box.style.setProperty("--mf-cap-b", "24%"); box.style.setProperty("--mf-cap-l", "8%"); box.style.setProperty("--mf-cap-r", "18%"); }
    var pp = CAP_PLATFORM[cfg.platform]; if (pp) Object.keys(pp).forEach(function (k) { box.style.setProperty("--mf-cap-" + k, pp[k]); });
    if (cfg.position) Object.keys(cfg.position).forEach(function (k) { box.style.setProperty("--mf-cap-" + k, cfg.position[k]); });
    if (cfg.size) box.style.setProperty("--mf-cap-size", cfg.size);
    var cap = document.createElement("div"); cap.className = "cap"; cap.setAttribute("data-mf-text", ""); box.appendChild(cap); stage.appendChild(box);
    var current = -1, spans = [];
    return function (t) {
      var idx = -1; for (var i = 0; i < cues.length; i++) if (t >= cues[i].start && t < cues[i].end) { idx = i; break; }
      if (idx !== current) {
        current = idx; cap.textContent = ""; spans = [];
        if (idx >= 0) cues[idx].words.forEach(function (w, j) { var sp = document.createElement("span"); sp.className = "w"; sp.textContent = w.text; cap.appendChild(sp); spans.push(sp);
          if (j < cues[idx].words.length - 1) cap.appendChild(document.createTextNode(" ")); });
        cap.style.visibility = idx >= 0 ? "visible" : "hidden";
      }
      if (idx >= 0) cues[idx].words.forEach(function (w, j) { var on = t >= w.start && t < w.end, done = t >= w.end;
        spans[j].className = "w" + (on ? " on" : done ? " done" : "");
        if (cfg.style === "word" && on) { var kw = Math.min(1, (t - cues[idx].start) / 0.1); spans[j].style.transform = "scale(" + (0.82 + 0.18 * (1 - Math.pow(1 - kw, 3))).toFixed(4) + ")"; }
        if (cfg.style === "pop") { var k = on ? Math.min(1, (t - w.start) / 0.12) : 0; spans[j].style.transform = "scale(" + (1 + 0.1 * Math.sin(k * Math.PI / 2) * (on ? 1 : 0)).toFixed(4) + ")"; } });
    };
  }

  // ---------------------------------------------------------------- beats
  // MF.beats(json from scripts/beats.mjs) → helpers to snap motion to music (hard-sync only the moments that matter).
  function beats(b) {
    b = b || { bpm: 120, beats: [] };
    var list = b.beats || [];
    return { bpm: b.bpm, list: list, onsets: b.onsets || [],
      at: function (i) { if (i < list.length) return list[i]; var p = 60 / b.bpm; return (list[list.length - 1] || 0) + (i - list.length + 1) * p; },
      nearest: function (t) { var best = t, d = Infinity; list.forEach(function (x) { if (Math.abs(x - t) < d) { d = Math.abs(x - t); best = x; } }); return best; },
      after: function (t) { for (var i = 0; i < list.length; i++) if (list[i] >= t) return list[i]; return t; },
      bar: function (n, beatsPerBar) { return this.at(n * (beatsPerBar || 4)); } };
  }

  // -------------------------------------------------------------- compose
  function compose(cfg) {
    cfg = cfg || {};
    var width = cfg.width || 1920, height = cfg.height || 1080, fps = cfg.fps || 30;
    var tl = cfg.timeline || null;
    var renderFn = cfg.render || null;
    var stage = toArray(cfg.stage || "#stage")[0] || document.body;
    var isGsap = tl && !tl.isMF && typeof tl.seek === "function";
    var duration = cfg.duration || (tl ? (isGsap ? tl.duration() : tl.duration()) : 5);
    if (isGsap && tl.paused) tl.paused(true);
    var labels = tl ? (isGsap ? Object.assign({}, tl.labels) : Object.assign({}, tl.labels)) : {};
    if (cfg.labels) Object.assign(labels, cfg.labels);
    var renderMode = !!global.__MF_RENDER;
    var params = new URLSearchParams(location.search);
    var showUI = !renderMode && params.get("ui") !== "0";
    if (params.get("alpha") === "1") {   // transparent delivery (render.mjs --formats alpha|png adds this): no page/stage fill, no preview plates
      document.documentElement.classList.add("mf-alpha");
      var as = document.createElement("style"); as.textContent = "html.mf-alpha,html.mf-alpha body,html.mf-alpha #stage{background:transparent !important}html.mf-alpha .mf-plate{display:none !important}"; document.head.appendChild(as);
    }
    var stats = { seeks: 0, seekMs: [] }, unwired = 0;

    // scale stage to fit window in preview; exact 1:1 in render mode
    function fit() {
      stage.style.width = width + "px"; stage.style.height = height + "px";
      if (renderMode) { stage.style.transform = ""; return; }
      var availH = innerHeight - (showUI ? 44 : 0);
      var s = Math.min(innerWidth / width, availH / height);
      stage.style.transformOrigin = "0 0";
      stage.style.transform = "translate(" + (innerWidth - width * s) / 2 + "px," + (availH - height * s) / 2 + "px) scale(" + s + ")";
    }
    fit(); addEventListener("resize", fit);
    document.querySelectorAll("canvas").forEach(function (cv) { cv.addEventListener("webglcontextlost", function () { cv.__mfContextLost = true; }); });

    var captionFn = null;
    function applyTime(t) {
      t = clamp(t, 0, duration);
      if (tl) { if (isGsap) tl.seek(t, false); else tl.seek(t); }
      if (renderFn) renderFn(t, { width: width, height: height, fps: fps, duration: duration, progress: t / duration });
      if (captionFn) captionFn(t);
    }
    // load EVERY declared face up front: lazy webfont loading causes mid-render glyph swaps (non-deterministic frames)
    var fontsReady = !document.fonts ? Promise.resolve() : document.fonts.ready.then(function () {
      var loads = []; document.fonts.forEach(function (f) { if (f.status === "unloaded") loads.push(f.load().catch(function () {})); });
      return Promise.all(loads);
    }).then(function () { return document.fonts.ready; });
    var ready = Promise.resolve(fontsReady).then(function () { return cfg.setup ? cfg.setup() : null; }).then(function () {
      var capCfg = typeof cfg.captions === "function" ? cfg.captions() : cfg.captions;
      if (capCfg && (capCfg.cues || capCfg.srt || capCfg.words)) captionFn = makeCaptions(stage, { cues: capCfg.cues || (capCfg.words ? chunkWords(capCfg.words, { maxWords: capCfg.maxWords || (capCfg.style === "word" ? 1 : 4), maxChars: capCfg.maxChars, gap: capCfg.gap }) : parseCaptions(capCfg.srt)),
        style: capCfg.style, position: capCfg.position, size: capCfg.size, platform: capCfg.platform, uppercase: capCfg.uppercase }, cfg.frame);
      // layers (for NLE hand-off), in PAINT ORDER so they restack correctly in an editor: each top-level child of the stage is
      // its own layer (named by data-mf-layer, id or class), canvas/plates → background, captions → captions; an element
      // tagged data-mf-layer inside a branch becomes its own layer right after that branch. ?layer=<name> renders one layer.
      var order = [], seenL = {}, push = function (n) { if (!seenL[n]) { seenL[n] = 1; order.push(n); } };
      var nameOf = function (c, i) { return c.getAttribute("data-mf-layer") || (c.tagName === "CANVAS" || c.classList.contains("mf-plate") ? "background" : c.classList.contains("mf-captions") ? "captions" : (c.id || (typeof c.className === "string" && c.className.trim().split(/\s+/)[0]) || "layer" + (i + 1)).replace(/[^\w-]/g, "")); };
      if (getComputedStyle(stage).backgroundImage !== "none" || !/rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(stage).backgroundColor)) push("background");
      var kids = Array.prototype.slice.call(stage.children).filter(function (c) { return !/^(SCRIPT|STYLE)$/.test(c.tagName); });
      kids.forEach(function (c, i) { var n = nameOf(c, i); c.setAttribute("data-mf-l", n); if (n !== "captions") push(n);
        Array.prototype.forEach.call(c.querySelectorAll("[data-mf-layer]"), function (e) { var en = e.getAttribute("data-mf-layer"); e.setAttribute("data-mf-l", en); push(en); }); });
      if (kids.some(function (c) { return c.getAttribute("data-mf-l") === "captions"; })) push("captions");
      api.meta.layers = order;
      var onlyLayer = params.get("layer");
      if (onlyLayer) { var ls = document.createElement("style");
        ls.textContent = '[data-mf-l]:not([data-mf-l="' + onlyLayer.replace(/"/g, "") + '"]){visibility:hidden !important}[data-mf-l="' + onlyLayer.replace(/"/g, "") + '"]{visibility:visible}' + (onlyLayer !== "background" ? "#stage{background:transparent !important}" : "");
        document.head.appendChild(ls); }
      // timelines are usually built in setup(): resolve duration/labels now
      if (tl && !isGsap) tl._finalize();
      if (tl && !cfg.duration) { duration = tl.duration(); api.meta.duration = duration; }
      if (tl) Object.keys(tl.labels || {}).forEach(function (k) { if (!(k in api.meta.labels)) api.meta.labels[k] = tl.labels[k]; });
      if (!(duration > 0)) throw new Error("MF.compose: duration is 0 — pass duration or build the timeline in setup()");
      created.forEach(function (c) {
        var hasWork = c.isMF ? c.segments.length > 0 : (c.getChildren ? c.getChildren().length > 0 : false);
        if (hasWork && c !== tl && !c._nested && !(c.parent && c.parent !== (global.gsap && global.gsap.globalTimeline))) unwired++;
      });
      applyTime(0);
    });
    var api = {
      version: VERSION,
      ready: ready,
      meta: { width: width, height: height, fps: fps, duration: duration, labels: labels, engine: isGsap ? "gsap" : "mf", title: cfg.title || document.title },
      seek: function (t) {
        var t0 = performance.now(); applyTime(t); stats.seeks++;
        return new Promise(function (res) { requestAnimationFrame(function () { stats.seekMs.push(performance.now() - t0); res(t); }); });
      },
      qa: function () { var r = qa(stage, cfg.safeZones === false ? null : (cfg.safeZones || (cfg.frame ? cfg.frame.safeZones : null) || (height > width ? "9:16" : "16:9")));   /* landscape too: broadcast title-safe (MotionBench found the gap) */ if (unwired) r.issues.push({ code: "TIMELINE_NOT_WIRED", severity: "critical", text: unwired + " timeline(s) built but not passed to MF.compose({timeline}) or nested with .add() — they will never move in renders" }); return r; },
      stats: function () { var a = stats.seekMs.slice().sort(function (x, y) { return x - y; });
        var pick = function (q) { return a.length ? +a[Math.min(a.length - 1, Math.floor(q * a.length))].toFixed(2) : null; };
        var extra = cfg.stats ? cfg.stats() : {};
        return Object.assign({ seeks: stats.seeks, seekP50: pick(0.5), seekP95: pick(0.95), seekMax: pick(1) }, extra); }
    };
    global.__MF = api;

    if (!renderMode) {
      // preview player: loops, space = pause, ←/→ = ±1 frame (shift ±1s), Home = 0, ?t=2.5 to park, ?guides=1 safe zones
      var key = "mf:t:" + location.pathname, saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(key) || "null"); } catch (e) {}
      var playing = params.has("t") ? false : saved ? saved.playing : true;
      var t = params.has("t") ? +params.get("t") : saved ? saved.t : 0, last = null;
      var persist = function () { try { sessionStorage.setItem(key, JSON.stringify({ t: t, playing: playing })); } catch (e) {} };
      if (params.get("guides") === "1") safeZones(stage, cfg.safeZones || (height > width ? "9:16" : "16:9"));
      var ui = null, bar, btn, lab;
      if (showUI) {
        ui = document.createElement("div"); ui.setAttribute("data-mf-qa-ignore", "");
        ui.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:44px;display:flex;align-items:center;gap:12px;padding:0 14px;background:#111;color:#ddd;font:12px/1 ui-monospace,Menlo,monospace;z-index:2147483647;box-sizing:border-box";
        btn = document.createElement("button"); btn.style.cssText = "width:30px;height:26px;border:1px solid #444;background:#1b1b1b;color:#eee;border-radius:4px;cursor:pointer";
        var track = document.createElement("div"); track.style.cssText = "position:relative;flex:1;height:26px";
        bar = document.createElement("input"); bar.type = "range"; bar.min = 0; bar.max = 1; bar.step = 0.0001; bar.style.cssText = "position:absolute;inset:0;width:100%;margin:0;accent-color:#e0421c";
        track.appendChild(bar);
        lab = document.createElement("span"); lab.style.cssText = "min-width:118px;text-align:right;font-variant-numeric:tabular-nums";
        ui.appendChild(btn); ui.appendChild(track); ui.appendChild(lab); document.body.appendChild(ui);
        btn.onclick = function () { playing = !playing; persist(); sync(); };
        bar.oninput = function () { playing = false; t = +bar.value * duration; applyTime(t); persist(); sync(); };
        ready.then(function () {   // label ticks (act/beat markers)
          Object.keys(api.meta.labels).forEach(function (k) { var v = api.meta.labels[k]; if (!(v > 0 && v < duration)) return;
            var m = document.createElement("i"); m.title = k + " @" + v.toFixed(2) + "s";
            m.style.cssText = "position:absolute;top:0;width:2px;height:7px;background:#e0421c;pointer-events:none;left:calc(" + (v / duration * 100) + "% - 1px)"; track.appendChild(m); });
        });
      }
      function sync() { if (!ui) return; btn.textContent = playing ? "❚❚" : "▶"; bar.value = String(t / duration); lab.textContent = t.toFixed(2) + " / " + duration.toFixed(2) + "s"; }
      addEventListener("keydown", function (e) {
        if (e.target && e.target.tagName === "INPUT" && e.code !== "Space") return;
        if (e.code === "Space") { playing = !playing; e.preventDefault(); }
        if (e.code === "ArrowRight") { playing = false; t = Math.min(duration, t + (e.shiftKey ? 1 : 1 / fps)); }
        if (e.code === "ArrowLeft") { playing = false; t = Math.max(0, t - (e.shiftKey ? 1 : 1 / fps)); }
        if (e.code === "Home") t = 0;
        applyTime(t); persist(); sync();
      });
      ready.then(function () {
        applyTime(Math.min(t, duration)); sync();
        (function loop(now) {
          if (playing) { if (last != null) t += (now - last) / 1000; if (t > duration + (cfg.loopPause || 0.6)) t = 0; applyTime(Math.min(t, duration)); sync(); if ((now | 0) % 10 === 0) persist(); }
          last = now; requestAnimationFrame(loop);
        })(performance.now());
      });
      addEventListener("beforeunload", persist);
    }
    return api;
  }

  function safeZones(stage, kind) {
    var o = document.createElement("div"); o.setAttribute("data-mf-qa-ignore", ""); o.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:99999";
    var W = parseFloat(stage.style.width), H = parseFloat(stage.style.height);
    var box = function (l, t, r, b, c) { var d = document.createElement("div"); d.style.cssText = "position:absolute;border:2px dashed " + c + ";left:" + l + "px;top:" + t + "px;right:" + r + "px;bottom:" + b + "px"; o.appendChild(d); };
    if (kind === "9:16") { box(W * 0.06, H * 0.14, W * 0.16, H * 0.2, "rgba(255,60,60,.7)"); }
    else { box(W * 0.05, H * 0.05, W * 0.05, H * 0.05, "rgba(60,200,255,.7)"); box(W * 0.1, H * 0.1, W * 0.1, H * 0.1, "rgba(255,200,60,.7)"); }
    stage.appendChild(o);
  }

  var created = [];   // every MF.timeline() — used to catch timelines that were built but never handed to compose()
  // GSAP passthrough: MF.timeline() returns a paused GSAP timeline when GSAP is loaded and engine isn't forced to "mf".
  function timeline(opts) {
    opts = opts || {};
    var useGsap = global.gsap && opts.engine !== "mf" && !global.__MF_FORCE_ENGINE;
    if (useGsap && !timeline._cfg) { global.gsap.config({ force3D: false }); timeline._cfg = true; }   // 2D transforms: crisp, history-free raster
    var t = useGsap ? global.gsap.timeline(Object.assign({ paused: true }, { defaults: opts.defaults })) : new Timeline(opts);
    created.push(t);
    return t;
  }

  global.MF = {
    version: VERSION, timeline: timeline, Timeline: Timeline, compose: compose, split: split,
    ease: parseEase, cubicBezier: cubicBezier, rng: mulberry32, clamp: clamp, lerp: lerp, smoothstep: smoothstep,
    tokens: tokens, qa: qa, safeZones: safeZones, fontAvailable: fontAvailable,
    cssColor: cssColor, quality: quality, pixelRatio: pixelRatio, physics: physics, shake: shake, frame: frame, data: data, loadText: loadText, loadJSON: loadJSON, parseCaptions: parseCaptions, chunkWords: chunkWords, beats: beats
  };
})(typeof window !== "undefined" ? window : globalThis);
