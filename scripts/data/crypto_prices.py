"""Build 365projects/68/data.js, the daily cryptocurrency prices behind project 68 (Crypto Volatility Lab).

    python scripts/data/crypto_prices.py [--cache DIR]

Source (downloaded into --cache, never committed):

  Coin Metrics, "Free Coin Metrics data archives", https://github.com/coinmetrics/data, one file per coin at
  https://raw.githubusercontent.com/coinmetrics/data/master/csv/<coin>.csv, column PriceUSD.

  Terms. The repository's README says: "Data is made available under the CC BY-NC 4.0 license", and its LICENSE
  file says: "This work by Coin Metrics, Inc is licensed under the Creative Commons Attribution-NonCommercial 4.0
  International License." The README also says: "This data is published in the hope it will be useful, but
  without any warranty. You are using it at your own risk." CC BY-NC 4.0 allows copying and redistribution for
  non-commercial purposes with attribution. This page is a non-commercial personal project with no advertising,
  and it names Coin Metrics as the source on the page and in the module. Many popular price APIs (exchange and
  aggregator APIs) forbid redistribution of their data; Coin Metrics' community archive is used because its
  licence allows it. (Checked on 14 October 2026.) CC BY-NC 4.0, section 3(a), asks for the creator's name, a notice
  that refers to the licence with its URI, a notice that refers to the disclaimer of warranties, and an indication of
  any changes; the module and the page give all four.

  What the price is. Coin Metrics' documentation of PriceUSD
  (https://docs.coinmetrics.io/network-data/network-data-overview/market/price) says: "The price of the asset
  denominated in U.S. Dollars", that "The daily frequency represents the price as of the end of the day in UTC
  time", and that it "is computed using our CM Reference Rates".

  The archive stopped updating on 24 May 2026 (the repository's last commit). The last day with a PriceUSD for
  every coin below is 23 May 2026.

Cleaning rules:
  * Keep the rows with a PriceUSD, in date order. The first and last such dates are the series' ends.
  * The script stops if a day is missing between the first and the last, or a price is not a positive number.
  * Prices are written to six significant figures. Nothing is filled in or smoothed.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "68" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; data download script)"}  # anonymous: no name or address
RETRIEVED = "2026-10-14"
URL = "https://raw.githubusercontent.com/coinmetrics/data/master/csv/{}.csv"

# Coin Metrics file name, display name, ticker.
COINS = [
    ("btc", "Bitcoin", "BTC"),
    ("eth", "Ether", "ETH"),
    ("ltc", "Litecoin", "LTC"),
    ("xrp", "XRP", "XRP"),
    ("doge", "Dogecoin", "DOGE"),
    ("ada", "Cardano", "ADA"),
]


def fetch(url: str, name: str, cache: Path) -> Path:
    path = cache / name
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            path.write_bytes(r.read())
    return path


def daily(coin: str, cache: Path) -> tuple[str, list[float]]:
    text = fetch(URL.format(coin), f"{coin}.csv", cache).read_text("utf-8")
    rows = [r for r in csv.DictReader(io.StringIO(text)) if r.get("PriceUSD")]
    rows.sort(key=lambda r: r["time"])
    days = [dt.date.fromisoformat(r["time"]) for r in rows]
    for a, b in zip(days, days[1:]):
        if (b - a).days != 1:
            raise SystemExit(f"{coin}: no price between {a} and {b}")
    prices = []
    for r in rows:
        v = float(r["PriceUSD"])
        if not v > 0:
            raise SystemExit(f"{coin}, {r['time']}: {r['PriceUSD']!r} is not a positive number")
        prices.append(float(f"{v:.6g}"))
    return days[0].isoformat(), prices


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="crypto_prices_"))
    cache.mkdir(parents=True, exist_ok=True)

    coins = []
    for file, name, ticker in COINS:
        start, prices = daily(file, cache)
        coins.append({"id": file, "name": name, "ticker": ticker, "start": start, "prices": prices})
    out = {
        "retrieved": RETRIEVED,
        "source": {
            "name": "Coin Metrics, free community data archives",
            "url": "https://github.com/coinmetrics/data",
            "licence": "CC BY-NC 4.0",
            "licenceUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
            "warranty": "Coin Metrics publishes the data without any warranty.",
            "changes": "Prices rounded to six significant figures; nothing else changed.",
            "metric": "PriceUSD, the US dollar price at the end of each UTC day, from Coin Metrics' reference rates",
        },
        "coins": coins,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by scripts/data/crypto_prices.py. Do not edit by hand.\n"
        "// Daily US dollar prices at the end of each UTC day from Coin Metrics, Inc's free community data, licensed under\n"
        "// CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/) and published without any warranty.\n"
        "// Rounded to six significant figures here; nothing else changed.\n"
        f"// Retrieved {RETRIEVED}. prices[i] is the price i days after start.\n"
        "export const CRYPTO = " + json.dumps(out, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), cache at {cache}")
    for c in coins:
        end = dt.date.fromisoformat(c["start"]) + dt.timedelta(days=len(c["prices"]) - 1)
        print(f"  {c['id']:5} {c['start']} to {end}  {len(c['prices'])} days  first {c['prices'][0]}  last {c['prices'][-1]}")


if __name__ == "__main__":
    main()
