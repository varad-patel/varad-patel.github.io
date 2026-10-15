"""Build 365projects/70/data.js: month-end closes of the Toronto Stock Exchange composite index and its sector indices,
behind project 70 (Fear and Greed Index).

    python scripts/data/tsx_sentiment.py                 download afresh and rewrite the snapshot
    python scripts/data/tsx_sentiment.py --cache DIR     keep the download in DIR; a second run with the same DIR
                                                         rebuilds the same file without touching the network

Standard library only. The module is written only after every check below has passed.

Why these series
  The page builds a market mood index from volatility, momentum and breadth, and needs prices that may be
  republished. Daily index levels and share prices are sold under licence by exchanges and index providers, and the
  volatility indices that commercial "fear" gauges use are proprietary as well. Statistics Canada publishes the
  month-end closes of the Toronto composite and of its sector indices in a table of its own under its Open Licence,
  so the page is built on those, monthly, from January 1956 to September 2023.

Source (downloaded into --cache, never committed):
  Statistics Canada, Table 10-10-0125-01, "Toronto Stock Exchange statistics", monthly, full table as CSV
  (https://www150.statcan.gc.ca/n1/tbl/csv/10100125-eng.zip). The table's notes: "As of January 2017, this data is
  obtained from the Toronto Stock Exchange eReview, TMX Group Inc."; earlier figures came from the Bank of Canada; the
  table ends in September 2023 and is no longer updated.
  Licence: Statistics Canada Open Licence (https://www.statcan.gc.ca/en/terms-conditions/open-licence, modified
  2025-07-10, read 14 October 2026): "Statistics Canada grants you a worldwide, royalty-free, non-exclusive licence
  to: use, reproduce, publish, freely distribute, or sell the Information; use, reproduce, publish, freely
  distribute, or sell Value-added Products". Notices it requires: "Source: Statistics Canada, name of product,
  reference date. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada." and, for a
  value-added product such as this index, "Adapted from Statistics Canada, name of product, reference date. This
  does not constitute an endorsement by Statistics Canada of this product." It also says: "Intellectual property
  rights that third parties may have in the Information shall remain their property": the indices belong to S&P Dow
  Jones Indices and TMX Group, and the page says so.

What is kept
  * The S&P/TSX Composite close, January 1956 to September 2023 (price index: dividends are not included).
  * Seven sector indices of the old TSE 300 (oil and gas, metals and minerals, utilities, paper and forest products,
    merchandising, financial services, gold and silver), January 1956 to June 2003.
  * Ten S&P/TSX sector indices (consumer discretionary, consumer staples, energy, financials, gold, industrials,
    information technology, materials, telecommunication services, utilities), December 1997 to September 2023. The
    diversified metals and mining index stops in July 2016 and is left out, so that the number of sectors does not
    change in the middle of the series.
  * Values as published (two decimals). Nothing is filled in. Names are Statistics Canada's; short names are this
    script's.

Checks, run on every build (any failure stops the script with the reason)
  1. The CSV has the columns REF_DATE, the statistics column, VALUE and STATUS, and every series below.
  2. Each kept series has a value in every month from its first to its last, with no status flag, and every value
     is a positive number, and the first and last months are the ones written below.
  3. The anchor values below (taken on 14 October 2026) are unchanged.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import os
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "70" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; data-snapshot/1.0)"}  # anonymous: no name or address
URL = "https://www150.statcan.gc.ca/n1/tbl/csv/10100125-eng.zip"
COLUMN = "Toronto Stock Exchange Statistics"

# id, Statistics Canada's member name, short name, first month, last month.
COMPOSITE = ("composite", "Standard and Poor's/Toronto Stock Exchange Composite Index, close", "S&P/TSX Composite", "1956-01", "2023-09")
OLD = [
    ("oilgas", "Toronto Stock Exchange, oil and gas, closing quotations", "Oil and gas"),
    ("metals", "Toronto Stock Exchange, metals and minerals, closing quotations", "Metals and minerals"),
    ("utilities_old", "Toronto Stock Exchange, utilities, closing quotations", "Utilities"),
    ("paper", "Toronto Stock Exchange, paper and forest products, closing quotations", "Paper and forest products"),
    ("merch", "Toronto Stock Exchange, merchandising, closing quotations", "Merchandising"),
    ("finance_old", "Toronto Stock Exchange, financial services, closing quotations", "Financial services"),
    ("gold_old", "Toronto Stock Exchange, gold and silver, closing quotations", "Gold and silver"),
]
NEW = [
    ("discretionary", "Standard and Poor's/Toronto Stock Exchange Canadian Consumer Discretionary Index", "Consumer discretionary"),
    ("staples", "Standard and Poor's/Toronto Stock Exchange Canadian Consumer Staples Index", "Consumer staples"),
    ("energy", "Standard and Poor's/Toronto Stock Exchange Canadian Energy Index", "Energy"),
    ("financials", "Standard and Poor's/Toronto Stock Exchange Canadian Financial Index", "Financials"),
    ("gold", "Standard and Poor's/Toronto Stock Exchange Canadian Gold Index", "Gold"),
    ("industrials", "Standard and Poor's/Toronto Stock Exchange Canadian Industrial Index", "Industrials"),
    ("it", "Standard and Poor's/Toronto Stock Exchange Canadian Information Technology Index", "Information technology"),
    ("materials", "Standard and Poor's/Toronto Stock Exchange Canadian Materials Index", "Materials"),
    ("telecom", "Standard and Poor's/Toronto Stock Exchange Canadian Telecommunication Service Index", "Telecommunication services"),
    ("utilities", "Standard and Poor's/Toronto Stock Exchange Canadian Utilities Index", "Utilities"),
]
SPANS = {"old": ("1956-01", "2003-06"), "new": ("1997-12", "2023-09")}
ANCHORS = {("composite", "1956-01"): 525.63, ("composite", "2008-10"): 9762.76, ("composite", "2023-09"): 19541.27,
           ("oilgas", "1987-08"): 4448.65, ("energy", "2020-03"): 60.12}


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            body = r.read()
        path.write_bytes(body)
        path.with_suffix(path.suffix + ".date").write_text(dt.date.today().isoformat(), encoding="utf-8")
    return path


def retrieved(path: Path) -> str:
    stamp = path.with_suffix(path.suffix + ".date")
    return stamp.read_text(encoding="utf-8").strip() if stamp.exists() else dt.date.fromtimestamp(path.stat().st_mtime).isoformat()


def month_list(first: str, last: str) -> list[str]:
    y, m = map(int, first.split("-"))
    out = []
    while f"{y}-{m:02d}" <= last:
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def series(by: dict, member: str, short: str, first: str, last: str) -> list[float]:
    if member not in by:
        raise SystemExit(f"1: the table has no series {member!r}")
    pts = sorted((r["REF_DATE"], r["VALUE"], r["STATUS"]) for r in by[member] if r["VALUE"] not in ("", ".."))
    months = [p[0] for p in pts]
    if months != month_list(first, last):
        raise SystemExit(f"2: {short} runs {months[0]} to {months[-1]} with {len(months)} months, expected {first} to {last} without gaps")
    values = []
    for month, value, status in pts:
        if status:
            raise SystemExit(f"2: {short} {month} carries the status {status!r}")
        v = float(value)
        if not v > 0:
            raise SystemExit(f"2: {short} {month}: {value} is not a positive number")
        values.append(v)
    return values


def build(cache: Path) -> None:
    zpath = fetch(URL, cache / "10100125-eng.zip")
    with zipfile.ZipFile(zpath) as z:
        rows = list(csv.DictReader(io.TextIOWrapper(z.open("10100125.csv"), encoding="utf-8-sig")))
    need = {"REF_DATE", COLUMN, "VALUE", "STATUS"}
    if not rows or not need <= set(rows[0]):
        raise SystemExit(f"1: the CSV lacks the columns {sorted(need - set(rows[0] if rows else []))}")
    by = {}
    for r in rows:
        by.setdefault(r[COLUMN], []).append(r)

    cid, cmember, cshort, cfirst, clast = COMPOSITE
    out = {"composite": {"id": cid, "name": cmember, "short": cshort, "start": cfirst, "values": series(by, cmember, cshort, cfirst, clast)}}
    for key, group in (("old", OLD), ("new", NEW)):
        first, last = SPANS[key]
        out[key] = {"start": first, "sectors": [{"id": sid, "name": member, "short": short, "values": series(by, member, short, first, last)} for sid, member, short in group]}

    def value(sid: str, month: str) -> float:
        if sid == "composite":
            s, start = out["composite"], out["composite"]["start"]
        else:
            g = next(g for g in ("old", "new") if any(x["id"] == sid for x in out[g]["sectors"]))
            s, start = next(x for x in out[g]["sectors"] if x["id"] == sid), out[g]["start"]
        return s["values"][len(month_list(start, month)) - 1]

    for (sid, month), want in ANCHORS.items():
        if want is not None and value(sid, month) != want:
            raise SystemExit(f"3: {sid} {month} is {value(sid, month)}, was {want}")

    data = {
        "retrieved": retrieved(zpath),
        "source": {
            "name": "Statistics Canada, Table 10-10-0125-01, Toronto Stock Exchange statistics (monthly)",
            "url": "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1010012501",
            "doi": "https://doi.org/10.25318/1010012501-eng",
            "licence": "Statistics Canada Open Licence",
            "licenceUrl": "https://www.statcan.gc.ca/en/terms-conditions/open-licence",
            "notice": "Source: Statistics Canada, Table 10-10-0125-01 Toronto Stock Exchange statistics, January 1956 to September 2023. Reproduced and distributed on an \"as is\" basis with the permission of Statistics Canada.",
            "adapted": "Adapted from Statistics Canada, Table 10-10-0125-01 Toronto Stock Exchange statistics, January 1956 to September 2023. This does not constitute an endorsement by Statistics Canada of this product.",
            "origin": "The Bank of Canada before January 2017; the Toronto Stock Exchange eReview, TMX Group Inc., from then on. The indices belong to S&P Dow Jones Indices and TMX Group. The table is no longer updated.",
        },
        **out,
    }
    text = (
        "// Generated by scripts/data/tsx_sentiment.py. Do not edit by hand.\n"
        "// Month-end closes of the S&P/TSX Composite and of Toronto sector indices, from Statistics Canada Table 10-10-0125-01\n"
        f"// under the Statistics Canada Open Licence, retrieved {data['retrieved']}. values[i] is the month i months after start.\n"
        "export const TSX = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    if "NaN" in text or "Infinity" in text:
        raise SystemExit("the output holds a value that is not a number")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    for sid, month in ANCHORS:
        print(f"  {sid} {month}: {value(sid, month)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", default=None, help="folder for the download; reused if it is already there")
    args = ap.parse_args()
    if args.cache:
        Path(args.cache).mkdir(parents=True, exist_ok=True)
        build(Path(args.cache))
    else:
        with tempfile.TemporaryDirectory() as tmp:
            build(Path(tmp))


if __name__ == "__main__":
    main()
