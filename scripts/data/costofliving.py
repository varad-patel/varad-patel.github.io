"""Build 365projects/33/data.js, the price levels behind project 33.

    python scripts/data/costofliving.py [--cache DIR] [--retrieved YYYY-MM-DD]

Sources (downloaded into --cache, never committed):
  * U.S. Bureau of Economic Analysis, Regional Price Parities for 2024: by metropolitan statistical area
    (table MARPP, https://apps.bea.gov/regional/zip/MARPP.zip) and by state (table SARPP,
    https://apps.bea.gov/regional/zip/SARPP.zip). A work of the United States government, in the public
    domain. Each parity is a price level with the United States average set to 100, for all items and for
    four parts: goods, housing (rents), utilities and other services.
  * World Bank, World Development Indicators (CC BY 4.0), for 2024:
      PA.NUS.PRVT.PP     PPP conversion factor, household consumption (local currency per international $)
      PA.NUS.PPP         PPP conversion factor, GDP (local currency per international $)
      NY.GDP.PCAP.CD     GDP per person, current US$
      NY.GDP.PCAP.PP.CD  GDP per person, PPP, current international $
      PA.NUS.FCRF        official exchange rate (local currency per US$, period average)

How a country's price level is worked out. The level is the household-consumption PPP divided by the
official exchange rate, with the United States at 1:

    level = PA.NUS.PRVT.PP / PA.NUS.FCRF

That division is only safe when the official rate is the rate the World Bank itself uses to turn the
country's figures into dollars, in the same currency unit and for the same twelve months, and it is not
always. So the official rate is first checked against the rate implied by the World Bank's own GDP
figures, whose units cancel:

    implied rate = PA.NUS.PPP / (NY.GDP.PCAP.CD / NY.GDP.PCAP.PP.CD)

(For 2024 this is the Bank's published "DEC alternative conversion factor", PA.NUS.ATLS, to within 0.1%
for every country in the file: the review of the page checked.) Where the two agree to within 2% the
formula above is used and the exchange rate is kept. Otherwise the level is built from ratios alone, no
exchange rate is kept, and the reason is recorded in "noRate":

    level = (PA.NUS.PRVT.PP / PA.NUS.PPP) x (NY.GDP.PCAP.CD / NY.GDP.PCAP.PP.CD)

  "missing"  the World Bank gives no official rate for the year (for 2024: Afghanistan, Guinea, Iran,
             Malawi, Mauritania, Sierra Leone, West Bank and Gaza)
  "differs"  it gives one, but more than 2% from the rate it uses itself. The World Bank's country notes
             give the reasons. A different currency unit: Bulgaria (series restated in euros, which it
             adopted in January 2026, while the official rate is in leva) and Liberia (accounts kept in US
             dollars, official rate in Liberian dollars). National accounts for a fiscal year, with a
             conversion rate for the same months: Bangladesh, Egypt, Ethiopia. More than one exchange rate
             in use, so that the Bank converts at its own estimate: Angola, Burundi, Ethiopia.

The first ratio is household prices relative to prices across the whole economy; the second is the price
level of GDP at the rate the World Bank used to turn GDP into dollars. The page then works in US dollars
only for that country. The script prints which countries these are.

The BEA tables set the United States to 100 for all items only. Its national figures for the four parts
are close to 100 but not equal to it; they are kept as "us" so that the page can say so.

Cleaning rules:
  * Only 2024 is used, to match the BEA figures. A country missing any of the first four series for 2024
    is left out. World Bank aggregates (regions, income groups) are left out.
  * A few World Bank names are shortened (RENAME below). Nothing else is edited by hand.
  * BEA names lose the suffix "(Metropolitan Statistical Area)", which one row carries without its
    brackets, and any footnote star.
  * Values are rounded: parities to 0.001 as published, country levels to 5 significant figures, exchange
    rates to 6 significant figures.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import io
import json
import re
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "33" / "data.js"
UA = {"User-Agent": "varad-patel-365projects/1.0 (https://varad-patel.github.io)"}
YEAR = 2024
BEA_ZIP = "https://apps.bea.gov/regional/zip/{table}.zip"
WB_URL = "https://api.worldbank.org/v2/country/all/indicator/{ind}?format=json&per_page=1000&date={year}"
WB_COUNTRIES = "https://api.worldbank.org/v2/country?format=json&per_page=400"
INDICATORS = ["PA.NUS.PRVT.PP", "PA.NUS.PPP", "NY.GDP.PCAP.CD", "NY.GDP.PCAP.PP.CD", "PA.NUS.FCRF"]
PARTS = {1: "all", 2: "goods", 3: "housing", 4: "utilities", 5: "other"}
RENAME = {
    "Bahamas, The": "Bahamas", "Congo, Rep.": "Congo (Brazzaville)", "Congo, Dem. Rep.": "Congo (Kinshasa)",
    "Egypt, Arab Rep.": "Egypt", "Gambia, The": "Gambia", "Hong Kong SAR, China": "Hong Kong", "Iran, Islamic Rep.": "Iran",
    "Korea, Rep.": "South Korea", "Macao SAR, China": "Macao", "Micronesia, Fed. Sts.": "Micronesia",
    "Venezuela, RB": "Venezuela", "Yemen, Rep.": "Yemen", "Somalia, Fed. Rep.": "Somalia",
}


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                    path.write_bytes(r.read())
                break
            except OSError:
                if attempt == 3:
                    raise
    return path


def bea(table: str, cache: Path):
    """Rows of one BEA table for YEAR: {fips: {"name": ..., "all": ..., "goods": ...}} and the 'last updated' note."""
    archive = zipfile.ZipFile(fetch(BEA_ZIP.format(table=table), cache / f"{table}.zip"))
    name = next(n for n in archive.namelist() if re.fullmatch(rf"{table}_[A-Z]+_\d{{4}}_\d{{4}}\.csv", n))
    text = archive.read(name).decode("latin-1")
    updated = re.search(r"Last updated: ([A-Z][a-z]+ \d{1,2}, \d{4})", text)
    rows: dict[str, dict] = {}
    for r in csv.DictReader(io.StringIO(text), skipinitialspace=True):
        if not r.get("LineCode") or not r["LineCode"].strip().isdigit():
            continue  # the notes under the table
        value = r[str(YEAR)].strip()
        if value in ("(NA)", ""):
            continue
        place = rows.setdefault(r["GeoFIPS"].strip().strip('"'), {"name": re.sub(r"\s*\(?Metropolitan Statistical Area\)?", "", re.sub(r"\s*\*$", "", r["GeoName"].strip()))})
        place[PARTS[int(r["LineCode"])]] = float(value)
    return rows, (updated.group(1) if updated else "")


def world_bank(ind: str, cache: Path) -> tuple[dict[str, float], str]:
    body = json.loads(fetch(WB_URL.format(ind=ind, year=YEAR), cache / f"wb-{ind}-{YEAR}.json").read_text(encoding="utf-8"))
    return {r["countryiso3code"]: r["value"] for r in body[1] if r["value"] is not None and r["countryiso3code"]}, body[0]["lastupdated"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    ap.add_argument("--retrieved", default=None, help="date the files were downloaded, if the cache is older than today")
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp())
    cache.mkdir(parents=True, exist_ok=True)

    keys = list(PARTS.values())
    row = lambda p: [p["name"], *[round(p[k], 3) for k in keys]]

    metro_rows, bea_updated = bea("MARPP", cache)
    state_rows, _ = bea("SARPP", cache)
    assert metro_rows["00000"]["all"] == 100 and state_rows["00000"]["all"] == 100, "the United States should be 100"
    complete = lambda p: all(k in p for k in keys)
    metros = sorted((row(p) for fips, p in metro_rows.items() if fips not in ("00000", "00999") and complete(p)), key=lambda r: r[0])
    states = sorted((row(p) for fips, p in state_rows.items() if fips != "00000" and complete(p)), key=lambda r: r[0])
    rural = row(metro_rows["00999"])
    rural[0] = "United States, non-metropolitan portion"
    us = [round(metro_rows["00000"][k], 3) for k in keys]
    assert us == [round(state_rows["00000"][k], 3) for k in keys], "the two tables should agree about the United States"

    series = {}
    wb_updated = ""
    for ind in INDICATORS:
        series[ind], wb_updated = world_bank(ind, cache)
    listing = json.loads(fetch(WB_COUNTRIES, cache / "wb-countries.json").read_text(encoding="utf-8"))[1]
    real = {c["id"]: c["name"] for c in listing if c["region"]["value"] != "Aggregates"}

    countries, no_rate = [], {}
    for iso, name in real.items():
        if any(iso not in series[ind] for ind in INDICATORS[:4]):
            continue
        hh, gdp, usd, intl = (series[ind][iso] for ind in INDICATORS[:4])
        implied = gdp / (usd / intl)                    # the exchange rate behind the World Bank's own GDP figures
        official = series["PA.NUS.FCRF"].get(iso)
        if official and abs(official / implied - 1) < 0.02:
            level, rate = hh / official, float(f"{official:.6g}")
        else:
            level, rate = (hh / gdp) * (usd / intl), None
            no_rate[iso] = "differs" if official else "missing"
        countries.append([iso, RENAME.get(name, name), float(f"{level:.5g}"), rate])
    countries.sort(key=lambda r: r[1])
    usa = next(c for c in countries if c[0] == "USA")
    assert usa[2] == 1 and usa[3] == 1, "the United States should be exactly 1"

    data = {
        "year": YEAR,
        "retrieved": args.retrieved or datetime.date.today().isoformat(),
        "bea": f"U.S. Bureau of Economic Analysis, Regional Price Parities by metropolitan area (MARPP) and by state (SARPP), last updated {bea_updated}. Public domain.",
        "worldBank": f"World Bank, World Development Indicators, last updated {wb_updated}: PA.NUS.PRVT.PP, PA.NUS.PPP, NY.GDP.PCAP.CD, NY.GDP.PCAP.PP.CD, PA.NUS.FCRF. CC BY 4.0.",
        "parts": keys,
        "us": us,
        "noRate": dict(sorted(no_rate.items())),
    }
    head = json.dumps(data, ensure_ascii=False, indent=2)[:-2]
    lines = lambda table: ",\n".join("    " + json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in table)
    text = (
        "// GENERATED by scripts/data/costofliving.py. Do not edit by hand.\n"
        f"// Price levels for {YEAR}. metros, states and rural: [name, all items, goods, housing (rents), utilities, other services],\n"
        "// each a BEA regional price parity with the United States average at 100.\n"
        "// countries: [ISO code, name, price level of household consumption with the United States at 1,\n"
        "//   official exchange rate in local currency per US dollar, or null where it cannot be used].\n"
        "// us: the United States row of the BEA tables, in the order of parts. noRate: why a country has no exchange rate here,\n"
        '//   "missing" (the World Bank gives none for the year) or "differs" (it is not the rate the World Bank itself converts at).\n'
        f"export const COST = {head},\n"
        f'  "metros": [\n{lines(metros)}\n  ],\n'
        f'  "states": [\n{lines(states)}\n  ],\n'
        f'  "rural": {json.dumps(rural, separators=(",", ":"))},\n'
        f'  "countries": [\n{lines(countries)}\n  ]\n'
        "};\n"
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(metros)} metropolitan areas, {len(states)} states, {len(countries)} countries, {len(text) / 1024:.0f} KB")
    for why in ("missing", "differs"):
        print(f"no usable exchange rate, {why}: {', '.join(sorted(real[i] for i in no_rate if no_rate[i] == why))}")


if __name__ == "__main__":
    main()
