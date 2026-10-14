"""Build 365projects/62/data.js: month-end closes of Toronto Stock Exchange indices behind project 62 (Random Walk
versus Reality).

    python scripts/data/tsx_indices.py                 download afresh and rewrite the snapshot
    python scripts/data/tsx_indices.py --cache DIR     keep the download in DIR; a second run with the same DIR
                                                       rebuilds the same file without touching the network

Standard library only. The module is written only after every check below has passed.

Why these series
  The page needs prices that may be republished. Daily or monthly prices of individual shares are sold under
  licence by exchanges and data vendors, and none was found under an open licence. Index providers license their
  index values the same way, and research data libraries publish portfolio returns without a licence that allows
  them to be passed on (Kenneth French's data library, for example, carries only "Copyright Eugene F. Fama and
  Kenneth R. French"). Statistics Canada, however, publishes the month-end closes of the main Toronto indices in a
  table of its own under its Open Licence, and that is the source used here.

Source (downloaded into --cache, never committed):
  Statistics Canada, Table 10-10-0125-01, "Toronto Stock Exchange statistics", monthly, full table as CSV
  (https://www150.statcan.gc.ca/n1/tbl/csv/10100125-eng.zip). The table's notes: "As of January 2017, this data
  is obtained from the Toronto Stock Exchange eReview, TMX Group Inc."; "Prior to January 2017, the information
  presented in this table was provided by the Bank of Canada."; and "this table is no longer being updated as of
  November 1, 2023". Its last month is September 2023.
  Licence: Statistics Canada Open Licence (https://www.statcan.gc.ca/en/terms-conditions/open-licence, modified
  2025-07-10, read 14 October 2026): "Statistics Canada grants you a worldwide, royalty-free, non-exclusive licence
  to" use, reproduce, publish, freely distribute or sell the Information, with the notice "Source: Statistics
  Canada, name of product, reference date. Reproduced and distributed on an "as is" basis with the permission of
  Statistics Canada." The licence also says that "Intellectual property rights that third parties may have in the
  Information shall remain their property": the indices themselves belong to S&P Dow Jones Indices and TMX Group,
  and the page says so.

What is kept
  * Every index series in the table: the S&P/TSX Composite close, the S&P/TSX 60, the Toronto 35, the seven older
    TSE sector indices and the eleven S&P/TSX sector indices. The table's composite high and low, its dividend
    yield and its price-earnings ratio are not price series and are left out.
  * Each series from its first to its last published month, values as published (two decimals). Nothing is filled
    in. The names are Statistics Canada's own; the short names are this script's.

Checks, run on every build (any failure stops the script with the reason)
  1. The CSV has the columns REF_DATE, GEO, the statistics column, VALUE and STATUS, and every series below.
  2. Each kept series has a value in every month from its first to its last, with no status flag, and every value
     is a positive number.
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
OUT = ROOT / "365projects" / "62" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; varad-patel-365projects/1.0; +https://varad-patel.github.io)"}
URL = "https://www150.statcan.gc.ca/n1/tbl/csv/10100125-eng.zip"
COLUMN = "Toronto Stock Exchange Statistics"

# id, Statistics Canada's member name, short name.
SERIES = [
    ("composite", "Standard and Poor's/Toronto Stock Exchange Composite Index, close", "S&P/TSX Composite"),
    ("tsx60", "Standard and Poor's/Toronto Stock Exchange 60 Index", "S&P/TSX 60"),
    ("t35", "Toronto Stock Exchange, Toronto 35 index, closing quotations (May 27 1987=100)", "Toronto 35"),
    ("oilgas", "Toronto Stock Exchange, oil and gas, closing quotations", "TSE oil and gas"),
    ("metals", "Toronto Stock Exchange, metals and minerals, closing quotations", "TSE metals and minerals"),
    ("utilities_old", "Toronto Stock Exchange, utilities, closing quotations", "TSE utilities"),
    ("paper", "Toronto Stock Exchange, paper and forest products, closing quotations", "TSE paper and forest products"),
    ("merch", "Toronto Stock Exchange, merchandising, closing quotations", "TSE merchandising"),
    ("finance_old", "Toronto Stock Exchange, financial services, closing quotations", "TSE financial services"),
    ("gold_old", "Toronto Stock Exchange, gold and silver, closing quotations", "TSE gold and silver"),
    ("discretionary", "Standard and Poor's/Toronto Stock Exchange Canadian Consumer Discretionary Index", "S&P/TSX Consumer Discretionary"),
    ("staples", "Standard and Poor's/Toronto Stock Exchange Canadian Consumer Staples Index", "S&P/TSX Consumer Staples"),
    ("energy", "Standard and Poor's/Toronto Stock Exchange Canadian Energy Index", "S&P/TSX Energy"),
    ("financials", "Standard and Poor's/Toronto Stock Exchange Canadian Financial Index", "S&P/TSX Financials"),
    ("gold", "Standard and Poor's/Toronto Stock Exchange Canadian Gold Index", "S&P/TSX Gold"),
    ("industrials", "Standard and Poor's/Toronto Stock Exchange Canadian Industrial Index", "S&P/TSX Industrials"),
    ("it", "Standard and Poor's/Toronto Stock Exchange Canadian Information Technology Index", "S&P/TSX Information Technology"),
    ("materials", "Standard and Poor's/Toronto Stock Exchange Canadian Materials Index", "S&P/TSX Materials"),
    ("mining", "Standard and Poor's/Toronto Stock Exchange Canadian Diversified Metals and Mining Index", "S&P/TSX Diversified Metals and Mining"),
    ("telecom", "Standard and Poor's/Toronto Stock Exchange Canadian Telecommunication Service Index", "S&P/TSX Telecommunication Services"),
    ("utilities", "Standard and Poor's/Toronto Stock Exchange Canadian Utilities Index", "S&P/TSX Utilities"),
]
ANCHORS = {("composite", "1956-01"): 525.63, ("composite", "2000-08"): 11247.91, ("composite", "2023-09"): 19541.27}


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


def build(cache: Path) -> None:
    zpath = fetch(URL, cache / "10100125-eng.zip")
    with zipfile.ZipFile(zpath) as z:
        rows = list(csv.DictReader(io.TextIOWrapper(z.open("10100125.csv"), encoding="utf-8-sig")))
    need = {"REF_DATE", "GEO", COLUMN, "VALUE", "STATUS"}
    if not rows or not need <= set(rows[0]):
        raise SystemExit(f"1: the CSV lacks the columns {sorted(need - set(rows[0] if rows else []))}")
    by = {}
    for r in rows:
        by.setdefault(r[COLUMN], []).append(r)

    out = []
    for sid, member, short in SERIES:
        if member not in by:
            raise SystemExit(f"1: the table has no series {member!r}")
        pts = sorted((r["REF_DATE"], r["VALUE"], r["STATUS"]) for r in by[member] if r["VALUE"] not in ("", ".."))
        months = [p[0] for p in pts]
        if months != month_list(months[0], months[-1]):
            raise SystemExit(f"2: {short} has a missing or repeated month between {months[0]} and {months[-1]}")
        values = []
        for month, value, status in pts:
            if status:
                raise SystemExit(f"2: {short} {month} carries the status {status!r}")
            v = float(value)
            if not v > 0:
                raise SystemExit(f"2: {short} {month}: {value} is not a positive number")
            values.append(v)
        out.append({"id": sid, "name": member, "short": short, "start": months[0], "values": values})

    for (sid, month), want in ANCHORS.items():
        s = next(x for x in out if x["id"] == sid)
        v = s["values"][len(month_list(s["start"], month)) - 1]
        if v != want:
            raise SystemExit(f"3: {sid} {month} is {v}, was {want}")

    data = {
        "retrieved": retrieved(zpath),
        "source": {
            "name": "Statistics Canada, Table 10-10-0125-01, Toronto Stock Exchange statistics (monthly)",
            "url": "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1010012501",
            "licence": "Statistics Canada Open Licence",
            "licenceUrl": "https://www.statcan.gc.ca/en/terms-conditions/open-licence",
            "notice": "Source: Statistics Canada, Table 10-10-0125-01 Toronto Stock Exchange statistics, January 1956 to September 2023. Reproduced and distributed on an \"as is\" basis with the permission of Statistics Canada.",
            "origin": "The Bank of Canada before January 2017; the Toronto Stock Exchange eReview, TMX Group Inc., from then on. The table is no longer updated after November 2023.",
        },
        "series": out,
    }
    text = (
        "// Generated by scripts/data/tsx_indices.py. Do not edit by hand.\n"
        "// Month-end closes of Toronto Stock Exchange indices, from Statistics Canada Table 10-10-0125-01 under the Statistics\n"
        f"// Canada Open Licence, retrieved {data['retrieved']}. values[i] is the month i months after start.\n"
        "export const TSX = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    if "NaN" in text or "Infinity" in text:
        raise SystemExit("the output holds a value that is not a number")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB), {len(out)} series")
    for s in out:
        print(f"  {s['id']:14s} {s['start']} to {month_list(s['start'], '2100-01')[len(s['values']) - 1]}  {len(s['values'])} months")


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
