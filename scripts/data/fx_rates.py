"""Build 365projects/80/data.js: month-end exchange rates against the US dollar behind project 80 (Currency
Prediction Lab).

    python scripts/data/fx_rates.py                 download afresh and rewrite the snapshot
    python scripts/data/fx_rates.py --cache DIR     keep the download in DIR; a second run with the same DIR
                                                    rebuilds the same file without touching the network

Standard library only. The module is written only after every check below has passed.

Source (downloaded into --cache, never committed):
  Board of Governors of the Federal Reserve System, release H.10 "Foreign Exchange Rates", the complete release
  from the Data Download Program (https://www.federalreserve.gov/datadownload/Output.aspx?rel=H10&filetype=zip,
  file H10_data.xml): daily rates, "noon buying rates in New York for cable transfers payable in the listed
  currencies", "certified by the Federal Reserve Bank of New York for customs purposes" (H.10, About). Units are
  currency units per US dollar, except for the Australian dollar, the euro, the New Zealand dollar and the pound,
  which are US dollars per unit.
  Terms: the Board's website policy (https://www.federalreserve.gov/disclaimer.htm, read 14 October 2026), under
  "Copyright/trademark": "Unless otherwise indicated, information on Board's website is in the public domain and
  may be copied and distributed without permission. Please cite to the Board as the source of the information."
  The H.10 release and its notes mark no third-party material.

What is kept
  * The daily series of the 22 currencies on the release other than the Venezuelan bolivar, whose quoted rate
    jumps more than 300-fold in February 2018 and drops five zeros in August 2018 and six in October 2021 (it
    has a rate in every month from January 2000, so the reason is the breaks, not gaps).
  * The data may be revised after a release ("past releases are not revised and may not reflect subsequent
    revisions to the data", H.10 About), so the page's backtest uses the series as it stands today, not as it
    stood at each forecast date; the page says so.
  * For each currency and calendar month, the last daily rate published in that month (status "A"), as
    published, with the day of the month it came from. Months before a currency's first rate are left out;
    nothing is filled in. The month in which the release was prepared is not over, so it is left out.
  * The month-end of the US dollar indexes and other memo items are not kept.

Checks, run on every build (any failure stops the script with the reason)
  1. The file holds a daily series for every currency named below, with the expected unit direction.
  2. Every daily value with status "A" is a positive number; any other status is "ND" (no data).
  3. From its first month on, every currency has a rate in every month up to the last month of the release.
  4. A set of anchor month-end rates, written below, still have the values they had on 14 October 2026.
  The script also prints in how many months the currencies' last rates fall on different days (a currency with
  no rate on the last business day of a month takes its rate from the day before).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "80" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; varad-patel-365projects/1.0; +https://varad-patel.github.io)"}
URL = "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H10&filetype=zip"
NS = {"kf": "http://www.federalreserve.gov/structure/compact/H10_H10", "frb": "http://www.federalreserve.gov/structure/compact/common"}

# ISO code, name, H.10 series, True if the release quotes US dollars per unit (otherwise units per US dollar).
CURRENCIES = [
    ("AUD", "Australian dollar", "RXI$US_N.B.AL", True),
    ("BRL", "Brazilian real", "RXI_N.B.BZ", False),
    ("CAD", "Canadian dollar", "RXI_N.B.CA", False),
    ("CNY", "Chinese yuan", "RXI_N.B.CH", False),
    ("DKK", "Danish krone", "RXI_N.B.DN", False),
    ("EUR", "euro", "RXI$US_N.B.EU", True),
    ("HKD", "Hong Kong dollar", "RXI_N.B.HK", False),
    ("INR", "Indian rupee", "RXI_N.B.IN", False),
    ("JPY", "Japanese yen", "RXI_N.B.JA", False),
    ("MYR", "Malaysian ringgit", "RXI_N.B.MA", False),
    ("MXN", "Mexican peso", "RXI_N.B.MX", False),
    ("NZD", "New Zealand dollar", "RXI$US_N.B.NZ", True),
    ("NOK", "Norwegian krone", "RXI_N.B.NO", False),
    ("SGD", "Singapore dollar", "RXI_N.B.SI", False),
    ("ZAR", "South African rand", "RXI_N.B.SF", False),
    ("KRW", "South Korean won", "RXI_N.B.KO", False),
    ("LKR", "Sri Lankan rupee", "RXI_N.B.SL", False),
    ("SEK", "Swedish krona", "RXI_N.B.SD", False),
    ("CHF", "Swiss franc", "RXI_N.B.SZ", False),
    ("TWD", "New Taiwan dollar", "RXI_N.B.TA", False),
    ("THB", "Thai baht", "RXI_N.B.TH", False),
    ("GBP", "pound sterling", "RXI$US_N.B.UK", True),
]
# Month-end rates as published on the release of 13 October 2026 (the unit as the release quotes it).
ANCHORS = {("EUR", "2008-07"): 1.5589, ("JPY", "1985-09"): 216.5, ("GBP", "1992-09"): 1.779,
           ("CHF", "2015-01"): 0.921, ("INR", "2026-09"): 95.83}


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
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
    zpath = fetch(URL, cache / "FRB_H10.zip")
    with zipfile.ZipFile(zpath) as z:
        root = ET.fromstring(z.read("H10_data.xml"))
    prepared = root.find("{http://www.SDMX.org/resources/SDMXML/schemas/v1_0/message}Header/{http://www.SDMX.org/resources/SDMXML/schemas/v1_0/message}Prepared")
    series = {s.get("SERIES_NAME"): s for s in root.iter("{%s}Series" % NS["kf"])}

    daily = {}
    for code, name, sid, usd_per_unit in CURRENCIES:
        s = series.get(sid)
        if s is None:
            raise SystemExit(f"1: the release has no series {sid} ({name})")
        if s.get("FREQ") != "9" or s.get("CURRENCY") != code[:3] and not (code == "CNY" and s.get("CURRENCY") == "CNY"):
            raise SystemExit(f"1: {sid} is not the daily {code} series: FREQ {s.get('FREQ')}, CURRENCY {s.get('CURRENCY')}")
        if sid.startswith("RXI$US") != usd_per_unit:
            raise SystemExit(f"1: {sid} does not quote {code} the expected way round")
        obs = []
        for o in s.findall("frb:Obs", NS):
            status, value, day = o.get("OBS_STATUS"), o.get("OBS_VALUE"), o.get("TIME_PERIOD")
            if status == "A":
                v = float(value)
                if not v > 0:
                    raise SystemExit(f"2: {code} {day}: {value} is not a positive number")
                obs.append((day, v))
            elif status != "ND":
                raise SystemExit(f"2: {code} {day}: unknown status {status!r}")
        daily[code] = obs

    # The month the release was prepared in is not over, and neither is any later one: the last month kept is the
    # one before. (The release of 13 October 2026 holds rates to 9 October.)
    stamp = prepared.text[:7] if prepared is not None and prepared.text else dt.date.today().isoformat()[:7]
    y, m = map(int, stamp.split("-"))
    last_month = f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"
    for code in daily:
        daily[code] = [(d, v) for d, v in daily[code] if d[:7] <= last_month]
    if max(d[-1][0][:7] for d in daily.values()) != last_month:
        raise SystemExit(f"3: no currency has a rate in {last_month}, the month before the release was prepared")
    out = []
    end_day = {}
    for code, name, sid, usd_per_unit in CURRENCIES:
        by_month = {}
        for day, v in daily[code]:
            by_month[day[:7]] = (day, v)  # the days come in order, so the last one in a month wins
        first = min(by_month)
        months = month_list(first, last_month)
        missing = [m for m in months if m not in by_month]
        if missing:
            raise SystemExit(f"3: {code} has no rate in {missing[:6]}")
        out.append({"code": code, "name": name, "usdPerUnit": usd_per_unit, "start": first,
                    "values": [by_month[m][1] for m in months], "days": [int(by_month[m][0][8:]) for m in months]})
        for m in months:
            end_day.setdefault(m, Counter())[by_month[m][0]] += 1

    for (code, month), want in ANCHORS.items():
        c = next(x for x in out if x["code"] == code)
        i = len(month_list(c["start"], month)) - 1
        if c["values"][i] != want:
            raise SystemExit(f"4: {code} {month} is {c['values'][i]}, was {want}")
    split = sum(1 for m, cnt in end_day.items() if len(cnt) > 1)

    data = {
        "retrieved": retrieved(zpath),
        "prepared": prepared.text if prepared is not None else "",
        "source": {
            "name": "Board of Governors of the Federal Reserve System, H.10 Foreign Exchange Rates (daily)",
            "url": "https://www.federalreserve.gov/releases/h10/",
            "terms": "Public domain: \"Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source of the information.\" (https://www.federalreserve.gov/disclaimer.htm)",
            "what": "Noon buying rates in New York for cable transfers payable in the listed currencies, certified by the Federal Reserve Bank of New York for customs purposes.",
        },
        "last": last_month,
        "currencies": out,
    }
    text = (
        "// Generated by scripts/data/fx_rates.py. Do not edit by hand.\n"
        "// Month-end exchange rates (the last daily rate published in each month) from the Federal Reserve Board's H.10\n"
        f"// release (public domain), retrieved {data['retrieved']}. values[i] is the month i months after start, quoted as the\n"
        "// release quotes it: US dollars per unit if usdPerUnit, otherwise units per US dollar. days[i] is its day of the month.\n"
        "export const FX = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    if "NaN" in text or "Infinity" in text:
        raise SystemExit("the output holds a value that is not a number")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB), release prepared {data['prepared']}, to {last_month}")
    print(f"  months in which currencies' last rates fall on different days: {split} of {len(end_day)}")
    for c in out:
        print(f"  {c['code']} {c['start']} {len(c['values'])} months, last {c['values'][-1]}")


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
