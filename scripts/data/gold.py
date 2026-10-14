"""Build 365projects/61/data.js: the monthly price of gold behind project 61 (Gold Price Forecaster).

    python scripts/data/gold.py                 download afresh and rewrite the snapshot
    python scripts/data/gold.py --cache DIR     keep the downloads in DIR; a second run with the same DIR
                                                rebuilds the same file without touching the network

Standard library only, so a scheduled job needs nothing installed. The module is written only after every
check below has passed: a failed refresh stops with a message and leaves the old snapshot in place.

Source (downloaded into --cache, never committed):
  World Bank, "Commodity Price Data (The Pink Sheet)", the workbook CMO-Historical-Data-Monthly.xlsx linked from
  https://www.worldbank.org/en/research/commodity-markets, sheet "Monthly Prices", column "Gold", unit
  "($/troy oz)": monthly averages in nominal US dollars. The workbook's "Description" sheet defines the price as
  "Gold, spot average of daily rates, from June 2025; previously (UK), 99.5% fine, London afternoon fixing,
  average of daily rates" and names its sources (Bloomberg, Kitco, the IMF's International Financial
  Statistics, the London Bullion Market and others). The World Bank publishes the Pink Sheet under CC BY 4.0,
  the licence its commodity-markets page points to under "Using this Data"
  (https://datacatalog.worldbank.org/public-licenses). The workbook's address changes with each edition, so
  the script reads the current link from the commodity-markets page on every run.

What is kept, and why
  * January 1975 to the latest month with a price. Until December 1967 the series is the official $35; from
    March 1968 central banks dealt with one another at an official price beside the free market (the two-tier
    system, Federal Reserve History, "Gold Convertibility Ends"), and Americans could not own gold bullion until
    31 December 1974 (Executive Order 11825, 40 FR 1003). From January 1975 the price is a free market price.
  * Values exactly as published (whole dollars). Nothing is filled in, smoothed or converted.

Checks, run on every build (any failure stops the script with the reason)
  1. The commodity-markets page links to exactly one monthly historical workbook on thedocs.worldbank.org.
  2. The sheet "Monthly Prices" exists, has an "Updated on ..." line, a header row whose second cell is
     "Crude oil, average", one column called "Gold", and that column's unit is "($/troy oz)".
  3. The Description sheet still defines gold as an average of daily rates.
  4. The month labels run 1960M01, 1960M02, ... with nothing missing or repeated.
  5. Every gold value from January 1975 to the last one is a positive number; no month is blank in between.
  6. The anchor months below have the values they had when this script was written (a revision of history
     would change the page's finding, so it must be looked at by a person).
  7. If a snapshot already exists, the new one is no shorter and agrees with it on every month they share.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "61" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; varad-patel-365projects/1.0; +https://varad-patel.github.io)"}
PAGE = "https://www.worldbank.org/en/research/commodity-markets"
LINK = re.compile(r"https://thedocs\.worldbank\.org/en/doc/[0-9a-f-]+/related/CMO-Historical-Data-Monthly\.xlsx")
FIRST = "1975-01"
# Values as published in the workbook "Updated on October 02, 2026" (US$ per troy ounce, monthly average).
ANCHORS = {"1975-01": 176, "1980-01": 675, "1999-07": 256, "2011-09": 1772, "2020-08": 1969, "2026-09": 4319}

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def fetch(url: str, path: Path) -> Path:
    """Download once. The day of the download is kept beside the file so a rebuild from the cache is identical."""
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            body = r.read()
        path.write_bytes(body)
        path.with_suffix(path.suffix + ".date").write_text(dt.date.today().isoformat(), encoding="utf-8")
    return path


def retrieved(path: Path) -> str:
    stamp = path.with_suffix(path.suffix + ".date")
    return stamp.read_text(encoding="utf-8").strip() if stamp.exists() else dt.date.fromtimestamp(path.stat().st_mtime).isoformat()


def col_index(ref: str) -> int:
    """'A5' -> 0, 'BR12' -> 69."""
    k = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        k = k * 26 + ord(ch) - 64
    return k - 1


def read_sheet(book: Path, name: str) -> list[list]:
    """The cells of one worksheet as a list of rows (strings and numbers, None for empty), with the standard library."""
    with zipfile.ZipFile(book) as z:
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
                strings.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
        sheets = {s.get("name"): s.get(REL) for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS)}
        if name not in sheets:
            raise SystemExit(f"the workbook has no sheet called {name!r}: {sorted(sheets)}")
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        target = rels[sheets[name]].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).find("m:sheetData", NS).findall("m:row", NS):
            cells = {}
            for c in row.findall("m:c", NS):
                t, v = c.get("t"), c.find("m:v", NS)
                if t == "s":
                    value = strings[int(v.text)]
                elif t == "inlineStr":
                    value = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                elif v is None or v.text is None:
                    value = None
                elif t in ("str", "e"):
                    value = v.text
                else:
                    value = float(v.text)
                    value = int(value) if value.is_integer() else value
                cells[col_index(c.get("r"))] = value
            r = int(row.get("r")) - 1
            while len(rows) < r:
                rows.append([])
            rows.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
        return rows


def month_list(first: str, count: int) -> list[str]:
    y, m = map(int, first.split("-"))
    out = []
    for _ in range(count):
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def build(cache: Path) -> None:
    page = fetch(PAGE, cache / "commodity-markets.html").read_text(encoding="utf-8", errors="replace")
    links = sorted(set(LINK.findall(page)))
    if len(links) != 1:
        raise SystemExit(f"1: expected one link to the monthly workbook on {PAGE}, found {links}")
    book = fetch(links[0], cache / "CMO-Historical-Data-Monthly.xlsx")

    rows = read_sheet(book, "Monthly Prices")
    cell = lambda r, i: r[i] if i < len(r) else None
    head = next((i for i, r in enumerate(rows) if cell(r, 1) == "Crude oil, average"), None)
    if head is None:
        raise SystemExit("2: no header row whose second cell is 'Crude oil, average'")
    vintage = next((str(r[0]).strip() for r in rows[:head] if r and isinstance(r[0], str) and r[0].startswith("Updated on")), None)
    if not vintage:
        raise SystemExit("2: no 'Updated on ...' line above the header row")
    names = [str(c).strip() if c is not None else "" for c in rows[head]]
    if names.count("Gold") != 1:
        raise SystemExit(f"2: expected one column called 'Gold', found {names.count('Gold')}")
    g = names.index("Gold")
    unit = cell(rows[head + 1], g)
    if unit != "($/troy oz)":
        raise SystemExit(f"2: the unit of the gold column is {unit!r}, not '($/troy oz)'")

    described = [r for r in read_sheet(book, "Description") if any(isinstance(c, str) and c.startswith("Gold,") for c in r)]
    definition = next((c for r in described for c in r if isinstance(c, str) and c.startswith("Gold,")), "")
    if "average of daily rates" not in definition:
        raise SystemExit(f"3: the Description sheet no longer defines gold as an average of daily rates: {definition!r}")

    data = [r for r in rows[head + 2:] if r and isinstance(r[0], str) and re.fullmatch(r"\d{4}M\d{2}", r[0])]
    stamps = [f"{r[0][:4]}-{r[0][5:]}" for r in data]
    if stamps != month_list("1960-01", len(stamps)):
        raise SystemExit("4: the month labels are not consecutive from 1960M01")
    first = stamps.index(FIRST)
    gold = [cell(r, g) for r in data[first:]]
    while gold and not isinstance(gold[-1], (int, float)):
        gold.pop()  # months the workbook lists before their prices are published
    for stamp, v in zip(stamps[first:], gold):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not v > 0:
            raise SystemExit(f"5: the gold price for {stamp} is {v!r}, not a positive number")
    months = stamps[first:first + len(gold)]
    for stamp, want in ANCHORS.items():
        if stamp in months and gold[months.index(stamp)] != want:
            raise SystemExit(f"6: the gold price for {stamp} is now {gold[months.index(stamp)]}, was {want}: history has been revised")
    if ANCHORS and max(ANCHORS) not in months:
        raise SystemExit(f"6: the series ends in {months[-1]}, before the anchor month {max(ANCHORS)}")

    if OUT.exists():
        old = json.loads(re.search(r"export const GOLD = (\{.*\});", OUT.read_text(encoding="utf-8")).group(1))
        if old["start"] != FIRST or len(old["values"]) > len(gold):
            raise SystemExit(f"7: the new series ({len(gold)} months) is shorter than the snapshot ({len(old['values'])} months)")
        changed = [m for m, a, b in zip(months, old["values"], gold) if a != b]
        if changed:
            raise SystemExit(f"7: these months differ from the existing snapshot: {changed[:12]}")

    out = {
        "retrieved": retrieved(book),
        "vintage": vintage,
        "source": {
            "name": "World Bank, Commodity Price Data (The Pink Sheet), monthly prices",
            "url": "https://www.worldbank.org/en/research/commodity-markets",
            "file": links[0],
            "licence": "CC BY 4.0",
        },
        "definition": definition.strip(),
        "unit": "US$ per troy ounce",
        "start": FIRST,
        "values": gold,
    }
    text = (
        "// Generated by scripts/data/gold.py. Do not edit by hand.\n"
        "// Monthly average price of gold, US$ per troy ounce, from the World Bank's Pink Sheet (CC BY 4.0).\n"
        f"// {vintage}; retrieved {out['retrieved']}. values[i] is the month i months after start.\n"
        "export const GOLD = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    if "NaN" in text or "Infinity" in text:
        raise SystemExit("the output holds a value that is not a number")
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB): {FIRST} to {months[-1]}, {len(gold)} months, "
          f"last {gold[-1]}; {vintage}; retrieved {out['retrieved']}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", default=None, help="folder for the downloads; reused if the files are already there")
    args = ap.parse_args()
    if args.cache:
        Path(args.cache).mkdir(parents=True, exist_ok=True)
        build(Path(args.cache))
    else:
        with tempfile.TemporaryDirectory() as tmp:
            build(Path(tmp))


if __name__ == "__main__":
    main()
