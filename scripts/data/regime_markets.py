"""Build 365projects/72/data.js, the monthly market series behind project 72 (Market Regime Detector).

    python scripts/data/regime_markets.py [--cache DIR]

Sources (downloaded into --cache, never committed):

  1. Board of Governors of the Federal Reserve System, H.15 Selected Interest Rates, monthly averages, through the
     Data Download Program "package" for H.15 monthly data
     (https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&series=d7e27b7b09a3a7feae95b9c61781fcd8&...):
     series RIFLGFCY10_N.M, "Market yield on U.S. Treasury securities at 10-year constant maturity, quoted on
     investment basis", percent a year, from April 1953. The Board's website policy
     (https://www.federalreserve.gov/disclaimer.htm) says: "Unless otherwise indicated, information on Board's
     website is in the public domain and may be copied and distributed without permission. Please cite to the
     Board as the source of the information." (Checked 14 October 2026.)

  2. World Bank, "Commodity Price Data (The Pink Sheet)", CMO-Historical-Data-Monthly.xlsx, sheet "Monthly
     Prices", monthly averages in nominal US dollars. Licence CC BY 4.0, the World Bank's default for data it
     produces (https://datacatalog.worldbank.org/public-licenses). The workbook names the original sources.

  3. Coin Metrics, "Free Coin Metrics data archives", https://github.com/coinmetrics/data, csv/btc.csv, column
     PriceUSD. The README says "Data is made available under the CC BY-NC 4.0 license" and the LICENSE file says
     "This work by Coin Metrics, Inc is licensed under the Creative Commons Attribution-NonCommercial 4.0
     International License." Non-commercial reuse with attribution is allowed; this page is non-commercial. The
     archive stopped updating on 24 May 2026.

  Stock index data would be the obvious choice for market regimes, but index providers own their indices and their
  terms do not allow republishing the history, so this page uses open series instead.

Cleaning rules:
  * Treasury yield: the monthly average as published, April 1953 to the last month. "ND" (no data) rows stop the script.
  * Pink Sheet prices as published (the workbook rounds them). Gold starts in January 1975 (US private ownership
    legal again from 31 December 1974); Brent crude starts in January 1980, before which the Pink Sheet repeats
    administered prices for months at a time; copper starts in January 1970.
  * Bitcoin: the monthly average of the daily PriceUSD values, complete months only (August 2010 to April 2026).
  * Months must be consecutive and prices positive, or the script stops. Nothing is filled in or smoothed.
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
OUT = ROOT / "365projects" / "72" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; data download script)"}  # anonymous: no name or address
RETRIEVED = "2026-10-14"

H15_URL = ("https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&series=d7e27b7b09a3a7feae95b9c61781fcd8"
           "&lastobs=&from=&to=&filetype=csv&label=include&layout=seriescolumn&type=package")
H15_COLUMN = "RIFLGFCY10_N.M"
PINK_FILE = "CMO-Historical-Data-Monthly.xlsx"
PINK_URL = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/" + PINK_FILE
BTC_URL = "https://raw.githubusercontent.com/coinmetrics/data/master/csv/btc.csv"
PINK = [
    ("gold", "Gold", "Gold", "US$ per troy ounce", "1975-01"),
    ("brent", "Crude oil, Brent", "Crude oil, Brent", "US$ per barrel", "1980-01"),
    ("copper", "Copper", "Copper", "US$ per tonne", "1970-01"),
]


def fetch(url: str, name: str, cache: Path) -> Path:
    path = cache / name
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
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


def treasury(cache: Path) -> dict:
    rows = list(csv.reader(io.StringIO(fetch(H15_URL, "h15_monthly_package.csv", cache).read_text("utf-8-sig"))))
    head = next(i for i, r in enumerate(rows) if r and r[0] == "Time Period")
    j = rows[head].index(H15_COLUMN)
    desc = rows[0][j]
    if "10-year" not in desc:
        raise SystemExit(f"H.15: column {H15_COLUMN} is {desc!r}")
    data = [(r[0], r[j]) for r in rows[head + 1:] if r and r[j] != ""]
    if any(v == "ND" for _, v in data):
        raise SystemExit("H.15: a month has no data")
    stamps = [s for s, _ in data]
    consecutive(stamps, "H.15")
    return {"id": "ust10", "name": "US 10-year Treasury yield", "unit": "% a year", "kind": "yield", "start": stamps[0],
            "values": [float(v) for _, v in data], "source": "fed",
            "detail": "Market yield on US Treasury securities at 10-year constant maturity, monthly average (Federal Reserve H.15)."}


def pink(cache: Path) -> list[dict]:
    import openpyxl

    book = openpyxl.load_workbook(fetch(PINK_URL, PINK_FILE, cache), read_only=True, data_only=True)
    rows = list(book["Monthly Prices"].iter_rows(values_only=True))
    head = next(i for i, r in enumerate(rows) if len(r) > 1 and r[1] == "Crude oil, average")
    names = [str(c).strip() if c is not None else "" for c in rows[head]]
    data = [r for r in rows[head + 2:] if isinstance(r[0], str) and re.fullmatch(r"\d{4}M\d{2}", r[0])]
    stamps = [f"{r[0][:4]}-{r[0][5:]}" for r in data]
    consecutive(stamps, "Pink Sheet")
    out = []
    for sid, column, name, unit, first in PINK:
        j = names.index(column)
        keep = [(s, r[j]) for s, r in zip(stamps, data) if s >= first]
        out.append({"id": sid, "name": name, "unit": unit, "kind": "price", "start": keep[0][0],
                    "values": [positive(v, f"Pink Sheet {column} {s}") for s, v in keep], "source": "pink",
                    "detail": f"World Bank Pink Sheet, {column}, monthly average, nominal US dollars."})
    return out


def bitcoin(cache: Path) -> dict:
    rows = [r for r in csv.DictReader(io.StringIO(fetch(BTC_URL, "btc.csv", cache).read_text("utf-8"))) if r.get("PriceUSD")]
    by = defaultdict(list)
    for r in rows:
        by[r["time"][:7]].append(positive(float(r["PriceUSD"]), f"btc {r['time']}"))
    first_day, last_day = min(r["time"] for r in rows), max(r["time"] for r in rows)
    keep = sorted(m for m in by if first_day[:7] < m < last_day[:7])
    consecutive(keep, "Bitcoin")
    return {"id": "btc", "name": "Bitcoin", "unit": "US$", "kind": "price", "start": keep[0],
            "values": [float(f"{sum(by[m]) / len(by[m]):.6g}") for m in keep], "source": "coinmetrics",
            "detail": "Monthly average of Coin Metrics' daily US dollar price (end of each UTC day)."}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="regime_markets_"))
    cache.mkdir(parents=True, exist_ok=True)

    series = [treasury(cache), *pink(cache), bitcoin(cache)]
    out = {
        "retrieved": RETRIEVED,
        "sources": {
            "fed": {"name": "Federal Reserve Board, H.15 Selected Interest Rates", "url": "https://www.federalreserve.gov/releases/h15/", "licence": "public domain"},
            "pink": {"name": "World Bank, Commodity Price Data (The Pink Sheet)", "url": "https://www.worldbank.org/en/research/commodity-markets", "licence": "CC BY 4.0",
                     "licenceUrl": "https://creativecommons.org/licenses/by/4.0/"},
            "coinmetrics": {"name": "Coin Metrics, free community data archives", "url": "https://github.com/coinmetrics/data", "licence": "CC BY-NC 4.0",
                            "licenceUrl": "https://creativecommons.org/licenses/by-nc/4.0/", "warranty": "Coin Metrics publishes the data without any warranty.",
                            "changes": "Daily prices averaged by calendar month, complete months only, rounded to six significant figures."},
        },
        "series": series,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by scripts/data/regime_markets.py. Do not edit by hand.\n"
        "// Monthly averages: US 10-year Treasury yield (Federal Reserve H.15, public domain), gold, Brent crude and copper\n"
        f"// (World Bank Pink Sheet, CC BY 4.0) and Bitcoin (Coin Metrics, CC BY-NC 4.0). Retrieved {RETRIEVED}. values[i] is month i after start.\n"
        "export const MARKETS = " + json.dumps(out, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), cache at {cache}")
    for s in series:
        print(f"  {s['id']:7} {s['start']} to {months(s['start'], len(s['values']))[-1]}  {len(s['values'])} months  first {s['values'][0]}  last {s['values'][-1]}")


if __name__ == "__main__":
    main()
