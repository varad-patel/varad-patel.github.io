// Day 35: Where Your Tax Rupee Goes. The model, with no DOM code.
// Splits an amount of tax across the Union Budget in proportion to spending, lays the split out as a
// squarified treemap, and compares shares across ten years. Figures come from data.js (rupees crore).

const sum = (a) => a.reduce((s, v) => s + v, 0);

/* ------------------------------------------------------------------ rupees */

/** Whole rupees with Indian digit grouping: 1234567 becomes "12,34,567". */
export function groupIndian(x) {
  if (!Number.isFinite(x)) return "–";
  const n = Math.round(Math.abs(x));
  const digits = String(n);
  const head = digits.length > 3 ? digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "";
  return (x < 0 && n > 0 ? "−" : "") + head + digits.slice(-3);
}
/** "₹12,34,567", or with paise below ten rupees so that small shares do not all read "₹0". */
export function rupees(x) {
  if (!Number.isFinite(x)) return "–";
  const a = Math.abs(x);
  if (a > 0 && a < 9.995) return `${x < 0 ? "−" : ""}₹${a.toFixed(2)}`;
  return `${x < 0 && Math.round(a) > 0 ? "−" : ""}₹${groupIndian(a)}`;
}
/** An amount in rupees crore, in the words Indian budgets use: "₹53.47 lakh crore", "₹12,345 crore", "₹68 crore". */
export function crore(x) {
  if (!Number.isFinite(x)) return "–";
  const a = Math.abs(x), sign = x < 0 ? "−" : "";
  if (a >= 99999.5) return `${sign}₹${(a / 1e5).toFixed(2)} lakh crore`;
  if (a >= 99.95) return `${sign}₹${groupIndian(a)} crore`;
  return `${sign}₹${Number(a.toFixed(a >= 9.995 ? 1 : 2))} crore`;
}
/** A share as a percentage with enough decimals to show small ones: 36.9%, 2.63%, 0.04%. */
export function percent(share) {
  if (!Number.isFinite(share)) return "–";
  const p = share * 100, a = Math.abs(p);
  const text = a >= 10 ? a.toFixed(1) : a >= 0.995 ? a.toFixed(2) : a.toFixed(a >= 0.0995 ? 2 : 3);
  return `${p < 0 && Number(text) > 0 ? "−" : ""}${text}%`;
}

export const MAX_TAX = 1e11; // ₹10,000 crore: far above any household, and small enough to print exactly
/** Read the amount box. Returns { value } or { error }. Commas and a rupee sign are allowed; words and signs are not. */
export function parseAmount(text) {
  const raw = String(text ?? "").replace(/[₹,\s]/g, "");
  if (raw === "") return { error: "Type the tax you pay in a year, in rupees: for example 100000." };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { error: "Use digits only, for example 100000 or 1,00,000. Write lakh and crore out as numbers." };
  const value = Number(raw);
  if (value < 1) return { error: "Enter an amount of at least ₹1." }; // a smaller one would print as ₹0.00 throughout
  if (value > MAX_TAX) return { error: "Enter an amount up to ₹10,000 crore (1,00,00,00,00,000)." };
  return { value };
}

/* ------------------------------------------------------------------ the budget */

const SHORT = {
  "The President, Parliament, Union Public Service Commission and the Secretariat of the Vice President": "President, Parliament, UPSC and Vice President's Secretariat",
};
/** A ministry's name without "Ministry of" or "Department of", for labels. */
export const shortName = (name) => SHORT[name] || name.replace(/^(Ministry|Department) of /, "");

export const STATUS_WORDS = { Actuals: "actual", "Revised Estimates": "revised estimate", "Budget Estimates": "budget estimate" };

/**
 * One year of the budget: every ministry with its demands, largest first.
 * value is rupees crore; share is of total spending. A demand that did not exist that year is left out
 * (listed under `missing`), and a ministry with none of its demands that year has value null.
 */
export function yearView(data, i) {
  if (!Number.isInteger(i) || i < 0 || i >= data.years.length) throw new RangeError("no such year");
  const total = data.total[i];
  const ministries = data.ministries.map((m) => {
    const demands = m.demands.filter((d) => d.v[i] != null)
      .map((d) => ({ name: d.name, value: d.v[i], share: d.v[i] / total }))
      .sort((a, b) => b.value - a.value);
    const value = demands.length ? sum(demands.map((d) => d.value)) : null;
    return { name: m.name, short: shortName(m.name), value, share: value == null ? null : value / total, demands,
      missing: m.demands.filter((d) => d.v[i] == null).map((d) => d.name) };
  }).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  return { year: data.years[i], status: data.status[i], budget: data.budget[i], total, ministries };
}

/** Where each rupee of spending is funded from, and what share of gross central taxes is passed to the States. */
export function funding(data, i) {
  const r = data.receipts, total = data.total[i];
  return {
    netTax: r.netTax[i] / total,
    nonTax: r.nonTax[i] / total,
    assets: (r.loans[i] + r.other[i]) / total, // loans recovered and other non-debt capital receipts (mostly disinvestment)
    borrowing: r.borrowing[i] / total,
    statesShare: r.statesShare[i] / r.grossTax[i],
  };
}

/**
 * Split an amount of tax in proportion to spending. With keepStatesShare, the States' share of gross central taxes is
 * taken out first and only the rest is split. Returns { toStates, toUnion, rows: [{ name, amount, ... }] } for the
 * rows given (ministries or demands), each amount being toUnion times that row's share of total spending.
 */
export function splitTax(amount, rows, { statesShare = 0 } = {}) {
  if (!(amount >= 0) || !Number.isFinite(amount)) throw new RangeError("amount must be a number that is not negative");
  if (!(statesShare >= 0 && statesShare < 1)) throw new RangeError("statesShare must be at least 0 and below 1");
  const toStates = amount * statesShare, toUnion = amount - toStates;
  return { toStates, toUnion, rows: rows.map((r) => ({ ...r, amount: r.share == null ? null : toUnion * r.share })) };
}

/**
 * Ten years of change: for every ministry, its share of spending in years i and j, the change in percentage points
 * and how many times larger its spending is in rupees. Ministries with no figure in either year have nulls.
 * Sorted from the largest gain in share to the largest loss.
 */
export function changeTable(data, i, j) {
  const a = yearView(data, i), b = yearView(data, j);
  const first = new Map(a.ministries.map((m) => [m.name, m]));
  return b.ministries.map((m) => {
    const was = first.get(m.name);
    const ok = was.value != null && m.value != null && was.value > 0;
    return { name: m.name, short: m.short, from: was.share, to: m.share, fromValue: was.value, toValue: m.value,
      points: ok ? (m.share - was.share) * 100 : null, multiple: ok ? m.value / was.value : null };
  }).sort((x, y) => (y.points ?? -Infinity) - (x.points ?? -Infinity));
}

/** A row's share of total spending in every year (null where it has no figure). `demand` picks one demand of the ministry. */
export function shareSeries(data, ministry, demand = null) {
  const m = data.ministries.find((x) => x.name === ministry);
  if (!m) throw new RangeError("no such ministry");
  const rows = demand ? m.demands.filter((d) => d.name === demand) : m.demands;
  if (!rows.length) throw new RangeError("no such demand");
  return data.years.map((year, i) => {
    const present = rows.filter((d) => d.v[i] != null);
    const value = present.length ? sum(present.map((d) => d.v[i])) : null;
    return { year, status: data.status[i], value, share: value == null ? null : value / data.total[i] };
  });
}

/* ------------------------------------------------------------------ treemap */

/**
 * Squarified treemap (Bruls, Huizing and van Wijk 2000). items: [{ value, ... }]; only values above zero are drawn.
 * Returns the same objects in descending order with x, y, w, h added, tiling the rectangle (x, y, w, h) exactly with
 * areas in proportion to value. Rows are laid along the shorter side and a row is closed as soon as adding the next
 * item would make its worst aspect ratio worse.
 */
export function squarify(items, x = 0, y = 0, w = 1, h = 1) {
  const list = items.filter((it) => Number.isFinite(it.value) && it.value > 0).sort((a, b) => b.value - a.value);
  const out = [];
  if (!list.length || !(w > 0) || !(h > 0)) return out;
  const scale = (w * h) / sum(list.map((it) => it.value));
  const worst = (row, side) => {
    const s = sum(row), hi = Math.max(...row), lo = Math.min(...row);
    return Math.max((side * side * hi) / (s * s), (s * s) / (side * side * lo));
  };
  let start = 0;
  while (start < list.length) {
    const side = Math.min(w, h);
    const row = [list[start].value * scale];
    let end = start + 1;
    while (end < list.length) {
      const next = [...row, list[end].value * scale];
      if (worst(next, side) > worst(row, side)) break;
      row.push(next[next.length - 1]);
      end++;
    }
    const last = end === list.length; // the last row takes whatever is left, so rounding cannot leave a gap
    const thick = sum(row) / side;
    let offset = 0;
    row.forEach((area, k) => {
      const it = list[start + k];
      if (w >= h) { // the row is a column on the left, filled from the top
        const colW = last ? w : thick;
        const len = k === row.length - 1 ? h - offset : area / colW;
        out.push({ ...it, x, y: y + offset, w: colW, h: len });
        offset += len;
      } else { // the row is a strip along the top, filled from the left
        const rowH = last ? h : thick;
        const len = k === row.length - 1 ? w - offset : area / rowH;
        out.push({ ...it, x: x + offset, y, w: len, h: rowH });
        offset += len;
      }
    });
    if (w >= h) { const used = last ? w : thick; x += used; w -= used; } else { const used = last ? h : thick; y += used; h -= used; }
    start = end;
  }
  return out;
}
