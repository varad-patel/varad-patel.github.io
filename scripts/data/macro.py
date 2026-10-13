"""Build 365projects/data/macro.js, the yearly country panel shared by projects 55 and 57.

    pip install openpyxl
    python scripts/data/macro.py [--cache DIR]

For each country and year from 1960 to 2025: real GDP growth, consumer price inflation, and the
unemployment rate under up to two definitions that are kept apart and never joined.

Sources (downloaded into --cache, never committed):
  * World Bank, World Development Indicators (CC BY 4.0), https://api.worldbank.org/v2/
      g      NY.GDP.MKTP.KD.ZG  GDP growth, annual %, constant prices
      p      FP.CPI.TOTL.ZG     Inflation, consumer prices, annual % (from the IMF's International
                                Financial Statistics)
      uIlo   SL.UEM.TOTL.ZS     Unemployment, % of the labour force, modelled ILO estimate, 1991 on.
                                One method for every country, but figures for countries with few
                                surveys are imputed by the ILO's models, and the last year or two
                                are the ILO's projections (see the cleaning rules).
  * OECD Economic Outlook No 119 (Edition 2026/1), https://sdmx.oecd.org/public/rest/
      uOecd  UNR                Unemployment rate, % of the labour force, national definitions, from
                                1960 for the longest series. The OECD links older figures backwards
                                where a country changed its method (database documentation, "Back-
                                splicing of data").
    Licence: not Creative Commons. The CC BY 4.0 licence that the OECD adopted on 1 July 2024 covers
    its written content; data fall under section 3, "Data", of the OECD Terms and Conditions
    (https://www.oecd.org/en/about/terms-conditions.html, last updated 1 July 2024, read 12 October
    2026): "you can extract from, download, copy, adapt, print, distribute, share and embed Data for
    any purpose, even for commercial use", with credit to the OECD "by using the citation associated
    with the relevant Data", and anyone who shares work built on the data must pass the same
    requirement on. The dataset carries no licence statement of its own, only its citation:
    OECD (2026), OECD Economic Outlook No 119 (Edition 2026/1).
  * OECD, "EO119 Last historical points" (xlsx): the last year of each series that is an outturn.
  * ILO, ILOSTAT SDMX service, https://sdmx.ilo.org/rest/ : the ILO's own copy of the modelled
    unemployment rate (dataflow DF_UNE_2EAP_SEX_AGE_RT, total, age 15+), which marks each figure that
    rests on a national survey as a "real value". Used only to find where the estimates stop and the
    projections begin; no ILO figure is copied from it.

Cleaning rules:
  * World Bank aggregates (regions, income groups, the world) are left out; only countries are kept.
  * The Economic Outlook also holds projections. Every OECD value after the country's own "last
    historical observation" for UNR is dropped (2025 for all 45 countries in this edition), and so is
    every OECD area that is not a single country (OECD total, euro area).
  * The World Bank's modelled ILO series runs on into the ILO's projections: its figures for the year
    after the last one in which any country reported a real value are the ILO's projections for that
    year, made before the year was over (the ILO's methodological overview of January 2026: "the last
    year with reported information (i.e., 2024)", "the projected period (2025-2027)"). Every modelled
    ILO value after the last year with a reported value is dropped (2025 in this edition), and the
    script stops if the World Bank's figures no longer match the ILO edition it is checked against.
  * A country is kept if it has an OECD unemployment series, or a modelled ILO series together with
    at least 20 years of GDP growth from 1991.
  * Growth and inflation are rounded to two decimal places and unemployment rates to three. Nothing
    is interpolated, filled in or joined: a missing year is null, and the two unemployment series
    are separate arrays.
  * Each series is stored as [first year, [values...]] with leading and trailing gaps trimmed.
  * A few World Bank names are shortened ("Korea, Rep." to "South Korea"); the list is NAMES below.
"""

from __future__ import annotations

import argparse
import csv
import json
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "data" / "macro.js"
UA = {"User-Agent": "varad-patel-365projects/1.0 (https://varad-patel.github.io)"}
FIRST, LAST = 1960, 2025
RETRIEVED = "2026-10-12"
EDITION = "Economic Outlook 119"
WB_URL = "https://api.worldbank.org/v2/country/all/indicator/{ind}?format=json&per_page=20000&date=1960:2025"
WB_COUNTRIES = "https://api.worldbank.org/v2/country?format=json&per_page=400"
WB = {"g": "NY.GDP.MKTP.KD.ZG", "p": "FP.CPI.TOTL.ZG", "uIlo": "SL.UEM.TOTL.ZS"}
# Version 1.5 of the dataflow is edition 119. The script stops if the server answers with another edition.
OECD_URL = ("https://sdmx.oecd.org/public/rest/data/OECD.ECO.MAD,DSD_EO@DF_EO,1.5/.UNR.A"
            "?startPeriod=1950&endPeriod=2026&format=csvfilewithlabels")
OECD_LAST = "https://webfs-eco.oecd.org/files/.Stat/EO119/Last_Historical_observation_EO_119.xlsx"
OECD_TERMS = ('OECD Terms and Conditions, section 3 "Data" (last updated 1 July 2024): free to extract, copy, adapt and share '
              "for any purpose, commercial use included, with credit to the OECD by the citation given with the data. "
              "Not a Creative Commons licence.")
# The ILO's own copy of the modelled unemployment rate (total, 15 and over), with its observation-status flags.
ILO_URL = "https://sdmx.ilo.org/rest/data/ILO,DF_UNE_2EAP_SEX_AGE_RT,1.0/.A..SEX_T.AGE_YTHADULT_YGE15?startPeriod=1991"
ILO_FLOW = "https://sdmx.ilo.org/rest/dataflow/ILO/DF_UNE_2EAP_SEX_AGE_RT/1.0?references=none&detail=full"
AS_CSV = {"Accept": "application/vnd.sdmx.data+csv;version=1.0.0;labels=id"}
AS_JSON = {"Accept": "application/vnd.sdmx.structure+json; charset=utf-8; version=1.0"}

NAMES = {
    "Bahamas, The": "Bahamas", "Brunei Darussalam": "Brunei", "Congo, Dem. Rep.": "DR Congo",
    "Congo, Rep.": "Congo (Brazzaville)", "Cote d'Ivoire": "Côte d'Ivoire", "Egypt, Arab Rep.": "Egypt",
    "Gambia, The": "Gambia", "Hong Kong SAR, China": "Hong Kong", "Iran, Islamic Rep.": "Iran",
    "Korea, Dem. People's Rep.": "North Korea", "Korea, Rep.": "South Korea", "Kyrgyz Republic": "Kyrgyzstan",
    "Lao PDR": "Laos", "Macao SAR, China": "Macao", "Micronesia, Fed. Sts.": "Micronesia",
    "Puerto Rico (US)": "Puerto Rico", "Russian Federation": "Russia", "Slovak Republic": "Slovakia",
    "Syrian Arab Republic": "Syria", "Turkiye": "Türkiye", "Venezuela, RB": "Venezuela", "Viet Nam": "Vietnam",
    "Yemen, Rep.": "Yemen", "Somalia, Fed. Rep.": "Somalia", "Curacao": "Curaçao",
    "Sao Tome and Principe": "São Tomé and Príncipe",
}


def fetch(url: str, path: Path, headers: dict | None = None) -> Path:
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=180) as r:
            path.write_bytes(r.read())
    return path


def trimmed(values: dict[int, float], digits: int):
    """{year: value} to [first year, [values with null for a gap]], or None when empty."""
    years = [y for y in sorted(values) if FIRST <= y <= LAST]
    if not years:
        return None
    return [years[0], [round(values[y], digits) if y in values else None for y in range(years[0], years[-1] + 1)]]


def main() -> None:
    import openpyxl

    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp())
    cache.mkdir(parents=True, exist_ok=True)

    meta = json.loads(fetch(WB_COUNTRIES, cache / "wb_countries.json").read_text(encoding="utf-8"))[1]
    countries = {c["id"]: c["name"].strip() for c in meta if c["region"]["value"] != "Aggregates"}
    wb, updated = {}, set()
    for key, ind in WB.items():
        head, rows = json.loads(fetch(WB_URL.format(ind=ind), cache / f"wb_{ind}.json").read_text(encoding="utf-8"))
        if head["pages"] != 1:
            raise SystemExit(f"{ind}: the World Bank answer has {head['pages']} pages, expected 1")
        updated.add(head["lastupdated"])
        wb[key] = {}
        for r in rows:
            if r["value"] is not None and r["countryiso3code"] in countries:
                wb[key].setdefault(r["countryiso3code"], {})[int(r["date"])] = float(r["value"])

    # Where the ILO's estimates stop and its projections begin: the last year in which any country has a "real value".
    with open(fetch(ILO_URL, cache / "ilo_UNE_2EAP_total_15plus.csv", AS_CSV), encoding="utf-8-sig", newline="") as f:
        ilo_rows = [r for r in csv.DictReader(f) if r["OBS_VALUE"] != ""]
    ilo_last = max(int(r["TIME_PERIOD"]) for r in ilo_rows if r["OBS_STATUS"] == "R")
    projected = {r["REF_AREA"]: float(r["OBS_VALUE"]) for r in ilo_rows if int(r["TIME_PERIOD"]) == ilo_last + 1}
    carried = {iso: s[ilo_last + 1] for iso, s in wb["uIlo"].items() if ilo_last + 1 in s}
    same = sum(1 for iso, v in carried.items() if iso in projected and abs(v - projected[iso]) < 5e-4)
    if carried and same < 0.9 * len(carried):
        raise SystemExit(f"the World Bank's modelled ILO figures for {ilo_last + 1} match the ILO's projections for only {same} of "
                         f"{len(carried)} countries: the two are from different editions, so check where the estimates now end")
    dropped = 0
    for series in wb["uIlo"].values():
        for year in [y for y in series if y > ilo_last]:
            del series[year]
            dropped += 1
    flow = json.loads(fetch(ILO_FLOW, cache / "ilo_dataflow.json", AS_JSON).read_text(encoding="utf-8"))["data"]["dataflows"][0]["name"]
    ilo_edition = flow.split("--")[-1].strip()

    sheet = openpyxl.load_workbook(fetch(OECD_LAST, cache / "EO119_last_hist.xlsx"), read_only=True, data_only=True).worksheets[0]
    last_hist = {r[0]: int(r[7]) for r in sheet.iter_rows(min_row=4, values_only=True) if r[4] == "UNR" and r[7]}
    oecd = {}
    with open(fetch(OECD_URL, cache / "oecd_eo119_UNR.csv"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r["STRUCTURE_NAME"] != EDITION or r["UNIT_MEASURE"] != "PT_LF" or r["FREQ"] != "A":
                raise SystemExit(f"unexpected OECD row: {r['STRUCTURE_NAME']} {r['UNIT_MEASURE']} {r['FREQ']}")
            iso, year = r["REF_AREA"], int(r["TIME_PERIOD"])
            if r["OBS_VALUE"] == "" or iso not in countries:
                continue  # not a single country (OECD total, euro area)
            if iso not in last_hist:
                raise SystemExit(f"{iso}: no last historical observation listed for UNR")
            if year <= last_hist[iso]:
                oecd.setdefault(iso, {})[year] = float(r["OBS_VALUE"])
    for iso, series in oecd.items():
        years = sorted(series)
        if years != list(range(years[0], years[-1] + 1)):
            raise SystemExit(f"{iso}: the OECD unemployment series has a gap")

    out = []
    for iso, name in countries.items():
        g, p, ilo, long = (d.get(iso, {}) for d in (wb["g"], wb["p"], wb["uIlo"], oecd))
        if not long and not (ilo and sum(1 for y in g if y >= 1991) >= 20):
            continue
        if not g:
            continue
        out.append({"iso3": iso, "name": NAMES.get(name, name), "g": trimmed(g, 2), "p": trimmed(p, 2),
                    "uIlo": trimmed(ilo, 3), "uOecd": trimmed(long, 3)})
    out.sort(key=lambda c: c["name"])
    if len(updated) != 1:
        raise SystemExit(f"the World Bank series were updated on different dates: {updated}")

    data = {
        "source": {
            "wb": "World Bank, World Development Indicators (CC BY 4.0), database last updated " + updated.pop(),
            "oecd": "OECD (2026), OECD Economic Outlook No 119 (Edition 2026/1), historical data to 27 May 2026",
            "oecdTerms": OECD_TERMS,
            "ilo": f"{ilo_edition}: estimates to {ilo_last}; the projections for later years that the World Bank series also carries are left out",
            "retrieved": RETRIEVED,
        },
        "first": FIRST, "last": LAST, "lastIlo": ilo_last,
        "series": {
            "g": "Real GDP growth, annual % (World Bank NY.GDP.MKTP.KD.ZG)",
            "p": "Consumer price inflation, annual % (World Bank FP.CPI.TOTL.ZG)",
            "uIlo": f"Unemployment, % of labour force, modelled ILO estimate (World Bank SL.UEM.TOTL.ZS), to {ilo_last}",
            "uOecd": "Unemployment rate, % of labour force, national definitions (OECD Economic Outlook 119, UNR)",
        },
        # Each series is [first year, [one value per year, null for a gap]], or null when the country has none.
        "countries": out,
    }
    OUT.write_text(
        "// Generated by scripts/data/macro.py. Do not edit by hand.\n"
        "// Yearly real GDP growth, consumer price inflation and unemployment by country, 1960 to 2025.\n"
        "// World Bank World Development Indicators (CC BY 4.0) and OECD Economic Outlook No 119. Retrieved " + RETRIEVED + ".\n"
        "// The OECD series is not under a Creative Commons licence. It is reused under section 3 (Data) of the OECD Terms and\n"
        "// Conditions: any purpose, commercial use included, with credit to the OECD, and anyone who passes this file on must keep\n"
        "// that credit. Cite as: OECD (2026), OECD Economic Outlook No 119 (Edition 2026/1).\n"
        "// The modelled ILO series stops at " + str(ilo_last) + ": later years in the World Bank's series are the ILO's projections and are left out.\n"
        "export const MACRO = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n",
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB): {len(out)} countries, "
          f"{sum(1 for c in out if c['uOecd'])} with an OECD series, {sum(1 for c in out if c['uIlo'])} with an ILO series")
    print(f"ILO: {ilo_edition}; last year with a reported value {ilo_last}; {dropped} projected values dropped; "
          f"{same} of {len(carried)} World Bank figures for {ilo_last + 1} equal the ILO's projection")
    print("OECD series from:", {c["iso3"]: c["uOecd"][0] for c in out if c["uOecd"]})
    print("no inflation:", [c["iso3"] for c in out if not c["p"]])


if __name__ == "__main__":
    main()
