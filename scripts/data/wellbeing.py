"""Build 365projects/data/wellbeing.js, the country panel shared by projects 1, 8 and 9.

    pip install openpyxl
    python scripts/data/wellbeing.py [--cache DIR]

Sources (downloaded into --cache, never committed):
  * World Happiness Report 2026, "Data for Figure 2.1": three-year average life evaluation
    (Cantril ladder, 0 to 10, Gallup World Poll) per country, its 95% interval, and for recent
    years the contribution the report assigns to each of six factors.
    https://worldhappiness.report/data-sharing/
  * World Bank, World Development Indicators (CC BY 4.0): GDP per capita, PPP, constant 2021
    international $ (NY.GDP.PCAP.PP.KD) and life expectancy at birth (SP.DYN.LE00.IN).

A WHR year Y is the average of surveys from Y-2 to Y, so the World Bank series are averaged over
the same three years (using whichever of those years exist).
"""

from __future__ import annotations

import argparse
import json
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "data" / "wellbeing.js"
UA = {"User-Agent": "varad-patel-365projects/1.0 (https://varad-patel.github.io)"}
WHR_URL = "https://files.worldhappiness.report/WHR26_Data_Figure_2.1.xlsx"
WB_URL = "https://api.worldbank.org/v2/country/all/indicator/{ind}?format=json&per_page=20000&date=2009:2025"
WB_COUNTRIES = "https://api.worldbank.org/v2/country?format=json&per_page=400"

# WHR names that differ from the World Bank's. None: the World Bank publishes no series for it.
ISO3 = {
    "Congo": "COG", "Côte d’Ivoire": "CIV", "DR Congo": "COD", "Egypt": "EGY", "Gambia": "GMB",
    "Hong Kong SAR of China": "HKG", "Iran": "IRN", "Kyrgyzstan": "KGZ", "North Cyprus": None, "Puerto Rico": "PRI",
    "Republic of Korea": "KOR", "Republic of Moldova": "MDA", "Slovakia": "SVK", "Somalia": "SOM",
    "Somaliland Region": None, "State of Palestine": "PSE", "Swaziland": "SWZ", "Syria": "SYR",
    "Taiwan Province of China": None, "Türkiye": "TUR", "Venezuela": "VEN", "Yemen": "YEM",
}
SHORT = {
    "Republic of Korea": "South Korea", "Republic of Moldova": "Moldova", "Hong Kong SAR of China": "Hong Kong",
    "Taiwan Province of China": "Taiwan", "State of Palestine": "Palestine", "Swaziland": "Eswatini",
    "Russian Federation": "Russia", "Viet Nam": "Vietnam", "Lao PDR": "Laos",
    "Congo": "Congo (Brazzaville)", "Somaliland Region": "Somaliland", "Côte d’Ivoire": "Côte d'Ivoire",
}
REGION_FIX = {"North Cyprus": "Europe & Central Asia", "Somaliland Region": "Sub-Saharan Africa", "Taiwan Province of China": "East Asia & Pacific"}
FACTORS = ["income", "social", "health", "freedom", "generosity", "corruption"]


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
            path.write_bytes(r.read())
    return path


def r3(x):
    return None if x is None else round(float(x), 3)


def main() -> None:
    import openpyxl

    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp())
    cache.mkdir(parents=True, exist_ok=True)

    sheet = openpyxl.load_workbook(fetch(WHR_URL, cache / "whr26.xlsx"), read_only=True, data_only=True).worksheets[0]
    rows = [r[:13] for r in sheet.iter_rows(min_row=2, values_only=True) if r[0]]

    wb_meta = json.loads(fetch(WB_COUNTRIES, cache / "wb_countries.json").read_text(encoding="utf-8"))[1]
    by_name = {c["name"]: c for c in wb_meta if c["region"]["value"] != "Aggregates"}
    by_iso = {c["id"]: c for c in wb_meta}
    series = {}
    for key, ind in (("gdp", "NY.GDP.PCAP.PP.KD"), ("life", "SP.DYN.LE00.IN")):
        data = json.loads(fetch(WB_URL.format(ind=ind), cache / f"wb_{ind}.json").read_text(encoding="utf-8"))[1]
        series[key] = {(d["countryiso3code"], int(d["date"])): d["value"] for d in data if d["value"] is not None}

    def window(key, iso, year):
        vals = [series[key][(iso, y)] for y in (year - 2, year - 1, year) if (iso, y) in series[key]]
        return sum(vals) / len(vals) if vals else None

    years = sorted({int(r[0]) for r in rows})
    countries = {}
    unmatched = []
    for r in rows:
        year, name = int(r[0]), r[2]
        iso = ISO3[name] if name in ISO3 else by_name.get(name, {}).get("id")
        if name not in ISO3 and iso is None:
            unmatched.append(name)
        c = countries.setdefault(name, {
            "name": SHORT.get(name, name), "iso3": iso,
            "region": REGION_FIX.get(name) or (by_iso[iso]["region"]["value"].strip() if iso else None),
            "rows": {},
        })
        gdp = window("gdp", iso, year) if iso else None
        life = window("life", iso, year) if iso else None
        factors = [r3(v) for v in r[6:12]]
        c["rows"][year] = {
            "ladder": r3(r[3]), "lo": r3(r[4]), "hi": r3(r[5]), "rank": int(r[1]) if r[1] else None,
            "factors": factors if all(v is not None for v in factors) else None,
            "gdp": None if gdp is None else round(gdp), "life": None if life is None else round(life, 2),
        }
    if unmatched:
        raise SystemExit(f"no ISO code for: {sorted(set(unmatched))}")

    out = {
        "source": {
            "whr": "World Happiness Report 2026, Data for Figure 2.1 (Gallup World Poll, three-year averages)",
            "wb": "World Bank, World Development Indicators: NY.GDP.PCAP.PP.KD and SP.DYN.LE00.IN (CC BY 4.0)",
            "retrieved": "2026-10-10",
        },
        "years": years,
        "factors": FACTORS,
        "countries": [
            {
                "name": c["name"], "iso3": c["iso3"], "region": c["region"],
                # One array per field, aligned with "years"; null where there is no value.
                "ladder": [c["rows"].get(y, {}).get("ladder") for y in years],
                "lo": [c["rows"].get(y, {}).get("lo") for y in years],
                "hi": [c["rows"].get(y, {}).get("hi") for y in years],
                "rank": [c["rows"].get(y, {}).get("rank") for y in years],
                "gdp": [c["rows"].get(y, {}).get("gdp") for y in years],
                "life": [c["rows"].get(y, {}).get("life") for y in years],
                "factors": [c["rows"].get(y, {}).get("factors") for y in years],
            }
            for c in sorted(countries.values(), key=lambda c: c["name"])
        ],
    }
    OUT.write_text(
        "// Generated by scripts/data/wellbeing.py. Do not edit by hand.\n"
        "// World Happiness Report 2026 (Figure 2.1) joined to World Bank GDP per capita and life expectancy.\n"
        "export const WELLBEING = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n",
    )
    latest = years[-1]
    i = years.index(latest)
    full = [c for c in out["countries"] if c["ladder"][i] is not None and c["gdp"][i] and c["life"][i] and c["factors"][i]]
    with_f = {y: sum(1 for c in out["countries"] if c["factors"][years.index(y)]) for y in years}
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB): {len(out['countries'])} countries, years {years[0]} to {latest}")
    print(f"complete rows in {latest}: {len(full)}; countries with factor data by year: {with_f}")
    print("no World Bank match:", [c["name"].encode("ascii", "replace").decode() for c in out["countries"] if not c["iso3"]])
    print("regions:", sorted({c["region"] for c in out["countries"]}))


if __name__ == "__main__":
    main()
