"""Build 365projects/46/data.js, the survey shares and Gini indices behind project 46.

    python scripts/data/pip_inequality.py [--cache DIR] [--retrieved YYYY-MM-DD]

Source (downloaded into --cache, never committed):
  World Bank, Poverty and Inequality Platform (PIP), https://pip.worldbank.org, through its public API:
    https://api.worldbank.org/pip/v1/pip?country=all&year=all&fill_gaps=false&reporting_level=all
        &release_version=20260922&ppp_version=2021&format=json
  One row per country, survey year, kind of survey (income or consumption) and reporting level, with the
  share of the total held by each tenth of the population (decile1 to decile10), the Gini index the Bank
  computes from the full distribution, and the Bank's comparability code. The release is pinned, so a later
  run downloads the same figures.

Licence: Creative Commons Attribution 4.0 (CC BY 4.0), the World Bank's licence for its open data.

Cleaning rules:
  * Only survey estimates are requested (fill_gaps=false): nothing interpolated or extrapolated.
  * Rows that report the whole country (reporting_level "national") are kept. Rows for urban or rural areas
    alone are dropped where the country also has national rows (China's urban and rural halves, and early
    urban-only or rural-only surveys in a handful of countries). Argentina has no national rows, because its
    survey covers urban areas only: its urban rows are kept and the series is labelled "urban".
  * A series is one country and one kind of survey. A country with both income and consumption surveys has
    two series, never mixed.
  * The year is PIP's reporting_year.
  * Shares and the Gini index are published as fractions to four decimal places. They are stored multiplied
    by 10,000 as whole numbers (a share of 0.4017 is 4017; a Gini of 0.5195 is 5195), exactly as published.
    Nothing is rescaled: the ten shares of a survey add up to between 9,997 and 10,003.
  * The comparability code (survey_comparability) is kept as published: within a country it starts at 0 and
    changes whenever the Bank judges that the survey or its welfare measure changed.
  * distribution_type becomes a code: 0 household records ("micro"), 1 grouped data ("group"),
    2 a national distribution put together from grouped urban and rural data ("synthetic"),
    3 survey-to-survey imputation ("imputed").
  * Country names are the World Bank's own, except nine that it writes in catalogue order ("Egypt, Arab Rep."),
    which are given their ordinary short English names so that they can be used in a sentence: see RENAME.
    "Taiwan, China" is left as the Bank writes it. ISO codes are unchanged.
  * Shares are kept as published even where they are not in ascending order, which shares of tenths ranked
    from poorest to richest should be. There is one such survey, Cote d'Ivoire 2002 (the fourth tenth is given
    6.35% and the fifth 6.19%). The script prints any it finds, and the page flags them.
  * The script stops if a row lacks a share or a Gini index, if a share is not above zero, if the shares of a
    survey do not add up to 1 within 0.001, or if a series has two rows for one year.
"""

from __future__ import annotations

import argparse
import datetime
import json
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "46" / "data.js"
UA = {"User-Agent": "varad-patel-365projects/1.0 (https://varad-patel.github.io)"}
RELEASE = "20260922"
PPP = "2021"
VERSION = f"{RELEASE}_{PPP}_01_02_PROD"
URL = (
    "https://api.worldbank.org/pip/v1/pip?country=all&year=all&fill_gaps=false&reporting_level=all"
    f"&release_version={RELEASE}&ppp_version={PPP}&format=json"
)
FILE = f"pip_{RELEASE}_{PPP}.json"
KIND = {"micro": 0, "group": 1, "synthetic": 2, "imputed": 3}
RENAME = {
    "Congo, Dem. Rep.": "Democratic Republic of the Congo",
    "Congo, Rep.": "Republic of the Congo",
    "Egypt, Arab Rep.": "Egypt",
    "Gambia, The": "Gambia",
    "Iran, Islamic Rep.": "Iran",
    "Korea, Rep.": "South Korea",
    "Micronesia, Fed. Sts.": "Micronesia",
    "Venezuela, RB": "Venezuela",
    "Yemen, Rep.": "Yemen",
}


def fetch(cache: Path) -> list[dict]:
    path = cache / FILE
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(URL, headers=UA), timeout=300) as r:
            path.write_bytes(r.read())
    return json.loads(path.read_text(encoding="utf-8"))


def whole(x: float) -> int:
    """A fraction published to four places, as a whole number of ten-thousandths."""
    v = round(x * 10000)
    if abs(v - x * 10000) > 1e-6:
        raise SystemExit(f"{x} has more than four decimal places: read the source again before rebuilding")
    return v


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    ap.add_argument("--retrieved", default=None, help="date the file was downloaded, if the cache is older than today")
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp())
    cache.mkdir(parents=True, exist_ok=True)

    rows = fetch(cache)
    has_national = {r["country_code"] for r in rows if r["reporting_level"] == "national"}
    series: dict[tuple, list] = {}
    names: dict[str, str] = {}
    for r in rows:
        code = r["country_code"]
        level = r["reporting_level"]
        if level != "national" and (code in has_national or level != "urban"):
            continue
        shares = [r[f"decile{i}"] for i in range(1, 11)]
        if any(s is None for s in shares) or r["gini"] is None:
            raise SystemExit(f"{code} {r['reporting_year']}: a share or the Gini index is missing")
        if min(shares) <= 0 or abs(sum(shares) - 1) > 0.001:
            raise SystemExit(f"{code} {r['reporting_year']}: a share is not above zero, or the ten do not add up to 1")
        if any(b < a for a, b in zip(shares, shares[1:])):
            print(f"note: {code} {r['reporting_year']} ({r['welfare_type']}): shares not in ascending order, kept as published")
        if r["welfare_type"] not in ("income", "consumption") or r["distribution_type"] not in KIND:
            raise SystemExit(f"{code} {r['reporting_year']}: unknown welfare or distribution type")
        names[code] = RENAME.get(r["country_name"], r["country_name"])
        key = (code, r["welfare_type"], level)
        series.setdefault(key, []).append(
            [int(r["reporting_year"]), whole(r["gini"]), int(r["survey_comparability"]), KIND[r["distribution_type"]], *map(whole, shares)]
        )

    missing = set(RENAME) - {r["country_name"] for r in rows}
    if missing:
        raise SystemExit(f"names in RENAME that the source no longer uses: {sorted(missing)}")
    out = []
    for (code, welfare, level), body in sorted(series.items(), key=lambda kv: (names[kv[0][0]], kv[0][1] != "income")):
        body.sort()
        years = [b[0] for b in body]
        if len(set(years)) != len(years):
            raise SystemExit(f"{code} {welfare}: two rows for one year")
        out.append([code, names[code], welfare, level, body])

    head = {
        "source": "World Bank, Poverty and Inequality Platform (PIP), https://pip.worldbank.org",
        "licence": "CC BY 4.0",
        "version": VERSION,
        "api": URL,
        "retrieved": args.retrieved or datetime.date.today().isoformat(),
    }
    lines = ",\n".join("    " + json.dumps(s, ensure_ascii=False, separators=(",", ":")) for s in out)
    text = (
        "// GENERATED by scripts/data/pip_inequality.py. Do not edit by hand.\n"
        f"// World Bank, Poverty and Inequality Platform, version {VERSION}. CC BY 4.0. Retrieved {head['retrieved']}.\n"
        "// series: one entry per country and kind of survey:\n"
        '//   [ISO code, country name, "income" or "consumption", "national" or "urban", rows].\n'
        "// Each row is one survey: [year, the Bank's Gini index x 10,000, the Bank's comparability code,\n"
        "//   how the distribution was obtained (0 household records, 1 grouped data, 2 synthetic, 3 imputed),\n"
        "//   then the share of the total held by each tenth of the population, poorest first, x 10,000].\n"
        f"export const PIP = {json.dumps(head, ensure_ascii=False, indent=2)[:-2]},\n"
        f'  "series": [\n{lines}\n  ]\n'
        "};\n"
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    surveys = sum(len(s[4]) for s in out)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} series, {len(names)} countries, {surveys} surveys, {len(text.encode('utf-8')) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
