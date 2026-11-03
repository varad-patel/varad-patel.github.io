"""Build 365projects/118/data.js: Galton's family records of height behind project 118 (Regression to the Mean).

    python scripts/data/galton.py                 download afresh and rewrite the snapshot
    python scripts/data/galton.py --cache DIR     keep the downloads in DIR; a second run with the same DIR
                                                  rebuilds the same file without touching the network

Standard library only. The module is written only after every check below has passed.

Source (downloaded into --cache, never committed)
  Harvard Dataverse, "Galton height data", doi:10.7910/DVN/T0HSJ1 (author Francis Galton, deposited by Jeremy
  Freese on 24 July 2017). The dataset's licence, as its metadata record states, is CC0 1.0
  (http://creativecommons.org/publicdomain/zero/1.0); its description says the data "are public domain and can be
  used for teaching or any other purpose". The file used is galton-stata11.tab (Dataverse file id 3037856), a
  tab-separated table with one row per child: family, father, mother, gender, height, kids, male, female. Heights
  are in inches.
  The rows are the same as the "August 2004 version" of James Hanley's transcription of Galton's notebook
  (https://jhanley.biostat.mcgill.ca/galton/, file galton_heights_197_families.txt, which records heights as
  inches above 60): 197 of the 205 families, the other 8 left blank by Hanley on purpose, and only children whose
  height is written as a number (Hanley's file also has 27 heights in words, such as "tall"). One numeric height in
  Hanley's file, a son of 66.2 inches in family 130, is not in the Dataverse copy; it is not added here. Hanley described the notebook in The American Statistician 58(3), 237-243 (2004).

Cleaning rules
  1. Widaman's erratum, published at the end of Hanley's file (19 January 2005): family 101 should have 4 sons,
     not 6, and its sons of 67.0 and 66.0 inches belong to family 103. The script moves those two rows to family
     103 (father 69.0, mother 66.5) after checking that they are where the erratum says. Nothing else is changed.
  2. Each row keeps family, father, mother, sex (1 son, 0 daughter) and height, exactly as published.
     "kids" is dropped: the page does not use it, and the erratum changes it for two families.

Checks, run on every build (any failure stops the script with the reason)
  1. The Dataverse record still names the licence CC0 1.0 and still lists galton-stata11.tab (file 3037856)
     with the stored checksum below; the table the access API serves (the stored file with a header row added, so
     its checksum differs from the stored one) has the checksum it had when this script was written (SERVED_MD5).
  2. The header is family, father, mother, gender, height, kids, male, female.
  3. 898 rows, 197 families, 465 sons and 433 daughters; every height a number between 55 and 80 inches; father
     and mother the same on every row of a family.
  4. The anchor rows in ANCHORS below are present as published: family 1 (father 78.5, mother 67.0, a son of
     73.2 and a daughter of 69.2), family 2's daughter of 65.5, the two sons of family 101 that the erratum moves,
     and family 103's daughter of 61.0. They match the notebook as transcribed by Hanley (heights above 60 inches:
     18.5, 7, 13.2 and 9.2 for family 1).
  5. After the erratum, family 101 has 4 sons and family 103 has 6.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "118" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; 365projects-data/1.0)"}
META = "https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/T0HSJ1"
FILE_ID = 3037856
FILE_URL = f"https://dataverse.harvard.edu/api/access/datafile/{FILE_ID}"
MD5 = "9bbb93f45b0d0dab16d991e01feb50fa"         # the stored file, as the record lists it
SERVED_MD5 = "46a9ffa3cefb3eec8a96e180ea44c66c"  # the table served by the access API on 2026-10-29
HEADER = ["family", "father", "mother", "gender", "height", "kids", "male", "female"]
# (family, father, mother, sex, height) rows that must be present as published, before the erratum is applied.
ANCHORS = [("1", 78.5, 67.0, 1, 73.2), ("1", 78.5, 67.0, 0, 69.2), ("2", 75.5, 66.5, 0, 65.5),
           ("101", 69.0, 66.7, 1, 67.0), ("101", 69.0, 66.7, 1, 66.0), ("103", 69.0, 66.5, 0, 61.0)]


def fetch(url: str, path: Path) -> Path:
    """Download once. The day of the download is kept beside the file so a rebuild from the cache is identical."""
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
            body = r.read()
        path.write_bytes(body)
        path.with_suffix(path.suffix + ".date").write_text(dt.date.today().isoformat(), encoding="utf-8")
    return path


def retrieved(path: Path) -> str:
    stamp = path.with_suffix(path.suffix + ".date")
    return stamp.read_text(encoding="utf-8").strip() if stamp.exists() else dt.date.fromtimestamp(path.stat().st_mtime).isoformat()


def build(cache: Path) -> None:
    meta = json.loads(fetch(META, cache / "galton-meta.json").read_text(encoding="utf-8"))
    version = meta["data"]["latestVersion"]
    licence = version.get("license", {}).get("name")
    if licence != "CC0 1.0":
        raise SystemExit(f"1: the Dataverse record now names the licence {licence!r}, not CC0 1.0")
    files = {f["dataFile"]["id"]: f["dataFile"] for f in version["files"]}
    if FILE_ID not in files or files[FILE_ID].get("md5") != MD5:
        raise SystemExit(f"1: file {FILE_ID} is missing from the record or its checksum changed")
    tab = fetch(FILE_URL, cache / "galton-stata11.tab")
    body = tab.read_bytes()
    if hashlib.md5(body).hexdigest() != SERVED_MD5:
        raise SystemExit("1: the served table has changed since this script was written: look at it before using it")

    lines = body.decode("utf-8").splitlines()
    head = [h.strip() for h in lines[0].split("\t")]
    if head != HEADER:
        raise SystemExit(f"2: unexpected header {head}")
    rows = []
    for line in lines[1:]:
        if not line.strip():
            continue
        c = line.split("\t")
        family = c[0].strip().strip('"')
        sex = {"M": 1, "F": 0}.get(c[3].strip().strip('"'))
        if sex is None:
            raise SystemExit(f"3: gender {c[3]!r} is not M or F")
        father, mother, height = float(c[1]), float(c[2]), float(c[4])
        for v in (father, mother, height):
            if not 55 <= v <= 80:
                raise SystemExit(f"3: a height of {v} inches in family {family} is out of range")
        rows.append([family, father, mother, sex, height])
    families = {}
    for f, fa, mo, _, _ in rows:
        if families.setdefault(f, (fa, mo)) != (fa, mo):
            raise SystemExit(f"3: family {f} has more than one father or mother")
    sons = sum(r[3] for r in rows)
    if (len(rows), len(families), sons, len(rows) - sons) != (898, 197, 465, 433):
        raise SystemExit(f"3: {len(rows)} rows, {len(families)} families, {sons} sons; expected 898, 197, 465")
    for a in ANCHORS:
        if list(a) not in rows:
            raise SystemExit(f"4: the row {a} is not in the file")

    # Cleaning rule 1: Widaman's erratum.
    for h in (67.0, 66.0):
        i = rows.index(["101", 69.0, 66.7, 1, h])
        rows[i] = ["103", 69.0, 66.5, 1, h]
    if sum(r[0] == "101" for r in rows) != 4 or sum(r[0] == "103" and r[3] == 1 for r in rows) != 6:
        raise SystemExit("erratum: families 101 and 103 do not have 4 and 6 sons after the move")

    order = list(dict.fromkeys(r[0] for r in rows))  # families in the file's order
    out = {
        "retrieved": retrieved(tab),
        "source": {
            "name": "Galton height data, Harvard Dataverse, doi:10.7910/DVN/T0HSJ1",
            "url": "https://doi.org/10.7910/DVN/T0HSJ1",
            "licence": "CC0 1.0",
            "licenceUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        },
        "unit": "inches",
        "note": "One row per child: family index, father, mother, sex (1 son, 0 daughter), height. Two sons moved from "
                "family 101 to 103 following Widaman's erratum (2005) to Hanley's transcription.",
        "families": order,
        "rows": [[order.index(f), fa, mo, s, h] for f, fa, mo, s, h in rows],
    }
    text = (
        "// Generated by scripts/data/galton.py. Do not edit by hand.\n"
        "// Galton's family records of height (Hanley's transcription, 197 families), Harvard Dataverse, CC0 1.0.\n"
        f"// Retrieved {out['retrieved']}. rows: [family index, father, mother, sex (1 son, 0 daughter), height in inches].\n"
        "export const GALTON = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    if "NaN" in text or "Infinity" in text:
        raise SystemExit("the output holds a value that is not a number")
    if OUT.exists() and OUT.read_text(encoding="utf-8").split("\n", 3)[3:] == text.split("\n", 3)[3:]:
        print(f"no change: {OUT.relative_to(ROOT)} left as it is")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB): {len(rows)} children in {len(order)} families; retrieved {out['retrieved']}")


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
