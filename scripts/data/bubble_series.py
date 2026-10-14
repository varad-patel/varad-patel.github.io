"""Build 365projects/69/data.js, the monthly series behind project 69 (Bubble Detector).

    python scripts/data/bubble_series.py [--cache DIR]

The critical values for the same series are simulated separately by scripts/data/bubble_critical.mjs, which reads
the module this script writes. Run this script first.

Sources (downloaded into --cache, never committed):

  1. Coin Metrics, "Free Coin Metrics data archives", https://github.com/coinmetrics/data, csv/btc.csv, column
     PriceUSD (US dollar price at the end of each UTC day, from Coin Metrics' reference rates). Licence: the
     README says "Data is made available under the CC BY-NC 4.0 license" and the LICENSE file says "This work by
     Coin Metrics, Inc is licensed under the Creative Commons Attribution-NonCommercial 4.0 International
     License." Non-commercial reuse with attribution is allowed; this page is non-commercial. The archive stopped
     updating on 24 May 2026.

  2. Federal Housing Finance Agency, House Price Index, "hpi_master.csv" from
     https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv: the purchase-only index for the United States,
     monthly, seasonally adjusted (January 1991 = 100). FHFA's website privacy policy, section 10 "Copyright and
     Trademark Notice", says: "Generally, information and materials produced by Federal agencies, including FHFA,
     are in the public domain and may be copied and distributed without permission." (Checked 14 October 2026.)
     "FHFA HPI" is a registered trademark; the page uses it only to name the source.

  3. US Bureau of Labor Statistics, Consumer Price Index for All Urban Consumers, "Rent of primary residence in
     U.S. city average", seasonally adjusted, series CUSR0000SEHA, through the BLS Public Data API (version 1,
     https://api.bls.gov/publicAPI/v1/timeseries/data/), ten years per request. BLS's copyright page
     (https://www.bls.gov/opub/copyright-information.htm) says that "everything that we publish, both in hard copy
     and electronically, is in the public domain" and asks users to cite BLS as the source.

  4. World Bank, "Commodity Price Data (The Pink Sheet)", CMO-Historical-Data-Monthly.xlsx, sheet "Monthly
     Prices", nominal US dollars. Licence CC BY 4.0, the World Bank's default for the data it produces
     (https://datacatalog.worldbank.org/public-licenses). The workbook names the original sources of each price.

Cleaning rules:
  * Bitcoin: the monthly average of the daily PriceUSD values of each calendar month. Only complete months are kept:
    August 2010 (the archive's first price is 18 July 2010) to April 2026 (the last price is 23 May 2026).
  * House prices relative to rents: FHFA index divided by the rent index, both rescaled so January 1991 = 100,
    for the months both publish (January 1991 to the last FHFA month). The two inputs are kept as well.
    BLS has no October 2025 rent value (the 2025 lapse in appropriations); it is filled with the geometric mean of
    September and November 2025, the one filled value in the module, listed under "filled".
  * Pink Sheet prices as published (the workbook rounds them). Gold and silver start in January 1975, after the US
    allowed private gold ownership again (31 December 1974) and when both prices move every month; Brent crude and
    nickel start in January 1980, before which the Pink Sheet repeats the same price for months at a time
    (administered and producer prices).
  * Months must be consecutive and values positive, or the script stops. Apart from the one rent month above,
    nothing is filled in or smoothed.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import tempfile
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "69" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; data download script)"}  # anonymous: no name or address
RETRIEVED = "2026-10-14"

BTC_URL = "https://raw.githubusercontent.com/coinmetrics/data/master/csv/btc.csv"
FHFA_URL = "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv"
BLS_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
# BLS published no October 2025 value ("Data unavailable due to the 2025 lapse in appropriations"). That month of the
# rent index is filled with the geometric mean of September and November 2025, and the module lists it under "filled".
MISSING = {"2025-10": ("2025-09", "2025-11")}
PINK_FILE = "CMO-Historical-Data-Monthly.xlsx"
PINK_URL = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/" + PINK_FILE

# id, Pink Sheet column, display name, unit, first month.
PINK = [
    ("gold", "Gold", "Gold", "US$ per troy ounce", "1975-01"),
    ("silver", "Silver", "Silver", "US$ per troy ounce", "1975-01"),
    ("brent", "Crude oil, Brent", "Crude oil, Brent", "US$ per barrel", "1980-01"),
    ("nickel", "Nickel", "Nickel", "US$ per tonne", "1980-01"),
]


def fetch(url: str, name: str, cache: Path, body: dict | None = None) -> Path:
    path = cache / name
    if not path.exists():
        data = json.dumps(body).encode() if body else None
        headers = {**UA, "Content-Type": "application/json"} if body else UA
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=300) as r:
            path.write_bytes(r.read())
    return path


def months(first: str, count: int) -> list[str]:
    y, m = map(int, first.split("-"))
    out = []
    for _ in range(count):
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def consecutive(stamps: list[str], what: str) -> None:
    if stamps != months(stamps[0], len(stamps)):
        raise SystemExit(f"{what}: the months are not consecutive")


def positive(v, what: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not v > 0:
        raise SystemExit(f"{what}: {v!r} is not a positive number")
    return float(v)


def bitcoin(cache: Path) -> dict:
    rows = [r for r in csv.DictReader(io.StringIO(fetch(BTC_URL, "btc.csv", cache).read_text("utf-8"))) if r.get("PriceUSD")]
    by = defaultdict(list)
    for r in rows:
        by[r["time"][:7]].append(positive(float(r["PriceUSD"]), f"btc {r['time']}"))
    first_day, last_day = min(r["time"] for r in rows), max(r["time"] for r in rows)
    keep = sorted(m for m in by if m > first_day[:7] and m < last_day[:7])  # complete months only
    consecutive(keep, "Bitcoin")
    for m in keep:
        y, mo = map(int, m.split("-"))
        days = 31 if mo in (1, 3, 5, 7, 8, 10, 12) else 30 if mo != 2 else (29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28)
        if len(by[m]) != days:
            raise SystemExit(f"Bitcoin {m}: {len(by[m])} daily prices, expected {days}")
    return {"id": "btc", "name": "Bitcoin", "unit": "US$, monthly average of daily prices", "start": keep[0],
            "values": [float(f"{sum(by[m]) / len(by[m]):.6g}") for m in keep],
            "source": "coinmetrics", "detail": "Monthly average of Coin Metrics' daily US dollar price (end of each UTC day)."}


def housing(cache: Path) -> dict:
    hpi = {}
    for r in csv.DictReader(io.StringIO(fetch(FHFA_URL, "fhfa_hpi_master.csv", cache).read_text("utf-8"))):
        if (r["hpi_type"], r["hpi_flavor"], r["frequency"], r["place_id"]) == ("traditional", "purchase-only", "monthly", "USA"):
            hpi[f"{int(r['yr'])}-{int(r['period']):02d}"] = positive(float(r["index_sa"]), f"FHFA {r['yr']}-{r['period']}")
    rent = {}
    for a, b in [(1991, 2000), (2001, 2010), (2011, 2020), (2021, 2026)]:
        body = {"seriesid": ["CUSR0000SEHA"], "startyear": str(a), "endyear": str(b)}
        js = json.loads(fetch(BLS_URL, f"bls_CUSR0000SEHA_{a}_{b}.json", cache, body).read_text("utf-8"))
        if js.get("status") != "REQUEST_SUCCEEDED":
            raise SystemExit(f"BLS {a}-{b}: {js.get('status')} {js.get('message')}")
        got = {d["year"] for d in js["Results"]["series"][0]["data"]}
        if not got <= {str(y) for y in range(a, b + 1)}:
            raise SystemExit(f"BLS {a}-{b}: the response holds years {sorted(got)}")
        for d in js["Results"]["series"][0]["data"]:
            if not re.fullmatch(r"M(0[1-9]|1[0-2])", d["period"]):
                continue
            stamp = f"{d['year']}-{d['period'][1:]}"
            if d["value"] == "-" and stamp in MISSING:
                continue
            rent[stamp] = positive(float(d["value"]), f"BLS {stamp}")
    filled = []
    for stamp, (before, after) in MISSING.items():
        if stamp in rent or before not in rent or after not in rent:
            raise SystemExit(f"BLS {stamp}: expected a gap between {before} and {after}")
        rent[stamp] = round((rent[before] * rent[after]) ** 0.5, 3)
        filled.append(stamp)
    common = sorted(set(hpi) & set(rent))
    consecutive(common, "FHFA and BLS")
    if common[0] != "1991-01":
        raise SystemExit(f"housing starts in {common[0]}, expected 1991-01")
    h0, r0 = hpi[common[0]], rent[common[0]]
    return {"id": "house", "name": "US house prices relative to rents", "unit": "index, January 1991 = 100", "start": common[0],
            "values": [round(100 * (hpi[m] / h0) / (rent[m] / r0), 3) for m in common],
            "hpi": [hpi[m] for m in common], "rent": [rent[m] for m in common], "filled": filled,
            "source": "fhfa", "detail": "FHFA purchase-only house price index for the United States divided by the BLS consumer price index for rent of primary residence, both seasonally adjusted, January 1991 = 100."}


def pink(cache: Path) -> tuple[list[dict], str]:
    import openpyxl

    book = openpyxl.load_workbook(fetch(PINK_URL, PINK_FILE, cache), read_only=True, data_only=True)
    rows = list(book["Monthly Prices"].iter_rows(values_only=True))
    head = next(i for i, r in enumerate(rows) if len(r) > 1 and r[1] == "Crude oil, average")
    names = [str(c).strip() if c is not None else "" for c in rows[head]]
    vintage = next(str(r[0]).strip() for r in rows[:head] if r[0] and str(r[0]).startswith("Updated on"))
    data = [r for r in rows[head + 2:] if isinstance(r[0], str) and re.fullmatch(r"\d{4}M\d{2}", r[0])]
    stamps = [f"{r[0][:4]}-{r[0][5:]}" for r in data]
    consecutive(stamps, "Pink Sheet")
    out = []
    for sid, column, name, unit, first in PINK:
        j = names.index(column)
        keep = [(s, r[j]) for s, r in zip(stamps, data) if s >= first]
        out.append({"id": sid, "name": name, "unit": unit, "start": keep[0][0],
                    "values": [positive(v, f"Pink Sheet {column} {s}") for s, v in keep],
                    "source": "pink", "detail": f"World Bank Pink Sheet, {column}, monthly average, nominal US dollars."})
    return out, vintage


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="bubble_series_"))
    cache.mkdir(parents=True, exist_ok=True)

    commodities, vintage = pink(cache)
    series = [bitcoin(cache), housing(cache), *commodities]
    out = {
        "retrieved": RETRIEVED,
        "sources": {
            "coinmetrics": {"name": "Coin Metrics, free community data archives", "url": "https://github.com/coinmetrics/data", "licence": "CC BY-NC 4.0",
                            "licenceUrl": "https://creativecommons.org/licenses/by-nc/4.0/", "warranty": "Coin Metrics publishes the data without any warranty.",
                            "changes": "Daily prices averaged by calendar month, complete months only, rounded to six significant figures."},
            "fhfa": {"name": "FHFA House Price Index (purchase-only, seasonally adjusted) and BLS CPI rent of primary residence (CUSR0000SEHA)", "url": "https://www.fhfa.gov/data/hpi", "licence": "public domain (US government works)"},
            "pink": {"name": "World Bank, Commodity Price Data (The Pink Sheet)", "url": "https://www.worldbank.org/en/research/commodity-markets", "licence": "CC BY 4.0", "licenceUrl": "https://creativecommons.org/licenses/by/4.0/", "vintage": vintage},
        },
        "series": series,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by scripts/data/bubble_series.py. Do not edit by hand.\n"
        "// Monthly series: Bitcoin (Coin Metrics, CC BY-NC 4.0), US house prices relative to rents (FHFA and BLS, public\n"
        f"// domain) and four commodity prices (World Bank Pink Sheet, CC BY 4.0). Retrieved {RETRIEVED}. values[i] is month i after start.\n"
        "export const SERIES = " + json.dumps(out, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), cache at {cache}")
    for s in series:
        print(f"  {s['id']:7} {s['start']} to {months(s['start'], len(s['values']))[-1]}  {len(s['values'])} months  first {s['values'][0]}  last {s['values'][-1]}")


if __name__ == "__main__":
    main()
