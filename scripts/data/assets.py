"""Build 365projects/data/assets.js, the monthly asset returns shared by projects 63, 64 and 65.

    python scripts/data/assets.py [--cache DIR]

Eleven assets for an investor who counts in US dollars: US Treasury bills, Treasury notes and bonds at four
constant maturities, and cash deposits in six foreign currencies. One return per asset per month, February 1999
to September 2026, nominal, in US dollars. Every return is computed here from published yields, exchange rates
and interest rates by the rules below; none is the return of a fund or an index that anyone publishes.

Why these assets and not shares or commodities: every share index (S&P 500, MSCI, FTSE, DAX and the rest) is the
property of the firm that calculates it, and official sites that republish them pass the owners' restrictions on
(FRED's notes to its S&P 500 series, read 14 October 2026: "Reproduction of S&P 500 in any form is prohibited
except with the prior written permission of S&P Dow Jones Indices LLC"). The open commodity prices (the World
Bank's Pink Sheet, CC BY 4.0) are monthly averages, and returns between monthly averages are smoothed and
autocorrelated by construction, which would fake momentum on page 63. Treasury yields and exchange rates are
published daily by the US government, so month-end values exist and are in the public domain.

Sources (downloaded into --cache, never committed):

  1. Federal Reserve Board, H.15 Selected Interest Rates, full release from the Data Download Program,
     https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&filetype=zip
     Daily market yields on US Treasury securities at constant maturity (3 months, 2, 5, 10 and 20 years),
     "quoted on investment basis", which the Board takes from the US Department of the Treasury.
  2. Federal Reserve Board, H.10 Foreign Exchange Rates, full release,
     https://www.federalreserve.gov/datadownload/Output.aspx?rel=H10&filetype=zip
     Daily noon buying rates in New York for cable transfers payable in the listed currencies (H.10 "About").
     Terms for 1 and 2, from https://www.federalreserve.gov/disclaimer.htm (read 14 October 2026): "Unless
     otherwise indicated, information on Board's website is in the public domain and may be copied and
     distributed without permission. Please cite to the Board as the source of the information." Neither
     release marks these series as anyone else's. The download file itself says (October 2026) that the Data
     Download Program is being retired; if the address stops working, the same daily series are on the H.15
     and H.10 release pages and the Treasury's yield curve pages.
  3. Bank for International Settlements, central bank policy rates (dataflow WS_CBPOL), monthly, end of
     period, https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/
     Terms of permitted use of BIS statistics (https://data.bis.org/help/legal, read 14 October 2026): use is
     unrestricted "provided that: if the statistics are reproduced, the BIS must be cited in your publication
     or product as the source of the statistics", the use is not misleading or implies no endorsement, a
     commercial product adds no charge for them, and "nothing in these statistics shall be construed as
     containing any investment recommendation or advice". Not a Creative Commons licence. Each country's
     series is compiled by the BIS from the central bank's own announcements.

Cleaning and construction rules:

  * Month-end value: the last daily observation in the month with status "A" (a missing day is "ND" and is
    skipped). Policy rates are BIS end-of-period values.
  * Treasury bills: the return in month t is the 3-month yield at the end of month t-1 divided by 12 (a
    3-month bill rolled monthly, accruing a twelfth of its annual yield).
  * Treasury notes and bonds of maturity m (2, 5, 10 and 20 years): at the end of month t-1 a bond paying a
    coupon c equal to that month's yield is bought at par. A month later it has m - 1/12 years left and is
    priced at the end-of-month-t yield y for maturity m:
        P = (c / y) (1 - (1 + y/2)^(-2n)) + (1 + y/2)^(-2n),  n = m - 1/12   (P = 1 + c n when y = 0)
    and the return is P - 1 + c/12 (price change plus a month of coupon). Swinkels (2019, Data 4(3), 91) uses the
    same par bond for the 10-year yield but approximates the price change by duration and convexity; here the
    bond is repriced in full (on this data the two 10-year series correlate at 0.9998 month by month, and the
    calendar-year 10-year returns are within 1.5 points of Damodaran's annual 10-year Treasury returns in every
    year 1999-2025, checked in review on 14 October 2026). It ignores the gap between the yields at m and at
    m - 1/12 and the exact timing of coupons, so it is close to, but not the same as, the return of a
    Treasury index or fund.
  * Foreign currency deposits: S is the dollar price of one unit of the currency at the end of the month
    (the H.10 rate, inverted where H.10 quotes units per dollar) and i the currency's central bank policy
    rate at the end of the month before. The return is (S_t / S_{t-1}) (1 + i_{t-1} / 1200) - 1: the change in
    the exchange rate plus a month of interest. The policy rate stands in for what a deposit earned. For the euro
    area the BIS series is the ECB's main refinancing rate until 17 September 2024 and its deposit facility rate
    from 18 September 2024; the deposit facility rate was lower (below zero from June 2014 to July 2022), so
    euro returns before September 2024 are higher than money at the deposit facility earned.
  * The BIS series for Japan is blank in three spells in which the Bank of Japan set no numerical rate target:
    March 1999 to July 2000 (guideline: the overnight call rate to "move as low as possible", 12 February 1999),
    April 2001 to February 2006 (target: current account balances; the rate to "stay close to zero percent",
    19 March 2001) and May 2013 to August 2016 (target: the monetary base; the BIS notes "no policy rate").
    Those month-ends use 0%, so the yen earns nothing in the month after each, an approximation. The script stops if Japan's blanks fall anywhere else, or if
    any other series has a missing month.
  * Returns are rounded to 6 decimal places (0.0001 percentage points); the inputs are stored as published.
"""

from __future__ import annotations

import argparse
import csv
import json
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "data" / "assets.js"
UA = {"User-Agent": "365projects-data-script/1.0"}
RETRIEVED = "2026-10-14"
BASE, FIRST, LAST = "1999-01", "1999-02", "2026-09"  # BASE is the month-end the first return starts from

H15_URL = "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&filetype=zip"
H10_URL = "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H10&filetype=zip"
BIS_URL = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M.XM+JP+GB+CH+CA+AU?startPeriod=1998-12&format=csv"

# id, H.15 series, maturity in years (None for bills), name, short name
TREASURIES = [
    ("bills", "RIFLGFCM03_N.B", None, "US Treasury bills (3-month)", "T-bills"),
    ("t2", "RIFLGFCY02_N.B", 2, "US Treasury 2-year", "2-year"),
    ("t5", "RIFLGFCY05_N.B", 5, "US Treasury 5-year", "5-year"),
    ("t10", "RIFLGFCY10_N.B", 10, "US Treasury 10-year", "10-year"),
    ("t20", "RIFLGFCY20_N.B", 20, "US Treasury 20-year", "20-year"),
]
# id, H.10 series, True if H.10 quotes dollars per unit, BIS area, name, short name, currency code
CURRENCIES = [
    ("eur", "RXI$US_N.B.EU", True, "XM", "Euro deposit", "Euro", "EUR"),
    ("jpy", "RXI_N.B.JA", False, "JP", "Japanese yen deposit", "Yen", "JPY"),
    ("gbp", "RXI$US_N.B.UK", True, "GB", "Pound sterling deposit", "Sterling", "GBP"),
    ("chf", "RXI_N.B.SZ", False, "CH", "Swiss franc deposit", "Swiss franc", "CHF"),
    ("cad", "RXI_N.B.CA", False, "CA", "Canadian dollar deposit", "Canadian dollar", "CAD"),
    ("aud", "RXI$US_N.B.AL", True, "AU", "Australian dollar deposit", "Australian dollar", "AUD"),
]
JAPAN_ZERO = [("1999-03", "2000-07"), ("2001-04", "2006-02"), ("2013-05", "2016-08")]


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            path.write_bytes(r.read())
    return path


def months(first: str, last: str) -> list[str]:
    y, m = map(int, first.split("-"))
    out = []
    while f"{y}-{m:02d}" <= last:
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def month_ends(zip_path: Path, member: str, wanted: set[str]) -> dict[str, dict[str, float]]:
    """{series: {YYYY-MM: last valid daily value in that month}} from an FRB SDMX-ML release."""
    out: dict[str, dict[str, float]] = {}
    with zipfile.ZipFile(zip_path) as z, z.open(member) as f:
        for _, node in ET.iterparse(f, events=("end",)):
            if node.tag.endswith("}Series"):
                name = node.get("SERIES_NAME")
                if name in wanted:
                    last: dict[str, tuple[str, float]] = {}
                    for o in node:
                        if not o.tag.endswith("}Obs") or o.get("OBS_STATUS") != "A":
                            continue
                        day, value = o.get("TIME_PERIOD"), float(o.get("OBS_VALUE"))
                        key = day[:7]
                        if key not in last or day > last[key][0]:
                            last[key] = (day, value)
                    out[name] = {k: v for k, (_, v) in last.items()}
                node.clear()
    missing = wanted - set(out)
    if missing:
        raise SystemExit(f"{member}: series not found: {sorted(missing)}")
    return out


def bond_price(c: float, y: float, n: float) -> float:
    """Price per 1 of face of a bond with annual coupon rate c paid twice a year, n years left, at yield y."""
    if y == 0:
        return 1 + c * n
    d = (1 + y / 2) ** (-2 * n)
    return c / y * (1 - d) + d


def bond_return(y0: float, y1: float, m: float) -> float:
    """Return over one month of a par bond of maturity m bought at yield y0 (percent) and valued at y1."""
    c, y = y0 / 100, y1 / 100
    return bond_price(c, y, m - 1 / 12) - 1 + c / 12


def in_spells(month: str, spells) -> bool:
    return any(a <= month <= b for a, b in spells)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="assets_"))
    cache.mkdir(parents=True, exist_ok=True)

    span = months(BASE, LAST)  # month-ends from BASE: one more than there are returns
    ret_months = span[1:]
    if ret_months[0] != FIRST:
        raise SystemExit("month arithmetic")

    h15 = month_ends(fetch(H15_URL, cache / "FRB_H15.zip"), "H15_data.xml", {t[1] for t in TREASURIES})
    h10 = month_ends(fetch(H10_URL, cache / "FRB_H10.zip"), "H10_data.xml", {c[1] for c in CURRENCIES})

    with open(fetch(BIS_URL, cache / "bis_cbpol_monthly.csv"), encoding="utf-8-sig", newline="") as f:
        bis_rows = list(csv.DictReader(f))
    bis: dict[str, dict[str, float]] = {}
    for r in bis_rows:
        if r["FREQ"] != "M" or r["UNIT_MEASURE"] != "368":
            raise SystemExit(f"unexpected BIS row: {r['FREQ']} {r['UNIT_MEASURE']}")
        if r["OBS_VALUE"] != "":
            bis.setdefault(r["REF_AREA"], {})[r["TIME_PERIOD"]] = float(r["OBS_VALUE"])

    def series(table, name, need, label):
        values = []
        for mth in need:
            if mth not in table[name]:
                raise SystemExit(f"{label}: no value for {mth}")
            values.append(table[name][mth])
        return values

    assets, inputs = [], {"yields": {}, "fx": {}, "policy": {}}
    for sid, code, maturity, name, short in TREASURIES:
        y = series(h15, code, span, f"H.15 {code}")
        inputs["yields"][sid] = y
        if maturity is None:
            r = [y[k - 1] / 1200 for k in range(1, len(span))]
            detail = ("3-month US Treasury bill yield at the end of each month (H.15, constant maturity, investment basis), "
                      "earned for the following month: a twelfth of the annual yield.")
        else:
            r = [bond_return(y[k - 1], y[k], maturity) for k in range(1, len(span))]
            detail = (f"A {maturity}-year Treasury bought at par at each month-end and valued a month later at the new "
                      f"{maturity}-year constant-maturity yield (H.15): price change plus a month of coupon. Modelled, "
                      f"not the return of an index or a fund.")
        assets.append({"id": sid, "name": name, "short": short, "group": "cash" if maturity is None else "treasury",
                       "maturity": maturity, "source": "H.15", "series": code, "detail": detail,
                       "returns": [round(v, 6) for v in r]})

    japan_filled = []
    for sid, code, dollars_per_unit, area, name, short, iso in CURRENCIES:
        raw = series(h10, code, span, f"H.10 {code}")
        usd = raw if dollars_per_unit else [1 / v for v in raw]
        rates = []
        for mth in span[:-1]:  # the rate at the end of t-1 is earned in month t
            v = bis.get(area, {}).get(mth)
            if v is None:
                if area == "JP" and in_spells(mth, JAPAN_ZERO):
                    v = 0.0
                    japan_filled.append(mth)
                else:
                    raise SystemExit(f"BIS {area}: no policy rate for {mth}")
            rates.append(v)
        for mth in months("1998-12", span[-2]):
            if area == "JP" and mth in bis.get("JP", {}) and in_spells(mth, JAPAN_ZERO):
                raise SystemExit(f"BIS JP has a value for {mth}, inside a spell the script fills with zero: check JAPAN_ZERO")
        inputs["fx"][sid] = raw
        inputs["policy"][sid] = rates
        r = [usd[k] / usd[k - 1] * (1 + rates[k - 1] / 1200) - 1 for k in range(1, len(span))]
        quote = "dollars per " + iso if dollars_per_unit else iso + " per dollar"
        assets.append({"id": sid, "name": name, "short": short, "group": "deposit", "currency": iso, "maturity": None,
                       "source": "H.10 and BIS", "series": code, "quote": quote, "area": area,
                       "detail": (f"Cash held in {iso} for a dollar investor: the change in the dollar price of the {iso} "
                                  f"(H.10 noon buying rate, {quote}, at month-end) plus a month of interest at the "
                                  f"central bank's policy rate (BIS) at the end of the month before."),
                       "returns": [round(v, 6) for v in r]})

    expected_fill = [m for m in span[:-1] if in_spells(m, JAPAN_ZERO)]
    if japan_filled != expected_fill:
        raise SystemExit("Japan: the blanks in the BIS series no longer match the three spells")

    data = {
        "retrieved": RETRIEVED,
        "first": FIRST, "last": LAST, "base": BASE, "months": len(ret_months),
        "currency": "US dollars, nominal",
        "sources": {
            "h15": {"name": "Federal Reserve Board, H.15 Selected Interest Rates (Treasury yields from the US Department of the Treasury)",
                    "url": "https://www.federalreserve.gov/releases/h15/", "licence": "Public domain (Federal Reserve Board website policy)"},
            "h10": {"name": "Federal Reserve Board, H.10 Foreign Exchange Rates (noon buying rates in New York)",
                    "url": "https://www.federalreserve.gov/releases/h10/", "licence": "Public domain (Federal Reserve Board website policy)"},
            "bis": {"name": "Bank for International Settlements, central bank policy rates (WS_CBPOL)",
                    "url": "https://data.bis.org/topics/CBPOL", "licence": "BIS terms of permitted use of statistics: free use with the BIS cited as the source"},
        },
        "japanZero": JAPAN_ZERO,
        "assets": assets,
        # inputs: month-end values from BASE to LAST (one more than returns); policy[t] is the rate earned in month t+1.
        "inputs": inputs,
    }
    OUT.write_text(
        "// Generated by scripts/data/assets.py. Do not edit by hand.\n"
        f"// Monthly returns of eleven assets for a US-dollar investor, {FIRST} to {LAST}, nominal, computed from public data:\n"
        "// Treasury yields (Federal Reserve H.15) and exchange rates (Federal Reserve H.10), public domain, and central bank\n"
        f"// policy rates (Bank for International Settlements, free use with the BIS cited as source). Retrieved {RETRIEVED}.\n"
        "// returns[i] is the return in the month i months after `first`, as a fraction (0.01 is 1%).\n"
        "export const ASSETS = " + json.dumps(data, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), {len(ret_months)} months, cache at {cache}")
    for a in assets:
        r = a["returns"]
        growth = 1.0
        for v in r:
            growth *= 1 + v
        print(f"  {a['id']:6} mean {sum(r) / len(r) * 1200:6.2f}%/yr  growth x{growth:5.2f}  first {r[0]:+.6f}  last {r[-1]:+.6f}")
    print(f"  Japan months set to 0%: {len(japan_filled)}")


if __name__ == "__main__":
    main()
