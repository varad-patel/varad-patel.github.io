// Day 65: Risk Calculator. Interface.
import { $, el, fmt, mount, select, segmented, textField, button, stat, note, chart, debounce } from "../kit/kit.js";
import { ALL, T, BILLS, monthLabel, startOfYear, endOfYear, MIN_MONTHS, parseAmount, weightsFrom, portfolioReturns, measures, riskShares } from "./logic.js";

mount();

const FIRST_YEAR = 1999, LAST_YEAR = 2026;
const PRESETS = [
  { label: "Bonds and three currencies", amounts: { t10: 4000, eur: 2000, jpy: 2000, aud: 2000 } },
  { label: "All in 20-year Treasuries", amounts: { t20: 10000 } },
  { label: "Treasury ladder", amounts: { t2: 2500, t5: 2500, t10: 2500, t20: 2500 } },
  { label: "Six currencies", amounts: { eur: 1000, jpy: 1000, gbp: 1000, chf: 1000, cad: 1000, aud: 1000 } },
  { label: "Equal in all eleven", amounts: Object.fromEntries(ALL.map((a) => [a.id, 1000])) },
];
const DEFAULT = { amounts: PRESETS[0].amounts, mode: "rebalanced", from: FIRST_YEAR, to: LAST_YEAR };
const state = { mode: DEFAULT.mode, from: DEFAULT.from, to: DEFAULT.to };
const GROUPS = [["cash", "Cash in dollars"], ["treasury", "US Treasuries"], ["deposit", "Cash in another currency"]];

const pct = (x, d = 1) => fmt.pct(x, d);
const money = (x) => `$${fmt.num(x, x >= 100 ? 0 : 2)}`;
const end = (i, from) => (i < 0 ? `the start, the end of ${monthLabel(from - 1)}` : `the end of ${monthLabel(from + i)}`);

/* ---------- controls ---------- */
const fields = new Map();
const amountMsg = el("div", { role: "alert" });
const holdings = el("div", { class: "field", role: "group", "aria-label": "Your holdings, in dollars" },
  el("div", { class: "lab" }, el("span", { text: "Your holdings, in dollars" })),
  el("p", { class: "hint", text: "Type how much you hold in each, in US dollars, or start from an example. Leave a box empty for none." }),
  GROUPS.map(([g, title]) => el("div", { class: "rc-group" }, el("p", { class: "rc-sub", text: title }),
    ALL.filter((a) => a.group === g).map((a) => {
      const f = textField({ label: a.short, value: "", placeholder: "0", onInput: debounce(() => update(), 300) });
      f.input.setAttribute("inputmode", "decimal");
      f.input.setAttribute("maxlength", "24");
      f.el.title = a.detail;
      fields.set(a.id, f);
      return f.el;
    }))),
  amountMsg);
const presetBox = el("div", { class: "field", role: "group", "aria-label": "Examples" },
  el("div", { class: "lab" }, el("span", { text: "Examples" })),
  el("div", { class: "row rc-presets" },
    PRESETS.map((p) => button(p.label, (e) => { fill(p.amounts); update(); e.currentTarget.focus(); }, { small: true })),
    button("Clear all", (e) => { fill({}); update(); e.currentTarget.focus(); }, { small: true })));
const modeSeg = segmented({
  label: "Rebalancing", value: state.mode,
  options: [{ value: "rebalanced", label: "Back to these weights monthly" }, { value: "drift", label: "Bought once" }],
  hint: "Rebalanced: the weights are restored at the start of every month. Bought once: each holding grows with its own returns.",
  onChange: (v) => { state.mode = v; update(); },
});
const years = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const fromSelect = select({
  label: "From", value: state.from,
  options: years(FIRST_YEAR, LAST_YEAR - 1).map((y) => ({ value: y, label: monthLabel(startOfYear(y)) })),
  onChange: (v) => { state.from = Number(v); update(); },
});
const toSelect = select({
  label: "To", value: state.to,
  options: years(FIRST_YEAR, LAST_YEAR).map((y) => ({ value: y, label: monthLabel(endOfYear(y)) })),
  hint: "The portfolio is held from the start of the first month to the end of the last.",
  onChange: (v) => { state.to = Number(v); update(); },
});
const windowMsg = el("div", { role: "alert" });
const about = el("div", { class: "hint rc-about" },
  `Monthly returns in US dollars, ${monthLabel(0)} to ${monthLabel(T - 1)}, nominal, before tax and costs. Treasuries are modelled constant-maturity bonds, not a fund; the currencies are cash deposits earning their central bank's policy rate. Each series is described under "How it works" below.`);
const controls = el("div", { class: "controls" }, holdings, presetBox, modeSeg.el, fromSelect.el, toSelect.el, windowMsg, about);

/* ---------- outputs ---------- */
const sVol = stat("Volatility");
const sFall = stat("Maximum drawdown");
const sSharpe = stat("Sharpe ratio");
const sRet = stat("Return a year");
const status = el("p", { class: "sr-only", role: "status" });
const message = el("div");
const worked = el("div", { class: "rc-worked" });
const valueBox = el("div"), ddBox = el("div");
const tableBox = el("div", { class: "rc-tbl", id: "rc-holdings" });
const advice = note("", "A description of how this mix behaved in the past, not investment advice and not a forecast.");
const jump = el("nav", { class: "row small jump", "aria-label": "Parts of this tool" },
  el("span", { class: "muted", text: "Jump to:" }), el("a", { href: "#rc-results", text: "The measures" }), el("a", { href: "#rc-worked", text: "Worked out" }), el("a", { href: "#rc-holdings", text: "Each holding" }));
const out = el("div", { class: "out" },
  el("div", { class: "stats", id: "rc-results" }, sVol.el, sFall.el, sSharpe.el, sRet.el), status, message,
  el("div", { class: "panel", id: "rc-worked" }, el("h2", { text: "The numbers, worked out" }), worked),
  valueBox, ddBox, tableBox, advice);
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));

const valueChart = chart(valueBox, { series: [], height: 300 });
const ddChart = chart(ddBox, { series: [], height: 220 });

function fill(amounts) {
  for (const [id, f] of fields) { f.value = amounts[id] ? String(amounts[id]) : ""; f.input.removeAttribute("aria-invalid"); }
}

const xOf = (i) => { const k = (2 - 1) + i; return 1999 + Math.floor(k / 12) + (k % 12) / 12; }; // return index -> year + month/12 (Feb 1999 = index 0)
const xLabel = (v) => { const k = Math.round(v * 12); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][((k % 12) + 12) % 12]} ${Math.floor(k / 12)}`; };

/* ---------- the calculation ---------- */
function update() {
  // Read and check every box.
  const errors = [], amounts = [];
  for (const a of ALL) {
    const f = fields.get(a.id);
    const r = parseAmount(f.value);
    if (r.error) f.input.setAttribute("aria-invalid", "true"); else f.input.removeAttribute("aria-invalid");
    f.input.classList.toggle("invalid", Boolean(r.error));
    if (r.error) errors.push(`${a.short}: "${f.value.trim().slice(0, 24)}${f.value.trim().length > 24 ? "..." : ""}" ${r.error}.`);
    amounts.push(r.error ? 0 : r.value);
  }
  amountMsg.replaceChildren(errors.length ? note("bad", ...errors.flatMap((e, i) => (i ? [el("br"), e] : [e]))) : "");
  if (errors.length) return blank("Fix the amounts marked above to see the measures.");
  const total = amounts.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return blank("Type an amount for at least one asset, or choose an example.");
  const from = startOfYear(state.from), to = endOfYear(state.to);
  windowMsg.replaceChildren();
  if (to - from + 1 < MIN_MONTHS) {
    windowMsg.replaceChildren(note("bad", to < from
      ? `The window ends (${monthLabel(to)}) before it starts (${monthLabel(from)}). Choose an end at least a year after the start.`
      : `From ${monthLabel(from)} to ${monthLabel(to)} is ${to - from + 1} ${to === from ? "month" : "months"}. Choose an end at least a year after the start.`));
    return blank(to < from ? "The window ends before it starts." : "The window is shorter than a year.");
  }
  const w = weightsFrom(amounts);
  const r = portfolioReturns(w, from, to, state.mode);
  const rf = BILLS.returns.slice(from, to + 1);
  const m = measures(r, rf);
  const d = m.drawdown;
  const n = m.months;
  const onlyBills = w.every((v, i) => v === 0 || ALL[i].id === "bills");

  sVol.set(pct(m.vol, 2), "a year");
  sFall.set(d.depth < 0 ? pct(d.depth, 1) : "none", d.depth < 0 ? `${d.peakAt < 0 ? "the start" : monthLabel(from + d.peakAt)} to ${monthLabel(from + d.troughAt)}` : "it never fell below a past peak");
  sSharpe.set(Number.isFinite(m.sharpe) ? fmt.num(m.sharpe, 2) : "–", Number.isFinite(m.sharpe) ? `over bills' ${pct(m.rfYear, 2)} a year` : "not defined for bills alone");
  sRet.set(pct(m.cagr, 2), `${money(total)} became ${money(total * m.growth)}`);
  message.replaceChildren(onlyBills ? note("", "This portfolio is Treasury bills alone, the same asset the Sharpe ratio measures against, so its excess return is zero every month and the ratio is 0 divided by 0.") : "");

  // The formulas with this portfolio's numbers in them.
  const fall = d.depth < 0
    ? ["The largest fall was ", `from ${money(total * d.peakValue)} at ${end(d.peakAt, from)} to ${money(total * d.troughValue)} at ${end(d.troughAt, from)}: `,
      el("span", { class: "rc-eq" }, `${money(total * d.troughValue)} / ${money(total * d.peakValue)} − 1 = ${pct(d.depth, 1)}`),
      d.recoveredAt >= 0 ? `. It was back above that peak at the end of ${monthLabel(from + d.recoveredAt)}.` : `. It had not got back to that peak by the end of ${monthLabel(to)}.`]
    : ["The value never fell below an earlier high, so the maximum drawdown is zero."];
  worked.replaceChildren(
    el("p", {}, `Over ${fmt.int(n)} months, ${monthLabel(from)} to ${monthLabel(to)}, with monthly returns r and Treasury bills' returns r`, el("sub", { text: "f" }), " for the same months."),
    el("h3", { text: "Volatility" }),
    el("p", { class: "eq" }, `√12 × sd(r) = √12 × ${pct(m.sdMonthly, 3)} = ${pct(m.vol, 2)} a year`),
    el("p", { class: "small" }, "sd is the standard deviation of the monthly returns, dividing by the number of months minus one. Multiplying by √12 turns a monthly spread into a yearly one if months are independent."),
    el("h3", { text: "Maximum drawdown" }),
    el("p", { class: "eq" }, "min over t of  W", el("sub", { text: "t" }), " / max(W", el("sub", { text: "0" }), ", …, W", el("sub", { text: "t" }), ") − 1"),
    el("p", { class: "small" }, "W is the value at each month-end, starting from what you typed. ", ...fall),
    el("h3", { text: "Sharpe ratio" }),
    Number.isFinite(m.sharpe)
      ? el("p", { class: "eq" }, `√12 × mean(r − r`, el("sub", { text: "f" }), `) / sd(r − r`, el("sub", { text: "f" }), `) = √12 × ${pct(m.exMean, 3)} / ${pct(m.exSd, 3)} = ${fmt.num(m.sharpe, 2)}`)
      : el("p", { class: "eq" }, "√12 × mean(r − r", el("sub", { text: "f" }), ") / sd(r − r", el("sub", { text: "f" }), ") = 0 / 0, not defined"),
    el("p", { class: "small" }, `The risk-free rate is the 3-month Treasury bill, which averaged ${pct(m.rfYear, 2)} a year over these months. The monthly ratio is multiplied by √12 to give a yearly one. A negative Sharpe ratio means the portfolio earned less than bills.`),
    el("h3", { text: "Return a year" }),
    el("p", { class: "eq" }, `(∏ (1 + r))^(12/${n}) − 1 = ${fmt.num(m.growth, 4)}^(12/${n}) − 1 = ${pct(m.cagr, 2)}`));

  const value = [[xOf(from) - 1 / 12, total], ...Array.from(d.wealth, (v, t) => [xOf(from + t), total * v])];
  const marks = d.depth < 0 ? [{ type: "span", x0: xOf(from + d.peakAt), x1: xOf(from + d.troughAt) }, { type: "point", x: xOf(from + d.troughAt), y: total * d.troughValue, text: `Low, ${pct(d.depth, 1)}` }] : [];
  valueChart.update({
    title: `Value of your ${money(total)} from the end of ${monthLabel(from - 1)} to the end of ${monthLabel(to)}`,
    subtitle: `${state.mode === "rebalanced" ? "Rebalanced to your weights every month." : "Bought once and left alone."} The shaded stretch is the largest fall, from its peak to its low.`,
    label: `Line chart of the portfolio's value from ${monthLabel(from)} to ${monthLabel(to)}`,
    x: { format: xLabel, label: "Month" },
    y: { label: "Value, $", format: (v) => `$${fmt.compact(v)}` },
    series: [{ name: "Value", type: "line", data: value, color: 0 }],
    marks,
  });
  ddChart.update({
    title: "Drawdown: how far below its highest value so far",
    subtitle: "Zero at every new high.",
    label: `Area chart of the portfolio's drawdown from ${monthLabel(from)} to ${monthLabel(to)}`,
    x: { format: xLabel, label: "Month" },
    y: { label: "Below the peak, %", format: (v) => fmt.num(v, 0), zero: true },
    series: [{ name: "Drawdown", type: "area", data: [[xOf(from) - 1 / 12, 0], ...Array.from(d.dd, (v, t) => [xOf(from + t), v * 100])], color: 7 }],
  });

  // Each holding on its own.
  const shares = riskShares(w, from, to);
  const rows = ALL.map((a, i) => ({ a, i, amt: amounts[i], w: w[i] })).filter((x) => x.amt > 0).map((x) => {
    const own = measures(Float64Array.from(x.a.returns.slice(from, to + 1)), rf);
    return { ...x, own, share: shares[x.i] };
  });
  tableBox.replaceChildren(listTable({
    caption: "Each holding on its own over the same months",
    columns: [
      { label: "Holding", get: (r) => r.a.name },
      { label: "Weight", get: (r) => pct(r.w) },
      { label: "Return a year", get: (r) => pct(r.own.cagr) },
      { label: "Volatility", get: (r) => pct(r.own.vol) },
      { label: "Maximum drawdown", get: (r) => (r.own.drawdown.depth < 0 ? pct(r.own.drawdown.depth) : "none") },
      { label: "Sharpe ratio", get: (r) => (Number.isFinite(r.own.sharpe) ? fmt.num(r.own.sharpe, 2) : "not defined") },
      { label: "Share of the risk", get: (r) => (Number.isFinite(r.share) ? pct(r.share) : "–") },
    ],
    rows: rows.sort((p, q) => q.w - p.w),
    foot: `Share of the risk is each holding's part in the variance of the portfolio rebalanced to these weights, w(Sw) / w'Sw from the monthly covariances; it can be negative for a holding that steadies the rest.${rows.length > 1 ? ` On their own the holdings' volatilities average ${pct(rows.reduce((s, x) => s + x.w * x.own.vol, 0))} (weighted); together they come to ${pct(m.vol)}${state.mode === "rebalanced" ? "" : " bought once"}.` : ""}`,
  }));

  status.textContent = `Over ${n} months from ${monthLabel(from)} to ${monthLabel(to)}: volatility ${pct(m.vol, 2)} a year, maximum drawdown ${d.depth < 0 ? pct(d.depth, 1) : "none"}, Sharpe ratio ${Number.isFinite(m.sharpe) ? fmt.num(m.sharpe, 2) : "not defined"}, return ${pct(m.cagr, 2)} a year.`;
}

function blank(why) {
  for (const s of [sVol, sFall, sSharpe, sRet]) s.set("–", "");
  message.replaceChildren(note("warn", why));
  status.textContent = why;
  worked.replaceChildren(el("p", { class: "muted", text: why }));
  valueChart.update({ series: [], marks: [], empty: why });
  ddChart.update({ series: [], marks: [], empty: why });
  tableBox.replaceChildren();
}

function listTable({ caption, columns, rows, foot }) {
  return el("div", {},
    el("table", { class: "tbl rt", role: "table" },
      el("caption", { text: caption }),
      el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, columns.map((c, k) => el("th", { role: "columnheader", scope: "col", class: k ? "num" : null, text: c.label })))),
      el("tbody", { role: "rowgroup" }, rows.map((r) => el("tr", { role: "row" },
        columns.map((c, k) => el(k === 0 ? "th" : "td", { role: k === 0 ? "rowheader" : "cell", scope: k === 0 ? "row" : null, class: k ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) })))))),
    foot ? el("p", { class: "small muted", text: foot }) : null);
}

fill(DEFAULT.amounts);
update();
