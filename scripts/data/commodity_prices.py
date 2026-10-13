"""Build 365projects/58/data.js, the monthly commodity prices behind project 58.

    python scripts/data/commodity_prices.py [--cache DIR]

Sources (downloaded into --cache, never committed):

  1. World Bank, "Commodity Price Data (The Pink Sheet)", the workbook CMO-Historical-Data-Monthly.xlsx linked
     from https://www.worldbank.org/en/research/commodity-markets, sheet "Monthly Prices": monthly averages in
     nominal US dollars from January 1960. The World Bank publishes the Pink Sheet under CC BY 4.0. Its
     "Description" sheet names where each price comes from (US Department of Agriculture, the International
     Sugar Organization, Tea Board India, Bloomberg and others); the page repeats that.
     The address of the workbook changes with each year's edition, so PINK_URL below is the one that was
     live on the day in RETRIEVED. To refresh, copy the current link from the page above.

  2. FAO, "Food Price Monitoring and Analysis (FPMA) Tool", https://fpma.fao.org/, through the JSON
     interface the tool itself uses: retail prices in India, national average, rupees per kilogram, monthly
     from January 2014. FAO's "Statistical Database Terms of Use"
     (https://www.fao.org/contact-us/terms/db-terms-of-use/en/) license the datasets of its statistical
     databases under CC BY 4.0 and list the FPMA Tool among those databases. FAO names its own source for
     these two series as India's Ministry of Consumer Affairs (the price monitoring reports of the Department
     of Consumer Affairs); the series metadata states no further condition.
     The terms apply CC BY 4.0 "unless specified otherwise in their metadata or webpage", and their clause on
     third parties says that data provided by third parties may carry the provider's own conditions, that such
     conditions are given in the metadata or web page, and that FAO does not warrant that it controls all
     rights. The Department's own price site, https://fcainfoweb.nic.in/ (Disclaimer), says that its material
     may be reproduced free of charge "after taking proper permission by sending a mail to us", accurately
     and with the source acknowledged. This script takes the monthly national averages from FAO, as FAO
     publishes them, and never from the Department's site; the page says all of this under its sources.
     (Checked on 12 October 2026.)

Cleaning rules:
  * Pink Sheet: the row of series names is the one whose second cell is "Crude oil, average"; the next row
    holds the units; a data row is one whose first cell looks like 1980M01. Only January 1980 onwards is
    kept: before that several of these prices were quoted to two decimal places of a much smaller number or
    were fixed by regulation for years at a time, which a seasonal decomposition would read as pattern.
  * Values are written as the workbook holds them (it rounds to one or two decimal places). Nothing is
    filled in, smoothed or converted. If a chosen series has a missing month the script stops.
  * FPMA: the monthly "price_value" in rupees, in date order. If a month is missing between the first and
    the last the script stops.
  * The script also stops if a series contains a value that is not a positive number.
"""

from __future__ import annotations

import argparse
import json
import re
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "58" / "data.js"
UA = {"User-Agent": "varad-patel-365projects/1.0 (https://varad-patel.github.io)"}
RETRIEVED = "2026-10-12"
FIRST = "1980-01"

PINK_FILE = "CMO-Historical-Data-Monthly.xlsx"
PINK_URL = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/" + PINK_FILE
FPMA_API = "https://fpma.fao.org/giews/v4/price_module/api/v1/"

# id, column name in the Pink Sheet, display name, unit, what the Description sheet says the price is.
PINK = [
    ("wheat", "Wheat, US HRW", "Wheat, US hard red winter", "US$ per tonne",
     "No. 2 hard red winter wheat, export price at US Gulf ports (no. 1, ordinary protein, up to June 2020)."),
    ("maize", "Maize", "Maize, US", "US$ per tonne", "No. 2 yellow maize, free on board at US Gulf ports."),
    ("rice", "Rice, Thai 5%", "Rice, Thai 5% broken", "US$ per tonne",
     "Thai white rice, 5% broken, milled, indicative export price free on board at Bangkok."),
    ("sugar", "Sugar, world", "Sugar, world", "US$ per kg",
     "Raw sugar, International Sugar Agreement daily price, free on board at greater Caribbean ports."),
    ("tea", "Tea, Kolkata", "Tea, Kolkata auctions", "US$ per kg",
     "Leaf tea at the Kolkata auctions, including excise duty, average of weekly quotes."),
    ("orange", "Orange", "Oranges, Mediterranean", "US$ per kg",
     "Navel oranges from Mediterranean exporters, European Union indicative import price delivered to Paris."),
    ("banana", "Banana, US", "Bananas, US import", "US$ per kg",
     "Central and South American bananas, major brands, US import price free on truck at US Gulf ports."),
    ("gas", "Natural gas, US", "Natural gas, US", "US$ per million Btu", "Spot price at Henry Hub, Louisiana."),
]
# id, FPMA series identifier, display name, the commodity and price type the metadata must report.
FPMA = [
    ("onion", "5c8bca69-bf64-4b16-9444-bebbeac26609", "Onions, India retail", "Onions"),
    ("potato", "4b785aed-9c9b-42cb-8f09-e748401c5326", "Potatoes, India retail", "Potatoes"),
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


def positive(value, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not value > 0:
        raise SystemExit(f"{what}: {value!r} is not a positive number")
    return value


def pink(cache: Path):
    import openpyxl

    book = openpyxl.load_workbook(fetch(PINK_URL, PINK_FILE, cache), read_only=True, data_only=True)
    rows = list(book["Monthly Prices"].iter_rows(values_only=True))
    head = next(i for i, r in enumerate(rows) if len(r) > 1 and r[1] == "Crude oil, average")
    names = [str(c).strip() if c is not None else "" for c in rows[head]]
    vintage = next(str(r[0]).strip() for r in rows[:head] if r[0] and str(r[0]).startswith("Updated on"))
    data = [r for r in rows[head + 2:] if isinstance(r[0], str) and re.fullmatch(r"\d{4}M\d{2}", r[0])]
    data = [r for r in data if f"{r[0][:4]}-{r[0][5:]}" >= FIRST]
    stamps = [f"{r[0][:4]}-{r[0][5:]}" for r in data]
    if stamps != months(FIRST, len(stamps)):
        raise SystemExit("Pink Sheet: the months are not consecutive")
    out = []
    for sid, column, name, unit, detail in PINK:
        j = names.index(column)
        values = [positive(r[j], f"Pink Sheet, {column}, {stamp}") for r, stamp in zip(data, stamps)]
        out.append({"id": sid, "name": name, "source": "pink", "column": column, "unit": unit, "detail": detail,
                    "start": FIRST, "values": values})
    return out, vintage


def fpma(cache: Path):
    out = []
    for sid, uuid, name, commodity in FPMA:
        meta = json.loads(fetch(f"{FPMA_API}FpmaSerie/{uuid}/?format=json", f"fpma-serie-{uuid}.json", cache).read_text("utf-8"))
        want = {"iso3_country_code": "IND", "commodity_name": commodity, "price_type": "RETAIL", "currency": "INR",
                "measure_unit_label": "Kg", "market_name": "National Average"}
        for key, value in want.items():
            if meta.get(key) != value:
                raise SystemExit(f"FPMA {uuid}: {key} is {meta.get(key)!r}, expected {value!r}")
        prices = json.loads(fetch(f"{FPMA_API}FpmaSeriePrice/{uuid}/?format=json", f"fpma-price-{uuid}.json", cache).read_text("utf-8"))
        points = sorted((p["date"][:7], p["price_value"]) for p in prices["datapoints"] if p["periodicity"] == "monthly")
        stamps = [p[0] for p in points]
        if stamps != months(stamps[0], len(stamps)):
            raise SystemExit(f"FPMA {name}: a month is missing or repeated")
        values = [positive(v, f"FPMA, {name}, {stamp}") for stamp, v in points]
        out.append({"id": sid, "name": name, "source": "fpma", "column": uuid, "unit": "₹ per kg",
                    "detail": f"{commodity}, retail, national average for India, as reported to FAO from the price "
                              f"monitoring of the Department of Consumer Affairs ({meta['source_name']}).",
                    "start": stamps[0], "values": values})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="commodity_prices_"))
    cache.mkdir(parents=True, exist_ok=True)

    food = fpma(cache)
    world, vintage = pink(cache)
    out = {
        "retrieved": RETRIEVED,
        "sources": {
            "fpma": {
                "name": "FAO, Food Price Monitoring and Analysis (FPMA) Tool",
                "url": "https://fpma.fao.org/",
                "licence": "CC BY 4.0",
                "terms": "https://www.fao.org/contact-us/terms/db-terms-of-use/en/",
                "origin": "Department of Consumer Affairs, Government of India (price monitoring reports)",
            },
            "pink": {
                "name": "World Bank, Commodity Price Data (The Pink Sheet)",
                "url": "https://www.worldbank.org/en/research/commodity-markets",
                "file": PINK_URL,
                "licence": "CC BY 4.0",
                "vintage": vintage,
            },
        },
        "series": food + world,
    }
    last = {s["id"]: months(s["start"], len(s["values"]))[-1] for s in out["series"]}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by scripts/data/commodity_prices.py. Do not edit by hand.\n"
        "// Monthly commodity prices, nominal: India retail from FAO's FPMA Tool (CC BY 4.0) and world benchmarks from the\n"
        f"// World Bank's Pink Sheet (CC BY 4.0). Retrieved {RETRIEVED}. values[i] is the month i months after start.\n"
        "export const PRICES = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), cache at {cache}")
    for s in out["series"]:
        print(f"  {s['id']:7} {s['start']} to {last[s['id']]}  {len(s['values'])} months  last {s['values'][-1]}")


if __name__ == "__main__":
    main()
