"""Build 365projects/71/data.js: daily exchange rates against the US dollar behind project 71 (News and Markets Event
Study).

    python scripts/data/fx_daily.py                 download afresh and rewrite the snapshot
    python scripts/data/fx_daily.py --cache DIR     keep the download in DIR; a second run with the same DIR
                                                    rebuilds the same file without touching the network

Standard library only. The module is written only after every check below has passed.

Why exchange rates
  An event study needs daily returns that may be republished. Daily share prices and index levels are sold under
  licence by exchanges and index providers; the Federal Reserve Board's daily exchange rates are in the public domain.
  The page therefore studies how currencies moved around dated news.

Source (downloaded into --cache, never committed):
  Board of Governors of the Federal Reserve System, release H.10 "Foreign Exchange Rates", the complete release
  from the Data Download Program (https://www.federalreserve.gov/datadownload/Output.aspx?rel=H10&filetype=zip,
  file H10_data.xml): daily "noon buying rates in New York for cable transfers payable in the listed currencies",
  "certified by the Federal Reserve Bank of New York for customs purposes". Units are currency units per US
  dollar, except for the Australian dollar, the euro, the New Zealand dollar and the pound, which are US dollars per
  unit. The file of 13 October 2026 says in its header that the Data Download Program is being retired: if this URL
  stops working, rebuild from a kept --cache folder, or take the complete release from the H.10 release page.
  Terms: the Board's website policy (https://www.federalreserve.gov/disclaimer.htm, read 14 October 2026), under
  "Copyright/trademark": "Unless otherwise indicated, information on Board's website is in the public domain and
  may be copied and distributed without permission. Please cite to the Board as the source of the information."
  The H.10 release marks no third-party material.

What is kept
  * Twelve currencies, each from 2 January 1991 or its first rate on the release if later, to the last rate on the
    release: seven that make up the page's dollar basket (Australian dollar, Canadian dollar, Swiss franc, Danish
    krone, pound, yen, Swedish krona: the members of the Board's former "major currencies" index, with the krone,
    pegged first to the German mark and then to the euro, standing for the euro area throughout, because the release
    has no mark) and five more that the page's events need (euro, Chinese yuan, Mexican peso, Thai baht, South
    African rand).
  * Every daily rate with status "A", exactly as published. A day with status "ND" (no data) is kept as a gap.
  * Encoding, to keep the module small: one calendar of every date on which any kept currency has a rate (the first
    date, then the number of days to each next one); for each currency the scale (rates are stored as whole numbers
    of 10^-scale units), the index of its first date in the calendar, and then its first rate followed by the change
    from its previous published rate on each later date, or null on a date with no rate.

Checks, run on every build (any failure stops the script with the reason)
  1. The file holds a daily series for every currency named below, quoted the expected way round.
  2. Every value with status "A" is a positive number; any other status is "ND".
  3. Decoding the module's numbers gives back every published rate exactly.
  4. A set of anchor rates, written below, still have the values they had on 14 October 2026.
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
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "71" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; data-snapshot/1.0)"}  # anonymous: no name or address
URL = "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H10&filetype=zip"
NS = "http://www.federalreserve.gov/structure/compact/H10_H10"
MSG = "{http://www.SDMX.org/resources/SDMXML/schemas/v1_0/message}"
START = "1991-01-02"

# ISO code, name, H.10 series, True if the release quotes US dollars per unit, True if in the dollar basket.
CURRENCIES = [
    ("AUD", "Australian dollar", "RXI$US_N.B.AL", True, True),
    ("CAD", "Canadian dollar", "RXI_N.B.CA", False, True),
    ("CHF", "Swiss franc", "RXI_N.B.SZ", False, True),
    ("DKK", "Danish krone", "RXI_N.B.DN", False, True),
    ("GBP", "pound sterling", "RXI$US_N.B.UK", True, True),
    ("JPY", "Japanese yen", "RXI_N.B.JA", False, True),
    ("SEK", "Swedish krona", "RXI_N.B.SD", False, True),
    ("EUR", "euro", "RXI$US_N.B.EU", True, False),
    ("CNY", "Chinese yuan", "RXI_N.B.CH", False, False),
    ("MXN", "Mexican peso", "RXI_N.B.MX", False, False),
    ("THB", "Thai baht", "RXI_N.B.TH", False, False),
    ("ZAR", "South African rand", "RXI_N.B.SF", False, False),
]
# Daily rates as published on the release of 13 October 2026 (the unit as the release quotes it).
ANCHORS = {("GBP", "2016-06-23"): "1.48", ("GBP", "2016-06-24"): "1.3639", ("CHF", "2015-01-14"): "1.0172",
           ("CHF", "2015-01-15"): "0.893", ("JPY", "2022-09-22"): "142.16", ("CNY", "2005-07-21"): "8.2765"}


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


def build(cache: Path) -> None:
    zpath = fetch(URL, cache / "FRB_H10.zip")
    with zipfile.ZipFile(zpath) as z:
        root = ET.fromstring(z.read("H10_data.xml"))
    prepared = root.find(f"{MSG}Header/{MSG}Prepared")
    series = {s.get("SERIES_NAME"): s for s in root.iter("{%s}Series" % NS)}

    raw = {}
    for code, name, sid, usd_per_unit, _ in CURRENCIES:
        s = series.get(sid)
        if s is None:
            raise SystemExit(f"1: the release has no series {sid} ({name})")
        if s.get("FREQ") != "9" or s.get("CURRENCY") != code:
            raise SystemExit(f"1: {sid} is not the daily {code} series: FREQ {s.get('FREQ')}, CURRENCY {s.get('CURRENCY')}")
        if sid.startswith("RXI$US") != usd_per_unit:
            raise SystemExit(f"1: {sid} does not quote {code} the expected way round")
        obs = {}
        for o in s:
            if not o.tag.endswith("Obs"):
                continue
            status, value, day = o.get("OBS_STATUS"), o.get("OBS_VALUE"), o.get("TIME_PERIOD")
            if status == "A":
                if not Decimal(value) > 0:
                    raise SystemExit(f"2: {code} {day}: {value} is not a positive number")
                if day >= START:
                    obs[day] = value
            elif status != "ND":
                raise SystemExit(f"2: {code} {day}: unknown status {status!r}")
        raw[code] = obs

    dates = sorted({d for obs in raw.values() for d in obs})
    index = {d: i for i, d in enumerate(dates)}
    days = [dt.date.fromisoformat(d) for d in dates]
    gaps = [(days[i] - days[i - 1]).days for i in range(1, len(days))]

    out = []
    for code, name, sid, usd_per_unit, in_basket in CURRENCIES:
        obs = raw[code]
        scale = max(len(v.rstrip("0").split(".")[1]) if "." in v.rstrip("0") else 0 for v in obs.values())
        first = index[min(obs)]
        values, prev = [], None
        for d in dates[first:]:
            if d not in obs:
                values.append(None)
                continue
            v = int(Decimal(obs[d]) * 10 ** scale)
            values.append(v if prev is None else v - prev)
            prev = v
        # Check 3: decode and compare with every published rate.
        acc, k = None, first
        for x in values:
            if x is not None:
                acc = x if acc is None else acc + x
                if Decimal(acc) / 10 ** scale != Decimal(obs[dates[k]]):
                    raise SystemExit(f"3: {code} {dates[k]} decodes to {acc} / 10^{scale}, published {obs[dates[k]]}")
            k += 1
        out.append({"code": code, "name": name, "usdPerUnit": usd_per_unit, "basket": in_basket, "scale": scale, "first": first, "values": values})

    for (code, day), want in ANCHORS.items():
        if Decimal(raw[code].get(day, "0")) != Decimal(want):
            raise SystemExit(f"4: {code} {day} is {raw[code].get(day)}, was {want}")

    data = {
        "retrieved": retrieved(zpath),
        "prepared": prepared.text if prepared is not None else "",
        "source": {
            "name": "Board of Governors of the Federal Reserve System, H.10 Foreign Exchange Rates (daily)",
            "url": "https://www.federalreserve.gov/releases/h10/",
            "terms": "Public domain: \"Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source of the information.\" (https://www.federalreserve.gov/disclaimer.htm)",
            "what": "Noon buying rates in New York for cable transfers payable in the listed currencies, certified by the Federal Reserve Bank of New York for customs purposes.",
        },
        "firstDate": dates[0],
        "gaps": gaps,
        "currencies": out,
    }
    text = (
        "// Generated by scripts/data/fx_daily.py. Do not edit by hand.\n"
        "// Daily noon buying rates in New York from the Federal Reserve Board's H.10 release (public domain), retrieved\n"
        f"// {data['retrieved']}. Calendar: firstDate, then gaps[i] days to each next date. For each currency, values starts at\n"
        "// calendar index first: the first rate, then the change from the previous published rate, or null for no rate;\n"
        "// rates are whole numbers of 10^-scale units, quoted as the release quotes them (US dollars per unit if usdPerUnit).\n"
        "export const FX = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    if "NaN" in text or "Infinity" in text:
        raise SystemExit("the output holds a value that is not a number")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB), release prepared {data['prepared']}, {dates[0]} to {dates[-1]}, {len(dates)} dates")
    for c in out:
        print(f"  {c['code']} from {dates[c['first']]}, scale {c['scale']}, {sum(v is None for v in c['values'])} days with no rate")


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
