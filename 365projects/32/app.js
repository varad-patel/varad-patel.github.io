// Day 32: Personal Inflation Calculator. Interface.
import { $, el, fmt, mount, slider, select, button, stat, note, chart, clamp, debounce, palette } from "../kit/kit.js";
import { PRICES } from "../data/prices.js";
import { MAX_AMOUNT, HOUSEHOLDS, monthOf, monthLabel, placeName, formCategories, firstMonth, readAmount, officialSpend, personal, series, peakMonth, reading, categoryReading, methodWarning, flagNotes, benchmarkRate, oneDecimal } from "./logic.js";

mount();

// What belongs in each row, in everyday words. Checked against the classes Eurostat lists under each division.
const HINTS = {
  CP01: "Groceries and soft drinks to have at home.",
  CP02: "Beer, wine and spirits bought in shops, and tobacco.",
  CP03: "Clothes and shoes, and having them cleaned or mended.",
  CP04: "Rent, repairs, water and refuse charges, electricity, gas and heating fuel. Leave out mortgage payments: the index does not count them.",
  CP05: "Furniture, appliances, kitchenware, tools, cleaning products and paid help at home.",
  CP06: "Medicines, glasses, dentists and doctors, as far as you pay for them yourself.",
  CP07: "Buying and running a car, motorbike or bicycle, fuel, parking, and bus, train and air fares.",
  CP08: "Phones, computers and televisions, phone and internet contracts, television licences and streaming.",
  CP09: "Package holidays, hobbies, toys, sport, pets, gardening, cinema and concerts, books and newspapers.",
  CP10: "School, university and course fees.",
  CP11: "Eating and drinking out, takeaways, canteens and hotels.",
  CP12: "Insurance premiums of every kind, and bank charges.",
  CP13: "Toiletries, hairdressing, jewellery and watches, childcare and care homes.",
};
const MINE = palette[0], THEIRS = "#8a94a3";
const cats = formCategories(PRICES);
const first = PRICES.countries[0];
const opening = HOUSEHOLDS[0];
const invented = (name) => `These amounts are an invented household, "${name}". They are an illustration, not survey data and not your own spending. Replace them with what you spend in a month.`;
// On load: an invented household in the first country of the list, for that country's latest month.
const state = { code: first.code, i: first.last, spend: [...opening.spend], errors: cats.map(() => ""), label: invented(opening.name) };
const country = () => PRICES.countries.find((c) => c.code === state.code);
const short = (i) => monthLabel(PRICES, i, true);

/* ---------- the form ---------- */
const countrySel = select({
  label: "Country whose prices to use", value: state.code,
  hint: "18 European countries, the euro area, the European Union and the United Kingdom. India is not included: Day 31 says why.",
  options: PRICES.countries.map((c) => ({ value: c.code, label: c.name })),
  onChange: (v) => { state.code = v; setMonth(state.i); },
});

const rows = cats.map((c, k) => {
  const id = `amount-${c.code}`;
  const input = el("input", { type: "number", id, min: 0, max: MAX_AMOUNT, step: "any", inputmode: "decimal", value: state.spend[k], "aria-describedby": `${id}-hint ${id}-err` });
  const err = el("div", { class: "amt-err", id: `${id}-err` });
  input.addEventListener("input", () => {
    const got = readAmount(input.value, input.validity.badInput);
    state.errors[k] = got.error ? `"${c.name}" ${got.error}.` : "";
    if (got.error) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    if (!got.error) state.spend[k] = got.value;
    state.label = "";
    update();
  });
  return { input, err, el: el("div", { class: "amt" }, el("label", { for: id, text: c.name }), input, el("div", { class: "hint", id: `${id}-hint`, text: HINTS[c.code] }), err) };
});

function fill(spend, label) {
  state.spend = [...spend];
  state.errors = cats.map(() => "");
  state.label = label;
  rows.forEach((r, k) => { r.input.value = String(spend[k]); r.input.removeAttribute("aria-invalid"); });
  update();
}
const presets = el("div", { class: "field", role: "group", "aria-label": "Example baskets" },
  el("div", { class: "lab" }, el("span", { text: "Example baskets" })),
  el("div", { class: "row" },
    HOUSEHOLDS.map((h) => button(h.name, () => fill(h.spend, invented(h.name)), { small: true })),
    button("Official basket", () => {
      const c = country();
      fill(officialSpend(PRICES, c, state.i), `These amounts are the official basket of ${placeName(c)} for ${monthOf(PRICES, state.i).year}, scaled to 2,000 a month. Replace them with what you spend in a month.`);
    }, { small: true }),
    button("Set every amount to 0", () => fill(cats.map(() => 0), ""), { small: true })),
  el("div", { class: "hint", text: "The four households are invented for this page. Their amounts do not come from a survey." }));

const monthSlider = slider({ label: "Compare prices over the 12 months to", min: firstMonth(), max: first.last, step: 1, value: state.i, format: short, onInput: (v) => setMonth(v) });
function stepButton(delta) {
  const b = button(delta < 0 ? "1 month earlier" : "1 month later", () => setMonth(state.i + delta), { small: true });
  b.setAttribute("aria-label", `12 months to: ${b.textContent}`);
  return b;
}
const steps = { down: stepButton(-1), up: stepButton(1) };
const monthRow = el("div", { class: "row steps" }, steps.down, steps.up,
  button("Latest month", () => setMonth(country().last), { small: true }),
  button("Peak of the surge", () => { const p = peakMonth(PRICES, country()); if (p >= 0) setMonth(p); }, { small: true }));
const vintage = el("p", { class: "small muted vintage" });

const controls = el("div", { class: "controls" },
  countrySel.el,
  el("h2", { text: "What you spend in a month" }),
  el("p", { class: "small muted", text: "Any one currency will do, because only the proportions matter. Leave a box at 0, or empty, for anything you do not buy: it is then left out of your basket. The amounts are read as how the budget was divided at the start of each 12 months. Nothing typed here is sent anywhere or saved." }),
  presets,
  el("div", { class: "amts" }, rows.map((r) => r.el)),
  monthSlider.el, monthRow,
  el("p", { class: "small muted", text: "The peak of the surge is the month with the highest official annual rate between January 2021 and December 2023." }),
  vintage);

/* ---------- outputs ---------- */
const sMine = stat("This basket");
const sOfficial = stat("Official rate");
const sGap = stat("Gap");
const sBench = stat("Official basket, priced this way");
// Said in the tool itself when the difference of method is large in the month chosen.
const caution = el("div");
const labelBox = el("div");
// The headline figures, kept in view while the form is filled in. Screen readers get the status line instead.
const strip = el("p", { class: "strip", "aria-hidden": "true" });
const message = el("div");
const words = el("p", { class: "reading" });
// Read out once typing or dragging has stopped, not on every keystroke.
const live = el("p", { class: "sr-only", role: "status" });
const announce = debounce((text) => { live.textContent = text; }, 700);
const chartBox = el("div");
const listHead = el("h2");
const legend = el("div", { class: "chart-legend" },
  el("span", {}, el("i", { style: { background: MINE } }), "What it adds to this basket's rate"),
  el("span", {}, el("i", { style: { background: THEIRS } }), "What it adds to the official rate"));
const list = el("ol", { class: "drivers", role: "list" });
const fine = el("div", { class: "small muted fine" });
const out = el("div", { class: "out" }, labelBox, el("div", { class: "stats" }, sMine.el, sOfficial.el, sGap.el, sBench.el), message, caution, words, live, chartBox, listHead, legend, list, fine);

$("#app").append(el("div", { class: "tool-grid wide-controls" }, strip, controls, out));
const plot = chart(chartBox, { series: [], height: 320 });

/* ---------- state ---------- */
function setMonth(i) {
  state.i = clamp(Math.round(i), firstMonth(), country().last);
  update();
}

// A month sits at its middle on an axis in years, so ticks on whole years fall between December and January.
const xOf = (i) => { const { year, month } = monthOf(PRICES, i); return year + (month - 0.5) / 12; };
const xLabel = (v) => {
  if (Number.isInteger(v)) return String(v);
  const year = Math.floor(v), month = clamp(Math.round((v - year) * 12 + 0.5), 1, 12);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${year}`;
};

function update() {
  const c = country();
  monthSlider.input.max = c.last;
  monthSlider.value = state.i;
  steps.down.setAttribute("aria-disabled", String(state.i <= firstMonth()));
  steps.up.setAttribute("aria-disabled", String(state.i >= c.last));
  const src = PRICES.sources[c.source];
  vintage.textContent = `Prices for ${placeName(c)} run to ${monthLabel(PRICES, c.last)}. Source: ${src.name}, as updated on ${fmt.date(src.updated)} and retrieved on ${fmt.date(PRICES.retrieved)}. ${src.licence}.`;
  rows.forEach((r, k) => {
    r.input.classList.toggle("invalid", Boolean(state.errors[k]));
    if (r.err.textContent !== state.errors[k]) r.err.textContent = state.errors[k];
  });
  labelBox.replaceChildren(...(state.label ? [note("warn", state.label)] : []));

  const problems = state.errors.filter(Boolean);
  const r = problems.length ? { error: `${problems.join(" ")} Correct ${problems.length === 1 ? "it" : "them"} in the form to see a result.` } : personal(PRICES, c, state.spend, state.i);
  const official = c.rate[state.i];
  const when = `12 months to ${short(state.i)}`;
  sOfficial.set(official == null ? "–" : `${fmt.signed(official, 1)}%`, `${placeName(c)}, ${when}`);
  const all = series(PRICES, c, r.error ? cats.map(() => 0) : state.spend);
  const lines = [
    { name: "Official rate", type: "line", color: "#16233b", width: 2, data: all.map((p) => [xOf(p.i), p.official]) },
    { name: "Official basket, priced this way", type: "line", color: THEIRS, width: 1.8, data: all.filter((p) => p.benchmark != null).map((p) => [xOf(p.i), p.benchmark]) },
  ];
  // The official basket priced the way this page prices any basket: what the method alone does in this month.
  const bench = benchmarkRate(PRICES, c, state.i);
  const year = monthOf(PRICES, state.i).year;
  if (bench == null) sBench.set("–", "a price is missing for this month");
  else {
    const shown = oneDecimal(bench), apart = official == null ? null : oneDecimal(shown - official);
    const against = apart == null ? "" : apart === 0 ? ": the same as the official rate to one decimal place" : `: ${fmt.num(Math.abs(apart), 1)} ${Math.abs(apart) === 1 ? "point" : "points"} ${apart > 0 ? "above" : "below"} the official rate by method alone`;
    sBench.set(`${fmt.signed(shown, 1)}%`, `${year} weights as one fixed basket${against}`);
  }

  if (r.error) {
    // An alert is read out when it appears, so it is only replaced when its words change.
    if (message.textContent !== r.error) message.replaceChildren(note(problems.length ? "bad" : "warn", r.error));
    sMine.set("–", "no basket to price");
    strip.textContent = problems.length ? "No result: an amount in the form needs correcting." : "No result: every amount is 0.";
    sGap.set("–", "");
    caution.replaceChildren();
    words.textContent = "";
    listHead.hidden = legend.hidden = true;
    list.replaceChildren();
    announce(problems.length ? "" : r.error);
  } else {
    message.replaceChildren();
    sMine.set(`${fmt.signed(r.shown, 1)}%`, when);
    if (r.gap == null) sGap.set("–", "no official rate for this month");
    else sGap.set(fmt.signed(r.gap, 1), r.gap === 0 ? "points: the same to one decimal place" : `${Math.abs(r.gap) === 1 ? "point" : "points"} ${r.gap > 0 ? "above" : "below"} the official rate`);
    strip.textContent = `This basket ${fmt.signed(r.shown, 1)}%, official rate ${official == null ? "not published" : `${fmt.signed(official, 1)}%`}, over the ${when}.`;
    const warning = methodWarning(PRICES, c, r);
    if (caution.textContent !== warning) caution.replaceChildren(...(warning ? [note("warn", warning)] : []));
    const sentences = reading(PRICES, c, r);
    words.textContent = sentences.join(" ");
    announce(sentences.join(" "));
    lines.push({ name: "This basket", type: "line", color: 0, width: 2.5, data: all.map((p) => [xOf(p.i), p.rate]) });

    // One row per category of the country's index, largest addition to this basket's rate first.
    const sorted = [...r.categories].sort((x, y) => y.points - x.points);
    const values = sorted.flatMap((k) => [k.points, k.officialPoints ?? 0]);
    const lo = Math.min(0, ...values), hi = Math.max(0, ...values), width = hi - lo || 1;
    const bar = (v, colour) => el("div", { class: "drv-track" },
      el("span", { class: "drv-fill", style: { left: `${((Math.min(v, 0) - lo) / width) * 100}%`, width: `${(Math.abs(v) / width) * 100}%`, background: colour } }),
      el("i", { style: { left: `${(-lo / width) * 100}%` } }));
    listHead.hidden = legend.hidden = false;
    listHead.textContent = `Category by category, over the ${when.replace(short(state.i), monthLabel(PRICES, state.i))}`;
    list.replaceChildren(...sorted.map((k) => el("li", {},
      el("div", { class: "drv-top" }, el("span", { class: "drv-name", text: k.name }), el("strong", { class: "drv-pts", text: k.share > 0 ? `${fmt.signed(k.points, 2)} points` : "not in this basket" })),
      el("div", { "aria-hidden": "true" }, bar(k.points, MINE), k.officialPoints == null ? null : bar(k.officialPoints, THEIRS)),
      el("p", { class: "small muted", text: categoryReading(k) }))));
  }

  fine.replaceChildren(...[
    c.scheme === "ecoicop2" ? null : `The UK's index has 12 categories, not 13. The form's last two rows are added together and priced with the UK's "Miscellaneous goods and services". The UK index also counts computers and televisions under recreation and culture, not communication.`,
    "The official figure for each category is its contribution to the official rate. Each figure is rounded, so a column can differ from its total by a hundredth or two.",
    ...(r.error ? [] : flagNotes(PRICES, r.flagged, c.index.length)),
  ].filter(Boolean).map((line) => el("p", { text: line })));

  plot.update({
    title: `This basket and the official rate in ${placeName(c)}`,
    subtitle: "The rate in each month is the change in prices over the 12 months before it, with the same budget shares throughout. The grey line is the official basket of each year priced the way this page prices a basket: where it leaves the official rate, the difference is method, not spending. The dashed line marks the month chosen.",
    label: `Line chart of the 12-month rate of price change for this basket, the official rate in ${placeName(c)} and the official basket priced as a fixed basket, by month`,
    x: { label: "Month", format: xLabel },
    y: { label: "Per cent a year", format: (v) => fmt.num(v, 1) },
    series: lines,
    marks: [{ type: "vline", x: xOf(state.i), text: short(state.i) }],
  });
}

update();
