"""Build 365projects/11/data.js: who influenced whom among philosophers, from Wikidata (CC0).

    python scripts/data/philosophers.py

Two queries against the Wikidata Query Service:
  1. every statement "A influenced by B" (P737) where both A and B have the occupation philosopher (Q4964182);
  2. for each person in those statements (in batches): English label and description, years of birth
     and death, and the number of Wikipedia language editions with an article (sitelinks).

Edges are stored as [influenced, influencer] index pairs into the people array. Years are astronomical
(year 0 is 1 BC, so -383 is 384 BC). Two cleaning rules are applied and printed: a birth year later than
the death year is repaired from the item's description or dropped, and a link to an influencer born
after the influenced person died is removed.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
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
SELECT ?p ?pLabel ?pDescription (MIN(?by) AS ?born) (MIN(?dy) AS ?died) (SAMPLE(?links) AS ?sitelinks) WHERE {
  VALUES ?p { %s }
  OPTIONAL { ?p rdfs:label ?pLabel . FILTER(LANG(?pLabel) = "en") }
  OPTIONAL { ?p schema:description ?pDescription . FILTER(LANG(?pDescription) = "en") }
  OPTIONAL { ?p wdt:P569 ?b . BIND(YEAR(?b) AS ?by) }
  OPTIONAL { ?p wdt:P570 ?d . BIND(YEAR(?d) AS ?dy) }
  ?p wikibase:sitelinks ?links .
}
GROUP BY ?p ?pLabel ?pDescription
"""
BATCH = 150


def run(query: str) -> list[dict]:
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query})
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))["results"]["bindings"]


def qid(binding: dict, key: str) -> str:
    return binding[key]["value"].rsplit("/", 1)[1]


def main() -> None:
    edges_raw = run(EDGES)
    ids = sorted({qid(e, k) for e in edges_raw for k in ("a", "b")})
    people_raw = []
    for i in range(0, len(ids), BATCH):
        people_raw += run(PEOPLE % " ".join(f"wd:{q}" for q in ids[i:i + BATCH]))
        time.sleep(1)  # be polite to the public endpoint

    people = {}
    for row in people_raw:
        q = qid(row, "p")
        label = row.get("pLabel", {}).get("value")
        if not label:  # no English label: skip, the page could not show a name
            continue
        num = lambda k: int(row[k]["value"]) if k in row else None  # noqa: E731
        people[q] = {
            "q": q, "name": label, "about": row.get("pDescription", {}).get("value", ""),
            "born": num("born"), "died": num("died"), "links": num("sitelinks") or 0,
        }

    # Cleaning rule 1: a birth year after the death year is an error in the source. Use the years in the
    # item's own description if it gives them, otherwise treat the birth year as unknown.
    for person in people.values():
        if person["born"] is not None and person["died"] is not None and person["born"] > person["died"]:
            m = re.search(r"\((\d{3,4})\s*[–-]\s*(\d{3,4})\)", person["about"])
            fixed = (int(m[1]), int(m[2])) if m else (None, person["died"])
            print(f"fixed years for {person['name']}: {person['born']} to {person['died']} becomes {fixed[0]} to {fixed[1]}")
            person["born"], person["died"] = fixed

    pairs = sorted({(qid(e, "a"), qid(e, "b")) for e in edges_raw if qid(e, "a") in people and qid(e, "b") in people and qid(e, "a") != qid(e, "b")})
    # Cleaning rule 2: nobody is influenced by a person born after their own death.
    impossible = [(a, b) for a, b in pairs if people[a]["died"] is not None and people[b]["born"] is not None and people[b]["born"] >= people[a]["died"]]
    for a, b in impossible:
        print(f"dropped impossible link: {people[a]['name']} (died {people[a]['died']}) influenced by {people[b]['name']} (born {people[b]['born']})".encode("ascii", "replace").decode())
    pairs = [pair for pair in pairs if pair not in set(impossible)]
    used = sorted({q for pair in pairs for q in pair}, key=lambda q: (people[q]["born"] if people[q]["born"] is not None else 9999, people[q]["name"]))
    index = {q: i for i, q in enumerate(used)}

    out = {
        "source": "Wikidata (CC0): 'influenced by' (P737) statements between people whose occupation (P106) is philosopher (Q4964182)",
        "retrieved": "2026-10-10",
        "people": [[people[q]["name"], people[q]["born"], people[q]["died"], people[q]["links"], people[q]["about"], q] for q in used],
        "edges": [[index[a], index[b]] for a, b in pairs],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by scripts/data/philosophers.py from Wikidata (CC0). Do not edit by hand.\n"
        "// people: [name, born, died, sitelinks, description, Wikidata id]. edges: [influenced, influencer] as indexes into people.\n"
        "export const DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n",
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB): {len(used)} people, {len(pairs)} links")


if __name__ == "__main__":
    main()
