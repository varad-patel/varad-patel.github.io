"""Build 365projects/84/data.js: the monthly policy rates, inflation rates and quarterly real GDP behind project 84
(Taylor Rule versus the Central Bank), for the United States and India.

    python scripts/data/taylor_rule.py                 download afresh and rewrite the snapshot
    python scripts/data/taylor_rule.py --cache DIR     keep the downloads in DIR; a second run with the same DIR
                                                       rebuilds the same file without touching the network

Standard library only. The module is written only after every check below passes.

Sources (downloaded into --cache, never committed), with the terms each is used under:

  1. Policy rates. Bank for International Settlements, central bank policy rates (dataflow WS_CBPOL), monthly, end of
     period, https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M.US+IN?format=csv
       US: "From 19 Dec 1985 onwards: mid-point of the Federal Reserve target rate; from 1 Jul 1954 to 18 Dec 1985: US
           Fed Funds effective rate." Kept from January 1986, so every month is the FOMC's target.
       IN: "From 3 Apr 2001 onwards: official repo overnight rate; from 1 Jan 1946 to 2 Apr 2001: [b]ank rate", with the
           note "This rate can be considered the official policy rate as from 2001. The Reserve Bank of India (RBI)
           did not have a single policy rate prior to 2001." Kept from April 2001.
     The RBI's own website restricts reproduction of its material, so its rate is taken from the BIS compilation.
  2. India's consumer and wholesale prices. BIS, long series on consumer prices (WS_LONG_CPI), monthly index,
     https://stats.bis.org/api/v2/data/dataflow/BIS/WS_LONG_CPI/1.0/M.IN+US.?format=csv . The BIS documentation
     (https://www.bis.org/pages/statistics/cp-long-series-documentation.pdf) gives India's compilation as "From Jan
     2013 onwards: Consumer Price Index (2024=100); Apr 1953-Dec 2012: Wholesale Prices Index (Apr 1953=100)",
     sources "Ministry of Statistics and Programme Implementation; Bank for International Settlements". The 12-month
     rate is computed here from the index only when both months are in the same segment, so it is the wholesale
     price index to December 2012, nothing for 2013 (a 2013 rate would compare a consumer price with a wholesale
     price), and the consumer price index from January 2014. The script checks its rates against the BIS's own
     year-on-year series. The consumer price index is MoSPI's all-India CPI (Combined), the index the RBI targets;
     MoSPI moved it to a 2024 base in 2026, and the BIS series links the two, so its rates for 2025 can differ from
     those MoSPI published at the time.
     Terms for 1 and 2 (https://data.bis.org/help/legal, read 14 October 2026): use is unrestricted "provided that:
     if the statistics are reproduced, the BIS must be cited in your publication or product as the source of the
     statistics", the use is not misleading and implies no endorsement, a commercial product adds no charge for them,
     and "nothing in these statistics shall be construed as containing any investment recommendation or advice".
  3. India's consumer price index for industrial workers. OECD, Consumer price indices (DSD_PRICES@DF_PRICES_ALL),
     India, monthly, national CPI, total, growth over one year (GY), as published,
     https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/IND.M.N.CPI.._T.N.
     Its values are the Labour Bureau's CPI for industrial workers: 1.08% for June 2017, 1.79% for July 2017 and 6.46%
     for July 2016, the Labour Bureau's figures as reported when July 2017 was released (Press Trust of India, 31 August
     2017), against 1.46% for June 2017 on the CPI (Combined). Terms: OECD Terms and Conditions, section 3
     "Data" (last updated 1 July 2024; read in a browser on 15 October 2026, https://www.oecd.org/en/about/terms-conditions.html,
     which refuses plain scripted requests): "Except where additional restrictions apply as stated above, you can
     extract from, download, copy, adapt, print, distribute, share and embed Data for any purpose, even for commercial
     use", citing "OECD (year), (dataset name),(data source) DOI or URL (accessed on (date))". The same section leaves
     third parties' rights to the user ("It is the user's responsibility to verify ... whether the Data is fully or
     partially owned by third parties"). The index is the Labour Bureau's (Government of India). Its website's Terms
     and Conditions say "Material featured on this website may be reproduced free of charge ... the source must be
     prominently acknowledged", but its Website Policy says "Contents of this website may not be reproduced partially
     or fully, without due permission from the Labour Bureau" (both read 15 October 2026). The page credits the Labour
     Bureau; whether its permission is needed for rates taken from the OECD is for the site's owner to decide.
  4. US prices and output. US Bureau of Economic Analysis, NIPA flat files https://apps.bea.gov/national/Release/TXT/
     NipaDataM.txt (DPCERG, the PCE price index; DPCCRG, PCE excluding food and energy) and NipaDataQ.txt (A191RX,
     real GDP in chained dollars, seasonally adjusted at annual rates; A191RD, the GDP implicit price deflator).
     Terms (https://www.bea.gov/help/faq/145): "Unless stated otherwise, the information posted on the BEA web site is
     in the public domain and may be used or reproduced without specific permission."
  5. US consumer prices. US Bureau of Labor Statistics, CPI for all urban consumers, all items, US city average, not
     seasonally adjusted (CUUR0000SA0), from the public API (version 1, no key), https://api.bls.gov/publicAPI/v1/.
     Terms (https://www.bls.gov/opub/copyright-information.htm): everything BLS publishes "is in the public domain";
     BLS asks to be cited as the source. BLS published no CPI for October 2025 (a lapse in federal funding), so that
     month and the rate for October 2026 are null.
  6. India's real GDP. World Bank, Global Economic Monitor (source 15 of the World Bank API), GDP at constant prices
     in local currency, seasonally adjusted (NYGDPMKTPSAKN), quarterly,
     https://api.worldbank.org/v2/sources/15/country/IND/series/NYGDPMKTPSAKN/time/all?format=json
     Licence: Creative Commons Attribution 4.0 (World Bank data catalogue, dataset 0037798).

What is kept
  * One value per month from January 1986 to the last month any series reaches; a month a series does not cover is
    null. Nothing is interpolated or carried forward.
  * Inflation: 12-month percentage changes, 100 (P_t / P_t-12 - 1), rounded to two decimals; the OECD rate as
    published. The GDP deflator is quarterly: its 4-quarter change is given to each month of the quarter.
  * Real GDP stays quarterly (the page estimates the output gap from it): US from 1947 in billions of chained
    dollars, India from 1996 in millions of rupees at constant prices.
"""

from __future__ import annotations

import argparse
import csv
import json
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "84" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; data-script/1.0)"}  # anonymous: no name, address or link
RETRIEVED = "2026-10-14"
FIRST = "1986-01"
BIS_POL = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M.US+IN?format=csv"
BIS_CPI = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_LONG_CPI/1.0/M.IN+US.?format=csv"
OECD_CPI = ("https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/IND.M.N.CPI.._T.N."
            "?startPeriod=1950-01&format=csvfilewithlabels")
BEA_M = "https://apps.bea.gov/national/Release/TXT/NipaDataM.txt"
BEA_Q = "https://apps.bea.gov/national/Release/TXT/NipaDataQ.txt"
BLS = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
GEM = "https://api.worldbank.org/v2/sources/15/country/IND/series/NYGDPMKTPSAKN/time/all?format=json&per_page=3000"
BLS_YEARS = [(1984, 1993), (1994, 2003), (2004, 2013), (2014, 2023), (2024, 2026)]


def fetch(url: str, path: Path, body: bytes | None = None) -> Path:
    if not path.exists():
        headers = {**UA, **({"Content-type": "application/json"} if body else {})}
        with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=300) as r:
            path.write_bytes(r.read())
    return path


def months(first: str, last: str) -> list[str]:
    y, m = map(int, first.split("-"))
    out = []
    while f"{y}-{m:02d}" <= last:
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def back(month: str, k: int) -> str:
    y, m = map(int, month.split("-"))
    n = y * 12 + m - 1 - k
    return f"{n // 12}-{n % 12 + 1:02d}"


def yoy(index: dict[str, float], month: str, same_segment=lambda a, b: True):
    prev = back(month, 12)
    if month in index and prev in index and same_segment(month, prev):
        return round(100 * (index[month] / index[prev] - 1), 2)
    return None


def nipa(path: Path, codes: set[str]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {c: {} for c in codes}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if row and row[0] in codes:
                out[row[0]][row[1]] = float(row[2].replace(",", ""))
    for c, v in out.items():
        if not v:
            raise SystemExit(f"BEA: series {c} not found in {path.name}")
    return out


def check(label: str, got, want, tol=1e-9):
    if got is None or abs(got - want) > tol:
        raise SystemExit(f"anchor {label}: {got}, expected {want}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="taylor_"))
    cache.mkdir(parents=True, exist_ok=True)

    # 1. Policy rates.
    policy: dict[str, dict[str, float]] = {"US": {}, "IN": {}}
    with open(fetch(BIS_POL, cache / "bis_cbpol_us_in.csv"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r["FREQ"] != "M" or r["UNIT_MEASURE"] != "368":
                raise SystemExit(f"unexpected BIS policy row {r['FREQ']} {r['UNIT_MEASURE']}")
            if r["OBS_VALUE"] not in ("", "NaN"):
                policy[r["REF_AREA"]][r["TIME_PERIOD"]] = float(r["OBS_VALUE"])
    check("US policy 2008-12", policy["US"]["2008-12"], 0.125)
    check("IN policy 2020-05", policy["IN"]["2020-05"], 4.0)

    # 2. BIS long consumer prices (index 628, year-on-year 771).
    bis_ix: dict[str, dict[str, float]] = {"US": {}, "IN": {}}
    bis_yoy: dict[str, dict[str, float]] = {"US": {}, "IN": {}}
    with open(fetch(BIS_CPI, cache / "bis_long_cpi.csv"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r["OBS_VALUE"] in ("", "NaN"):
                continue
            (bis_ix if r["UNIT_MEASURE"] == "628" else bis_yoy)[r["REF_AREA"]][r["TIME_PERIOD"]] = float(r["OBS_VALUE"])
    segment = lambda m: "cpi" if m >= "2013-01" else "wpi"
    in_cpi = {m: yoy(bis_ix["IN"], m, lambda a, b: segment(a) == segment(b)) for m in bis_ix["IN"]}
    worst = max(abs(v - bis_yoy["IN"][m]) for m, v in in_cpi.items() if v is not None and m in bis_yoy["IN"])
    if worst > 0.006:
        raise SystemExit(f"India: the 12-month rates computed from the BIS index differ from the BIS's own by {worst}")

    # 3. OECD CPI for industrial workers, as published.
    in_iw: dict[str, float] = {}
    with open(fetch(OECD_CPI, cache / "oecd_cpi_ind.csv"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r["TRANSFORMATION"] == "GY" and r["OBS_VALUE"] != "":
                in_iw[r["TIME_PERIOD"]] = round(float(r["OBS_VALUE"]), 2)
    check("OECD India 2017-06", in_iw["2017-06"], 1.08)
    check("OECD India 2020-10", in_iw["2020-10"], 5.9)

    # 4. BEA.
    bm = nipa(fetch(BEA_M, cache / "NipaDataM.txt"), {"DPCERG", "DPCCRG"})
    bq = nipa(fetch(BEA_Q, cache / "NipaDataQ.txt"), {"A191RX", "A191RD"})
    pce = {f"{k[:4]}-{k[5:]}": v for k, v in bm["DPCERG"].items()}
    core = {f"{k[:4]}-{k[5:]}": v for k, v in bm["DPCCRG"].items()}
    check("BEA DPCCRG 2026-08", core["2026-08"], 130.455)
    check("BEA A191RX 2026Q2", bq["A191RX"]["2026Q2"], 24408011)
    quarters = sorted(bq["A191RX"])
    us_gdp = [round(bq["A191RX"][q] / 1000, 1) for q in quarters]
    if quarters[0] != "1947Q1" or len(quarters) != (int(quarters[-1][:4]) - 1947) * 4 + int(quarters[-1][-1]):
        raise SystemExit("BEA: real GDP is not a continuous quarterly series from 1947")
    deflator_q = {}
    for q, v in bq["A191RD"].items():
        prev = f"{int(q[:4]) - 1}{q[4:]}"
        if prev in bq["A191RD"]:
            deflator_q[q] = round(100 * (v / bq["A191RD"][prev] - 1), 2)

    # 5. BLS CPI-U.
    cpi: dict[str, float] = {}
    for a, b in BLS_YEARS:
        body = json.dumps({"seriesid": ["CUUR0000SA0"], "startyear": str(a), "endyear": str(b)}).encode()
        reply = json.loads(fetch(BLS, cache / f"bls_CUUR0000SA0_{a}_{b}.json", body).read_text(encoding="utf-8"))
        if reply.get("status") != "REQUEST_SUCCEEDED":
            raise SystemExit(f"BLS {a}-{b}: {reply.get('status')} {reply.get('message')}")
        for d in reply["Results"]["series"][0]["data"]:
            if d["period"].startswith("M") and d["period"] != "M13" and d["value"] not in ("-", ""):
                cpi[f"{d['year']}-{d['period'][1:]}"] = float(d["value"])
    check("BLS CPI-U 1984-01", cpi["1984-01"], 101.9)
    if "2025-10" in cpi:
        raise SystemExit("BLS now has a CPI for October 2025: update the docstring and the page")

    # 6. World Bank GEM, India real GDP.
    gem = json.loads(fetch(GEM, cache / "gem_ind_gdp_sa_real.json").read_text(encoding="utf-8"))
    in_q = {x["variable"][2]["id"]: x["value"] for x in gem["source"]["data"] if x["value"] is not None and "Q" in x["variable"][2]["id"]}
    in_quarters = sorted(in_q)
    for i in range(1, len(in_quarters)):
        y0, q0 = int(in_quarters[i - 1][:4]), int(in_quarters[i - 1][-1])
        if (y0 * 4 + q0) + 1 != int(in_quarters[i][:4]) * 4 + int(in_quarters[i][-1]):
            raise SystemExit("GEM: India's quarterly GDP has a gap")

    last = max(max(policy["US"]), max(policy["IN"]), max(cpi), max(core), max(in_iw), max(m for m in in_cpi if in_cpi[m] is not None))
    span = months(FIRST, last)

    def col(src: dict, start: str | None = None):
        return [src.get(m) if (start is None or m >= start) else None for m in span]

    def quarter_of(m: str) -> str:
        return f"{m[:4]}Q{(int(m[5:]) - 1) // 3 + 1}"

    data = {
        "retrieved": RETRIEVED, "first": FIRST, "last": last,
        "us": {
            "policy": col(policy["US"]),
            "inflation": {
                "pceCore": col({m: yoy(core, m) for m in span}),
                "pce": col({m: yoy(pce, m) for m in span}),
                "cpi": col({m: yoy(cpi, m) for m in span}),
                "deflator": col({m: deflator_q.get(quarter_of(m)) for m in span}),
            },
            "gdp": {"first": quarters[0], "values": us_gdp, "unit": "billions of chained dollars, seasonally adjusted at annual rates"},
        },
        "in": {
            "policy": col(policy["IN"], "2001-04"),
            "inflation": {"cpi": col(in_cpi), "cpiIw": col(in_iw)},
            "gdp": {"first": in_quarters[0], "values": [round(in_q[q]) for q in in_quarters], "unit": "millions of rupees at constant prices, seasonally adjusted"},
        },
        "sources": {
            "bis": "Bank for International Settlements: central bank policy rates (WS_CBPOL) and long series on consumer prices (WS_LONG_CPI). Free use with the BIS cited as the source.",
            "bea": "US Bureau of Economic Analysis, National Income and Product Accounts: PCE price indexes, real GDP, GDP deflator. Public domain.",
            "bls": "US Bureau of Labor Statistics, CPI-U all items, US city average, not seasonally adjusted (CUUR0000SA0). Public domain.",
            "oecd": "OECD, Consumer price indices: India, national CPI (CPI for industrial workers). OECD Terms and Conditions, section 3: any use with credit to the OECD.",
            "wb": "World Bank, Global Economic Monitor: India, GDP at constant prices, seasonally adjusted (NYGDPMKTPSAKN). CC BY 4.0.",
        },
    }
    OUT.write_text(
        "// Generated by scripts/data/taylor_rule.py. Do not edit by hand.\n"
        f"// Monthly policy rates and 12-month inflation rates for the US and India, {FIRST} to {last}, and quarterly real GDP.\n"
        "// BIS policy rates and long consumer prices (BIS cited as source), BEA and BLS (public domain), OECD (CPI for industrial\n"
        f"// workers; OECD terms: any use with credit), World Bank Global Economic Monitor (CC BY 4.0). Retrieved {RETRIEVED}.\n"
        "// Monthly arrays: index i is the month i months after `first`; null = not covered or not published.\n"
        "export const DATA = " + json.dumps(data, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), {len(span)} months {FIRST} to {last}, cache at {cache}")
    for name, series in [("US policy", data["us"]["policy"]), ("IN policy", data["in"]["policy"])] + \
            [(f"US {k}", v) for k, v in data["us"]["inflation"].items()] + [(f"IN {k}", v) for k, v in data["in"]["inflation"].items()]:
        have = [m for m, v in zip(span, series) if v is not None]
        gaps = [m for m in months(have[0], have[-1]) if series[span.index(m)] is None]
        print(f"  {name:12} {have[0]} to {have[-1]}, {len(gaps)} gaps {gaps[:14]}")
    print(f"  US GDP {quarters[0]} to {quarters[-1]}; IN GDP {in_quarters[0]} to {in_quarters[-1]}; India 12-month rates agree with the BIS's to {worst:.4f}")


if __name__ == "__main__":
    main()
