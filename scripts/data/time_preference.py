"""Build 365projects/76/data.js: US Treasury nominal and real (TIPS) yield curves, and US real consumption per
person, for project 76 (Time Preference from Bond Yields).

    python scripts/data/time_preference.py [--cache DIR]

One nominal and one real zero-coupon yield curve for the last trading day of every month from January 1999 to
the last complete month, plus the latest day published. Each curve is stored as the six parameters of the
Svensson (1994) function that the Federal Reserve Board's staff fit to Treasury prices that day; the page computes
yields, discount factors and forward rates from them with the published formulas. Alongside them, real personal
consumption expenditures per person each year from 1929, from which the page takes the growth rate and its
spread that the Ramsey equation needs.

Sources (downloaded into --cache, never committed):

  1. Federal Reserve Board, "The U.S. Treasury Yield Curve: 1961 to the Present" (staff estimates after
     Gurkaynak, Sack and Wright 2007), https://www.federalreserve.gov/data/yield-curve-tables/feds200628.csv
     Daily Svensson parameters BETA0 to BETA3, TAU1, TAU2 and the implied zero-coupon yields (continuously
     compounded, SVENY01 to SVENY30), instantaneous forward rates (SVENF01 to SVENF30) and par yields
     (coupon-equivalent, SVENPY01 to SVENPY30), in percent. The page that serves it
     (https://www.federalreserve.gov/data/nominal-yield-curve.htm, read 14 October 2026) says the curve is
     fitted to off-the-run Treasury notes and bonds: "Treasury bills and Treasury floating rate notes (FRNs) are
     not used", nor are on-the-run and first-off-the-run issues.
  2. Federal Reserve Board, "The TIPS Yield Curve and Inflation Compensation" (staff estimates after Gurkaynak,
     Sack and Wright 2010), https://www.federalreserve.gov/data/yield-curve-tables/feds200805.csv
     The same parameters for Treasury Inflation-Protected Securities, real zero-coupon yields TIPSY02 to
     TIPSY20 and forwards TIPSF02 to TIPSF20, and inflation compensation (BKEVEN, nominal minus real).
     Both files open with the note: "This is not an official Federal Reserve statistical release. Because this
     is a staff research product and not an official statistical release, it is subject to delay, revision, or
     methodological changes without advance notice." The TIPS file adds that breakeven rates "incorporate
     inflation risk premiums and the effects of the differential liquidity of TIPS and nominal securities.
     Consequently breakeven rates should not be interpreted as estimates of inflation expectations."
  Terms, from https://www.federalreserve.gov/disclaimer.htm (read 14 October 2026): "Unless otherwise
  indicated, information on Board's website is in the public domain and may be copied and distributed without
  permission. Please cite to the Board as the source of the information." Neither page nor file marks the data
  as anyone else's.
  3. US Bureau of Economic Analysis, National Income and Product Accounts, annual flat file
     https://apps.bea.gov/national/Release/TXT/NipaDataA.txt (file dated 30 September 2026), series A794RX:
     NIPA Table 7.1, "Selected Per Capita Product and Income Series in Current and Chained Dollars", line 13,
     personal consumption expenditures per capita in chained (2017) dollars (SeriesRegister.txt names the line).
     Terms, from https://www.bea.gov/help/faq/145 (read 14 October 2026): "Unless stated otherwise, the
     information posted on the BEA web site is in the public domain and may be used or reproduced without
     specific permission."

Cleaning rules:

  * A month's date is the last day in that month on which both files have all six parameters and every
    published zero-coupon yield (1 to 30 years nominal, 2 to 20 years real). The latest day in the files is
    added when it falls after the last complete month.
  * Where the Board fitted the four-parameter Nelson-Siegel curve (the TIPS curve from 1999 to 2003), it marks
    BETA3 and TAU2 as missing. Those dates are stored with BETA3 = 0 and TAU2 = null, which is the same curve.
  * Every chosen date is checked: the yields and instantaneous forward rates computed from the parameters must
    match every published zero-coupon yield and forward rate within 0.00006 percentage points (the files round
    to four decimals). The script stops otherwise. (Across all 16,296 nominal days with parameters in the file
    of 13 October 2026, 14 days between 2002 and 2018 miss by more than that, by up to 0.0016 points; none is
    a month-end. Counted again in review on 14 October 2026.)
  * Parameters are rounded to 12 significant figures, enough to reproduce the four published decimals even
    when two large parameters nearly cancel.
  * Consumption per person is stored as published (whole chained 2017 dollars), every year from 1929 to the
    latest; the script stops if a year is missing or the series register no longer names line 13 of Table 7.1.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "76" / "data.js"
UA = {"User-Agent": "365projects-data-script/1.0"}
RETRIEVED = "2026-10-14"
FIRST_MONTH = "1999-01"
NOMINAL_URL = "https://www.federalreserve.gov/data/yield-curve-tables/feds200628.csv"
REAL_URL = "https://www.federalreserve.gov/data/yield-curve-tables/feds200805.csv"
BEA_DATA = "https://apps.bea.gov/national/Release/TXT/NipaDataA.txt"
BEA_REGISTER = "https://apps.bea.gov/national/Release/TXT/SeriesRegister.txt"
BEA_SERIES = "A794RX"
PARAMS = ("BETA0", "BETA1", "BETA2", "BETA3", "TAU1", "TAU2")
CURVES = {"nominal": ("SVEN", 1, 30), "real": ("TIPS", 2, 20)}  # prefix, shortest and longest maturity
TOL = 6e-5


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
            path.write_bytes(r.read())
    return path


def load(path: Path) -> dict[str, dict[str, str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("Date,"))
    rows = list(csv.reader(lines[start:]))
    head = rows[0]
    out = {}
    for r in rows[1:]:
        if len(r) != len(head):
            raise SystemExit(f"{path.name}: a row has {len(r)} fields, the header {len(head)}")
        out[r[0]] = dict(zip(head, r))
    return out


def number(text: str | None) -> float | None:
    try:
        v = float(text)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) or v == -999.99 else v


def zero_yield(p: list, n: float) -> float:
    b0, b1, b2, b3, t1, t2 = p
    x1 = n / t1
    e1 = math.exp(-x1)
    y = b0 + b1 * (1 - e1) / x1 + b2 * ((1 - e1) / x1 - e1)
    if b3:
        x2 = n / t2
        y += b3 * ((1 - math.exp(-x2)) / x2 - math.exp(-x2))
    return y


def forward(p: list, n: float) -> float:
    b0, b1, b2, b3, t1, t2 = p
    f = b0 + b1 * math.exp(-n / t1) + b2 * (n / t1) * math.exp(-n / t1)
    return f + (b3 * (n / t2) * math.exp(-n / t2) if b3 else 0)


def parameters(row: dict[str, str]) -> list | None:
    """The six parameters, or None. A Nelson-Siegel day (BETA3 and TAU2 missing) becomes BETA3 = 0, TAU2 = None."""
    p = [number(row.get(k)) for k in PARAMS]
    if any(v is None for v in p[:3]) or p[4] is None:
        return None
    if p[3] is None and p[5] is None:
        p[3] = 0.0
    elif p[3] is None or p[5] is None:
        return None
    return [None if v is None else float(f"{v:.12g}") for v in p]


def complete(row: dict[str, str], prefix: str, lo: int, hi: int) -> bool:
    return parameters(row) is not None and all(
        number(row.get(f"{prefix}Y{m:02d}")) is not None for m in range(lo, hi + 1))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="curves_"))
    cache.mkdir(parents=True, exist_ok=True)

    files = {"nominal": load(fetch(NOMINAL_URL, cache / "feds200628.csv")),
             "real": load(fetch(REAL_URL, cache / "feds200805.csv"))}
    usable = sorted(d for d in files["nominal"] if d >= FIRST_MONTH and d in files["real"]
                    and all(complete(files[c][d], *CURVES[c]) for c in CURVES))
    latest = usable[-1]
    by_month: dict[str, str] = {}
    for d in usable:
        by_month[d[:7]] = d  # sorted, so the last day of each month wins
    # The month still in progress (October 2026 when this was run) is represented by its latest day.
    dates = [by_month[m] for m in sorted(by_month)]
    if dates[-1] != latest:
        raise SystemExit("latest day is not the last date")

    worst = 0.0
    curves = {}
    for c, (prefix, lo, hi) in CURVES.items():
        params = []
        for d in dates:
            row = files[c][d]
            p = parameters(row)
            for m in range(lo, hi + 1):
                for name, fn in ((f"{prefix}Y{m:02d}", zero_yield), (f"{prefix}F{m:02d}", forward)):
                    pub = number(row.get(name))
                    if pub is None:
                        continue
                    miss = abs(fn(p, m) - pub)
                    worst = max(worst, miss)
                    if miss > TOL:
                        raise SystemExit(f"{c} {d} {name}: computed {fn(p, m):.6f}, published {pub}")
            params.append(p)
        curves[c] = {"shortest": lo, "longest": hi, "params": params}

    register = fetch(BEA_REGISTER, cache / "SeriesRegister.txt").read_text(encoding="utf-8-sig")
    entry = next((line for line in register.splitlines() if line.startswith(BEA_SERIES + ",")), "")
    if '"Personal consumption expenditures"' not in entry or "T70100:13" not in entry:
        raise SystemExit(f"BEA series register no longer describes {BEA_SERIES} as Table 7.1 line 13: {entry!r}")
    values: dict[int, int] = {}
    with open(fetch(BEA_DATA, cache / "NipaDataA.txt"), encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if row and row[0] == BEA_SERIES:
                values[int(row[1])] = int(row[2].replace(",", ""))
    years = sorted(values)
    if years[0] != 1929 or years != list(range(years[0], years[-1] + 1)):
        raise SystemExit(f"BEA {BEA_SERIES}: years {years[0]} to {years[-1]} with gaps or a new start")
    consumption = {"series": BEA_SERIES, "first": years[0], "values": [values[y] for y in years],
                   "unit": "Chained (2017) dollars per person",
                   "name": "Real personal consumption expenditures per capita (NIPA Table 7.1, line 13)",
                   "source": "US Bureau of Economic Analysis, National Income and Product Accounts",
                   "file": BEA_DATA, "terms": "Public domain unless stated otherwise (bea.gov/help/faq/145)."}

    data = {
        "retrieved": RETRIEVED,
        "latest": latest,
        "dates": dates,
        "units": "Parameters of the Svensson curve: yields in percent a year, continuously compounded; TAU1 and TAU2 in years.",
        "sources": {
            "nominal": {"name": "Federal Reserve Board, The U.S. Treasury Yield Curve: 1961 to the Present (staff estimates, Gurkaynak, Sack and Wright 2007)",
                        "url": "https://www.federalreserve.gov/data/nominal-yield-curve.htm", "file": NOMINAL_URL},
            "real": {"name": "Federal Reserve Board, The TIPS Yield Curve and Inflation Compensation (staff estimates, Gurkaynak, Sack and Wright 2010)",
                     "url": "https://www.federalreserve.gov/data/tips-yield-curve-and-inflation-compensation.htm", "file": REAL_URL},
            "terms": "Public domain unless otherwise indicated; cite the Board as the source (federalreserve.gov/disclaimer.htm).",
        },
        "nominal": curves["nominal"],
        "real": curves["real"],
        "consumption": consumption,
    }
    text = ("// Generated by scripts/data/time_preference.py. Do not edit by hand.\n"
            "// US Treasury zero-coupon yield curves, nominal and real (TIPS), as Svensson parameters [b0, b1, b2, b3, tau1, tau2]\n"
            f"// fitted by Federal Reserve Board staff. Public domain. Retrieved {RETRIEVED}. One curve per month-end from January 1999,\n"
            "// plus the latest day: dates[i] goes with nominal.params[i] and real.params[i]. b3 = 0 and tau2 = null mark a\n"
            "// Nelson-Siegel curve (the TIPS curve before 2004). consumption.values[i] is US real consumption per person\n"
            f"// (BEA, chained 2017 dollars, public domain) in the year consumption.first + i.\n"
            f"export const CURVES = {json.dumps(data, separators=(',', ':'))};\n")
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT} ({len(text) / 1024:.0f} KB): {len(dates)} dates, {dates[0]} to {dates[-1]}; "
          f"largest gap to a published figure {worst:.6f} points; consumption {years[0]} to {years[-1]}")


if __name__ == "__main__":
    main()
