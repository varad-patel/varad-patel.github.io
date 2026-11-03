"""Build 365projects/120/data.js: every orbital launch attempt, with first flights marked, for project 120.

    python scripts/data/maiden_flights.py                 download afresh and rewrite the snapshot
    python scripts/data/maiden_flights.py --cache DIR     keep the downloads in DIR; a second run with the same DIR
                                                          rebuilds the same file without touching the network

Standard library only. The module is written only after every check below has passed.

Source (downloaded into --cache, never committed)
  Jonathan McDowell, General Catalog of Artificial Space Objects (GCAT), https://planet4589.org/space/gcat .
  Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0). The GCAT home page says "GCAT is released under
  the Creative Commons CC-BY licence. You are free to use the data in GCAT as long as you include a citation to it",
  and the files carry the notice "Licence: CC-BY-4.0 Creative Commons/Attribution ... This data may be freely
  reproduced as long as you cite it." Files used:
    tsv/launch/launch.tsv   the full launch list (orbital and suborbital), one row per launch
    tsv/tables/lv.tsv       the launch vehicle table: LV_Name and LV_Family
  Column meanings are from the GCAT pages "Launch List Column Descriptions" (web/launch/lcols.html) and
  "Launch Success Fractions" (web/intro/success.html).

Cleaning rules (the changes made to GCAT, as its licence asks to be noted)
  1. Orbital launch attempts only: LaunchCode beginning with O (orbital) or D (deep space, which also needs an
     orbital-class rocket), and second letter S (success) or F (failure). Pad explosions before lift-off (E) and pad
     aborts (A) are left out, as is anything else, including the near-orbital category N that GCAT added in 2026
     (target perigee between -1000 and 0 km): Starship's flights of 2023 Apr 20, 2023 Nov 18 and 2024 Mar 14 are N,
     so the first orbital attempt of Starship V1.0 is its flight of 2024 Jun 6.
  2. Success is GCAT's pass or fail: the second letter S. GCAT counts a launch success fraction below 0.75 as a
     failure, so OS75 to OS95 are successes and OF20 to OF70 failures.
  3. The date is the UTC date of launch (Launch_Date), and launches are put in order of Launch_JD. Three launches
     have a day GCAT marks as uncertain with "?" (two Safir failures in 2012 and a Chang Zheng 2C in 2021); the
     day is kept as written.
  4. A launch is the first flight of a type if it is the first orbital attempt with its LV_Type, and the first flight
     of a family if it is the first orbital attempt of any type whose LV_Family (from lv.tsv) is new. Suborbital test
     flights do not count, so a rocket that flew suborbital tests first has its first orbital attempt marked.
  5. Kept per launch: days since 1957-01-01, and a code 0 to 7 (1 success, 2 first of its type, 4 first of its
     family). Names are kept for first flights only.

Checks, run on every build (any failure stops the script with the reason)
  1. Both files have the expected header columns.
  2. Every kept launch has a readable date and a Launch_JD; every LV_Type of a kept launch is in lv.tsv with one family.
  3. The first launch kept is Sputnik's, 1957 Oct 4, a success and the first of its type and family.
  4. The anchor first flights below have the outcome, type and family flags they had when this script was written.
  5. Between 1957 and 2025 there are at least 7,000 kept launches with a success rate between 90% and 95%.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "120" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; 365projects-data/1.0)"}
BASE = "https://planet4589.org/space/gcat/"
EPOCH = dt.date(1957, 1, 1)
MONTHS = {m: i + 1 for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
# (UTC date, LV_Type, success, first of type, first of family), as in GCAT on 29 October 2026.
ANCHORS = [
    ("1996-06-04", "Ariane 5G", False, True, True),
    ("2010-06-04", "Falcon 9", True, True, True),
    ("2017-05-25", "Electron", False, True, True),
    ("2023-03-07", "H3-22S", False, True, False),
    ("2024-01-08", "Vulcan Centaur VC2S", True, True, True),
]


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


def read_tsv(path: Path, need: list[str]) -> tuple[list[dict], str]:
    """GCAT TSV: a header line starting with '#', comment lines starting with '#', then data rows."""
    head, rows, updated = None, [], ""
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            if head is None:
                head = [h.strip() for h in line[1:].split("\t")]
            elif "Updated" in line:
                updated = line[1:].strip()
            continue
        if line.strip():
            rows.append(dict(zip(head, (c.strip() for c in line.split("\t")))))
    missing = [c for c in need if c not in (head or [])]
    if missing:
        raise SystemExit(f"1: {path.name} lacks the columns {missing}")
    return rows, updated


def parse_date(text: str) -> dt.date:
    # VagueDate, e.g. "1957 Oct  4 1928:34"; orbital launches have a full date.
    parts = text.split()
    return dt.date(int(parts[0]), MONTHS[parts[1][:3]], int(parts[2].rstrip("?")))


def build(cache: Path) -> None:
    launches, updated = read_tsv(fetch(BASE + "tsv/launch/launch.tsv", cache / "launch.tsv"), ["Launch_JD", "Launch_Date", "LV_Type", "LaunchCode"])
    lvs, _ = read_tsv(fetch(BASE + "tsv/tables/lv.tsv", cache / "lv.tsv"), ["LV_Name", "LV_Family"])
    families: dict[str, set] = {}
    for r in lvs:
        families.setdefault(r["LV_Name"], set()).add(r["LV_Family"])

    kept = []
    for r in launches:
        code = r["LaunchCode"]
        if len(code) < 2 or code[0] not in "OD" or code[1] not in "SF":
            continue
        try:
            day, jd = parse_date(r["Launch_Date"]), float(r["Launch_JD"])
        except (ValueError, KeyError, IndexError):
            raise SystemExit(f"2: unreadable date {r['Launch_Date']!r} for {r.get('Launch_Tag')}")
        fam = families.get(r["LV_Type"])
        if not fam or len(fam) != 1:
            raise SystemExit(f"2: the launch vehicle {r['LV_Type']!r} has families {fam} in lv.tsv")
        kept.append((jd, day, r["LV_Type"], next(iter(fam)), code[1] == "S"))
    kept.sort(key=lambda k: k[0])

    seen_type, seen_family = set(), set()
    days, codes, firsts = [], [], []
    for i, (_, day, lv, fam, ok) in enumerate(kept):
        new_type, new_family = lv not in seen_type, fam not in seen_family
        seen_type.add(lv)
        seen_family.add(fam)
        days.append((day - EPOCH).days)
        codes.append(str(int(ok) + 2 * int(new_type) + 4 * int(new_family)))
        if new_type:
            firsts.append([i, lv, fam])

    first = kept[0]
    if first[1] != dt.date(1957, 10, 4) or codes[0] != "7":
        raise SystemExit(f"3: the first launch kept is {first[1]} {first[2]}, code {codes[0]}")
    for when, lv, ok, new_type, new_family in ANCHORS:
        hit = [i for i, k in enumerate(kept) if k[1].isoformat() == when and k[2] == lv]
        if len(hit) != 1:
            raise SystemExit(f"4: expected one launch of {lv} on {when}, found {len(hit)}")
        c = int(codes[hit[0]])
        if (bool(c & 1), bool(c & 2), bool(c & 4)) != (ok, new_type, new_family):
            raise SystemExit(f"4: {lv} on {when} now has code {c}")
    span = [int(c) & 1 for k, c in zip(kept, codes) if k[1].year <= 2025]
    if len(span) < 7000 or not 0.90 <= sum(span) / len(span) <= 0.95:
        raise SystemExit(f"5: {len(span)} launches to 2025, success rate {sum(span) / len(span):.3f}")

    out = {
        "retrieved": retrieved(cache / "launch.tsv"),
        "updated": updated,
        "source": {
            "name": "J. McDowell, General Catalog of Artificial Space Objects (GCAT), launch list and launch vehicle table",
            "url": "https://planet4589.org/space/gcat",
            "licence": "CC BY 4.0",
            "licenceUrl": "https://creativecommons.org/licenses/by/4.0/",
        },
        "note": "Orbital launch attempts (LaunchCode O or D with S or F). days: days since 1957-01-01 (UTC). "
                "codes: one digit per launch, 1 success + 2 first orbital attempt of its LV_Type + 4 first of its LV_Family. "
                "firsts: [launch index, LV_Type, LV_Family] for each first flight of a type.",
        "epoch": EPOCH.isoformat(),
        "days": days,
        "codes": "".join(codes),
        "firsts": firsts,
    }
    text = (
        "// Generated by scripts/data/maiden_flights.py. Do not edit by hand.\n"
        "// Orbital launch attempts from GCAT (J. McDowell, planet4589.org/space/gcat), CC BY 4.0, reduced as the script describes.\n"
        f"// {updated}; retrieved {out['retrieved']}.\n"
        "export const LAUNCHES = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
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
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB): {len(days)} launches, {len(firsts)} first flights of a type; {updated}")


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
