"""Build 365projects/83/data.js, the credit card records behind project 83 (Credit Risk Model).

    python scripts/data/credit_default.py [--cache DIR]

Needs xlrd (the source is an old-style .xls workbook).

Source (downloaded into --cache, never committed):

  UCI Machine Learning Repository, "Default of Credit Card Clients", donated by I-Cheng Yeh,
  https://archive.ics.uci.edu/dataset/350/default+of+credit+card+clients (DOI 10.24432/C55S3H).
  The dataset page says: "This dataset is licensed under a Creative Commons Attribution 4.0 International
  (CC BY 4.0) license." (Checked on 15 October 2026.) The file is
  https://archive.ics.uci.edu/static/public/350/default+of+credit+card+clients.zip, which holds one workbook,
  "default of credit card clients.xls": 30,000 cardholders of one bank in Taiwan, with their credit limit, sex,
  education, marital status and age, their repayment status, bill and payment for each month from April to
  September 2005, and whether they defaulted on the payment due in October 2005 ("default payment next month").
  The paper that introduced it is Yeh, I.-C., and Lien, C.-h. (2009), Expert Systems with Applications 36(2),
  2473-2480.

The codebook on the dataset page (quoted in the module's `codebook`) defines education as 1 = graduate school,
2 = university, 3 = high school, 4 = others; marital status as 1 = married, 2 = single, 3 = others; and the
repayment status as -1 = pay duly, 1 to 9 = payment delay for that many months ("9 = nine months and above").
The data also hold codes the codebook does not define: education 0, 5 and 6, marital status 0, and repayment
status -2 and 0. The script counts them and the page says so; it does not guess what they mean.

Cleaning rules (nothing else is changed, and every row is kept):
  * Education is kept in four groups: graduate school, university, high school, and "others or a code the
    codebook does not define" (codes 4, 0, 5, 6). Marital status in three: married, single, and "others or
    undefined" (codes 3, 0). Sex is kept as coded (1 = male, 2 = female).
  * The credit limit is stored in thousands of NT$, rounded. All limits but one are whole thousands; the one
    that is not (NT$327,680) becomes 328 thousand.
  * The repayment status for September 2005 is kept as coded (-2 to 8). For April to August only the number of
    months with a status of 1 or more (a payment delay) is kept, 0 to 5.
  * The September 2005 bill and the amount paid in September 2005 are rounded to the nearest NT$10.
  * The script stops if a column is missing, a value is outside the range given below, or the IDs are not
    1 to 30,000 in order.

Encoding: each column is one string, a fixed number of characters per cardholder in the order of the file's
IDs, each character a digit in base 64 with the alphabet below (most significant digit first):
  limit  2 chars  credit limit in thousands of NT$
  group  1 char   ((sex - 1) * 4 + education group) * 3 + marital group) * 2 + defaulted
  age    1 char   age in years minus 21
  status 1 char   September 2005 repayment status plus 2
  late   1 char   months from April to August 2005 with a payment delay
  bill   3 chars  September 2005 bill in NT$10, plus 20,000
  paid   3 chars  amount paid in September 2005, in NT$10
"""

from __future__ import annotations

import argparse
import json
import tempfile
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "83" / "data.js"
UA = {"User-Agent": "Mozilla/5.0"}  # anonymous: no name or address goes with the request
RETRIEVED = "2026-10-15"
PAGE = "https://archive.ics.uci.edu/dataset/350/default+of+credit+card+clients"
ZIP_URL = "https://archive.ics.uci.edu/static/public/350/default+of+credit+card+clients.zip"
ZIP_NAME = "default+of+credit+card+clients.zip"
SHEET_FILE = "default of credit card clients.xls"
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
COLUMNS = ["ID", "LIMIT_BAL", "SEX", "EDUCATION", "MARRIAGE", "AGE", "PAY_0", "PAY_2", "PAY_3", "PAY_4", "PAY_5",
           "PAY_6", "BILL_AMT1", "BILL_AMT2", "BILL_AMT3", "BILL_AMT4", "BILL_AMT5", "BILL_AMT6", "PAY_AMT1",
           "PAY_AMT2", "PAY_AMT3", "PAY_AMT4", "PAY_AMT5", "PAY_AMT6", "default payment next month"]
EDU_GROUP = {1: 0, 2: 1, 3: 2, 4: 3, 0: 3, 5: 3, 6: 3}
MAR_GROUP = {1: 0, 2: 1, 3: 2, 0: 2}
BILL_OFFSET = 20000


def fetch(url: str, name: str, cache: Path) -> Path:
    path = cache / name
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            path.write_bytes(r.read())
    return path


def digits(value: int, width: int) -> str:
    if not 0 <= value < 64 ** width:
        raise SystemExit(f"value {value} does not fit in {width} base-64 digits")
    out = ""
    for _ in range(width):
        out = ALPHABET[value % 64] + out
        value //= 64
    return out


def whole(x, lo, hi, what):
    if not isinstance(x, float) or x != int(x) or not lo <= x <= hi:
        raise SystemExit(f"{what}: {x!r} is not a whole number from {lo} to {hi}")
    return int(x)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="credit_default_"))
    cache.mkdir(parents=True, exist_ok=True)

    zpath = fetch(ZIP_URL, ZIP_NAME, cache)
    with zipfile.ZipFile(zpath) as z:
        if SHEET_FILE not in z.namelist():
            raise SystemExit(f"{SHEET_FILE} is not in the zip: {z.namelist()}")
        book = xlrd.open_workbook(file_contents=z.read(SHEET_FILE))
    sheet = book.sheet_by_index(0)
    head = sheet.row_values(1)
    if head != COLUMNS:
        raise SystemExit(f"unexpected columns: {head}")
    col = {name: i for i, name in enumerate(head)}

    cols = {k: [] for k in ["limit", "group", "age", "status", "late", "bill", "paid"]}
    raw_codes = {"EDUCATION": Counter(), "MARRIAGE": Counter(), "SEX": Counter(), "PAY_0": Counter(),
                 "earlier delay codes": Counter()}
    not_thousand = []
    n = 0
    for r in range(2, sheet.nrows):
        row = sheet.row_values(r)
        v = lambda name: row[col[name]]
        n += 1
        if whole(v("ID"), 1, 30000, "ID") != n:
            raise SystemExit(f"row {r}: ID {v('ID')} is out of order")
        limit = whole(v("LIMIT_BAL"), 10000, 1000000, "LIMIT_BAL")
        if limit % 1000:
            not_thousand.append(limit)
        sex = whole(v("SEX"), 1, 2, "SEX")
        edu = whole(v("EDUCATION"), 0, 6, "EDUCATION")
        mar = whole(v("MARRIAGE"), 0, 3, "MARRIAGE")
        age = whole(v("AGE"), 21, 79, "AGE")
        s0 = whole(v("PAY_0"), -2, 8, "PAY_0")
        earlier = [whole(v(k), -2, 8, k) for k in ["PAY_2", "PAY_3", "PAY_4", "PAY_5", "PAY_6"]]
        bill = v("BILL_AMT1")
        paid = v("PAY_AMT1")
        if not isinstance(bill, float) or not -200000 <= bill <= 1100000:
            raise SystemExit(f"BILL_AMT1 {bill!r} out of range")
        if not isinstance(paid, float) or not 0 <= paid <= 1000000:
            raise SystemExit(f"PAY_AMT1 {paid!r} out of range")
        y = whole(v("default payment next month"), 0, 1, "default")
        for name, code in [("EDUCATION", edu), ("MARRIAGE", mar), ("SEX", sex), ("PAY_0", s0)]:
            raw_codes[name][code] += 1
        for code in earlier:
            raw_codes["earlier delay codes"][code] += 1

        cols["limit"].append(digits(round(limit / 1000), 2))
        cols["group"].append(digits((((sex - 1) * 4 + EDU_GROUP[edu]) * 3 + MAR_GROUP[mar]) * 2 + y, 1))
        cols["age"].append(digits(age - 21, 1))
        cols["status"].append(digits(s0 + 2, 1))
        cols["late"].append(digits(sum(1 for c in earlier if c >= 1), 1))
        cols["bill"].append(digits(round(bill / 10) + BILL_OFFSET, 3))
        cols["paid"].append(digits(round(paid / 10), 3))

    if n != 30000:
        raise SystemExit(f"expected 30,000 rows, found {n}")
    print("limits that are not whole thousands:", not_thousand)
    for name, counter in raw_codes.items():
        print(name, sorted(counter.items()))

    data = {
        "retrieved": RETRIEVED,
        "n": n,
        "source": {
            "name": "Default of Credit Card Clients",
            "creator": "I-Cheng Yeh",
            "publisher": "UCI Machine Learning Repository",
            "page": PAGE,
            "doi": "10.24432/C55S3H",
            "file": ZIP_URL,
            "licence": "CC BY 4.0",
            "licenceUrl": "https://creativecommons.org/licenses/by/4.0/",
        },
        "codebook": {
            "education": "1 = graduate school; 2 = university; 3 = high school; 4 = others",
            "marriage": "1 = married; 2 = single; 3 = others",
            "status": "-1 = pay duly; 1 = payment delay for one month; 2 = payment delay for two months; ...; "
                      "8 = payment delay for eight months; 9 = payment delay for nine months and above",
        },
        "rawCodes": {k: {str(c): m for c, m in sorted(v.items())} for k, v in raw_codes.items()},
        "alphabet": ALPHABET,
        "billOffset": BILL_OFFSET,
        "cols": {k: "".join(v) for k, v in cols.items()},
    }
    body = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    OUT.write_text(
        "// Generated by scripts/data/credit_default.py. Do not edit by hand.\n"
        "// 30,000 credit card holders of one bank in Taiwan, April to September 2005, and whether each defaulted in\n"
        f"// October 2005. UCI Machine Learning Repository, \"Default of Credit Card Clients\" (I-Cheng Yeh), CC BY 4.0.\n"
        f"// Retrieved {RETRIEVED}. Columns are base-64 strings, a fixed width per cardholder: see the script.\n"
        f"export const CREDIT = {body};\n",
        encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), cache at {cache}")


if __name__ == "__main__":
    main()
