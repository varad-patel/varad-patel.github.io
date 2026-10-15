"""Build 365projects/78/data.js, the public-finance starting points for project 78 (Government Debt Dynamics).

    pip install openpyxl
    python scripts/data/debt_dynamics.py [--cache DIR]

For each country with the series below, every year from 1995 (or the first year all five exist) to the last
year that is an outturn: general government gross debt as a share of GDP, the primary balance as a share of GDP,
the effective interest rate on the debt and the growth of nominal GDP.

Source (downloaded into --cache, never committed):
  * OECD Economic Outlook No 119 (Edition 2026/1), https://sdmx.oecd.org/public/rest/ , dataflow
    OECD.ECO.MAD,DSD_EO@DF_EO version 1.5, annual:
      GGFLQ   General government gross financial liabilities as a percentage of GDP
      GGFL    General government gross financial liabilities, national currency
      GGINTP  Gross general government interest payments, national currency
      NLGXQ   General government primary balance as a percentage of GDP (net lending excluding net interest)
      GDP     Gross domestic product, nominal value, market prices, national currency
  * OECD, "EO119 Last historical points" (xlsx),
    https://webfs-eco.oecd.org/files/.Stat/EO119/Last_Historical_observation_EO_119.xlsx : the last year of
    each series that is an outturn. Everything later is an OECD projection and is dropped.
  Licence: not Creative Commons. Data fall under section 3, "Data", of the OECD Terms and Conditions
  (https://www.oecd.org/en/about/terms-conditions.html, last updated 1 July 2024): "you can extract from,
  download, copy, adapt, print, distribute, share and embed Data for any purpose, even for commercial use",
  with credit to the OECD by the citation that goes with the data, unless a dataset's metadata says that a third
  party owns it; anyone sharing or licensing work made with the Data must pass the same credit requirement on.
  The wording was read for scripts/data/macro.py on 12 October 2026, and read again in full in a browser on
  14 October 2026 by the page's reviewer (the page answers scripts with a browser check). The dataflow's own
  metadata (https://sdmx.oecd.org/public/rest/dataflow/OECD.ECO.MAD/DSD_EO@DF_EO/1.5, read 14 October 2026)
  names no third-party owner and gives the citation used here.
  Citation: OECD (2026), OECD Economic Outlook No 119 (Edition 2026/1).
  Why not the IMF's World Economic Outlook, which covers more countries: the IMF's terms
  (https://www.imf.org/en/About/copyright-and-terms, read 14 October 2026) allow reuse with attribution but
  say "The IMF prohibits bulk download of information by automated technology without explicit permission",
  which a download script is. The World Bank's debt series in the World Development Indicators,
  GC.DOD.TOTL.GD.ZS, is "Central government debt", not general government.

Construction and cleaning rules:
  * A value is kept only up to the last historical year that the OECD gives for that country and variable.
    A country's last year is the earliest of those across the five series; its first year is the first year
    from 1995 in which all five exist. A country is kept if that span is unbroken and ends in 2024 or later.
    Aggregates (the euro area, the OECD) lack the level series and drop out.
  * Effective interest rate in year t: GGINTP(t) / GGFL(t-1), in percent. This is gross interest paid on all
    debt outstanding, old and new, so it moves slowly when market rates change; interest the government
    receives on its own assets is not netted off.
  * Nominal growth in year t: GDP(t) / GDP(t-1) - 1, in percent.
  * GGFLQ must equal 100 x GGFL / GDP within 0.01 points. Where it does not, the levels are in mixed units
    (in this edition only Bulgaria, 1995 to 1997, before its currency was redenominated), and the country's
    series starts the year after the last such year.
  * Debt and the primary balance are rounded to 3 decimals (percent of GDP) and the two rates to 4 (percent a
    year). A steady state divides by g - r, which can be small, so coarser rounding would move it visibly.
  * The OECD's long country names are kept except "Korea", shown as "South Korea".
"""

from __future__ import annotations

import argparse
import csv
import json
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "78" / "data.js"
UA = {"User-Agent": "365projects-data-script/1.0"}
RETRIEVED = "2026-10-14"
EDITION = "Economic Outlook 119"
MEASURES = ("GGFLQ", "GGFL", "GGINTP", "NLGXQ", "GDP")
EO_URL = ("https://sdmx.oecd.org/public/rest/data/OECD.ECO.MAD,DSD_EO@DF_EO,1.5/.GGFLQ+GGFL+GGINTP+NLGXQ+GDP.A"
          "?startPeriod=1995&endPeriod=2027&format=csvfilewithlabels")
LAST_URL = "https://webfs-eco.oecd.org/files/.Stat/EO119/Last_Historical_observation_EO_119.xlsx"
FIRST = 1995
NAMES = {"Korea": "South Korea"}


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            path.write_bytes(r.read())
    return path


def main() -> None:
    import openpyxl

    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="debt_"))
    cache.mkdir(parents=True, exist_ok=True)

    raw: dict[str, dict[str, dict[int, float]]] = {}
    names: dict[str, str] = {}
    with open(fetch(EO_URL, cache / "eo119.csv"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r["STRUCTURE_NAME"] != EDITION:
                raise SystemExit(f"the server answered with {r['STRUCTURE_NAME']!r}, not {EDITION}")
            if r["OBS_VALUE"] == "":
                continue
            raw.setdefault(r["REF_AREA"], {}).setdefault(r["MEASURE"], {})[int(r["TIME_PERIOD"])] = float(r["OBS_VALUE"])
            names[r["REF_AREA"]] = r["Reference area"]

    sheet = openpyxl.load_workbook(fetch(LAST_URL, cache / "EO119_last_hist.xlsx"), read_only=True, data_only=True).worksheets[0]
    last_hist: dict[tuple[str, str], int] = {}
    for r in sheet.iter_rows(min_row=4, values_only=True):
        if r[4] in MEASURES and r[7]:
            last_hist[(r[0], r[4])] = int(r[7])

    countries = []
    for iso in sorted(raw):
        series = raw[iso]
        if not all(m in series and (iso, m) in last_hist for m in MEASURES):
            continue
        last = min(last_hist[(iso, m)] for m in MEASURES)
        first = next((y for y in range(FIRST, last + 1) if all(y in series[m] for m in MEASURES)), None)
        if first is None or last < 2024 or not all(y in series[m] for m in MEASURES for y in range(first, last + 1)):
            continue
        # A year in which the ratio does not match the two levels mixes units (Bulgaria before its 1999
        # redenomination): the series starts after the last such year.
        bad = [y for y in range(first, last + 1)
               if abs(100 * series["GGFL"][y] / series["GDP"][y] - series["GGFLQ"][y]) > 0.01]
        if bad:
            print(f"{iso}: debt ratio and levels disagree in {bad}; starting in {bad[-1] + 1}")
            first = bad[-1] + 1
        years = range(first, last + 1)
        rate = [None] + [round(100 * series["GGINTP"][y] / series["GGFL"][y - 1], 4) for y in years[1:]]
        growth = [None] + [round(100 * (series["GDP"][y] / series["GDP"][y - 1] - 1), 4) for y in years[1:]]
        countries.append({
            "iso": iso, "name": NAMES.get(names[iso], names[iso]), "first": first, "last": last,
            "debt": [round(series["GGFLQ"][y], 3) for y in years],
            "primary": [round(series["NLGXQ"][y], 3) for y in years],
            "rate": rate, "growth": growth,
        })
    if len(countries) < 20:
        raise SystemExit(f"only {len(countries)} countries kept")

    data = {
        "retrieved": RETRIEVED,
        "edition": "OECD Economic Outlook No 119 (Edition 2026/1)",
        "source": {"name": "OECD Economic Outlook No 119 (Edition 2026/1)", "dataflow": "OECD.ECO.MAD,DSD_EO@DF_EO,1.5",
                   "url": "https://sdmx.oecd.org/public/rest/", "lastHistorical": LAST_URL,
                   "terms": "OECD Terms and Conditions, section 3 (Data): free to extract, copy, adapt and share for any purpose with credit to the OECD."},
        "units": {"debt": "% of GDP (gross financial liabilities)", "primary": "% of GDP (surplus positive)",
                  "rate": "% a year (gross interest paid / last year's debt)", "growth": "% a year (nominal GDP)"},
        "countries": countries,
    }
    text = ("// Generated by scripts/data/debt_dynamics.py. Do not edit by hand.\n"
            "// General government debt, primary balance, effective interest rate and nominal GDP growth, outturns only, from\n"
            f"// OECD Economic Outlook No 119 (Edition 2026/1). Retrieved {RETRIEVED}. For a country, debt[i] is the year first + i;\n"
            "// rate and growth start with null because they need the year before.\n"
            f"export const DEBT = {json.dumps(data, ensure_ascii=False, separators=(',', ':'))};\n")
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT} ({len(text) / 1024:.0f} KB): {len(countries)} countries, last years "
          f"{sorted({c['last'] for c in countries})}")
    for c in countries:
        print(c["iso"], c["name"], c["first"], c["last"], c["debt"][-1], c["primary"][-1], c["rate"][-1], c["growth"][-1])


if __name__ == "__main__":
    main()
