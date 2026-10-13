// Shared kit for project pages: DOM helpers, form controls, charts, statistics, seeded randomness.
// No dependencies. Importing this file touches no DOM, so a project's logic.js and its tests can use
// the pure parts (fmt, rng, stats, linalg, csv, niceTicks) in Node.

/* ====================================================================== DOM */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function applyAttrs(node, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") node.setAttribute("class", v);
    else if (k === "text") node.textContent = v;
    else if (k === "style" && typeof v === "object") {
      for (const [p, val] of Object.entries(v)) p.startsWith("--") ? node.style.setProperty(p, val) : (node.style[p] = val);
    } else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
}
function appendKids(node, kids) {
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) node.append(kid);
  return node;
}

/** el("p", { class: "x", text: "hi", onclick: fn }, child, "text", [more]) */
export function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  return appendKids(node, kids);
}
export function svgEl(tag, attrs, ...kids) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  applyAttrs(node, attrs);
  return appendKids(node, kids);
}
export const debounce = (fn, ms = 150) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/* =============================================================== formatting */

const NF = new Map();
const nf = (opts) => {
  const key = JSON.stringify(opts);
  if (!NF.has(key)) NF.set(key, new Intl.NumberFormat("en-GB", { signDisplay: "negative", ...opts }));
  return NF.get(key);
};
const bad = (x) => x == null || typeof x !== "number" || !Number.isFinite(x);
const DASH = "–";

export const fmt = {
  /** fixed decimals with thousands separators: 1,234.50 */
  num: (x, d = 2) => (bad(x) ? DASH : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(x)),
  int: (x) => (bad(x) ? DASH : nf({ maximumFractionDigits: 0 }).format(x)),
  /** x is a share: fmt.pct(0.123) is "12.3%" */
  pct: (x, d = 1) => (bad(x) ? DASH : nf({ style: "percent", minimumFractionDigits: d, maximumFractionDigits: d }).format(x)),
  /** significant digits, no trailing zeros: 0.001235, 12.35, 12,346 */
  sig: (x, n = 3) => (bad(x) ? DASH : nf({ maximumSignificantDigits: n }).format(x)),
  auto: (x) => (bad(x) ? DASH : nf({ maximumSignificantDigits: 4 }).format(x)),
  /** three significant digits with a unit: 1.5k, 12.3m, 2bn. Written out here because browsers disagree (1.5k or 1.5K). */
  compact: (x) => {
    if (bad(x)) return DASH;
    const r = Number(x.toPrecision(3)), a = Math.abs(r);
    const [div, unit] = a >= 1e12 ? [1e12, "tn"] : a >= 1e9 ? [1e9, "bn"] : a >= 1e6 ? [1e6, "m"] : a >= 1e3 ? [1e3, "k"] : [1, ""];
    return nf({ maximumSignificantDigits: 3 }).format(r / div) + unit;
  },
  signed: (x, d = 2) => (bad(x) ? DASH : nf({ minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: "exceptZero" }).format(x)),
  date: (iso) => DATE.format(new Date(iso + "T00:00:00Z")),
};
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); // built once: making one is slow

/* ================================================================ randomness */

/** Seeded generator (mulberry32). const r = rng(42); r() in [0,1); r.int(1,6); r.normal(); r.pick(arr); r.shuffle(arr) */
export function rng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.bool = (p = 0.5) => next() < p;
  next.uniform = (lo = 0, hi = 1) => lo + next() * (hi - lo);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.normal = (mu = 0, sd = 1) => {
    let u = 0;
    while (u === 0) u = next();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  next.exponential = (rate = 1) => {
    let u = 0;
    while (u === 0) u = next();
    return -Math.log(u) / rate;
  };
  next.shuffle = (arr) => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return next;
}
export const randomSeed = () => Math.floor(Math.random() * 4294967296);

/* ============================================================ linear algebra */

export const linalg = {
  transpose: (A) => A[0].map((_, j) => A.map((row) => row[j])),
  matmul: (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0))),
  /** Inverse by Gauss-Jordan with partial pivoting. Throws if the matrix is singular. */
  inverse(A) {
    const n = A.length;
    const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) throw new Error("singular matrix");
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c];
      for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
      }
    }
    return M.map((row) => row.slice(n));
  },
  /** Solve A x = b. */
  solve(A, b) {
    return linalg.inverse(A).map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
  },
};

/* ================================================================ statistics */

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export const stats = {
  sum: (a) => { let s = 0; for (const v of a) s += v; return s; },
  mean: (a) => (a.length ? stats.sum(a) / a.length : NaN),
  min: (a) => { let m = Infinity; for (const v of a) if (v < m) m = v; return m; },
  max: (a) => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; },
  /** Sample variance by default (divides by n - 1). */
  variance(a, sample = true) {
    const n = a.length;
    if (n < (sample ? 2 : 1)) return NaN;
    const m = stats.mean(a);
    let s = 0;
    for (const v of a) s += (v - m) ** 2;
    return s / (sample ? n - 1 : n);
  },
  sd: (a, sample = true) => Math.sqrt(stats.variance(a, sample)),
  /** Linear-interpolated quantile, q in [0, 1]. */
  quantile(a, q) {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  },
  median: (a) => stats.quantile(a, 0.5),
  cov(x, y) {
    const n = x.length;
    if (n < 2) return NaN;
    const mx = stats.mean(x);
    const my = stats.mean(y);
    let s = 0;
    for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
    return s / (n - 1);
  },
  corr: (x, y) => stats.cov(x, y) / (stats.sd(x) * stats.sd(y)),
  /** Simple regression y = intercept + slope x. */
  linreg(x, y) {
    const n = x.length;
    const mx = stats.mean(x);
    const my = stats.mean(y);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    const rss = syy - slope * sxy;
    return { slope, intercept, r2: syy === 0 ? NaN : 1 - rss / syy, n, seSlope: n > 2 ? Math.sqrt(rss / (n - 2) / sxx) : NaN };
  },
  /**
   * Ordinary least squares. X is an array of rows (one array of predictors per observation), y the outcomes.
   * An intercept is added unless { intercept: false }. beta[0] is the intercept when there is one.
   */
  ols(X, y, { intercept = true } = {}) {
    const n = y.length;
    const D = X.map((row) => (intercept ? [1, ...row] : [...row]));
    const p = D[0].length;
    if (n <= p) throw new Error(`need more than ${p} observations, got ${n}`);
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const Xty = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const r = D[i];
      for (let a = 0; a < p; a++) { Xty[a] += r[a] * y[i]; for (let b = a; b < p; b++) XtX[a][b] += r[a] * r[b]; }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    const inv = linalg.inverse(XtX);
    const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
    const fitted = D.map((r) => r.reduce((s, v, j) => s + v * beta[j], 0));
    const residuals = y.map((v, i) => v - fitted[i]);
    const my = stats.mean(y);
    const rss = residuals.reduce((s, e) => s + e * e, 0);
    const tss = y.reduce((s, v) => s + (v - my) ** 2, 0);
    const sigma2 = rss / (n - p);
    const se = inv.map((row, j) => Math.sqrt(sigma2 * row[j]));
    const r2 = tss === 0 ? NaN : 1 - rss / tss;
    return { beta, se, t: beta.map((b, j) => b / se[j]), r2, adjR2: 1 - (1 - r2) * (n - 1) / (n - p), rss, tss, sigma2, fitted, residuals, n, p };
  },
  /** Equal-width bins: [{ x0, x1, count }]. */
  histogram(values, { bins = 20, min, max } = {}) {
    const lo = min ?? stats.min(values);
    let hi = max ?? stats.max(values);
    if (!(hi > lo)) hi = lo + 1;
    const w = (hi - lo) / bins;
    const out = Array.from({ length: bins }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }));
    for (const v of values) {
      if (!Number.isFinite(v) || v < lo || v > hi) continue;
      out[Math.min(bins - 1, Math.floor((v - lo) / w))].count++;
    }
    return out;
  },
  logGamma(z) {
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - stats.logGamma(1 - z);
    z -= 1;
    let x = LANCZOS[0];
    for (let i = 1; i < 9; i++) x += LANCZOS[i] / (z + i);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  },
  logChoose: (n, k) => stats.logGamma(n + 1) - stats.logGamma(k + 1) - stats.logGamma(n - k + 1),
  binomPmf: (k, n, p) => (k < 0 || k > n ? 0 : p === 0 ? (k === 0 ? 1 : 0) : p === 1 ? (k === n ? 1 : 0) : Math.exp(stats.logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p))),
  betaPdf: (x, a, b) => (x <= 0 || x >= 1 ? 0 : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - (stats.logGamma(a) + stats.logGamma(b) - stats.logGamma(a + b)))),
  normalPdf: (x, mu = 0, sd = 1) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI)),
  /** Standard error function approximation (Abramowitz and Stegun 7.1.26), absolute error below 1.5e-7. */
  normalCdf(x, mu = 0, sd = 1) {
    const z = (x - mu) / (sd * Math.SQRT2);
    const t = 1 / (1 + 0.3275911 * Math.abs(z));
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + (z >= 0 ? erf : -erf));
  },
  /** Shannon entropy in bits of a probability vector (zeros are skipped). */
  entropy: (probs) => -probs.reduce((s, p) => (p > 0 ? s + p * Math.log2(p) : s), 0),
};

/* ======================================================================= CSV */

export const csv = {
  /** Parse delimited text into an array of rows. Handles quotes, escaped quotes, CRLF and a BOM. */
  parse(text, delimiter) {
    text = text.replace(/^﻿/, "");
    if (!delimiter) {
      const first = text.split(/\r?\n/, 1)[0];
      delimiter = [",", "\t", ";"].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    }
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += ch;
      } else if (ch === '"' && cell === "") quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
  },
  /** First row as column names: { columns: [...], rows: [{ col: value }] }. Values stay strings. */
  toObjects(text, delimiter) {
    const [head, ...body] = csv.parse(text, delimiter);
    const columns = (head || []).map((h, i) => h.trim() || `column ${i + 1}`);
    return { columns, rows: body.map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? "").trim()]))) };
  },
  stringify: (rows) => rows.map((r) => r.map((c) => (/[",\n\r]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(",")).join("\n"),
};

/* ================================================================== controls */

let uid = 0;
const nextId = () => `k${++uid}`;

function wrapField(label, id, control, hint, readout) {
  return el("div", { class: "field" },
    el("div", { class: "lab" }, el("label", { for: id, text: label }), readout),
    control,
    hint ? el("div", { class: "hint", text: hint }) : null);
}

/** Range slider with a live readout. Returns { el, input, value } (value is a number, settable). */
export function slider({ label, min = 0, max = 100, step = 1, value = min, format = fmt.auto, hint, onInput }) {
  const id = nextId();
  const input = el("input", { type: "range", id, min, max, step, value });
  const out = el("output", { for: id });
  // The readout is also what a screen reader says for the value ("12 to 14 years", not "3").
  const show = () => {
    const text = String(format(Number(input.value)));
    out.textContent = text;
    if (text) input.setAttribute("aria-valuetext", text); else input.removeAttribute("aria-valuetext");
  };
  show();
  input.addEventListener("input", () => { show(); onInput?.(Number(input.value)); });
  // With step "any" browsers disagree about what an arrow key does (Firefox jumps most of the way along), so the
  // keys are handled here: an arrow is 1% of the range, Page Up and Page Down 10%, Home and End the two ends.
  if (step === "any") input.addEventListener("keydown", (e) => {
    const lo = Number(input.min), hi = Number(input.max);
    const move = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    const to = e.key === "Home" ? lo : e.key === "End" ? hi : move ? clamp(Number(input.value) + (move * (hi - lo)) / 100, lo, hi) : null;
    if (to == null || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    input.value = to;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return {
    el: wrapField(label, id, input, hint, out), input,
    get value() { return Number(input.value); },
    set value(v) { input.value = v; show(); },
  };
}

/** Number box. onInput fires only for a valid number inside [min, max]. value is NaN while the box is invalid. */
export function numberField({ label, min, max, step = "any", value = 0, hint, onInput }) {
  const id = nextId();
  // "decimal" keyboards on phones have no minus key, so only ask for one when negatives are impossible.
  const input = el("input", { type: "number", id, min, max, step, value, inputmode: min != null && min >= 0 ? "decimal" : null });
  const read = () => {
    const v = input.value.trim() === "" ? NaN : Number(input.value);
    return Number.isFinite(v) && (min == null || v >= min) && (max == null || v <= max) ? v : NaN;
  };
  input.addEventListener("input", () => {
    const v = read();
    input.classList.toggle("invalid", Number.isNaN(v));
    if (!Number.isNaN(v)) onInput?.(v);
  });
  return { el: wrapField(label, id, input, hint), input, get value() { return read(); }, set value(v) { input.value = v; input.classList.remove("invalid"); } };
}

/** options: ["a", "b"] or [{ value, label }]. value is a string. */
export function select({ label, options, value, hint, onChange }) {
  const id = nextId();
  const input = el("select", { id }, options.map((o) => {
    const opt = typeof o === "object" ? o : { value: o, label: o };
    return el("option", { value: opt.value, text: opt.label, selected: String(opt.value) === String(value) });
  }));
  if (value != null) input.value = String(value);
  input.addEventListener("change", () => onChange?.(input.value));
  return { el: wrapField(label, id, input, hint), input, get value() { return input.value; }, set value(v) { input.value = String(v); } };
}

/** Radio group drawn as a segmented control. options as for select. */
export function segmented({ label, options, value, hint, onChange }) {
  const name = nextId();
  const opts = options.map((o) => (typeof o === "object" ? o : { value: o, label: o }));
  const group = el("div", { class: "seg", role: "radiogroup", "aria-label": label },
    opts.map((o) => el("label", {}, el("input", { type: "radio", name, value: o.value, checked: String(o.value) === String(value) }), el("span", { text: o.label }))));
  group.addEventListener("change", (e) => onChange?.(e.target.value));
  const node = el("div", { class: "field" }, label ? el("div", { class: "lab" }, el("span", { text: label })) : null, group, hint ? el("div", { class: "hint", text: hint }) : null);
  return {
    el: node,
    get value() { return group.querySelector("input:checked")?.value; },
    set value(v) { for (const i of group.querySelectorAll("input")) i.checked = i.value === String(v); },
  };
}

export function checkbox({ label, checked = false, onChange }) {
  const input = el("input", { type: "checkbox", checked });
  input.addEventListener("change", () => onChange?.(input.checked));
  return { el: el("label", { class: "check" }, input, el("span", { text: label })), input, get checked() { return input.checked; }, set checked(v) { input.checked = Boolean(v); } };
}

export function textField({ label, value = "", placeholder, hint, mono = false, onInput }) {
  const id = nextId();
  const input = el("input", { type: "text", id, value, placeholder, class: mono ? "mono" : null, autocomplete: "off", spellcheck: "false" });
  input.addEventListener("input", () => onInput?.(input.value));
  return { el: wrapField(label, id, input, hint), input, get value() { return input.value; }, set value(v) { input.value = v; } };
}

export function textArea({ label, value = "", placeholder, hint, rows = 4, mono = false, onInput }) {
  const id = nextId();
  const input = el("textarea", { id, placeholder, rows, class: mono ? "mono" : null, spellcheck: "false" });
  input.value = value;
  input.addEventListener("input", () => onInput?.(input.value));
  return { el: wrapField(label, id, input, hint), input, get value() { return input.value; }, set value(v) { input.value = v; } };
}

/** button("Run", fn, { primary: true, small: true }) */
export function button(label, onClick, { primary = false, small = false, title } = {}) {
  return el("button", { type: "button", class: `btn${primary ? " primary" : ""}${small ? " small" : ""}`, title, text: label, onclick: onClick });
}

/* =================================================================== outputs */

/** Stat tile. const s = stat("Mean", "4.2", "of 100 runs"); s.set("4.3", "of 200 runs") */
export function stat(label, value = DASH, noteText = "") {
  const v = el("span", { class: "v", text: value });
  const n = el("span", { class: "n", text: noteText });
  return { el: el("div", { class: "stat" }, el("span", { class: "l", text: label }), v, n), set(value, noteText) { v.textContent = value; if (noteText !== undefined) n.textContent = noteText; } };
}

/** Message block. kind: "" | "good" | "warn" | "bad". Children may be strings or nodes. */
export function note(kind, ...kids) {
  return el("div", { class: `note${kind ? " " + kind : ""}`, role: kind === "bad" ? "alert" : null }, kids);
}

/** table({ columns: [{ key, label, num, format }], rows: [{...}], caption }) returns a scrollable wrapper. Cell values may be nodes. */
export function table({ columns, rows, caption }) {
  const cell = (c, r) => {
    const raw = r[c.key];
    const v = c.format ? c.format(raw, r) : raw;
    return el("td", { class: c.num ? "num" : null }, v instanceof Node ? v : String(v ?? ""));
  };
  return el("div", { class: "tbl-wrap" },
    el("table", { class: "tbl" },
      caption ? el("caption", { text: caption }) : null,
      el("thead", {}, el("tr", {}, columns.map((c) => el("th", { class: c.num ? "num" : null, scope: "col", text: c.label ?? c.key })))),
      el("tbody", {}, rows.map((r) => el("tr", {}, columns.map((c) => cell(c, r)))))));
}

/** Horizontal bar list for rankings. items: [{ label, value, color, highlight, title }]. Returns { el, update(items) }. */
export function bars(target, { items = [], max, format = fmt.auto } = {}) {
  const root = el("div", { class: "hbars" });
  target.append(root);
  const draw = (list) => {
    const top = max ?? Math.max(1e-12, ...list.map((i) => Math.abs(i.value)));
    root.replaceChildren(...list.map((i) =>
      el("div", { class: `hbar${i.highlight ? " hl" : ""}`, title: i.title },
        el("span", { class: "name", text: i.label }),
        el("span", { class: "track" }, el("span", { class: "fill", style: { width: `${clamp(Math.abs(i.value) / top, 0, 1) * 100}%`, background: i.color || null } })),
        el("span", { class: "val", text: format(i.value) }))));
  };
  draw(items);
  return { el: root, update: draw };
}

/** High-DPI canvas that redraws on resize. draw(ctx, width, height) works in CSS pixels. */
export function canvas(target, { height = 320, draw }) {
  const node = el("canvas", { class: "kit-canvas" });
  target.append(node);
  const ctx = node.getContext("2d");
  let w = 0;
  const redraw = () => {
    const dpr = window.devicePixelRatio || 1;
    w = Math.max(1, node.clientWidth || 600);
    const h = typeof height === "function" ? height(w) : height;
    node.style.height = `${h}px`;
    if (node.width !== Math.round(w * dpr) || node.height !== Math.round(h * dpr)) { node.width = Math.round(w * dpr); node.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw?.(ctx, w, h);
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { if (node.clientWidth !== w) redraw(); }).observe(node);
  redraw();
  return { el: node, ctx, redraw, get width() { return w; }, get height() { return typeof height === "function" ? height(w) : height; } };
}

/** Animation loop. const t = ticker((dt, time) => {...}); t.start(); t.stop(); t.running */
export function ticker(step) {
  let id = 0, last = 0, running = false;
  const frame = (now) => {
    if (!running) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt, now / 1000);
    if (running) id = requestAnimationFrame(frame);
  };
  return {
    start() { if (running) return; running = true; last = performance.now(); id = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(id); },
    get running() { return running; },
  };
}
export const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** localStorage that never throws. const s = store("day24"); s.get("log", []); s.set("log", value) */
export function store(namespace) {
  const key = (k) => `365:${namespace}:${k}`;
  return {
    get(k, fallback = null) { try { const v = localStorage.getItem(key(k)); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, value) { try { localStorage.setItem(key(k), JSON.stringify(value)); return true; } catch { return false; } },
    remove(k) { try { localStorage.removeItem(key(k)); } catch { /* storage unavailable */ } },
  };
}

export function download(filename, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ==================================================================== charts */

export const palette = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const NEUTRAL = "#8a94a3";
const INK = "#16233b";
const SURFACE = "#f9fbf9";
const colorOf = (s, i) => (typeof s.color === "string" ? s.color : palette[s.color ?? i] || NEUTRAL);

/** Round tick positions covering [lo, hi]: { ticks, step }. */
export function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let i = Math.ceil(lo / step - 1e-9); i * step <= hi + step * 1e-9; i++) ticks.push(Number((i * step).toPrecision(12)));
  return { ticks, step };
}
function logTicks(lo, hi) {
  const ticks = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push(Number(v.toPrecision(12))); }
  }
  const decades = ticks.filter((v) => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9);
  return decades.length >= 3 ? decades : ticks;
}
const tickFormat = (step) => {
  const d = clamp(-Math.floor(Math.log10(step) + 1e-9), 0, 8);
  return (v) => (Math.abs(v) >= 1e6 ? fmt.compact(v) : fmt.num(v, d));
};
const extent = (values, fallback) => {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return lo === Infinity ? fallback : [lo, hi];
};

function normalise(s) {
  return (s.data || []).map((d) => {
    if (s.type === "hist") return Array.isArray(d) ? { x0: d[0], x1: d[1], x: (d[0] + d[1]) / 2, y: d[2] } : { ...d, x: (d.x0 + d.x1) / 2 };
    if (s.type === "range") return Array.isArray(d) ? { x: d[0], y0: d[1], y: d[2] } : d;
    return Array.isArray(d) ? { x: d[0], y: d[1], label: d[2] } : d;
  });
}

function barPath(x, yValue, yBase, w) {
  const h = Math.abs(yBase - yValue);
  const r = Math.min(4, w / 2, h);
  const dir = yValue <= yBase ? 1 : -1; // 1: bar rises from the baseline
  const yr = yValue + dir * r;
  return `M${x},${yBase}V${yr}Q${x},${yValue} ${x + r},${yValue}H${x + w - r}Q${x + w},${yValue} ${x + w},${yr}V${yBase}Z`;
}

/**
 * XY chart drawn as SVG, responsive to its container.
 *
 *   const c = chart(target, {
 *     title, subtitle, height: 320, label: "aria description",
 *     x: { label, domain: [lo, hi], format: fn, type: "linear" | "log" | "band", categories, ticks, nice },
 *     y: { label, domain, format, type: "linear" | "log", ticks, zero: true },
 *     series: [{ name, type: "line" | "step" | "area" | "scatter" | "bars" | "hist" | "range", data, color, width, r, opacity, dash, endLabel }],
 *     marks: [{ type: "vline" | "hline" | "span" | "text" | "point", x, y, x0, x1, text, anchor }],
 *     legend, table: false, hover: "point",
 *     onClick({ x, y, point, series, inside, px, py, toPx, key }) {},   // px, py and toPx(x, y) are in the drawing's own pixels;
 *                                                                     // key is true when it came from Enter or Space
 *   });
 *   c.update({ series: [...] });
 *
 * data is [[x, y], ...] or [{ x, y, label }]; "hist" takes [[x0, x1, y]], "range" takes [[x, low, high]],
 * "bars" needs x.type "band" and takes [[category, y]]. color is a palette index or a CSS colour.
 * Hovering shows a crosshair and every series' value at that x (or the nearest point for scatter); arrow keys do the same,
 * and with onClick set, Enter or Space clicks whatever the arrow keys are on.
 */
export function chart(target, spec) {
  let cur = spec;
  let layout = null;
  let hover = -1;
  let lastWidth = -1;
  const clipId = nextId();
  const titleEl = el("p", { class: "chart-title" });
  const subEl = el("p", { class: "chart-sub" });
  const legendEl = el("div", { class: "chart-legend" });
  const svg = svgEl("svg", { role: "img", tabindex: "0" });
  const tip = el("div", { class: "chart-tip", hidden: true });
  const plot = el("div", { class: "chart-plot" }, svg, tip);
  const tableBox = el("div", { class: "tbl-wrap" });
  const details = el("details", { class: "chart-table" }, el("summary", { text: "Show the data as a table" }), tableBox);
  const root = el("div", { class: "chart" }, titleEl, subEl, legendEl, plot, details);
  const hoverLayer = svgEl("g", { class: "hover", "pointer-events": "none" });
  target.append(root);

  function render() {
    lastWidth = plot.clientWidth;
    const W = Math.max(260, plot.clientWidth || 640);
    const H = cur.height || (W < 480 ? 250 : 320);
    const X = { type: "linear", ...cur.x };
    const Y = { type: "linear", ...cur.y };
    const band = X.type === "band";
    const series = (cur.series || []).map((s, i) => ({ type: "line", ...s, _c: colorOf(s, i), _p: normalise({ type: "line", ...s }) }));

    titleEl.textContent = cur.title || "";
    titleEl.hidden = !cur.title;
    subEl.textContent = cur.subtitle || "";
    subEl.hidden = !cur.subtitle;
    svg.setAttribute("aria-label", cur.label || cur.title || "Chart");

    // Legend: always for two or more named series.
    const named = series.filter((s) => s.name && s.legend !== false);
    legendEl.hidden = cur.legend === false || (named.length < 2 && cur.legend !== true);
    legendEl.replaceChildren(...named.map((s) => el("span", {},
      el("i", { class: s.type === "scatter" ? "dot" : ["line", "step"].includes(s.type) ? "line" : "", style: s.type === "scatter" || !["line", "step"].includes(s.type) ? { background: s._c } : { borderTopColor: s._c, borderTopStyle: s.dash ? "dashed" : "solid" } }),
      s.name)));

    // Domains.
    const cats = band ? X.categories || [...new Set(series.flatMap((s) => s._p.map((p) => p.x)))] : null;
    const xs = [], ys = [];
    for (const s of series) for (const p of s._p) {
      if (!band) { if (s.type === "hist") xs.push(p.x0, p.x1); else if (Number.isFinite(p.x)) xs.push(p.x); }
      if (Number.isFinite(p.y)) ys.push(p.y);
      if (Number.isFinite(p.y0)) ys.push(p.y0);
    }
    const positive = (a) => a.filter((v) => v > 0);
    let [y0, y1] = Y.domain || extent(Y.type === "log" ? positive(ys) : ys, Y.type === "log" ? [1, 10] : [0, 1]);
    let yTicks;
    if (Y.type === "log") {
      if (!Y.domain) { y0 = 10 ** Math.floor(Math.log10(y0) + 1e-9); y1 = 10 ** Math.ceil(Math.log10(y1) - 1e-9); if (y0 === y1) y1 = y0 * 10; }
      yTicks = logTicks(y0, y1);
    } else {
      const zero = Y.zero ?? series.some((s) => ["bars", "hist", "area"].includes(s.type));
      if (!Y.domain) {
        if (zero) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
        if (y0 === y1) { const pad = Math.abs(y0) * 0.1 || 1; y0 -= pad; y1 += pad; }
      }
      const t = niceTicks(y0, y1, Y.ticks || Math.max(3, Math.round(H / 62)));
      if (!Y.domain) { y0 = Math.floor(y0 / t.step + 1e-9) * t.step; y1 = Math.ceil(y1 / t.step - 1e-9) * t.step; }
      yTicks = niceTicks(y0, y1, Y.ticks || Math.max(3, Math.round(H / 62))).ticks.filter((v) => v >= y0 - 1e-9 && v <= y1 + 1e-9);
      Y._step = t.step;
    }
    const yFmt = Y.format || (Y.type === "log" ? fmt.auto : tickFormat(Y._step));
    const yLabels = yTicks.map(yFmt);

    const endLabels = series.filter((s) => s.endLabel && s._p.length);
    // Very long tick labels may be cut off, but they never take more than 45% of the width from the plot.
    const mLeft = Math.min(Math.max(26, W * 0.45), Math.max(26, Math.max(0, ...yLabels.map((t) => String(t).length)) * 6.6 + 12));
    const mRight = endLabels.length ? Math.min(150, Math.max(...endLabels.map((s) => String(s.endLabel === true ? s.name : s.endLabel).length)) * 6.6 + 18) : 14;
    const mTop = Y.label ? 24 : 10;
    const mBottom = 26 + (X.label ? 18 : 0);
    const pw = Math.max(10, W - mLeft - mRight);
    const ph = Math.max(10, H - mTop - mBottom);

    let [x0, x1] = [0, 1];
    let xTicks = [];
    let xFmt = X.format;
    if (!band) {
      [x0, x1] = X.domain || extent(X.type === "log" ? positive(xs) : xs, X.type === "log" ? [1, 10] : [0, 1]);
      if (x0 === x1) { const pad = Math.abs(x0) * 0.1 || 1; x0 -= pad; x1 += pad; }
      else if (!X.domain && series.some((s) => s.type === "scatter")) {
        // Keep edge dots off the frame.
        if (X.type === "log") { const k = (x1 / x0) ** 0.03; x0 /= k; x1 *= k; } else { const pad = (x1 - x0) * 0.03; x0 -= pad; x1 += pad; }
      }
      if (X.type === "log") {
        xTicks = logTicks(x0, x1); xFmt ||= fmt.auto;
        // Many decades on a narrow chart: keep every nth label so they cannot collide.
        const room = Math.max(2, Math.floor(pw / (Math.max(...xTicks.map((v) => String(xFmt(v)).length)) * 6.6 + 14)));
        if (xTicks.length > room) { const every = Math.ceil(xTicks.length / room); xTicks = xTicks.filter((_, i) => (xTicks.length - 1 - i) % every === 0); }
      }
      else {
        const count = X.ticks || Math.max(2, Math.floor(pw / 84));
        let t = niceTicks(x0, x1, count);
        if (X.nice && !X.domain) { x0 = Math.floor(x0 / t.step + 1e-9) * t.step; x1 = Math.ceil(x1 / t.step - 1e-9) * t.step; t = niceTicks(x0, x1, count); }
        xTicks = t.ticks.filter((v) => v >= x0 - 1e-9 && v <= x1 + 1e-9);
        xFmt ||= tickFormat(t.step);
      }
    }
    const lin = (lo, hi, a, b) => (v) => a + ((v - lo) / (hi - lo)) * (b - a);
    const log = (lo, hi, a, b) => (v) => a + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (b - a);
    const bw = band ? pw / Math.max(1, cats.length) : 0;
    const sx = band ? (c) => mLeft + (cats.indexOf(c) + 0.5) * bw : (X.type === "log" ? log : lin)(x0, x1, mLeft, mLeft + pw);
    const sy = (Y.type === "log" ? log : lin)(y0, y1, mTop + ph, mTop);
    const ix = (px) => (X.type === "log" ? 10 ** (Math.log10(x0) + ((px - mLeft) / pw) * (Math.log10(x1) - Math.log10(x0))) : x0 + ((px - mLeft) / pw) * (x1 - x0));
    const iy = (py) => (Y.type === "log" ? 10 ** (Math.log10(y0) + ((mTop + ph - py) / ph) * (Math.log10(y1) - Math.log10(y0))) : y0 + ((mTop + ph - py) / ph) * (y1 - y0));
    const yBase = Y.type === "log" ? mTop + ph : sy(clamp(0, y0, y1));
    const ok = (p) => Number.isFinite(p.y) && (band ? cats.includes(p.x) : Number.isFinite(p.x)) && (X.type !== "log" || p.x > 0) && (Y.type !== "log" || p.y > 0);

    const nodes = [];
    nodes.push(svgEl("defs", {}, svgEl("clipPath", { id: clipId }, svgEl("rect", { x: mLeft - 6, y: mTop - 6, width: pw + 12, height: ph + 12 }))));

    // Grid, axes, labels.
    yTicks.forEach((v, i) => {
      const y = sy(v);
      nodes.push(svgEl("line", { class: "gridline", x1: mLeft, x2: mLeft + pw, y1: y, y2: y }));
      nodes.push(svgEl("text", { x: mLeft - 8, y, dy: "0.32em", "text-anchor": "end" }, String(yLabels[i])));
    });
    nodes.push(svgEl("line", { class: "axis", x1: mLeft, x2: mLeft + pw, y1: mTop + ph, y2: mTop + ph }));
    if (Y.type !== "log" && y0 < 0 && y1 > 0) nodes.push(svgEl("line", { class: "axis", x1: mLeft, x2: mLeft + pw, y1: sy(0), y2: sy(0) }));
    if (Y.label) nodes.push(svgEl("text", { class: "ax-label", x: 0, y: 12 }, Y.label));
    if (band) {
      const widest = Math.max(1, ...cats.map((c) => String(X.format ? X.format(c) : c).length)) * 6.6 + 10;
      const every = Math.max(1, Math.ceil(widest / bw));
      cats.forEach((c, i) => { if (i % every === 0) nodes.push(svgEl("text", { x: sx(c), y: mTop + ph + 17, "text-anchor": "middle" }, String(X.format ? X.format(c) : c))); });
    } else {
      xTicks.forEach((v, i) => nodes.push(svgEl("text", { x: sx(v), y: mTop + ph + 17, "text-anchor": i === 0 && sx(v) - mLeft < 12 ? "start" : sx(v) > mLeft + pw - 12 ? "end" : "middle" }, String(xFmt(v)))));
    }
    if (X.label) nodes.push(svgEl("text", { class: "ax-label", x: mLeft + pw / 2, y: H - 4, "text-anchor": "middle" }, X.label));

    const body = svgEl("g", { "clip-path": `url(#${clipId})` });
    nodes.push(body);

    for (const m of cur.marks || []) {
      if (m.type === "span") body.append(svgEl("rect", { x: sx(m.x0), y: mTop, width: Math.max(0, sx(m.x1) - sx(m.x0)), height: ph, fill: m.color || INK, opacity: m.opacity ?? 0.07 }));
    }

    const order = ["range", "area", "hist", "bars", "line", "step", "scatter"];
    const barSeries = series.filter((s) => s.type === "bars");
    for (const s of [...series].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))) {
      const pts = s._p;
      if (s.type === "range") {
        const good = pts.filter((p) => Number.isFinite(p.y) && Number.isFinite(p.y0) && Number.isFinite(p.x));
        if (good.length > 1) body.append(svgEl("path", { d: `M${good.map((p) => `${sx(p.x)},${sy(p.y)}`).join("L")}L${[...good].reverse().map((p) => `${sx(p.x)},${sy(p.y0)}`).join("L")}Z`, fill: s._c, opacity: s.opacity ?? 0.14 }));
      } else if (s.type === "hist") {
        for (const p of pts) {
          if (!Number.isFinite(p.y)) continue;
          const xa = sx(p.x0), xb = sx(p.x1);
          const gap = xb - xa > 4 ? 1 : 0;
          body.append(svgEl("rect", { x: xa + gap / 2, y: Math.min(sy(p.y), yBase), width: Math.max(0.5, xb - xa - gap), height: Math.abs(yBase - sy(p.y)), fill: s._c, opacity: s.opacity ?? 0.9 }));
        }
      } else if (s.type === "bars") {
        const k = barSeries.length;
        const w = Math.min(24, (bw * 0.8) / k - (k > 1 ? 2 : 0));
        const j = barSeries.indexOf(s);
        for (const p of pts) {
          if (!ok(p)) continue;
          const left = sx(p.x) - (k * w + (k - 1) * 2) / 2 + j * (w + 2);
          body.append(svgEl("path", { d: barPath(left, sy(p.y), yBase, Math.max(1, w)), fill: p.color || s._c, opacity: s.opacity ?? 1 }));
        }
      } else if (s.type === "scatter") {
        const r = s.r || 4;
        for (const p of pts) if (ok(p)) body.append(svgEl("circle", { cx: sx(p.x), cy: sy(p.y), r: p.r || r, fill: p.color || s._c, stroke: SURFACE, "stroke-width": r >= 3.5 ? 1.5 : 0, opacity: s.opacity ?? 1 }));
      } else {
        let d = "", pen = false;
        for (const p of pts) {
          if (!ok(p)) { pen = false; continue; }
          const px = sx(p.x), py = sy(p.y);
          d += !pen ? `M${px},${py}` : s.type === "step" ? `H${px}V${py}` : `L${px},${py}`;
          pen = true;
        }
        if (s.type === "area" && d) {
          let fill = "";
          let run = [];
          const flush = () => { if (run.length > 1) fill += `M${run[0][0]},${yBase}L${run.map((q) => q.join(",")).join("L")}L${run[run.length - 1][0]},${yBase}Z`; run = []; };
          for (const p of pts) { if (ok(p)) run.push([sx(p.x), sy(p.y)]); else flush(); }
          flush();
          body.append(svgEl("path", { d: fill, fill: s._c, opacity: s.fillOpacity ?? 0.12 }));
        }
        if (d) body.append(svgEl("path", { d, fill: "none", stroke: s._c, "stroke-width": s.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": s.dash ? "5 4" : null, opacity: s.opacity ?? 1 }));
      }
    }

    // Reference marks sit above the data. A text label that would land on an earlier label is dropped.
    const placed = [];
    const fits = (x, y, text, anchor) => {
      const w = String(text).length * 6.8;
      const box = { x0: anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x, y0: y - 11, w, h: 14 };
      if (placed.some((b) => box.x0 < b.x0 + b.w && b.x0 < box.x0 + box.w && box.y0 < b.y0 + b.h && b.y0 < box.y0 + box.h)) return false;
      placed.push(box);
      return true;
    };
    const markOrder = { point: 0, vline: 1, hline: 1, text: 2 };
    for (const m of [...(cur.marks || [])].sort((a, b) => (markOrder[a.type] ?? 1) - (markOrder[b.type] ?? 1))) {
      const within = (v, lo, hi) => v >= Math.min(lo, hi) - 1e-9 * Math.abs(hi - lo) && v <= Math.max(lo, hi) + 1e-9 * Math.abs(hi - lo);
      // A reference line beyond the ends of an axis has nothing to point at, so it is left out, label and all.
      if (m.type === "vline" && (band ? cats.includes(m.x) : Number.isFinite(m.x) && within(m.x, x0, x1))) {
        const x = sx(m.x);
        nodes.push(svgEl("line", { x1: x, x2: x, y1: mTop, y2: mTop + ph, stroke: m.color || INK, "stroke-width": 1, "stroke-dasharray": "4 3", opacity: 0.7 }));
        if (m.text) {
          // Step the label down a line at a time until it is clear of earlier labels.
          const flip = x > mLeft + pw * 0.7;
          let ty = mTop + 11 + (m.dy || 0);
          for (let tries = 0; tries < 4 && !fits(flip ? x - 5 : x + 5, ty, m.text, flip ? "end" : "start"); tries++) ty += 14;
          nodes.push(svgEl("text", { class: "mark-label", x: flip ? x - 5 : x + 5, y: ty, "text-anchor": flip ? "end" : "start" }, m.text));
        }
      } else if (m.type === "hline" && Number.isFinite(m.y) && within(m.y, y0, y1)) {
        const y = sy(m.y);
        nodes.push(svgEl("line", { x1: mLeft, x2: mLeft + pw, y1: y, y2: y, stroke: m.color || INK, "stroke-width": 1, "stroke-dasharray": "4 3", opacity: 0.7 }));
        if (m.text) {
          // Above the line if there is room, otherwise below it.
          const ty = fits(mLeft + pw - 4, y - 5, m.text, "end") ? y - 5 : y + 14;
          if (ty !== y - 5) fits(mLeft + pw - 4, ty, m.text, "end");
          nodes.push(svgEl("text", { class: "mark-label", x: mLeft + pw - 4, y: ty, "text-anchor": "end" }, m.text));
        }
      } else if (m.type === "text") {
        const tx = sx(m.x) + (m.dx || 0), ty = sy(m.y) + (m.dy || 0);
        if (fits(tx, ty, m.text, m.anchor || "start")) nodes.push(svgEl("text", { class: "mark-label", x: tx, y: ty, "text-anchor": m.anchor || "start" }, m.text));
      } else if (m.type === "point") {
        nodes.push(svgEl("circle", { cx: sx(m.x), cy: sy(m.y), r: m.r || 5.5, fill: m.color || INK, stroke: SURFACE, "stroke-width": 2 }));
        if (m.text) {
          const flip = sx(m.x) > mLeft + pw * 0.7;
          fits(sx(m.x) + (flip ? -9 : 9), sy(m.y) + 4, m.text, flip ? "end" : "start");
          nodes.push(svgEl("text", { class: "mark-label", x: sx(m.x) + (flip ? -9 : 9), y: sy(m.y), dy: "0.32em", "text-anchor": flip ? "end" : "start" }, m.text));
        }
      }
    }

    // Direct labels at line ends: a dot in the series colour, text in ink.
    for (const s of endLabels) {
      const last = [...s._p].reverse().find(ok);
      if (!last) continue;
      nodes.push(svgEl("circle", { cx: sx(last.x), cy: sy(last.y), r: 4, fill: s._c, stroke: SURFACE, "stroke-width": 2 }));
      nodes.push(svgEl("text", { class: "end-label", x: sx(last.x) + 8, y: sy(last.y), dy: "0.32em" }, String(s.endLabel === true ? s.name : s.endLabel)));
    }
    if (!series.some((s) => s._p.length)) nodes.push(svgEl("text", { x: mLeft + pw / 2, y: mTop + ph / 2, "text-anchor": "middle" }, cur.empty || "No data yet"));

    // Hover model.
    const pointMode = cur.hover === "point" || (series.length > 0 && series.every((s) => s.type === "scatter"));
    let keys = [];
    if (pointMode) {
      series.forEach((s) => { if (s.hover !== false) s._p.forEach((p) => { if (ok(p)) keys.push({ px: sx(p.x), py: sy(p.y), p, s }); }); });
      keys.sort((a, b) => a.px - b.px);
    } else {
      const seen = new Map();
      for (const s of series) {
        if (s.type === "scatter" || s.hover === false) continue;
        for (const p of s._p) {
          if (!(band ? cats.includes(p.x) : Number.isFinite(p.x))) continue;
          if (!seen.has(p.x)) seen.set(p.x, { x: p.x, px: sx(p.x), rows: [] });
          if (Number.isFinite(p.y)) seen.get(p.x).rows.push({ s, p });
        }
      }
      keys = [...seen.values()].filter((k) => k.rows.length).sort((a, b) => a.px - b.px);
    }

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", H);
    svg.replaceChildren(...nodes, hoverLayer);
    layout = { W, H, mLeft, mTop, pw, ph, sx, sy, ix, iy, keys, pointMode, X, Y, xFmt: band ? (X.format || String) : xFmt, yFmt: Y.format || fmt.auto, series, band };
    if (hover >= keys.length) hover = -1;
    showHover(hover);
    if (details.open) buildTable();
    details.hidden = cur.table === false;
  }

  function nearest(px, py) {
    const { keys, pointMode } = layout;
    if (!keys.length) return -1;
    if (pointMode) {
      let best = -1, bd = 48 * 48;
      keys.forEach((k, i) => { const d = (k.px - px) ** 2 + (k.py - py) ** 2; if (d < bd) { bd = d; best = i; } });
      return best;
    }
    let lo = 0, hi = keys.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid].px < px) lo = mid; else hi = mid; }
    return Math.abs(keys[lo].px - px) <= Math.abs(keys[hi].px - px) ? lo : hi;
  }

  function showHover(i) {
    hover = i;
    hoverLayer.replaceChildren();
    if (i < 0 || !layout || !layout.keys[i]) { tip.hidden = true; return; }
    const { keys, pointMode, mTop, ph, sx, sy, X, Y, xFmt, yFmt, W } = layout;
    const k = keys[i];
    const rows = [];
    let anchorY;
    if (pointMode) {
      hoverLayer.append(svgEl("circle", { cx: k.px, cy: k.py, r: (k.p.r || k.s.r || 4) + 3.5, fill: "none", stroke: INK, "stroke-width": 2 }));
      rows.push(el("b", { text: k.p.label != null ? String(k.p.label) : k.s.name || "" }));
      rows.push(el("div", {}, el("span", { text: X.label || "x" }), el("strong", { text: String(xFmt(k.p.x)) })));
      rows.push(el("div", {}, el("span", { text: Y.label || "y" }), el("strong", { text: String(yFmt(k.p.y)) })));
      anchorY = k.py;
    } else {
      hoverLayer.append(svgEl("line", { class: "cross", x1: k.px, x2: k.px, y1: mTop, y2: mTop + ph }));
      rows.push(el("b", { text: `${X.label ? X.label + ": " : ""}${xFmt(k.x)}` }));
      for (const { s, p } of k.rows) {
        if (["line", "step", "area"].includes(s.type)) hoverLayer.append(svgEl("circle", { cx: sx(p.x), cy: sy(p.y), r: 4, fill: s._c, stroke: SURFACE, "stroke-width": 2 }));
        const value = s.type === "range" ? `${yFmt(p.y0)} to ${yFmt(p.y)}` : String(yFmt(p.y));
        rows.push(el("div", {}, el("span", {}, el("i", { style: { borderTopColor: s._c } }), s.name || Y.label || "value"), el("strong", { text: value })));
      }
      anchorY = k.rows.length ? Math.min(...k.rows.map((r) => sy(r.p.y))) : mTop;
    }
    tip.replaceChildren(...rows);
    tip.hidden = false;
    const scale = plot.clientWidth / W || 1;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = k.px * scale + 12;
    if (left + tw > plot.clientWidth) left = k.px * scale - 12 - tw;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${clamp(anchorY * scale - th / 2, 0, Math.max(0, plot.clientHeight - th))}px`;
  }

  function buildTable() {
    const { keys, pointMode, X, Y, xFmt, yFmt, series } = layout;
    const LIMIT = 400;
    let columns, rows;
    if (pointMode) {
      columns = [{ key: "s", label: "Series" }, { key: "l", label: "Label" }, { key: "x", label: X.label || "x", num: true }, { key: "y", label: Y.label || "y", num: true }];
      rows = keys.slice(0, LIMIT).map((k) => ({ s: k.s.name || "", l: k.p.label ?? "", x: xFmt(k.p.x), y: yFmt(k.p.y) }));
    } else {
      const cols = series.filter((s) => s.type !== "scatter" && s.hover !== false);
      columns = [{ key: "x", label: X.label || "x" }, ...cols.map((s, i) => ({ key: `s${i}`, label: s.name || Y.label || "value", num: true }))];
      rows = keys.slice(0, LIMIT).map((k) => {
        const row = { x: xFmt(k.x) };
        cols.forEach((s, i) => { const hit = k.rows.find((r) => r.s === s); row[`s${i}`] = hit ? (s.type === "range" ? `${yFmt(hit.p.y0)} to ${yFmt(hit.p.y)}` : yFmt(hit.p.y)) : ""; });
        return row;
      });
    }
    const t = table({ columns, rows, caption: keys.length > LIMIT ? `First ${LIMIT} of ${keys.length} rows` : null });
    tableBox.replaceChildren(...t.childNodes);
    if (!pointMode) {
      // Dots drawn over a line chart have no place in the x-by-series table, so they get one of their own.
      const points = series.filter((s) => s.type === "scatter" && s.hover !== false).flatMap((s) => s._p.filter((p) => Number.isFinite(p.y)).map((p) => ({ s: s.name || "", l: p.label ?? "", x: xFmt(p.x), y: yFmt(p.y) })));
      if (points.length) {
        const extra = table({
          caption: points.length > LIMIT ? `Points: first ${LIMIT} of ${points.length}` : "Points",
          columns: [{ key: "s", label: "Series" }, { key: "l", label: "Label" }, { key: "x", label: X.label || "x", num: true }, { key: "y", label: Y.label || "y", num: true }],
          rows: points.slice(0, LIMIT),
        });
        tableBox.append(...extra.childNodes);
      }
    }
  }

  const local = (e) => {
    const box = svg.getBoundingClientRect();
    const scale = layout.W / box.width;
    return [(e.clientX - box.left) * scale, (e.clientY - box.top) * scale];
  };
  svg.addEventListener("pointermove", (e) => { if (layout) showHover(nearest(...local(e))); });
  // A finger does not hover. A tap shows the values at that point (a sideways drag moves them), and they stay up
  // until the next tap outside the chart: the pointer "leaves" the moment the finger lifts, so that cannot hide them.
  const finger = (e) => e.pointerType === "touch" || e.pointerType === "pen";
  svg.addEventListener("pointerdown", (e) => { if (layout && finger(e)) showHover(nearest(...local(e))); });
  svg.addEventListener("pointerleave", (e) => { if (!finger(e)) showHover(-1); });
  document.addEventListener("pointerdown", (e) => { if (hover >= 0 && finger(e) && !root.contains(e.target)) showHover(-1); });
  svg.addEventListener("blur", () => showHover(-1));
  svg.addEventListener("click", (e) => {
    if (!layout || !cur.onClick) return;
    const [px, py] = local(e);
    const i = layout.pointMode ? nearest(px, py) : -1;
    const hit = i >= 0 ? layout.keys[i] : null;
    cur.onClick({ x: layout.band ? null : layout.ix(px), y: layout.iy(py), point: hit ? hit.p : null, series: hit ? hit.s : null, inside: px >= layout.mLeft && px <= layout.mLeft + layout.pw && py >= layout.mTop && py <= layout.mTop + layout.ph, px, py, toPx: (x, y) => [layout.sx(x), layout.sy(y)] });
  });
  svg.addEventListener("keydown", (e) => {
    if (!layout || !layout.keys.length) return;
    const n = layout.keys.length;
    if (e.key === "ArrowRight") showHover(hover < 0 ? 0 : Math.min(n - 1, hover + 1));
    else if (e.key === "ArrowLeft") showHover(hover < 0 ? n - 1 : Math.max(0, hover - 1));
    else if (e.key === "Home") showHover(0);
    else if (e.key === "End") showHover(n - 1);
    else if (e.key === "Escape") showHover(-1);
    else if ((e.key === "Enter" || e.key === " ") && cur.onClick && hover >= 0) {
      // The keyboard's click: whatever the arrow keys are on.
      const k = layout.keys[hover], p = k.p || k.rows[0]?.p;
      cur.onClick({ x: layout.band ? null : k.p ? k.p.x : k.x, y: p ? p.y : null, point: k.p || null, series: k.s || null, inside: true, key: true, px: k.px, py: k.py ?? (p ? layout.sy(p.y) : null), toPx: (x, y) => [layout.sx(x), layout.sy(y)] });
    }
    else return;
    e.preventDefault();
  });
  details.addEventListener("toggle", () => { if (details.open && layout) buildTable(); });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { if (plot.clientWidth !== lastWidth) render(); }).observe(plot);
  render();

  return {
    el: root,
    update(next) { cur = { ...cur, ...next }; render(); },
    get spec() { return cur; },
  };
}

/* ============================================================ accessibility */

/**
 * Anything that scrolls must be reachable from the keyboard (WCAG 2.1.1). Tables and equations scroll
 * sideways on narrow screens, so whenever an element inside <main> overflows a scrolling box it is given
 * tabindex="0", a region role and a name; when it stops overflowing they are taken away again.
 * Runs after load, on resize, and when the tool changes its contents.
 */
function watchScrollables(root) {
  const NATIVE = "a[href], button, input, select, textarea, summary, [contenteditable]";
  const sweep = () => {
    for (const node of root.querySelectorAll("*")) {
      const ours = node.dataset.kitScroll === "1";
      const overflows = node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
      if (!overflows) {
        if (ours) { node.removeAttribute("tabindex"); node.removeAttribute("role"); node.removeAttribute("aria-label"); delete node.dataset.kitScroll; }
        continue;
      }
      if (ours || node.matches(NATIVE) || node.hasAttribute("tabindex") || node instanceof SVGElement) continue;
      const style = getComputedStyle(node);
      if (!/(auto|scroll)/.test(style.overflowX + style.overflowY)) continue;
      // A box whose own focusable content can already be tabbed to still needs a tab stop only if it has none.
      if (node.querySelector(NATIVE + ", [tabindex]:not([tabindex='-1'])")) continue;
      node.tabIndex = 0;
      node.dataset.kitScroll = "1";
      if (!node.hasAttribute("role")) node.setAttribute("role", "region");
      if (!node.hasAttribute("aria-label") && !node.hasAttribute("aria-labelledby")) {
        const caption = node.querySelector("caption")?.textContent.trim();
        const base = caption || (node.classList.contains("eq") ? "Equation" : node.querySelector("table") ? "Table" : "Content");
        // Two regions with one name cannot be told apart in a screen reader's list of landmarks: number the later ones.
        const taken = new Set([...root.querySelectorAll("[data-kit-scroll]")].map((x) => x.getAttribute("aria-label")));
        let label = `${base} (scrollable)`;
        for (let n = 2; taken.has(label); n++) label = `${base} ${n} (scrollable)`;
        node.setAttribute("aria-label", label);
      }
    }
  };
  const later = debounce(sweep, 200);
  requestAnimationFrame(sweep);
  window.addEventListener("resize", later);
  if (typeof MutationObserver !== "undefined") new MutationObserver(later).observe(root, { childList: true, subtree: true });
  document.addEventListener("toggle", later, true);
}

/* ===================================================================== shell */

/**
 * Add the site chrome to a project page: top bar, the "Day N" line above the title, previous and next links, footer.
 * Reads window.CHALLENGE (from ../challenge-data.js) and <body data-day="N">. Call once from app.js.
 */
export function mount() {
  const D = window.CHALLENGE || { projects: [], sections: [] };
  const day = Number(document.body.dataset.day);
  const p = D.projects.find((x) => x.id === day);
  const section = p && D.sections.find((s) => s.id === p.section);
  if (section) document.body.classList.add(`s${section.id}`);

  document.body.prepend(
    el("a", { class: "skip", href: "#app", text: "Skip to the tool" }),
    el("header", { class: "top wrap" },
      el("a", { class: "mark", href: "../../index.html", text: "Varad Patel" }),
      el("nav", { "aria-label": "Site" }, el("a", { href: "../../index.html", text: "Home" }), el("a", { href: "../index.html", text: "365 projects" }))));

  const head = $(".p-head");
  if (head) {
    head.prepend(el("p", { class: "p-kicker" },
      el("span", { class: "day", text: `Day ${day}` }),
      section ? el("span", { text: section.name }) : null,
      p?.concept ? el("span", { text: p.concept }) : null));
  }

  const main = $("main");
  if (main) watchScrollables(main);
  const builtList = D.projects.filter((x) => x.built && x.id !== day);
  const prev = builtList.filter((x) => x.id < day).pop();
  const next = builtList.find((x) => x.id > day);
  if (main && (prev || next)) {
    main.append(el("nav", { class: "p-nav", "aria-label": "Other projects" },
      prev ? el("a", { class: "prev", href: `../${prev.id}/` }, el("span", { text: `Day ${prev.id}` }), el("b", { text: prev.title })) : null,
      next ? el("a", { class: "next", href: `../${next.id}/` }, el("span", { text: `Day ${next.id}` }), el("b", { text: next.title })) : null));
  }

  const code = D.repo ? `${D.repo}/tree/${D.branch}/365projects/${day}` : null;
  document.body.append(el("footer", { class: "foot wrap" },
    el("p", { class: "p-foot-links" },
      el("span", {}, "Part of ", el("a", { href: "../index.html", text: "365 projects in 365 days" }), "."),
      code ? el("a", { href: code, text: "Code and tests for this page" }) : null,
      p?.built ? el("span", { text: `Built ${fmt.date(p.built)}.` }) : null)));
}
