"""Build 365projects/35/data.js: India's Union Budget spending by ministry and demand, 2017-18 to 2026-27.

    pip install openpyxl xlrd pypdf
    python scripts/data/union_budget.py [--cache DIR]

Source (downloaded into --cache, never committed): the Union Budget documents published by the
Ministry of Finance, Government of India, at https://www.indiabudget.gov.in, for the eight budgets
from 2019-20 to 2026-27:

  * Expenditure Profile, Statement 3 ("Expenditure of Ministries and Departments", called 3A before
    2023-24): for every demand for grants, revenue, capital and total expenditure, net of receipts
    and recoveries, as Actuals for the year two before the budget, Budget Estimates and Revised
    Estimates for the year before, and Budget Estimates for the budget year. Only the totals are
    kept. Read from the spreadsheet, and every figure used is then looked for in the printed PDF.
  * Expenditure Budget 2026-27, "Summary of Demands for Grants" (sumsbe.xlsx): which demands belong
    to which ministry.
  * Budget at a Glance, read from the printed PDFs: the statement of the same name (recovery of
    loans, other receipts, borrowings and other liabilities, total expenditure) and "Receipts"
    (gross tax revenue, the States' share, the Centre's net tax revenue, non-tax revenue).

Every page of the site carries the note "The Budget data in excel has been generated from System.
In case of any inconsistency, pdf files will be treated as final." There are inconsistencies: the
spreadsheet of Budget at a Glance 2023-24 prints non-tax revenue for 2021-22 as 3651132 in its first
statement and 365113 in "Receipts", where the PDF prints 365112 in both, and it gives the States'
share for that year as 898393 where the PDF prints 898392; the 2021-22 spreadsheet gives non-tax
revenue for 2019-20 as 327158 in "Receipts" where the PDF prints 327157. So Budget at a Glance is
read from the PDFs only, and the build stops if a Statement 3 figure is not in its PDF.

The site's copyright policy (https://www.indiabudget.gov.in/website-policies.php, read 12 October
2026) says: "This contents of this website may not be reproduced partially or fully, without due
permission from Ministry of Finance, Govt. of India. If referred to as a part of another
publication, the source must be appropriately acknowledged. The contents of this website can not be
used in any misleading or objectionable context." That is not an open licence, and no permission
has been obtained. data.gov.in has five Union Budget catalogues under the Government Open Data
License - India (2018-19, 2019-20 Interim, 2021-22, 2022-23 and 2023-24). They hold Budget at a
Glance and each budget year's provisions by demand, but not Statement 3, so they have no actuals by
demand, and there is nothing after 2023-24. Their downloads go through a form with a CAPTCHA and
their API needs a key from a registered account.

Which figure is used for each financial year (the best one published, never a mixture inside a year):

  2017-18 to 2024-25   Actuals, each from the budget presented two years later (2019-20 to 2026-27)
  2025-26              Revised Estimates, from Budget 2026-27
  2026-27              Budget Estimates, from Budget 2026-27

Cleaning rules:

  * A demand row is a row whose first filled cell is "<number>. <name>" or "Demand No. <number>
    <name>" and which carries twelve figures. "..." in the source means nil and is read as 0.
  * Demands are grouped by the ministry that holds them in the 2026-27 Summary of Demands for
    Grants, in every year. So the Department of Public Enterprises counts under Finance throughout,
    although it sat with Heavy Industries until 2021.
  * Six demands were renamed or merged and are joined to their successor (ALIASES below): the two
    Union Territories Dadra and Nagar Haveli and Daman and Diu (merged in 2020), Agriculture
    (Cooperation left it for a ministry of its own in 2021), AYUSH, Heavy Industry and Shipping.
  * A demand that does not exist in a year's document (Ladakh and Transfers to Jammu and Kashmir
    in 2017-18, Cooperation before 2020-21) is null for that year, not zero. Where the document
    lists a demand with nil spending (Repayment of Debt in every year, because repaying principal
    is not expenditure in these net figures) it is 0.
  * A Budget at a Glance row is found in the PDF's text by its label ("5. Recovery of Loans",
    "Gross Tax Revenue" and so on, in bag1.pdf and bag5.pdf). Its figures are the numbers of five
    or more digits that follow: a footnote mark before them and the next row's number after them
    have one or two. The first is Actuals; in a table of four, the third is Revised Estimates and
    the fourth Budget Estimates. Budget 2024-25 (July 2024) has a fifth column, Provisional
    Actuals, and only its first column is used. Non-tax revenue and net tax revenue are read from
    "Receipts".

Checks that stop the build: every column of every Statement 3 must add up to its own Grand Total;
every Statement 3 figure used must appear in the printed PDF of the statement; the Grand Total must
equal Budget at a Glance's total expenditure to the crore; the five kinds of receipt must add up to
total expenditure within 3 crore (rounding); every demand must belong to a ministry; the 2026-27
ministry totals must equal the Summary of Demands for Grants.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "35" / "data.js"
SITE = "https://www.indiabudget.gov.in/"
# The site answers 403 to a user agent that contains a URL, so this one is a bare name.
UA = {"User-Agent": "varad-patel-365projects/1.0"}
RETRIEVED = "2026-10-12"

YEARS = [f"{y}-{str(y + 1)[2:]}" for y in range(2017, 2027)]  # "2017-18" ... "2026-27"
LATEST = "2026-27"

# Files relative to each budget's folder on the site. The printed PDFs have the same names in every budget; the
# Statement 3 spreadsheet does not.
PDFS = {"stat3pdf": "doc/eb/stat3a.pdf", "bag1": "doc/Budget_at_Glance/bag1.pdf", "bag5": "doc/Budget_at_Glance/bag5.pdf"}
BUDGETS = {
    "2019-20": {"stat3": "doc/eb/stat3a.xlsx"},
    "2020-21": {"stat3": "doc/eb/stat3a.xlsx"},
    "2021-22": {"stat3": "doc/eb/stat3a.xls"},
    "2022-23": {"stat3": "doc/eb/stat3a.xls"},
    "2023-24": {"stat3": "doc/eb/stat3.xls"},
    "2024-25": {"stat3": "doc/eb/stat3.xlsx"},
    "2025-26": {"stat3": "doc/eb/stat3.xlsx"},
    "2026-27": {"stat3": "doc/eb/stat3a.xlsx", "sumsbe": "doc/eb/sumsbe.xlsx"},
}

# Old demand name -> the 2026-27 demand it became.
ALIASES = {
    "Dadra and Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman and Diu": "Dadra and Nagar Haveli and Daman and Diu",
    "Department of Agriculture, Cooperation and Farmers' Welfare": "Department of Agriculture and Farmers Welfare",
    "Department of Heavy Industry": "Ministry of Heavy Industries",
    "Ministry of Ayurveda, Yoga and Naturopathy, Unani, Siddha and Homoeopathy (AYUSH)": "Ministry of Ayush",
    "Ministry of Shipping": "Ministry of Ports, Shipping and Waterways",
}

DEMAND = re.compile(r"^\s*(?:Demand No\.\s*)?(\d+)\.?\s+(\S.*\S)\s*$")
NIL = {"...", "..", "…"}


def squash(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("’", "'")).strip()


def fetch(budget: str, rel: str, cache: Path) -> Path:
    """Download one file of one budget into the cache (once) and return its path."""
    path = cache / f"{budget}_{rel.replace('/', '_')}"
    if path.exists() and path.stat().st_size > 2000:
        return path
    # The latest budget lives at the site root until the next one is presented, then in its own folder.
    bases = [f"budget{budget}/"] + ([""] if budget == LATEST else [])
    for base in bases:
        url = SITE + urllib.parse.quote(base + rel)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                body = r.read()
        except Exception:  # noqa: BLE001 - try the next address
            continue
        if body[:1] == b"<" or len(body) < 2000:  # the site answers a missing file with an HTML page
            continue
        path.write_bytes(body)
        print(f"  downloaded {url} ({len(body):,} bytes)")
        return path
    raise SystemExit(f"could not download {rel} for Budget {budget}")


def sheets(path: Path):
    """Yield (sheet name, rows) for an .xlsx or a binary .xls workbook."""
    if path.read_bytes()[:4] == b"PK\x03\x04":
        import openpyxl

        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        for ws in wb.worksheets:
            yield ws.title, [list(row) for row in ws.iter_rows(values_only=True)]
    else:
        import xlrd

        with open(os.devnull, "w") as quiet:
            wb = xlrd.open_workbook(str(path), logfile=quiet)
        for sh in wb.sheets():
            yield sh.name, [[c if c != "" else None for c in sh.row_values(i)] for i in range(sh.nrows)]


def filled(row):
    return [c for c in row if c is not None and not (isinstance(c, str) and not c.strip())]


def number(cell):
    if isinstance(cell, bool):
        return None
    if isinstance(cell, (int, float)):
        return float(cell)
    if isinstance(cell, str):
        text = cell.strip()
        if text in NIL:
            return 0.0
        try:
            return float(text.replace(",", ""))
        except ValueError:
            return None
    return None


def parse_stat3(path: Path):
    """Statement 3: ([(name, [12 figures])], [12 grand totals], [four column headings])."""
    demands, grand, heads = [], None, None
    for _, rows in sheets(path):
        for row in rows:
            cells = filled(row)
            if not cells or not isinstance(cells[0], str):
                continue
            first = squash(cells[0])
            if heads is None and any(isinstance(c, str) and "Actuals" in c for c in cells):
                heads = [squash(c) for c in cells if isinstance(c, str) and re.search(r"Actuals|Estimates", c)]
            values = [v for v in (number(c) for c in cells[1:]) if v is not None]
            m = DEMAND.match(first)
            if m and len(values) == 12:
                demands.append((squash(m.group(2)), values))
            elif m:
                raise SystemExit(f"{path.name}: demand row with {len(values)} figures, expected 12: {first}")
            elif first.startswith("Grand Total"):
                if len(values) != 12:
                    raise SystemExit(f"{path.name}: Grand Total row has {len(values)} figures")
                grand = values
    if not demands or grand is None or not heads or len(heads) != 4:
        raise SystemExit(f"{path.name}: could not read Statement 3 (demands {len(demands)}, headings {heads})")
    for i in range(12):
        total = sum(v[i] for _, v in demands)
        if abs(total - grand[i]) > 0.06:
            raise SystemExit(f"{path.name}: column {i} adds up to {total:.2f}, Grand Total says {grand[i]:.2f}")
    return demands, grand, heads


def parse_sumsbe(path: Path):
    """Summary of Demands for Grants: [(ministry, total, [demand names])] in the document's order."""
    ministries = []
    for _, rows in sheets(path):
        for row in rows:
            cells = filled(row)
            if len(cells) < 4 or not isinstance(cells[0], str):
                continue
            values = [v for v in (number(c) for c in cells[1:]) if v is not None]
            if re.fullmatch(r"\s*\d+\.\s*", cells[0]) and isinstance(cells[1], str):
                ministries[-1][2].append(squash(cells[1]))
            elif len(values) == 3 and not re.match(r"\s*\d", cells[0]):
                ministries.append((squash(cells[0]), values[2], []))
    if len(ministries) < 40 or any(not m[2] for m in ministries):
        raise SystemExit(f"{path.name}: could not read the ministries ({len(ministries)} found)")
    return ministries


BAG_ROWS = {  # label of each Budget at a Glance row -> (file, pattern). The label may be broken over two lines.
    "loans": ("bag1", r"5\.\s*Recovery of Loans"),
    "other": ("bag1", r"6\.\s*Other Receipts"),
    "borrowing": ("bag1", r"7\.\s*Borrowings and Other\s+Liabilities"),
    "expenditure": ("bag1", r"9\.\s*Total Expenditure\s*\(10\+13\)"),
    "grossTax": ("bag5", r"Gross Tax Revenue"),
    "statesShare": ("bag5", r"Less\s*-\s*State'?s'?\s+share"),  # "State's share" in most years, "States' share" in 2023-24
    "netTax": ("bag5", r"1a Centre's Net Tax(?:\s+Revenue)?"),  # in 2022-23 the figures come before the word "Revenue"
    "nonTax": ("bag5", r"2\.\s*Non-Tax Revenue"),
}
PDF_TEXT: dict[Path, list[str]] = {}


def pdf_pages(path: Path) -> list[str]:
    """The text of each page of a PDF (read once)."""
    if path not in PDF_TEXT:
        from pypdf import PdfReader

        PDF_TEXT[path] = [(page.extract_text() or "").replace("’", "'") for page in PdfReader(str(path)).pages]
    return PDF_TEXT[path]


def parse_bag(path: Path, name: str, actuals_year: int) -> list[float]:
    """One Budget at a Glance row from the printed PDF: its figures in the table's order, Actuals first."""
    hits = []
    for text in pdf_pages(path):
        for m in re.finditer(BAG_ROWS[name][1] + r"\S{0,2}((?:\s+-?\d+){3,7})", text):
            first_year = re.search(r"(20\d\d)-(?:20)?\d\d", text)  # the table's first column heading
            if not first_year or int(first_year.group(1)) != actuals_year:
                raise SystemExit(f"{path.name}: the first column of the table is not Actuals {actuals_year}")
            # Every figure in these rows has five or more digits; a footnote mark or the next row's number has one or two.
            hits.append([float(t) for t in m.group(1).split() if len(t.lstrip("-")) >= 5])
    if len(hits) != 1 or len(hits[0]) not in (4, 5):
        raise SystemExit(f"{path.name}: expected one '{name}' row with four or five figures, found {hits}")
    return hits[0]


def printed(path: Path) -> set[float]:
    """Every number printed in a PDF, for checking a spreadsheet's figures against the document that is final."""
    return {float(t) for text in pdf_pages(path) for t in re.findall(r"-?\d+(?:\.\d+)?", text.replace(",", ""))}


def build(cache: Path) -> dict:
    files = {b: {k: fetch(b, rel, cache) for k, rel in {**spec, **PDFS}.items()} for b, spec in BUDGETS.items()}
    stat3 = {b: parse_stat3(f["stat3"]) for b, f in files.items()}

    # Which budget and which column give each financial year.
    def pick(year: str):
        start = int(year[:4])
        two_later = f"{start + 2}-{str(start + 3)[2:]}"
        if two_later in BUDGETS:
            return two_later, 0, "Actuals"
        if year == "2025-26":
            return LATEST, 2, "Revised Estimates"
        if year == LATEST:
            return LATEST, 3, "Budget Estimates"
        raise SystemExit(f"no source for {year}")

    picks = [pick(y) for y in YEARS]
    for year, (budget, col, status) in zip(YEARS, picks):
        long_year = f"{year[:4]}-{int(year[:4]) + 1}"
        head = stat3[budget][2][col].replace(" ", "")
        if long_year not in head or status.replace(" ", "") not in head:
            raise SystemExit(f"Budget {budget}, column {col}: heading '{stat3[budget][2][col]}' is not {status} {long_year}")

    # Ministries and their demands, from the 2026-27 summary.
    summary = parse_sumsbe(files[LATEST]["sumsbe"])
    home = {d: m for m, _, ds in summary for d in ds}
    latest_names = [n for n, _ in stat3[LATEST][0]]
    if sorted(latest_names) != sorted(home):
        raise SystemExit(f"Statement 3 and the Summary of Demands disagree: {set(latest_names) ^ set(home)}")

    series = {d: [None] * len(YEARS) for d in home}
    total = []
    for i, (budget, col, _) in enumerate(picks):
        demands, grand, _ = stat3[budget]
        in_print = printed(files[budget]["stat3pdf"])
        for name, values in [*demands, ("Grand Total", grand)]:
            # The site treats the PDF as final. Nil is printed as "..." there, so there is no number to look for.
            if values[col * 3 + 2] and round(values[col * 3 + 2], 2) not in in_print:
                raise SystemExit(f"Budget {budget}: {values[col * 3 + 2]} for '{name}' is in the spreadsheet but not in the printed PDF")
        for name, values in demands:
            name = ALIASES.get(name, name)
            if name not in series:
                raise SystemExit(f"Budget {budget}: demand '{name}' has no ministry. Add it to ALIASES.")
            series[name][i] = round((series[name][i] or 0) + values[col * 3 + 2], 2)
        total.append(round(grand[col * 3 + 2], 2))
        if abs(sum(v[i] for v in series.values() if v[i] is not None) - total[i]) > 0.06:
            raise SystemExit(f"{YEARS[i]}: the demands do not add up to the Grand Total")
    for m, m_total, ds in summary:
        if abs(sum(series[d][-1] for d in ds) - m_total) > 0.06:
            raise SystemExit(f"{m}: demands add up to something other than the summary's {m_total}")

    # Receipts.
    receipts = {k: [] for k in BAG_ROWS}
    for i, (budget, col, _) in enumerate(picks):
        for k, (which, _) in BAG_ROWS.items():
            row = parse_bag(files[budget][which], k, int(budget[:4]) - 2)
            if col and len(row) != 4:  # only a table of four has Revised Estimates third and Budget Estimates fourth
                raise SystemExit(f"Budget {budget}: the '{k}' row has {len(row)} figures, so column {col} is not known")
            receipts[k].append(round(row[col]))
        r = {k: v[i] for k, v in receipts.items()}
        if abs(r["expenditure"] - total[i]) > 1:
            raise SystemExit(f"{YEARS[i]}: Budget at a Glance spends {r['expenditure']}, Statement 3 {total[i]}")
        funded = r["netTax"] + r["nonTax"] + r["loans"] + r["other"] + r["borrowing"]
        if abs(funded - r["expenditure"]) > 3:
            raise SystemExit(f"{YEARS[i]}: receipts {funded} do not match expenditure {r['expenditure']}")
        if not 0.2 < r["statesShare"] / r["grossTax"] < 0.45:
            raise SystemExit(f"{YEARS[i]}: implausible States' share {r['statesShare']} of {r['grossTax']}")
    del receipts["expenditure"]

    return {
        "source": "Union Budget documents, Ministry of Finance, Government of India (indiabudget.gov.in): Expenditure Profile "
                  "Statement 3, Summary of Demands for Grants 2026-27 and Budget at a Glance (printed PDFs), budgets of 2019-20 to 2026-27",
        "policy": "This contents of this website may not be reproduced partially or fully, without due permission from Ministry of "
                  "Finance, Govt. of India. If referred to as a part of another publication, the source must be appropriately "
                  "acknowledged. The contents of this website can not be used in any misleading or objectionable context.",
        "retrieved": RETRIEVED,
        "unit": "rupees crore (1 crore = 10 million), not adjusted for inflation",
        "years": YEARS,
        "status": [s for _, _, s in picks],
        "budget": [b for b, _, _ in picks],
        "total": total,
        "receipts": receipts,
        "ministries": [{"name": m, "demands": [{"name": d, "v": series[d]} for d in ds]} for m, _, ds in summary],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", type=Path, default=None, help="folder for the downloaded files (kept between runs)")
    args = ap.parse_args()
    cache = args.cache or Path(tempfile.gettempdir()) / "union-budget-cache"
    cache.mkdir(parents=True, exist_ok=True)
    data = build(cache)
    head = (
        "// GENERATED by scripts/data/union_budget.py. Do not edit by hand.\n"
        "// India's Union Budget: expenditure of every demand for grants, grouped by ministry, 2017-18 to 2026-27, in rupees crore.\n"
        "// Source: Union Budget documents (Expenditure Profile Statement 3, Summary of Demands for Grants, Budget at a Glance),\n"
        "// Ministry of Finance, Government of India, https://www.indiabudget.gov.in. Retrieved " + RETRIEVED + ".\n"
        "// Not an open licence, and no permission has been obtained: the site's copyright policy is quoted in BUDGET.policy.\n"
        "// Statement 3 is read from the spreadsheets and checked against the printed PDFs; Budget at a Glance (receipts) is\n"
        "// read from the PDFs, which the site treats as final where the two differ. status[i] says whether year i is\n"
        "// Actuals, Revised Estimates or Budget Estimates, and budget[i] which budget's documents it was read from.\n"
        "// v[i] is null where a demand did not exist in that year's document.\n"
    )
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    body = body.replace('{"name":', '\n{"name":').replace('"ministries":[', '"ministries":[\n').replace('"receipts":', '\n"receipts":')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(head + "export const BUDGET = " + body + ";\n", encoding="utf-8", newline="\n")
    n = sum(len(m["demands"]) for m in data["ministries"])
    print(f"wrote {OUT.relative_to(ROOT)}: {len(data['ministries'])} ministries, {n} demands, {len(YEARS)} years, {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
