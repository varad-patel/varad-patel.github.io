"""Build 365projects/11/data.js: who influenced whom among philosophers, from Wikidata (CC0).

    python scripts/data/philosophers.py [--cache DIR]

Queries against the Wikidata Query Service (the raw answers are kept in --cache, so a second run with the
same folder rebuilds the same file without asking again):
  1. every statement "A influenced by B" (P737) where both A and B have the occupation philosopher (Q4964182);
  2. for each person in those statements (in batches): English label and description and the number of
     Wikipedia language editions with an article (sitelinks);
  3. for each person, every date of birth (P569) and date of death (P570) statement with its rank, its
     precision and its calendar.

Edges are stored as [influenced, influencer] index pairs into the people array. Years are astronomical
(year 0 is 1 BC, so -383 is 384 BC).

How one year is chosen from several statements:
  * Deprecated statements are ignored. Preferred statements are used if there are any, otherwise the normal ones.
  * Among those, the most precise wins (a day over a year over a decade), then the earliest.
  * The query service converts every date to the Gregorian calendar. A date recorded in the Julian calendar
    to the day is converted back before its year is read, so that Cicero, born on 3 January 106 BC, is not
    given the year of 31 December 107 BC.
  * A date known only to the decade or the century is stored as the middle year of that span, with its
    precision (8 for a decade, 7 for a century) in the row, so the page can say "420s BC" and not a year.
    Anything vaguer than a century is treated as unknown. (The service gives BC years as astronomical
    years only when the precision is a year or finer. Checked against the items' own records for Plato,
    Hippasus, Pythagoras, Seneca, Cicero and Caesar on 11 October 2026.)

Two cleaning rules are applied and printed: a birth after the death is repaired from the item's description
or dropped, and a link to an influencer who cannot have been born before the influenced person died is removed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "11" / "data.js"
ENDPOINT = "https://query.wikidata.org/sparql"
UA = {"User-Agent": "varad-patel-365projects/1.0 (https://varad-patel.github.io)", "Accept": "application/sparql-results+json"}

EDGES = """
SELECT ?a ?b WHERE {
  ?a wdt:P737 ?b .
  ?a wdt:P106 wd:Q4964182 .
  ?b wdt:P106 wd:Q4964182 .
}
"""

PEOPLE = """
SELECT ?p ?pLabel ?pDescription ?sitelinks WHERE {
  VALUES ?p { %s }
  OPTIONAL { ?p rdfs:label ?pLabel . FILTER(LANG(?pLabel) = "en") }
  OPTIONAL { ?p schema:description ?pDescription . FILTER(LANG(?pDescription) = "en") }
  ?p wikibase:sitelinks ?sitelinks .
}
"""

DATES = """
SELECT ?p ?t ?prec ?cal ?rank WHERE {
  VALUES ?p { %s }
  ?p p:{prop} ?st . ?st psv:{prop} ?v ; wikibase:rank ?rank .
  ?v wikibase:timeValue ?t ; wikibase:timePrecision ?prec ; wikibase:timeCalendarModel ?cal .
}
"""
BATCH = 150
JULIAN = "Q1985786"
YEAR, DECADE, CENTURY = 9, 8, 7


def run(query: str, cache: Path) -> list[dict]:
    path = cache / f"wdqs-{hashlib.sha1(query.encode('utf-8')).hexdigest()[:16]}.json"
    if not path.exists():
        url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query})
        for attempt in range(5):  # the public endpoint times out now and then
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                    path.write_bytes(r.read())
                break
            except (urllib.error.URLError, TimeoutError) as err:
                if attempt == 4:
                    raise
                print(f"retrying after: {err}")
                time.sleep(10 * (attempt + 1))
        time.sleep(1)  # be polite to the public endpoint
    return json.loads(path.read_text(encoding="utf-8"))["results"]["bindings"]


def qid(binding: dict, key: str) -> str:
    return binding[key]["value"].rsplit("/", 1)[1]


def julian_year(y: int, m: int, d: int) -> int:
    """The Julian-calendar year of a proleptic Gregorian date (astronomical years, by way of the Julian day number)."""
    a = (14 - m) // 12
    yy, mm = y + 4800 - a, m + 12 * a - 3
    jdn = d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045
    c = jdn + 32082
    dd = (4 * c + 3) // 1461
    e = c - 1461 * dd // 4
    return dd - 4800 + (5 * e + 2) // 153 // 10


def span(y: int, prec: int) -> tuple[int, int]:
    """First and last astronomical year a value can mean, counting decades and centuries the way Wikidata shows them."""
    if prec >= YEAR:
        return y, y
    size = 10 if prec == DECADE else 100
    if y > 0:  # AD: the 1230s are 1230 to 1239, the 13th century is 1201 to 1300, the first decade is 1 to 9
        lo = y // 10 * 10 if prec == DECADE else (y - 1) // 100 * 100 + 1
        return max(lo, 1), lo + size - 1
    h = 1 - y  # BC: the 420s are 429 to 420 BC, the 5th century is 500 to 401 BC, the first decade is 9 to 1 BC
    late = h // 10 * 10 if prec == DECADE else (h - 1) // 100 * 100 + 1
    return 1 - (late + size - 1), 1 - max(late, 1)


def choose(statements: list[dict]) -> tuple[int, int] | None:
    """(year, precision) from one person's statements for one property, or None. See the rules at the top."""
    values = []
    for s in statements:
        rank = s["rank"]["value"].rsplit("#", 1)[1]
        m = re.match(r"(-?\d+)-(\d\d)-(\d\d)T", s["t"]["value"])
        prec = min(int(s["prec"]["value"]), 11)
        if rank == "DeprecatedRank" or not m or prec < CENTURY:
            continue
        y, month, day = int(m[1]), int(m[2]), int(m[3])
        if prec == 11 and qid(s, "cal") == JULIAN:
            y = julian_year(y, month, day)
        if prec < YEAR and y < 0:
            y += 1  # the service leaves these as entered, where -428 means 428 BC, and not as astronomical years
        values.append((rank != "PreferredRank", -prec, y))
    if not values:
        return None
    best = min(values)
    return best[2], -best[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp())
    cache.mkdir(parents=True, exist_ok=True)

    assert julian_year(-106, 12, 31) == -105 and julian_year(-43, 3, 13) == -43 and julian_year(1582, 10, 15) == 1582
    assert span(-427, DECADE) == (-428, -419) and span(1235, DECADE) == (1230, 1239)  # Plato: the 420s BC
    assert span(-599, CENTURY) == (-599, -500) and span(1300, CENTURY) == (1201, 1300)  # Hippasus: 6th century BC
    assert span(-3, DECADE) == (-8, 0) and span(5, DECADE) == (1, 9)  # there is no year 0 in BC and AD

    edges_raw = run(EDGES, cache)
    ids = sorted({qid(e, k) for e in edges_raw for k in ("a", "b")})
    people_raw = []
    dates = {"P569": defaultdict(list), "P570": defaultdict(list)}
    for i in range(0, len(ids), BATCH):
        batch = " ".join(f"wd:{q}" for q in ids[i:i + BATCH])
        people_raw += run(PEOPLE % batch, cache)
        for prop, found in dates.items():
            for row in run(DATES.replace("{prop}", prop) % batch, cache):
                found[qid(row, "p")].append(row)

    people = {}
    for row in people_raw:
        q = qid(row, "p")
        label = row.get("pLabel", {}).get("value")
        if not label:  # no English label: skip, the page could not show a name
            continue
        born, died = choose(dates["P569"][q]), choose(dates["P570"][q])
        people[q] = {
            "q": q, "name": label, "about": row.get("pDescription", {}).get("value", ""),
            "born": born, "died": died, "links": int(row["sitelinks"]["value"]),
        }

    # Cleaning rule 1: a birth after the death is an error in the source. Use the years in the item's own
    # description if it gives them, otherwise treat the birth year as unknown.
    for person in people.values():
        if person["born"] and person["died"] and span(*person["born"])[0] > span(*person["died"])[1]:
            m = re.search(r"\((\d{3,4})\s*[–-]\s*(\d{3,4})\)", person["about"])
            fixed = ((int(m[1]), YEAR), (int(m[2]), YEAR)) if m else (None, person["died"])
            print(f"fixed years for {person['name']}: {person['born']} to {person['died']} becomes {fixed[0]} to {fixed[1]}")
            person["born"], person["died"] = fixed

    pairs = sorted({(qid(e, "a"), qid(e, "b")) for e in edges_raw if qid(e, "a") in people and qid(e, "b") in people and qid(e, "a") != qid(e, "b")})
    # Cleaning rule 2: nobody is influenced by a person born after their own death. A date known only to the
    # decade or century is given the benefit of the doubt: the link goes only if no year in the span allows it.
    impossible = {(a, b) for a, b in pairs if people[a]["died"] and people[b]["born"] and span(*people[b]["born"])[0] >= span(*people[a]["died"])[1]}
    for a, b in sorted(impossible):
        print(f"dropped impossible link: {people[a]['name']} (died {people[a]['died'][0]}) influenced by {people[b]['name']} (born {people[b]['born'][0]})".encode("ascii", "replace").decode())
    pairs = [pair for pair in pairs if pair not in impossible]

    def row(q: str) -> list:
        p = people[q]
        b, d = (span(*v) if v else None for v in (p["born"], p["died"]))
        if b and d:  # a vague birth cannot fall after the death, nor a vague death before the birth
            b, d = (b[0], min(b[1], d[1])), (max(d[0], b[0]), d[1])
        mid = lambda v: None if v is None else sum(v) // 2  # noqa: E731
        out = [p["name"], mid(b), mid(d), p["links"], p["about"], q]
        precs = [min(v[1], YEAR) if v else YEAR for v in (p["born"], p["died"])]
        return out + precs if min(precs) < YEAR else out  # the two precisions only where one is vaguer than a year

    rows = {q: row(q) for q in {q for pair in pairs for q in pair}}
    used = sorted(rows, key=lambda q: (rows[q][1] if rows[q][1] is not None else 9999, rows[q][0]))
    index = {q: i for i, q in enumerate(used)}

    out = {
        "source": "Wikidata (CC0): 'influenced by' (P737) statements between people whose occupation (P106) is philosopher (Q4964182)",
        "retrieved": date.fromtimestamp(min(p.stat().st_mtime for p in cache.glob("wdqs-*.json"))).isoformat(),
        "people": [rows[q] for q in used],
        "edges": [[index[a], index[b]] for a, b in pairs],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by scripts/data/philosophers.py from Wikidata (CC0). Do not edit by hand.\n"
        "// people: [name, born, died, sitelinks, description, Wikidata id] and, where a date is known only to the decade (8)\n"
        "// or century (7), the precision of born and of died (9 is a year). edges: [influenced, influencer] as indexes into people.\n"
        "export const DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n",
    )
    vague = sum(1 for q in used if len(rows[q]) > 6)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB): {len(used)} people, {len(pairs)} links, {vague} with a date known only to the decade or century")


if __name__ == "__main__":
    main()
