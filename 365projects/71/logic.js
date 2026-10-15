// Day 71: News and Markets Event Study. The model, with no DOM code.
// The market-model event study of MacKinlay (1997), applied to daily exchange rates: fit a currency's daily return on
// the return of a basket of other currencies over an estimation window, then measure what the fit cannot explain in
// the days around a dated event, with the standard errors that allow for the estimation error.

import { stats } from "../kit/kit.js";

/* ------------------------------------------------------------------ the events
   day0 is the first New York noon rate that could carry the news: the news date if it was public before 12:00 in
   New York, otherwise the next New York business day. Dates were checked against the sources named; a time that the
   source does not give is marked as coming from press reports. exclude: basket currencies left out by default, with
   the reason in the note (a currency tied to the one studied, or one with news of its own in the window). */

export const EVENTS = [
  { id: "gbp1992", code: "GBP", day0: "1992-09-16", win: [0, 1], title: "Sterling leaves the European Exchange Rate Mechanism", when: "16 September 1992",
    note: "The Bank of England raised its rate at 11:00 and 14:15 London time, before noon in New York, so day 0 holds the defence. The suspension came at about 19:30 London time and shows on day +1.",
    source: "Bank of England, \"Operation of monetary policy\", Quarterly Bulletin, November 1992", url: "https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/1992/operation-of-monetary-policy-qb-1992-q4.pdf" },
  { id: "mxn1994", code: "MXN", day0: "1994-12-20", win: [0, 2], title: "Mexico raises the ceiling of the peso's band", when: "20 December 1994, about 09:30 New York time",
    note: "The ceiling of the band was raised by 15%, announced at about 09:30 New York time, as the Federal Open Market Committee heard during its meeting that day. Two days later, on 22 December (day +2), the peso was left to float.",
    source: "Transcript of the Federal Open Market Committee meeting of 20 December 1994 (the time); the float two days later from the address of the IMF's Managing Director, Michel Camdessus, of 22 May 1995", url: "https://www.federalreserve.gov/monetarypolicy/files/fomc19941220meeting.pdf" },
  { id: "thb1997", code: "THB", day0: "1997-07-02", win: [0, 1], title: "Thailand floats the baht", when: "2 July 1997",
    note: "The managed float took effect on 2 July in Bangkok, eleven hours ahead of New York, so it was known before the New York noon rate of the same date.",
    source: "International Monetary Fund, \"IMF Welcomes Thailand's Exchange Rate Action\", News Brief, 2 July 1997", url: "https://www.imf.org/en/news/articles/2015/09/29/18/03/nb9712" },
  { id: "cny2005", code: "CNY", day0: "2005-07-21", win: [0, 1], title: "China reforms the yuan's exchange-rate regime", when: "21 July 2005, 19:00 Beijing time",
    note: "Announced at 07:00 New York time, after the onshore market had closed. The new rate of 8.11 yuan to the dollar became the next day's central parity, so the move shows on day +1: the noon rate was still 8.2765 on 21 July and 8.1111 on 22 July.",
    source: "People's Bank of China, Announcement [2005] No. 16, published by the State Administration of Foreign Exchange", url: "https://www.safe.gov.cn/safe/2005/0721/24199.html" },
  { id: "chf2011", code: "CHF", day0: "2011-09-06", win: [0, 1], title: "The Swiss National Bank sets a floor of 1.20 francs per euro", when: "6 September 2011, morning in Zurich",
    note: "Announced in the European morning, before noon in New York (the time is from press reports; the press release gives none).",
    source: "Swiss National Bank, \"Swiss National Bank sets minimum exchange rate at CHF 1.20 per euro\", press release, 6 September 2011", url: "https://www.snb.ch/en/publications/communication/press-releases/2011/pre_20110906" },
  { id: "eur2012", code: "EUR", day0: "2012-07-26", win: [0, 1], title: "Draghi: \"whatever it takes\"", when: "26 July 2012, in London",
    note: "Mario Draghi spoke at the Global Investment Conference in London during the London day, before noon in New York (the time is from press reports; the ECB's transcript gives none). The franc is left out of the basket as well as the krone: from September 2011 the Swiss National Bank held it at 1.20 per euro, so it moved with the euro.",
    exclude: ["CHF"],
    source: "European Central Bank, speech by Mario Draghi at the Global Investment Conference in London, 26 July 2012", url: "https://www.ecb.europa.eu/press/key/date/2012/html/sp120726.en.html" },
  { id: "jpy2014", code: "JPY", day0: "2014-10-31", win: [0, 1], title: "The Bank of Japan expands its asset purchases", when: "31 October 2014, early afternoon in Tokyo",
    note: "The Policy Board's meeting ended at 13:39 Tokyo time, 00:39 in New York on the same date, and the decision was released minutes later.",
    source: "Bank of Japan, \"Expansion of the Quantitative and Qualitative Monetary Easing\", 31 October 2014", url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2014/k141031a.pdf" },
  { id: "chf2015", code: "CHF", day0: "2015-01-15", win: [0, 1], title: "The Swiss National Bank drops the floor", when: "15 January 2015, morning in Zurich",
    note: "Announced in the European morning, hours before noon in New York (the time is from press reports; the press release gives none).",
    source: "Swiss National Bank, \"Swiss National Bank discontinues minimum exchange rate and lowers interest rate to -0.75%\", press release, 15 January 2015", url: "https://www.snb.ch/en/publications/communication/press-releases/2015/pre_20150115" },
  { id: "eur2015", code: "EUR", day0: "2015-01-22", win: [0, 1], title: "The ECB announces large-scale purchases of government bonds", when: "22 January 2015, afternoon in Frankfurt",
    note: "Announced at the press conference in the Frankfurt afternoon, the New York morning (the time is from press reports). The franc is left out of the basket: until a week before, the Swiss National Bank had held it at 1.20 per euro, so in the estimation window it moved with the euro.",
    exclude: ["CHF"],
    source: "European Central Bank, \"ECB announces expanded asset purchase programme\", press release, 22 January 2015", url: "https://www.ecb.europa.eu/press/pr/date/2015/html/pr150122_1.en.html" },
  { id: "cny2015", code: "CNY", day0: "2015-08-11", win: [0, 2], title: "China changes how the yuan's central rate is set", when: "11 August 2015, Beijing morning",
    note: "Effective from 11 August for the central rate set before the onshore market opened, the evening before in New York. The yuan kept falling for two more days.",
    source: "People's Bank of China, \"The PBC Announcement on Improving Quotation of the Central Parity of RMB against US Dollar\", 11 August 2015", url: "https://www.pbc.gov.cn/english/130721/2025080815064585842/index.html" },
  { id: "zar2015", code: "ZAR", day0: "2015-12-10", win: [0, 1], title: "South Africa's finance minister is replaced", when: "9 December 2015, evening in Pretoria",
    note: "Announced on the evening of 9 December, about 20:00 South African time by press reports, an hour after noon in New York, so day 0 is 10 December. The timing is close: a window from day −1 covers both readings.",
    source: "The Presidency of South Africa, \"President Jacob Zuma appoints new Finance Minister\", 9 December 2015", url: "https://www.gov.za/speeches/president-jacob-zuma-appoints-new-finance-minister-9-dec-2015-0000" },
  { id: "jpy2016", code: "JPY", day0: "2016-01-29", win: [0, 1], title: "The Bank of Japan introduces a negative interest rate", when: "29 January 2016, lunchtime in Tokyo",
    note: "The Policy Board's meeting ended at 12:31 Tokyo time, 22:31 in New York on 28 January, and the decision was released minutes later.",
    source: "Bank of Japan, \"Introduction of 'Quantitative and Qualitative Monetary Easing with a Negative Interest Rate'\", 29 January 2016", url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2016/k160129a.pdf" },
  { id: "gbp2016", code: "GBP", day0: "2016-06-24", win: [0, 1], title: "The United Kingdom votes to leave the European Union", when: "Vote on 23 June 2016; result declared at 07:20 London time on 24 June",
    note: "The count ran overnight, after noon in New York on 23 June.",
    source: "Electoral Commission, \"The 2016 EU referendum: report on the 23 June 2016 referendum on the UK's membership of the European Union\", September 2016", url: "https://www.electoralcommission.org.uk/sites/default/files/pdf_file/2016-EU-referendum-report.pdf" },
  { id: "mxn2016", code: "MXN", day0: "2016-11-09", win: [0, 1], title: "The United States elects Donald Trump", when: "Vote on 8 November 2016; result clear early on 9 November",
    note: "The count ran overnight, after noon in New York on 8 November.",
    source: "Federal Election Commission, \"Federal Elections 2016\"", url: "https://www.fec.gov/resources/cms-content/documents/federalelections2016.pdf" },
  { id: "jpy2022", code: "JPY", day0: "2022-09-22", win: [0, 0], title: "Japan's Ministry of Finance buys yen", when: "22 September 2022, about 17:00 Tokyo time",
    note: "About 04:00 New York time (the time is from press reports; the Ministry's record gives the date and the amount, 2.8 trillion yen). The Bank of Japan left its policy unchanged earlier the same day, so two pieces of news share day 0. The window is day 0 alone: day +1 is the day of the UK's Growth Plan, when the pound, a basket currency, fell 3% against the dollar for reasons of its own.",
    source: "Ministry of Finance, Japan, \"Foreign Exchange Intervention Operations\", row for 22 September 2022", url: "https://www.mof.go.jp/english/policy/international_policy/reference/feio/foreign_exchange_intervention_operations.csv" },
  { id: "gbp2022", code: "GBP", day0: "2022-09-23", win: [0, 1], title: "The UK government's \"Growth Plan 2022\"", when: "23 September 2022, London morning",
    note: "Presented to Parliament in the London morning, before noon in New York (the time is from press reports).",
    source: "HM Treasury, \"The Growth Plan 2022: documents\", 23 September 2022", url: "https://www.gov.uk/government/publications/the-growth-plan-2022-documents" },
  { id: "jpy2024", code: "JPY", day0: "2024-03-19", win: [0, 1], title: "The Bank of Japan ends negative interest rates", when: "19 March 2024, lunchtime in Tokyo",
    note: "The Policy Board's meeting ended at 12:28 Tokyo time, 23:28 in New York on 18 March, and the decision was released minutes later.",
    source: "Bank of Japan, \"Changes in the Monetary Policy Framework\", 19 March 2024", url: "https://www.boj.or.jp/en/mopo/mpmdeci/state_2024/k240319a.htm" },
];

/* ------------------------------------------------------------------ the data */

/** Decode the bundled calendar and rates: { dates: [...], series: { CODE: Float64Array of US dollars per unit, NaN where no rate } }. */
export function decode(FX) {
  const dates = [FX.firstDate];
  let t = Date.parse(FX.firstDate + "T00:00:00Z");
  for (const g of FX.gaps) { t += g * 86400000; dates.push(new Date(t).toISOString().slice(0, 10)); }
  const series = {};
  const meta = {};
  for (const c of FX.currencies) {
    const v = new Float64Array(dates.length).fill(NaN);
    let acc = null;
    c.values.forEach((d, k) => {
      if (d == null) return;
      acc = acc == null ? d : acc + d;
      const quoted = acc / 10 ** c.scale;
      v[c.first + k] = c.usdPerUnit ? quoted : 1 / quoted;
    });
    series[c.code] = v;
    meta[c.code] = { code: c.code, name: c.name, basket: c.basket, usdPerUnit: c.usdPerUnit, first: dates[c.first] };
  }
  return { dates, series, meta };
}

/** Currencies always left out of the basket when studying a given currency: itself, and one pegged to it throughout. */
export const LINKED = { EUR: ["DKK"], DKK: ["EUR"] };
/** Spells when a basket currency was held to another one: the event study warns if one overlaps the estimation window. */
export const PEGS = [
  { code: "EUR", member: "CHF", from: "2011-09-06", to: "2015-01-14", why: "the Swiss National Bank held the franc at 1.20 per euro from 6 September 2011 to 15 January 2015" },
];

/**
 * Daily log returns of a currency against the dollar (positive: the currency gained) and of the equal-weighted basket
 * of the other basket currencies, on the days the currency has a rate. A basket member enters a day's average only if it
 * has a rate on that day and on the currency's previous rate day. Returns [{ i (calendar index), date, r, m, k }].
 */
export function returns(D, code, exclude = []) {
  const own = D.series[code];
  if (!own) return [];
  const others = basketOf(D, code, exclude).map((c) => D.series[c]);
  if (!others.length) return [];
  const out = [];
  let prev = -1;
  for (let i = 0; i < own.length; i++) {
    if (!Number.isFinite(own[i])) continue;
    if (prev >= 0) {
      let s = 0, k = 0;
      for (const o of others) if (Number.isFinite(o[i]) && Number.isFinite(o[prev])) { s += Math.log(o[i] / o[prev]); k++; }
      if (k * 2 >= others.length) out.push({ i, date: D.dates[i], r: Math.log(own[i] / own[prev]), m: s / k, k, of: others.length });
    }
    prev = i;
  }
  return out;
}

/** The basket currencies used when studying `code`: every basket member except itself, one linked to it, and `exclude`. */
export function basketOf(D, code, exclude = []) {
  return Object.values(D.meta).filter((c) => c.basket && c.code !== code && !(LINKED[code] || []).includes(c.code) && !exclude.includes(c.code)).map((c) => c.code);
}

/* ------------------------------------------------------------------ Student's t */

/** Continued fraction for the regularised incomplete beta function (Numerical Recipes, betacf). */
function betacf(a, b, x) {
  const EPS = 1e-15, FPMIN = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
export function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(stats.logGamma(a + b) - stats.logGamma(a) - stats.logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(a, b, x)) / a : 1 - (front * betacf(b, a, 1 - x)) / b;
}
/** Two-sided p-value of a t statistic with df degrees of freedom. */
export function tTwoSided(t, df) {
  if (!Number.isFinite(t)) return t === Infinity || t === -Infinity ? 0 : NaN;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/* ------------------------------------------------------------------ the event study */

export const LIMITS = { estMin: 30, estMax: 1000, winMin: -30, winMax: 30 };

/**
 * Run the event study. event: { code, date }. est: estimation window length L1 in trading days. win: [tau1, tau2] in
 * trading days relative to the event day (day 0: the first day with a rate on or after the event date).
 * The estimation window is the L1 trading days just before tau1.
 */
export function eventStudy(D, { code, date, est = 250, win = [-5, 5], exclude = [] }) {
  const [t1, t2] = win;
  if (!D.series[code]) return { error: `There is no ${code} series in the data.` };
  const basket = basketOf(D, code, exclude);
  if (!basket.length) return { error: "The basket is empty. Tick at least one other currency: the market model needs a market to compare with." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return { error: "Give the event date as a day, month and year." };
  if (!Number.isInteger(est) || est < LIMITS.estMin || est > LIMITS.estMax) return { error: `The estimation window must be a whole number of days from ${LIMITS.estMin} to ${LIMITS.estMax}.` };
  if (!Number.isInteger(t1) || !Number.isInteger(t2) || t1 > t2 || t1 < LIMITS.winMin || t2 > LIMITS.winMax) return { error: `The event window must run from a first day to a last day no earlier, between ${LIMITS.winMin} and +${LIMITS.winMax}.` };
  const R = returns(D, code, exclude);
  const zero = R.findIndex((x) => x.date >= date);
  const name = D.meta[code].name;
  if (zero < 0) return { error: `${date} is after the last rate in the data (${R.at(-1)?.date}).` };
  const past = zero + t2 - R.length + 1;
  if (past > 0) return { error: `The event window runs ${past} trading ${past === 1 ? "day" : "days"} past the last rate in the data (${R.at(-1).date}). End it earlier.` };
  const e0 = zero + t1 - est;
  if (e0 < 0) return { error: `The ${name} has ${zero + t1 > 0 ? `only ${zero + t1}` : "no"} trading days of returns in the data before the event window, and the estimation window asks for ${est}. Shorten the estimation window or choose a later event.` };
  const E = R.slice(e0, zero + t1);
  const W = R.slice(zero + t1, zero + t2 + 1);

  // Market model by least squares.
  const x = E.map((d) => d.m), y = E.map((d) => d.r);
  const L1 = E.length;
  const mx = stats.mean(x), my = stats.mean(y);
  let sxx = 0, sxy = 0;
  for (let k = 0; k < L1; k++) { sxx += (x[k] - mx) ** 2; sxy += (x[k] - mx) * (y[k] - my); }
  if (!(sxx > 0)) return { error: "The basket did not move in the estimation window, so the market model cannot be fitted." };
  const beta = sxy / sxx, alpha = my - beta * mx;
  const resid = y.map((v, k) => v - alpha - beta * x[k]);
  const df = L1 - 2;
  const s2 = resid.reduce((s, e) => s + e * e, 0) / df;
  const r2 = 1 - resid.reduce((s, e) => s + e * e, 0) / y.reduce((s, v) => s + (v - my) ** 2, 0);

  // Abnormal returns and their variance given the estimation error (MacKinlay 1997, equations 7 to 11).
  const days = W.map((d, k) => {
    const ar = d.r - alpha - beta * d.m;
    const v = s2 * (1 + 1 / L1 + (d.m - mx) ** 2 / sxx);
    const t = ar / Math.sqrt(v);
    return { tau: t1 + k, date: d.date, r: d.r, m: d.m, normal: alpha + beta * d.m, ar, se: Math.sqrt(v), t, p: tTwoSided(t, df) };
  });
  let car = 0, cm = 0;
  const path = days.map((d, k) => {
    car += d.ar; cm += d.m;
    const n = k + 1;
    return { tau: d.tau, car, se: Math.sqrt(s2 * (n + (n * n) / L1 + (cm - n * mx) ** 2 / sxx)) };
  });
  const L2 = W.length;
  const sumM = W.reduce((s, d) => s + d.m, 0);
  const varCar = s2 * (L2 + (L2 * L2) / L1 + (sumM - L2 * mx) ** 2 / sxx);
  const scar = car / Math.sqrt(varCar);
  const p = tTwoSided(scar, df);

  // A check that needs no normal tails: windows of the same length inside the estimation period.
  const sums = [];
  for (let k = 0; k + L2 <= L1; k++) { let s = 0; for (let j = k; j < k + L2; j++) s += resid[j]; sums.push(s); }
  const asBig = sums.filter((s) => Math.abs(s) >= Math.abs(car)).length;

  return {
    code, name, date, eventDay: R[zero].date, est: { from: E[0].date, to: E.at(-1).date, n: L1 }, win: [t1, t2],
    alpha, beta, r2, sigma: Math.sqrt(s2), df, days, path, car, seCar: Math.sqrt(varCar), scar, p,
    raw: W.reduce((s, d) => s + d.r, 0), market: sumM, empirical: { windows: sums.length, asBig, p: (asBig + 1) / (sums.length + 1) },
    basketSize: Math.min(...E.map((d) => d.k)), basketFull: E[0].of, basket, estimation: E.map((d, k) => ({ date: d.date, m: d.m, r: d.r, e: resid[k] })),
    tied: PEGS.filter((g) => g.code === code && basket.includes(g.member) && g.from <= E.at(-1).date && g.to >= E[0].date),
    pegged: Math.sqrt(s2) < 0.0005,
  };
}

/** Plain words for a two-sided p-value. */
export function verdict(p) {
  if (!Number.isFinite(p)) return "";
  if (p < 0.01) return "significant at the 1% level";
  if (p < 0.05) return "significant at the 5% level";
  if (p < 0.1) return "significant at the 10% level only";
  return "not significant at the 10% level";
}
