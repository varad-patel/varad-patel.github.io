"""Build 365projects/53/data.js: published quintile transition matrices between parents and children.

    python scripts/data/mobility_matrices.py --cache DIR [--retrieved YYYY-MM-DD]

The matrices exist only as tables inside two PDFs, so the script downloads the PDFs into --cache (never the
repository), turns the page that holds each table into text with `pdftotext -raw` (Xpdf or Poppler must be
on the PATH), and reads the numbers out of that text. Nothing is typed in by hand. A second run reads the
cached PDFs.

Sources
  1. Jantti, M., Bratsberg, B., Roed, K., Raaum, O., Naylor, R., Osterbacka, E., Bjorklund, A., and
     Eriksson, T. (2006). American exceptionalism in a new light: a comparison of intergenerational earnings
     mobility in the Nordic countries, the United Kingdom and the United States. IZA Discussion Paper 1938.
       https://docs.iza.org/dp1938.pdf
     Table 12, page 33 (page 36 of the PDF): fathers and sons, pairs with zero earnings excluded.
     Table 13, page 34 (page 37 of the PDF): fathers and daughters, pairs with zero earnings excluded.
     Six countries in each table. A cell is the share of the offspring of fathers in earnings fifth fq_i who
     are themselves in earnings fifth oq_j, to three decimal places, with a bootstrap interval that is not kept.
     sha256 of the file as retrieved: 69b36c2efc01c5091c113c327611e033a90a880c3cc362872635bbf75e5d1783
  2. Chetty, R., Hendren, N., Kline, P., and Saez, E. (2014). Where is the land of opportunity? The geography
     of intergenerational mobility in the United States. Quarterly Journal of Economics 129(4), 1553-1623.
     The authors' final version (June 2014) as hosted by Opportunity Insights:
       https://opportunityinsights.org/wp-content/uploads/2018/03/mobility_geo.pdf
     Table II, "National Quintile Transition Matrix" (page 70 of that PDF). A cell is the percentage of
     children whose family income is in the fifth given by the ROW, among children whose parents' family
     income is in the fifth given by the COLUMN, to one decimal place.
     sha256 of the file as retrieved: fe16ba6b96bed1e12a70e6cc561d0e17928deff56d8e4660ba98b2e2511122f5

Licence
  The figures are published research results, reproduced with their source. They are facts, quoted with a
  citation; neither paper is redistributed.

Rules
  * Every matrix is stored with parents in rows and children in columns, lowest fifth first, in thousandths
    exactly as printed (0.247 is 247; 33.7% is 337). Chetty et al. print children in rows, so their table is
    transposed.
  * Nothing is rescaled here. Because of rounding in the sources a row adds up to between 999 and 1,001 (the
    script allows 997 to 1,003); the page divides each row by its own total before it does any arithmetic, and
    says so. The columns of the Jantti tables add up to between 961 and 1,043: see the page.
  * The script stops if a table does not have five rows of five numbers for every country, if a row total is
    further than 3 from 1,000, or if any of the spot checks in CHECKS (cells read off the PDFs by eye) fails.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "53" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; varad-patel-365projects/1.0; +https://varad-patel.github.io)"}

IZA = {"url": "https://docs.iza.org/dp1938.pdf", "file": "iza_dp1938.pdf", "sha256": "69b36c2efc01c5091c113c327611e033a90a880c3cc362872635bbf75e5d1783"}
CHETTY = {"url": "https://opportunityinsights.org/wp-content/uploads/2018/03/mobility_geo.pdf", "file": "chetty_mobility_geo.pdf", "sha256": "fe16ba6b96bed1e12a70e6cc561d0e17928deff56d8e4660ba98b2e2511122f5"}

JANTTI_CITE = "Jäntti, Bratsberg, Røed, Raaum, Naylor, Österbacka, Björklund and Eriksson (2006), IZA Discussion Paper 1938"
COMMON = "Fathers were aged 35 to 64 when the child was about 16. The earnings of both generations are adjusted to what they would have been at age 40. Pairs in which either has no earnings are left out."
# What each country's figures measure, from section 2 and appendix A of the paper.
COUNTRIES = {
    "Denmark": {"id": "dk", "who": "Children born 1958 to 1960. Their earnings in 1998 and 2000 (tax registers) against the father's earnings in 1980."},
    "Finland": {"id": "fi", "who": "Children born 1958 to 1960. Their earnings in 1993 and 2000 (tax records) against the father's earnings in 1975."},
    "Norway": {"id": "no", "who": "Everyone born in Norway in 1958. Their earnings in 1992 and 1999 (tax records) against the father's earnings in 1974."},
    "Sweden": {"id": "se", "who": "A one-in-five sample of children born in 1962. Their earnings in 1996 and 1999 (tax registers) against the father's earnings in 1975."},
    "UK": {"id": "uk", "name": "United Kingdom", "who": "Children born in one week of March 1958 (National Child Development Study). Their gross weekly pay at ages 33 and 41 (1991 and 1999) against the parents' net weekly income in 1974, which was recorded in bands."},
    "USNLSY": {"id": "us", "name": "United States", "who": "Children born 1957 to 1964 (National Longitudinal Survey of Youth). Their wages and salaries in 1995 and 2001 against family income in 1978, not the father's earnings alone."},
}
# Cells read off the PDFs by eye: (matrix id, parent fifth, child fifth) -> thousandths.
CHECKS = {
    ("us-sons", 1, 1): 422, ("us-sons", 1, 5): 79, ("us-sons", 5, 5): 360,
    ("dk-sons", 1, 1): 247, ("dk-sons", 5, 5): 363, ("uk-sons", 1, 1): 303, ("se-sons", 5, 1): 163,
    ("no-daughters", 1, 1): 235, ("us-daughters", 5, 2): 114, ("fi-daughters", 5, 5): 313,
    ("us-children", 1, 1): 337, ("us-children", 1, 5): 75, ("us-children", 5, 5): 365, ("us-children", 3, 4): 220, ("us-children", 2, 1): 242,
}


def fetch(src: dict, cache: Path) -> Path:
    path = cache / src["file"]
    if not path.exists():
        print(f"downloading {src['url']}", file=sys.stderr)
        with urllib.request.urlopen(urllib.request.Request(src["url"], headers=UA), timeout=300) as r:
            path.write_bytes(r.read())
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != src["sha256"]:
        print(f"note: {src['file']} is not the file this script was written against (sha256 {digest}); the checks below still apply", file=sys.stderr)
    return path


def page_text(pdf: Path, page: int) -> str:
    try:
        raw = subprocess.run(["pdftotext", "-raw", "-f", str(page), "-l", str(page), str(pdf), "-"], capture_output=True, check=True).stdout
    except FileNotFoundError:
        sys.exit("pdftotext was not found. Install Xpdf or Poppler and run again.")
    return raw.decode("utf-8", "replace")


def jantti(pdf: Path, page: int, table: int, child: str) -> list[dict]:
    text = page_text(pdf, page)
    if f"Table {table} " not in text:
        raise ValueError(f"page {page} of the IZA paper does not hold Table {table}")
    # Drop the bootstrap intervals, then cut the page into one piece per country.
    words = " ".join(line for line in text.splitlines() if not line.startswith("["))
    pieces = re.split(r"(Denmark|Finland|Norway|Sweden|UK|USNLSY) \(n = (\d+)\)", words)[1:]
    out = []
    for name, n, body in zip(pieces[0::3], pieces[1::3], pieces[2::3]):
        rows = []
        for q in range(1, 6):
            m = re.search(rf"fq{q} (0\.\d{{3}}) (0\.\d{{3}}) (0\.\d{{3}}) (0\.\d{{3}}) (0\.\d{{3}})(?= |$)", body)
            if not m:
                raise ValueError(f"Table {table}, {name}: no row fq{q}")
            rows.append([round(float(v) * 1000) for v in m.groups()])
        c = COUNTRIES[name]
        country = c.get("name", name)
        out.append({
            "id": f"{c['id']}-{child}",
            "country": country,
            "label": f"{country}, fathers and {child} (Jäntti et al. 2006)",
            "children": child,
            "measure": "earnings",
            "study": "jantti",
            "table": f"Table {table}, page {30 + table - 9}",
            "pairs": int(n),
            "who": f"{c['who']} {child.capitalize()} only. {COMMON}",
            "P": rows,
        })
    if [m["country"] for m in out] != ["Denmark", "Finland", "Norway", "Sweden", "United Kingdom", "United States"]:
        raise ValueError(f"Table {table}: expected six countries, found {[m['country'] for m in out]}")
    return out


def chetty(pdf: Path, page: int) -> dict:
    text = page_text(pdf, page)
    if "National Quintile Transition Matrix" not in text:
        raise ValueError(f"page {page} of the Chetty paper does not hold Table II")
    printed = []
    for q in range(1, 6):
        m = re.search(rf"^{q} (\d+\.\d)% (\d+\.\d)% (\d+\.\d)% (\d+\.\d)% (\d+\.\d)%\s*$", text, re.M)
        if not m:
            raise ValueError(f"Table II: no row for child fifth {q}")
        printed.append([round(float(v) * 10) for v in m.groups()])
    n = re.search(r"for the ([\d,]+) children in the\s+core sample \(1980-82 birth cohorts\)", text)
    if not n:
        raise ValueError("Table II: the note with the number of children was not found")
    return {
        "id": "us-children",
        "country": "United States",
        "label": "United States, parents and all children (Chetty et al. 2014)",
        "children": "children",
        "measure": "family income",
        "study": "chetty",
        "table": "Table II (page 70 of the authors' final version)",
        "pairs": int(n.group(1).replace(",", "")),
        "who": "Children born 1980 to 1982, sons and daughters together, from federal income tax records. The child's family income in 2011 and 2012, at about age 30, against the parents' family income averaged over 1996 to 2000. Fifths are of each generation's own national distribution.",
        "P": [[printed[child][parent] for child in range(5)] for parent in range(5)],  # transposed: parents in rows
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", required=True, help="folder for the two downloaded PDFs")
    ap.add_argument("--retrieved", default=datetime.date.today().isoformat())
    args = ap.parse_args()
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    iza, oi = fetch(IZA, cache), fetch(CHETTY, cache)

    matrices = [chetty(oi, 70), *jantti(iza, 36, 12, "sons"), *jantti(iza, 37, 13, "daughters")]
    by_id = {m["id"]: m for m in matrices}
    for m in matrices:
        if len(m["P"]) != 5 or any(len(r) != 5 for r in m["P"]):
            raise ValueError(f"{m['id']}: not five by five")
        for i, row in enumerate(m["P"]):
            if abs(sum(row) - 1000) > 3:
                raise ValueError(f"{m['id']}: row {i + 1} adds up to {sum(row)} thousandths")
    for (mid, parent, child), want in CHECKS.items():
        got = by_id[mid]["P"][parent - 1][child - 1]
        if got != want:
            raise ValueError(f"spot check failed: {mid} parent {parent} child {child} is {got}, expected {want}")

    data = {
        "retrieved": args.retrieved,
        "unit": 1000,
        "sources": {
            "jantti": {
                "cite": JANTTI_CITE + ". Tables 12 and 13, pages 33 and 34.",
                "url": IZA["url"],
            },
            "chetty": {
                "cite": "Chetty, Hendren, Kline and Saez (2014), Quarterly Journal of Economics 129(4), 1553-1623. Table II.",
                "url": CHETTY["url"],
            },
        },
        "matrices": matrices,
    }
    head = (
        "// GENERATED by scripts/data/mobility_matrices.py. Do not edit by hand.\n"
        "// Quintile transition matrices as printed in two papers, in thousandths, parents in rows and children in columns.\n"
        f"//   {JANTTI_CITE}, Tables 12 and 13: {IZA['url']}\n"
        f"//   Chetty, Hendren, Kline and Saez (2014), QJE 129(4), Table II: {CHETTY['url']}\n"
        f"// Published research results, quoted with their source. Retrieved {args.retrieved}.\n"
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(head + "export const MOBILITY = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8", newline="\n")
    sums = sorted({sum(r) for m in matrices for r in m["P"]})
    print(f"wrote {OUT}: {len(matrices)} matrices, row totals from {sums[0]} to {sums[-1]} thousandths", file=sys.stderr)


if __name__ == "__main__":
    main()
