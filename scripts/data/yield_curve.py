"""Build 365projects/75/data.js: monthly US Treasury yields and the NBER business-cycle chronology behind project 75
(Yield Curve Recession Model).

    python scripts/data/yield_curve.py                 download afresh and rewrite the snapshot
    python scripts/data/yield_curve.py --cache DIR     keep the downloads in DIR; a second run with the same DIR
                                                       rebuilds the same file without touching the network

Standard library only (openpyxl for the NBER spreadsheet). The module is written only after every check below passes.

Sources (downloaded into --cache, never committed):

  1. Board of Governors of the Federal Reserve System, release H.15 "Selected Interest Rates", the complete release
     from the Data Download Program, https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&filetype=zip
     (file H15_data.xml). Monthly series, each the average of the business days in the month:
       RIFLGFCM03_N.M ... RIFLGFCY30_N.M  "Market yield on U.S. Treasury securities at <m> constant maturity, quoted
                                           on investment basis" for 3 and 6 months and 1, 2, 3, 5, 7, 10, 20, 30 years
       RIFSGFSM03_N.M                      "3-month Treasury bill secondary market rate discount basis"
     Terms: the Board's website policy (https://www.federalreserve.gov/disclaimer.htm, read 14 October 2026), under
     "Copyright/trademark": "Unless otherwise indicated, information on Board's website is in the public domain and
     may be copied and distributed without permission. Please cite to the Board as the source of the information."
     The release marks none of these series as anyone else's.
  2. National Bureau of Economic Research, "US Business Cycle Expansions and Contractions" (business cycle data last
     updated 14 March 2023), https://www.nber.org/research/data/us-business-cycle-expansions-and-contractions, and its
     spreadsheet https://www.nber.org/sites/default/files/2023-03/BCDC_spreadsheet_for_website.xlsx: peak and trough
     months. The page says "Recessions ... start in the month after a peak in the business cycle, and end in the
     month of the trough", and "Permission to copy is granted, provided attribution of source is given."
  3. NBER, "Business Cycle Dating Committee Announcements",
     https://www.nber.org/research/business-cycle-dating/business-cycle-dating-committee-announcements: the date on
     which each turning point since 1980 was announced. The committee first announced a turning point on 3 June 1980;
     earlier dates were set by the NBER after the event and carry no announcement date here.

What is kept and how
  * Months from January 1959 (where the New York Fed's yield curve model starts) to the last month in which both the
    10-year yield and the 3-month bill rate are published. Values are kept as published (two decimals, percent a
    year). A month with no value (status "ND" or "NC", such as the 20-year from 1987 to 1993 and the 30-year from 2002 to 2006) is null;
    nothing is filled in or spliced. The 3-month bill rate is kept on its published discount basis; the page converts
    it to a bond-equivalent yield, as the New York Fed does.
  * Peaks and troughs from the August 1957 peak on (the April 1958 trough sets the state of January 1959).
  * Announcement dates for the turning points of 1980 onwards, read from the announcements page and checked against
    the list below.

Checks, run on every build (any failure stops the script with the reason)
  1. Every series named below is in the file with the expected description and unit.
  2. The 10-year yield and the 3-month bill rate have a value in every month from January 1959 to the last month.
  3. Anchor values: the 10-year yield and the bill rate for January 1959 (4.02 and 2.82, which are also the first row
     of the New York Fed's own spreadsheet, allmonth.xls) and for the last month.
  4. The NBER spreadsheet holds exactly the turning points listed below from 1957 on, and the announcements page
     lists exactly the announcements below.
"""

from __future__ import annotations

import argparse
import json
import re
import html
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "75" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; data-script/1.0)"}  # anonymous: no name, address or link
RETRIEVED = "2026-10-14"
FIRST = "1959-01"
H15_URL = "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&filetype=zip"
NBER_XLSX = "https://www.nber.org/sites/default/files/2023-03/BCDC_spreadsheet_for_website.xlsx"
NBER_PAGE = "https://www.nber.org/research/data/us-business-cycle-expansions-and-contractions"
NBER_ANN = "https://www.nber.org/research/business-cycle-dating/business-cycle-dating-committee-announcements"

# key, H.15 series, maturity in years
CMT = [
    ("m3", "RIFLGFCM03_N.M", 0.25), ("m6", "RIFLGFCM06_N.M", 0.5), ("y1", "RIFLGFCY01_N.M", 1), ("y2", "RIFLGFCY02_N.M", 2),
    ("y3", "RIFLGFCY03_N.M", 3), ("y5", "RIFLGFCY05_N.M", 5), ("y7", "RIFLGFCY07_N.M", 7), ("y10", "RIFLGFCY10_N.M", 10),
    ("y20", "RIFLGFCY20_N.M", 20), ("y30", "RIFLGFCY30_N.M", 30),
]
BILL = "RIFSGFSM03_N.M"
# The turning points the NBER spreadsheet must hold from 1957 on: (peak, trough).
CYCLES = [("1957-08", "1958-04"), ("1960-04", "1961-02"), ("1969-12", "1970-11"), ("1973-11", "1975-03"),
          ("1980-01", "1980-07"), ("1981-07", "1982-11"), ("1990-07", "1991-03"), ("2001-03", "2001-11"),
          ("2007-12", "2009-06"), ("2020-02", "2020-04")]
# (turning point month, kind, announcement date), as listed on the announcements page.
ANNOUNCED = [("1980-01", "peak", "1980-06-03"), ("1980-07", "trough", "1981-07-08"), ("1981-07", "peak", "1982-01-06"),
             ("1982-11", "trough", "1983-07-08"), ("1990-07", "peak", "1991-04-25"), ("1991-03", "trough", "1992-12-22"),
             ("2001-03", "peak", "2001-11-26"), ("2001-11", "trough", "2003-07-17"), ("2007-12", "peak", "2008-12-01"),
             ("2009-06", "trough", "2010-09-20"), ("2020-02", "peak", "2020-06-08"), ("2020-04", "trough", "2021-07-19")]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            path.write_bytes(r.read())
    return path


def months(first: str, last: str) -> list[str]:
    y, m = map(int, first.split("-"))
    out = []
    while f"{y}-{m:02d}" <= last:
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def h15_monthly(zip_path: Path, wanted: set[str]) -> tuple[dict, dict]:
    """{series: {YYYY-MM: value}} for status "A" observations, and {series: long description}."""
    values, about = {}, {}
    with zipfile.ZipFile(zip_path) as z, z.open("H15_data.xml") as f:
        for _, node in ET.iterparse(f, events=("end",)):
            if node.tag.endswith("}Series"):
                name = node.get("SERIES_NAME")
                if name in wanted:
                    if node.get("UNIT") != "Percent:_Per_Year" or node.get("FREQ") != "129":
                        raise SystemExit(f"{name}: unexpected unit or frequency {node.attrib}")
                    texts = [t.text.strip() for t in node.iter() if t.tag.endswith("AnnotationText") and t.text]
                    about[name] = texts[-1] if texts else ""
                    series = {}
                    for o in node:
                        if not o.tag.endswith("}Obs"):
                            continue
                        status = o.get("OBS_STATUS")
                        if status == "A":
                            series[o.get("TIME_PERIOD")[:7]] = float(o.get("OBS_VALUE"))
                        elif status not in ("ND", "NC"):
                            raise SystemExit(f"{name}: unexpected status {status}")
                    values[name] = series
                node.clear()
    missing = wanted - set(values)
    if missing:
        raise SystemExit(f"H.15: series not found: {sorted(missing)}")
    return values, about


def month_of(text: str) -> str:
    text = text.replace("\xa0", " ").strip()
    m = re.match(r"([A-Z][a-z]+) (\d{4})", text)
    if not m:
        raise SystemExit(f"cannot read a month from {text!r}")
    return f"{m.group(2)}-{MONTHS.index(m.group(1)) + 1:02d}"


def main() -> None:
    import openpyxl

    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="yield_curve_"))
    cache.mkdir(parents=True, exist_ok=True)

    wanted = {s for _, s, _ in CMT} | {BILL}
    h15, about = h15_monthly(fetch(H15_URL, cache / "FRB_H15.zip"), wanted)
    for _, s, mat in CMT:
        if "constant maturity" not in about[s] or "investment basis" not in about[s]:
            raise SystemExit(f"{s}: unexpected description {about[s]!r}")
    if "discount basis" not in about[BILL]:
        raise SystemExit(f"{BILL}: unexpected description {about[BILL]!r}")

    ten, bill = h15["RIFLGFCY10_N.M"], h15[BILL]
    last = min(max(ten), max(bill))
    span = months(FIRST, last)
    for s in ("RIFLGFCY10_N.M", BILL):
        gaps = [m for m in span if m not in h15[s]]
        if gaps:
            raise SystemExit(f"{s}: no value for {gaps[:5]}")
    anchors = {("RIFLGFCY10_N.M", "1959-01"): 4.02, (BILL, "1959-01"): 2.82,
               ("RIFLGFCY10_N.M", "2026-09"): 4.99, (BILL, "2026-09"): 3.94}
    for (s, m), v in anchors.items():
        if m <= last and abs(h15[s][m] - v) > 1e-9:
            raise SystemExit(f"{s} {m}: {h15[s][m]}, expected {v}")

    wb = openpyxl.load_workbook(fetch(NBER_XLSX, cache / "BCDC_spreadsheet_for_website.xlsx"), read_only=True, data_only=True)
    cycles = []
    for row in wb.worksheets[0].iter_rows(values_only=True):
        peak, trough = row[2], row[3]
        if isinstance(peak, str) and isinstance(trough, str) and re.match(r"[A-Z][a-z]+\s\d{4}", peak.replace("\xa0", " ")):
            p, t = month_of(peak), month_of(trough)
            if p >= "1957-01":
                cycles.append((p, t))
    if cycles != CYCLES:
        raise SystemExit(f"NBER turning points differ from the expected list: {cycles}")
    page = fetch(NBER_PAGE, cache / "nber_cycles.html").read_text(encoding="utf-8", errors="replace")
    if "Permission to copy is granted, provided attribution of source is given." not in page:
        raise SystemExit("the NBER page no longer carries the permission statement: read its terms again")

    text = fetch(NBER_ANN, cache / "nber_announcements.html").read_text(encoding="utf-8", errors="replace")
    text = html.unescape(re.sub(r"<[^>]+>", "\n", re.sub(r"<script.*?</script>|<style.*?</style>", "", text, flags=re.S)))
    found = []
    pattern = re.compile(r"([A-Z][a-z]+) (\d{1,2}), (\d{4})\s*\n[^\n]*?(?:Determination of the|Announcement of) ([A-Z][a-z]+) (\d{4}) "
                         r"(?:business cycle )?(peak|trough|Peak|Trough)")
    for m in pattern.finditer(text):
        date = f"{m.group(3)}-{MONTHS.index(m.group(1)) + 1:02d}-{int(m.group(2)):02d}"
        found.append((f"{m.group(5)}-{MONTHS.index(m.group(4)) + 1:02d}", m.group(6).lower(), date))
    found.sort()
    if found != sorted(ANNOUNCED):
        raise SystemExit(f"NBER announcements differ from the expected list: {found}")

    def column(s):
        return [h15[s].get(m) for m in span]

    data = {
        "retrieved": RETRIEVED,
        "first": FIRST,
        "last": last,
        "maturities": [{"key": k, "series": s, "years": y} for k, s, y in CMT],
        "cmt": {k: column(s) for k, s, _ in CMT},
        "bill3": column(BILL),
        "cycles": [{"peak": p, "trough": t} for p, t in CYCLES],
        "announced": [{"month": m, "kind": k, "date": d} for m, k, d in ANNOUNCED],
        "sources": {
            "h15": "Board of Governors of the Federal Reserve System, H.15 Selected Interest Rates, monthly averages. Public domain (Board website policy).",
            "nber": "National Bureau of Economic Research, US Business Cycle Expansions and Contractions (data last updated 14 March 2023) and Business Cycle Dating Committee announcements. Permission to copy is granted, provided attribution of source is given.",
        },
    }
    OUT.write_text(
        "// Generated by scripts/data/yield_curve.py. Do not edit by hand.\n"
        f"// Monthly averages of US Treasury yields, {FIRST} to {last}, percent a year, as published in the Federal Reserve Board's H.15\n"
        "// release (public domain); constant-maturity yields on an investment basis, and the 3-month bill on a discount basis.\n"
        "// NBER business-cycle peaks, troughs and announcement dates (NBER: permission to copy is granted, provided attribution of\n"
        f"// source is given). Retrieved {RETRIEVED}. cmt[key][i] and bill3[i] are for the month i months after `first`; null = not published.\n"
        "export const DATA = " + json.dumps(data, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), {len(span)} months {FIRST} to {last}, cache at {cache}")
    for k, s, _ in CMT:
        col = column(s)
        have = [m for m, v in zip(span, col) if v is not None]
        print(f"  {k:4} {s:16} {len(have):4} months, {have[0]} to {have[-1]}")
    print("  announcements:", len(found), " cycles:", len(cycles))


if __name__ == "__main__":
    main()
