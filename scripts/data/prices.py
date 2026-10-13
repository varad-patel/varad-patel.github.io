"""Build 365projects/data/prices.js: consumer price indices by category of spending, with the
official basket weights, monthly, for 18 European countries, the euro area, the European Union
and the United Kingdom. Shared by
projects 31 (What Is Driving Inflation?) and 32 (Personal Inflation Calculator).

    python scripts/data/prices.py                 download everything again and rewrite the snapshot
    python scripts/data/prices.py --cache DIR     keep the downloads in DIR; a second run with the same DIR
                                                  rebuilds the same file without touching the network

The script only needs the standard library. It writes the module only after every check below has
passed, so a failed refresh leaves the old snapshot in place.

Sources (downloaded into --cache, never committed):
  * Eurostat, Harmonised Index of Consumer Prices (HICP), ECOICOP version 2:
      prc_hicp_minr  monthly index (2025 = 100) and annual rate of change, by division
      prc_hicp_iw    item weights, parts per 1,000 of the country's basket, one set a year
      prc_hicp_ctr   Eurostat's own contributions to euro-area annual inflation (used only as a check)
    through the dissemination API. Eurostat's copyright notice authorises reuse of its statistical data
    for commercial or non-commercial purposes provided the source is acknowledged.
  * Office for National Statistics, Consumer price inflation time series (MM23): the CPI index
    (2015 = 100) and weights for the 12 COICOP divisions, the published annual rate, and the ONS's own
    contributions to the annual rate (used only as a check). Open Government Licence v3.0.

What is kept
  * Months from December 2013 to the latest month for which some country has the headline index
    and every division. Flash estimates (headline only) are dropped, so each country's series ends at
    its last complete month and may end a month before another's.
  * 13 ECOICOP ver. 2 divisions (CP01 to CP13) for the Eurostat countries, 12 COICOP divisions for
    the United Kingdom, which Eurostat has not covered by division since the UK left the EU.
  * Index values exactly as published (two decimals from Eurostat, one for Italy and for the UK),
    weights as published, and the published all-items annual rate.
  * Eurostat's status flags on the index values kept: "e" (estimated) and "u" (low reliability), as runs of
    months for each series. The pages say so when a period uses a flagged figure. The ONS file carries no flags.
    (Eurostat also flags France's weights for 2014 and 2015 as estimated; its indices for those years carry
    the same flag, so no separate record is kept.)

Cleaning rules
  * Nothing is interpolated, rescaled or filled in. A value that was not published is null.
  * A country is refused (the script stops) if it has a gap before its last complete month, if a
    year's weights do not add up to 1,000, or if any check below fails.

Checks, run on every build
  1. Weights add up to 1,000 (within 0.5) for every country and year.
  2. The published annual rate equals the rate worked out from the published index, rounded half
     away from zero, for every Eurostat country and month. (Not true of the UK, where the ONS works
     the rate out from unrounded indices; the mismatches are counted and printed.)
  3. Contributions to the 12-month rate, by the chain-linked ("Ribe") formula in
     365projects/31/logic.js, add up to the rate from the index within 0.03 points where indices
     have two decimals and 0.16 points where they have one.
  4. The same contributions for the euro area match prc_hicp_ctr within 0.011 points, and those for
     the UK match the ONS's published contributions within 0.035 points, in every month.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import tempfile
import urllib.request
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "data" / "prices.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; varad-patel-365projects/1.0; +https://varad-patel.github.io)"}
ESTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{code}?format=JSON&{query}"
ONS_MM23 = "https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/datasets/consumerpriceindices/current/mm23.csv"

FIRST = (2013, 12)  # first month kept: December 2013, the base for chain-linking 2014
# Eurostat code, name shown. EA is the euro area as it was in each month (19 members in 2015, 21 in 2026).
GEOS = [
    ("EA", "Euro area"), ("EU27_2020", "European Union (27 countries)"),
    ("AT", "Austria"), ("BE", "Belgium"), ("CZ", "Czechia"), ("DK", "Denmark"), ("FI", "Finland"), ("FR", "France"),
    ("DE", "Germany"), ("EL", "Greece"), ("HU", "Hungary"), ("IE", "Ireland"), ("IT", "Italy"), ("NL", "Netherlands"),
    ("NO", "Norway"), ("PL", "Poland"), ("PT", "Portugal"), ("ES", "Spain"), ("SE", "Sweden"), ("CH", "Switzerland"),
]
DIVISIONS = [f"CP{i:02d}" for i in range(1, 14)]
# Short names for chart legends and narrow screens. The full names come from Eurostat's own labels.
SHORT2 = {
    "CP01": "Food and soft drinks", "CP02": "Alcohol and tobacco", "CP03": "Clothing and footwear",
    "CP04": "Housing and household energy", "CP05": "Furnishings and household goods", "CP06": "Health",
    "CP07": "Transport", "CP08": "Information and communication", "CP09": "Recreation, sport and culture",
    "CP10": "Education", "CP11": "Restaurants and accommodation", "CP12": "Insurance and financial services",
    "CP13": "Personal care and other",
}
# United Kingdom: the 12 divisions of the 1999 COICOP, as the ONS names them in its CPI tables.
# (index series, weight series, published contribution to the annual rate, code, name, short name)
UK_SERIES = [
    ("D7BU", "CHZR", "WUMA", "01", "Food and non-alcoholic beverages", "Food and soft drinks"),
    ("D7BV", "CHZS", "WUMB", "02", "Alcoholic beverages and tobacco", "Alcohol and tobacco"),
    ("D7BW", "CHZT", "WUMC", "03", "Clothing and footwear", "Clothing and footwear"),
    ("D7BX", "CHZU", "WUMD", "04", "Housing, water, electricity, gas and other fuels", "Housing and household energy"),
    ("D7BY", "CHZV", "WUMP", "05", "Furniture, household equipment and maintenance", "Furniture and household goods"),
    ("D7BZ", "CHZW", "WUMQ", "06", "Health", "Health"),
    ("D7C2", "CHZX", "WUMW", "07", "Transport", "Transport"),
    ("D7C3", "CHZY", "WUMX", "08", "Communication", "Communication"),
    ("D7C4", "CHZZ", "WUNC", "09", "Recreation and culture", "Recreation and culture"),
    ("D7C5", "CJUU", "WUND", "10", "Education", "Education"),
    ("D7C6", "CJUV", "WUNE", "11", "Restaurants and hotels", "Restaurants and hotels"),
    ("D7C7", "CJUW", "WUNG", "12", "Miscellaneous goods and services", "Miscellaneous goods and services"),
]
UK_ALL, UK_ALL_W, UK_RATE = "D7BT", "CHZQ", "D7G7"
MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()


def fetch(url: str, path: Path) -> Path:
    """Download once. The day of the download is kept beside the file so a rebuild from the cache is identical."""
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
            body = r.read()
        path.write_bytes(body)
        path.with_suffix(path.suffix + ".date").write_text(dt.date.today().isoformat(), encoding="utf-8")
    return path


def retrieved(path: Path) -> str:
    stamp = path.with_suffix(path.suffix + ".date")
    return stamp.read_text(encoding="utf-8").strip() if stamp.exists() else dt.date.fromtimestamp(path.stat().st_mtime).isoformat()


def jsonstat(path: Path):
    """Eurostat JSON-stat 2.0 to { (code, ...) in the order of d["id"]: value }, plus labels and the update stamp."""
    d = json.loads(path.read_text(encoding="utf-8"))
    ids, size = d["id"], d["size"]
    codes = [sorted(d["dimension"][k]["category"]["index"], key=d["dimension"][k]["category"]["index"].get) for k in ids]
    out = {}
    for key, val in d["value"].items():
        n, coords = int(key), []
        for cs, s in zip(reversed(codes), reversed(size)):
            coords.append(cs[n % s])
            n //= s
        out[tuple(reversed(coords))] = val
    labels = {k: d["dimension"][k]["category"].get("label", {}) for k in ids}
    # Status flags sit beside the values under the same positions; their meanings come with the file.
    flags = {}
    for key, flag in (d.get("status") or {}).items():
        n, coords = int(key), []
        for cs, s in zip(reversed(codes), reversed(size)):
            coords.append(cs[n % s])
            n //= s
        flags[tuple(reversed(coords))] = flag
    labels["status"] = (d.get("extension", {}).get("status") or {}).get("label", {})
    return ids, out, labels, d.get("updated", "")[:10], flags


def month_list(first, last):
    y, m = first
    out = []
    while (y, m) <= last:
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def half_up(x: Decimal, places="0.1") -> Decimal:
    return x.quantize(Decimal(places), rounding=ROUND_HALF_UP)


def contributions(c, months, a, b):
    """Contribution of each category to the all-items change from month index a to month index b, in percentage
    points. The same generalised Ribe formula as 365projects/31/logic.js, written separately as a cross-check."""
    idx, links = c["index"], c["links"]
    is_link = lambda i: months[i][1] in links
    nodes = [a] + [i for i in range(a + 1, b) if is_link(i)] + [b]
    out = [0.0] * (len(idx) - 1)
    for start, end in zip(nodes, nodes[1:]):
        base = max(i for i in range(end) if is_link(i))
        w = c["weights"][months[end][0] - c["weight_year0"]]
        for k in range(len(out)):
            s = idx[k + 1]
            out[k] += 100 * w[k] / sum(w) * (s[end] - s[start]) / s[base] * idx[0][base] / idx[0][a]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", default=None, help="folder for the downloads; reused if the files are already there")
    args = ap.parse_args()
    if args.cache:
        Path(args.cache).mkdir(parents=True, exist_ok=True)
        build(Path(args.cache))
    else:
        # No cache named: download afresh into a folder that is removed afterwards.
        with tempfile.TemporaryDirectory() as tmp:
            build(Path(tmp))


def build(cache: Path) -> None:

    geo_q = "&".join(f"geo={g}" for g, _ in GEOS)
    div_q = "&".join(f"coicop18={c}" for c in ["TOTAL", *DIVISIONS])
    f_idx = fetch(ESTAT.format(code="prc_hicp_minr", query=f"unit=I25&unit=RCH_A&sinceTimePeriod={FIRST[0]}-{FIRST[1]:02d}&{div_q}&{geo_q}"), cache / "prc_hicp_minr.json")
    f_w = fetch(ESTAT.format(code="prc_hicp_iw", query=f"sinceTimePeriod={FIRST[0] + 1}&{div_q}&{geo_q}"), cache / "prc_hicp_iw.json")
    f_ctr = fetch(ESTAT.format(code="prc_hicp_ctr", query=f"sinceTimePeriod={FIRST[0] + 2}-01&geo=EA&" + "&".join(f"coicop18={c}" for c in DIVISIONS)), cache / "prc_hicp_ctr.json")
    f_ons = fetch(ONS_MM23, cache / "mm23.csv")

    ids, X, labels, estat_updated, XF = jsonstat(f_idx)
    if ids != ["freq", "unit", "coicop18", "geo", "time"]:
        raise SystemExit(f"prc_hicp_minr has changed shape: {ids}")
    _, W, _, _, _ = jsonstat(f_w)
    _, CTR, _, _, _ = jsonstat(f_ctr)

    # ---- United Kingdom, from the ONS file: one column per series, one row per period ("2015 JAN").
    rows = list(csv.reader(open(f_ons, encoding="utf-8", errors="replace", newline="")))
    col = {code: i for i, code in enumerate(rows[1])}
    wanted = [UK_ALL, UK_ALL_W, UK_RATE] + [s for row in UK_SERIES for s in row[:3]]
    missing = [s for s in wanted if s not in col]
    if missing:
        raise SystemExit(f"the ONS file no longer has these series: {missing}")
    ons_release = dt.datetime.strptime(rows[4][col[UK_ALL]], "%d-%m-%Y").date().isoformat()
    uk_m, uk_y = {s: {} for s in wanted}, {s: {} for s in wanted}
    for r in rows[7:]:
        monthly = re.fullmatch(r"(\d{4}) ([A-Z]{3})", r[0])
        yearly = re.fullmatch(r"\d{4}", r[0])
        for s in wanted:
            if r[col[s]] == "":
                continue
            if monthly:
                uk_m[s][(int(monthly[1]), MONTHS.index(monthly[2]) + 1)] = float(r[col[s]])
            elif yearly:
                uk_y[s][int(r[0])] = float(r[col[s]])

    # ---- The months kept: December 2013 to the latest month any country has complete.
    def complete_e(g, ym):
        t = f"{ym[0]}-{ym[1]:02d}"
        return all(("M", "I25", c, g, t) in X for c in ["TOTAL", *DIVISIONS])

    def complete_uk(ym):
        return all(ym in uk_m[s] for s in [UK_ALL] + [row[0] for row in UK_SERIES])

    every = month_list(FIRST, (dt.date.today().year + 1, 12))
    last_e = {g: max((ym for ym in every if complete_e(g, ym)), default=None) for g, _ in GEOS}
    last_uk = max((ym for ym in every if complete_uk(ym)), default=None)
    if None in last_e.values() or last_uk is None:
        raise SystemExit("a country has no complete month at all")
    months = month_list(FIRST, max([*last_e.values(), last_uk]))
    weight_years = list(range(FIRST[0] + 1, months[-1][0] + 1))

    countries = []
    for g, name in GEOS:
        t = lambda ym: f"{ym[0]}-{ym[1]:02d}"
        index = [[X.get(("M", "I25", c, g, t(ym))) if ym <= last_e[g] else None for ym in months] for c in ["TOTAL", *DIVISIONS]]
        rate = [X.get(("M", "RCH_A", "TOTAL", g, t(ym))) if ym <= last_e[g] else None for ym in months]
        weights = [[W.get(("A", c, "IW", g, str(y))) for c in DIVISIONS] for y in weight_years]
        # Flags as runs of months: [series (0 is all items), flag, first position, last position].
        flags = []
        for k, c in enumerate(["TOTAL", *DIVISIONS]):
            for i, ym in enumerate(months):
                f = XF.get(("M", "I25", c, g, t(ym))) if ym <= last_e[g] else None
                if not f:
                    continue
                if flags and flags[-1][:2] == [k, f] and flags[-1][3] == i - 1:
                    flags[-1][3] = i
                else:
                    flags.append([k, f, i, i])
        countries.append({"code": g, "name": name, "source": "eurostat", "scheme": "ecoicop2", "links": [12], "base": "2025 = 100",
                          "index": index, "rate": rate, "weights": weights, "flags": flags, "last_ym": last_e[g]})
    countries.append({
        "code": "UK", "name": "United Kingdom", "source": "ons", "scheme": "coicop1999", "links": [12, 1], "base": "2015 = 100",
        "index": [[uk_m[s].get(ym) if ym <= last_uk else None for ym in months] for s in [UK_ALL] + [row[0] for row in UK_SERIES]],
        "rate": [uk_m[UK_RATE].get(ym) if ym <= last_uk and ym[0] > FIRST[0] else None for ym in months],
        "weights": [[uk_y[row[1]].get(y) for row in UK_SERIES] for y in weight_years],
        "flags": [],
        "last_ym": last_uk,
    })
    countries.sort(key=lambda c: (c["code"] not in ("EA", "EU27_2020"), c["name"]))

    # ---- Checks.
    known = {f for c in countries for _, f, _, _ in c["flags"]}
    if not known <= set(labels["status"]):
        raise SystemExit(f"Eurostat uses a status flag it does not explain: {sorted(known - set(labels['status']))}")
    report = []
    for c in countries:
        last = months.index(c["last_ym"])
        c["last"] = last
        c["weight_year0"] = weight_years[0]
        for s in c["index"]:
            if any(v is None or not v > 0 for v in s[: last + 1]):
                raise SystemExit(f"{c['name']}: an index value is missing or not positive before its last complete month")
        years_used = [y for y in weight_years if y <= c["last_ym"][0]]
        for y in years_used:
            w = c["weights"][y - weight_years[0]]
            if any(v is None or v < 0 for v in w) or abs(sum(w) - 1000) > 0.5:
                raise SystemExit(f"{c['name']} {y}: weights are missing or add up to {sum(v or 0 for v in w):.2f}, not 1,000")
        c["decimals"] = max(len(repr(v).split(".")[1]) if "." in repr(v) and not repr(v).endswith(".0") else 0 for s in c["index"] for v in s[: last + 1])
        # 2: the published rate against the published index. 3: contributions against the rate from the index.
        mismatched, worst = 0, 0.0
        for i in range(13, last + 1):
            exact = (Decimal(repr(c["index"][0][i])) / Decimal(repr(c["index"][0][i - 12])) - 1) * 100
            if c["rate"][i] is None:
                raise SystemExit(f"{c['name']}: no published annual rate for {months[i]}")
            if half_up(exact) != Decimal(repr(c["rate"][i])):
                mismatched += 1
            worst = max(worst, abs(sum(contributions(c, months, i - 12, i)) - float(exact)))
        if c["source"] == "eurostat" and mismatched:
            raise SystemExit(f"{c['name']}: {mismatched} published annual rates differ from the rate given by the published index")
        limit = 0.03 if c["decimals"] >= 2 else 0.16
        if worst > limit:
            raise SystemExit(f"{c['name']}: contributions miss the annual rate by {worst:.3f} points, more than {limit}")
        c["mismatched"] = mismatched
        report.append(f"  {c['code']:10s} to {c['last_ym'][0]}-{c['last_ym'][1]:02d}, {c['decimals']} decimals, contributions within {worst:.3f} pt of the rate"
                      + (f", {mismatched} of {last - 12} published rates differ from the rounded index" if mismatched else "")
                      + (f", {sum(r[3] - r[2] + 1 for r in c['flags'])} flagged index values" if c["flags"] else ""))

    # 4: against the two statistical offices' own contributions.
    ea = next(c for c in countries if c["code"] == "EA")
    worst_ea = n_ea = 0
    for i in range(13, ea["last"] + 1):
        mine = contributions(ea, months, i - 12, i)
        for k, code in enumerate(DIVISIONS):
            pub = CTR.get(("M", "PC_PNT", code, "EA", f"{months[i][0]}-{months[i][1]:02d}"))
            if pub is not None:
                n_ea += 1
                worst_ea = max(worst_ea, abs(mine[k] - pub))
    uk = next(c for c in countries if c["code"] == "UK")
    worst_uk = n_uk = 0
    for i in range(13, uk["last"] + 1):
        mine = contributions(uk, months, i - 12, i)
        for k, row in enumerate(UK_SERIES):
            pub = uk_m[row[2]].get(months[i])
            if pub is not None:
                n_uk += 1
                worst_uk = max(worst_uk, abs(mine[k] - pub))
    if n_ea < 1000 or worst_ea > 0.011:
        raise SystemExit(f"euro area: {n_ea} contributions compared with Eurostat's, worst gap {worst_ea:.4f} points")
    if n_uk < 1000 or worst_uk > 0.035:
        raise SystemExit(f"United Kingdom: {n_uk} contributions compared with the ONS's, worst gap {worst_uk:.4f} points")

    # ---- Write.
    out = {
        "retrieved": max(retrieved(f) for f in (f_idx, f_w, f_ons)),
        "sources": {
            "eurostat": {
                "name": "Eurostat, Harmonised Index of Consumer Prices (ECOICOP ver. 2)",
                "tables": "prc_hicp_minr (monthly index and annual rate), prc_hicp_iw (item weights)",
                "licence": "Reuse authorised provided the source is acknowledged", "updated": estat_updated,
                "url": "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
            },
            "ons": {
                "name": "Office for National Statistics, Consumer price inflation time series (MM23)",
                "tables": "CPI index, weights and annual rate for all items and the 12 divisions",
                "licence": "Open Government Licence v3.0", "updated": ons_release,
                "url": "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/consumerpriceindices",
            },
        },
        # Element 0 of every monthly array is this month; arrays run month by month from there.
        "first": f"{FIRST[0]}-{FIRST[1]:02d}",
        "months": len(months),
        "weightYears": weight_years,
        # What Eurostat's status flags mean, in its own words. Each country lists the runs of months that carry one.
        "flagLabels": {f: labels["status"][f] for f in sorted(known)},
        "schemes": {
            "ecoicop2": {"name": "ECOICOP version 2 (13 divisions)", "categories": [{"code": c, "name": labels["coicop18"][c], "short": SHORT2[c]} for c in DIVISIONS]},
            "coicop1999": {"name": "COICOP 1999 (12 divisions)", "categories": [{"code": f"CP{row[3]}", "name": row[4], "short": row[5]} for row in UK_SERIES]},
        },
        "countries": [
            {
                "code": c["code"], "name": c["name"], "source": c["source"], "scheme": c["scheme"],
                # Months of the year after which the index is chain-linked: 12 is December, 1 is January.
                "links": c["links"], "base": c["base"], "decimals": c["decimals"],
                "last": c["last"],  # position of the latest month with the headline and every category
                "rate": c["rate"],  # published all-items annual rate, per cent
                "index": c["index"],  # [all items, category 1, category 2, ...], each one value per month
                "weights": c["weights"],  # one row per year in weightYears: parts per 1,000 for each category
                # Status flags on index values: [series (0 is all items), flag, first month position, last]
                "flags": c["flags"],
            }
            for c in countries
        ],
    }
    text = (
        "// Generated by scripts/data/prices.py. Do not edit by hand.\n"
        "// Consumer price indices by category of spending with the official basket weights, monthly.\n"
        "// Eurostat HICP (ECOICOP ver. 2, reuse authorised with the source acknowledged) and ONS CPI (Open Government Licence v3.0).\n"
        "export const PRICES = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    if "NaN" in text or "Infinity" in text:
        raise SystemExit("the output holds a value that is not a number")
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)

    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB): {len(countries)} countries, "
          f"{months[0][0]}-{months[0][1]:02d} to {months[-1][0]}-{months[-1][1]:02d}, retrieved {out['retrieved']}")
    print(f"Eurostat updated {estat_updated}; ONS release {ons_release}")
    print("\n".join(report))
    print(f"euro area: {n_ea} contributions within {worst_ea:.4f} pt of Eurostat's own (prc_hicp_ctr)")
    print(f"United Kingdom: {n_uk} contributions within {worst_uk:.4f} pt of the ONS's own")


if __name__ == "__main__":
    main()
