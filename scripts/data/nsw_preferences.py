"""Build 365projects/90/data.js, the real ballots behind project 90 (Ranked-Choice Election Engine).

    python scripts/data/nsw_preferences.py [--cache DIR]

Source (downloaded into --cache, never committed): the NSW Electoral Commission's results for the 2023 New South
Wales state election (25 March 2023), Legislative Assembly, for two districts:

  * the preference data: "Preference Data for each ballot paper scrutinised at the election including informal
    papers", one zip per district, from https://pastvtr.elections.nsw.gov.au/SG2301/LA/<district>/preferences.
    Each record is one preference marking: District, PollingPlaceName, BPNumber (a virtual ballot paper id, unique
    within a polling place), Formality, CandidateName, PrefMarking (the mark as seen on the paper) and PrefCounted
    (the preference number as interpreted for the count, given only for formal papers).
  * the published distribution of preferences, https://pastvtr.elections.nsw.gov.au/SG2301/LA/<district>/dop/dop,
    from which the script takes the candidates' parties, the order of exclusions and every count's progressive totals,
    exhausted votes, total votes in count and absolute majority, so the page and the tests can compare the
    engine's count with the official one.

Licence: the Commission's copyright page (https://elections.nsw.gov.au/copyright, checked 15 October 2026) says the
material on its website "is licensed under the Creative Commons Attribution 4.0 License", attributed with the notice
"(c) State of New South Wales through the NSW Electoral Commission", with a link to the licence and a statement of
any changes. The results site's pages link to that copyright page. Changes made here: identical preference sequences
are grouped and counted, and the markings are reduced to the counted order of preferences.

Cleaning rules:
  * A ballot paper is identified by (PollingPlaceName, BPNumber). Papers marked "Informal" are counted, then
    dropped. For a formal paper the candidates are put in the order of PrefCounted; the script stops unless those
    numbers run 1, 2, 3, ... without a gap or a repeat.
  * Candidates are listed in the order the published distribution lists them, and a
    ballot is written as a string of letters, A for the first candidate, B for the second and so on.
  * The script stops if the number of formal or informal papers, or any first-preference total, differs from the
    published distribution.
"""

from __future__ import annotations

import argparse
import csv
import html
import io
import json
import re
import tempfile
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "90" / "data.js"
UA = {"User-Agent": "Mozilla/5.0"}  # anonymous: no name or address goes with the request
RETRIEVED = "2026-10-15"
BASE = "https://pastvtr.elections.nsw.gov.au/SG2301/LA"
CONTESTS = [("wollondilly", "Wollondilly"), ("penrith", "Penrith")]
NOTICE = "© State of New South Wales through the NSW Electoral Commission"


def fetch(url: str, name: str, cache: Path) -> Path:
    path = cache / name
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            path.write_bytes(r.read())
    return path


def number(cell: str) -> int:
    digits = re.sub(r"[^0-9]", "", cell)
    if not digits:
        raise SystemExit(f"expected a number in {cell!r}")
    return int(digits)


def parse_dop(text: str):
    """The published distribution of preferences: candidates with parties, exclusions, and each count's figures."""
    table = text[text.index("<table"):text.index("</table>")]
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
        cells = [html.unescape(re.sub(r"<br\s*/?>", "\n", c)) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        rows.append([re.sub(r"<[^>]+>", "", c).strip() for c in cells])
    counts = sum(1 for c in rows[0] if c.startswith("Count "))
    # "TOUSSI Fatemeh (Minoo) (GRN)\nExcluded Candidate": the last bracket is the party.
    excluded_names = [c.split("\n")[0].rsplit(" (", 1)[0].strip() for c in rows[1][2:] if "Excluded" in c]
    candidates, figures = [], {}
    for r in rows[3:]:
        label = r[0]
        if label in ("Total Votes in Count", "Exhausted Votes", "Informal", "Total Votes / Ballot Papers", "Absolute Majority"):
            figures[label] = r[1:]
            continue
        if "\n" not in label:
            continue
        name, party = [x.strip() for x in label.split("\n", 1)]
        cells = r[1:]
        totals = [number(cells[0])]
        for k in range(1, counts):
            prog = cells[2 * k] if 2 * k < len(cells) else ""
            dist = cells[2 * k - 1] if 2 * k - 1 < len(cells) else ""
            if "EXCLUDED" in dist or not (prog or dist):
                totals.append(None)
            elif "ELECTED" in prog:
                totals.append(number(prog.replace("ELECTED", "")))
            else:
                totals.append(number(prog))
        # A candidate shown as excluded at count k has no total from count k on.
        candidates.append({"name": name, "party": party, "totals": totals})
    def series(label, first_only_cols=False):
        cells = figures[label]
        out = [number(cells[0])]
        for k in range(1, counts):
            out.append(number(cells[2 * k]))
        return out
    published = {
        "excluded": excluded_names,
        "inCount": series("Total Votes in Count"),
        "exhausted": series("Exhausted Votes"),
        "majority": [number(c) for c in figures["Absolute Majority"] if re.search(r"\d", c)],
        "informal": number(figures["Informal"][0]),
    }
    enrolled = re.search(r"Electors Enrolled as on [0-9/]+:\s*([0-9,]+)", re.sub(r"<[^>]+>", " ", text))
    return candidates, published, int(enrolled.group(1).replace(",", "")) if enrolled else None


def read_ballots(zpath: Path):
    with zipfile.ZipFile(zpath) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".txt")]
        if len(names) != 1:
            raise SystemExit(f"expected one .txt in {zpath.name}, found {names}")
        raw = z.read(names[0])
    text = raw.decode("utf-8-sig") if raw.startswith(b"\xef\xbb\xbf") else raw.decode("latin-1")
    reader = csv.reader(io.StringIO(text), delimiter="\t")
    head = next(reader)
    if head != ["District", "PollingPlaceName", "BPNumber", "Formality", "CandidateName", "PrefMarking", "PrefCounted"]:
        raise SystemExit(f"unexpected columns: {head}")
    formality, prefs = {}, defaultdict(list)
    for row in reader:
        if not row:
            continue
        district, place, bp, form, cand, marking, counted = row
        key = (place, bp)
        if formality.setdefault(key, form) != form:
            raise SystemExit(f"paper {key} is both {formality[key]} and {form}")
        if form == "Formal" and counted.strip():
            prefs[key].append((int(counted), cand))
    sequences = Counter()
    for key, form in formality.items():
        if form != "Formal":
            continue
        p = sorted(prefs[key])
        if [n for n, _ in p] != list(range(1, len(p) + 1)):
            raise SystemExit(f"paper {key}: counted preferences {p} do not run 1, 2, 3, ...")
        sequences[tuple(c for _, c in p)] += 1
    informal = sum(1 for f in formality.values() if f == "Informal")
    return sequences, informal


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp(prefix="nsw_preferences_"))
    cache.mkdir(parents=True, exist_ok=True)

    contests = []
    for slug, name in CONTESTS:
        dop_url = f"{BASE}/{slug}/dop/dop"
        zip_url = f"{BASE}/{slug}/SG2301%20LA%20Pref%20Data%20{name}.zip"
        candidates, published, enrolled = parse_dop(fetch(dop_url, f"{slug}-dop.html", cache).read_text("utf-8"))
        sequences, informal = read_ballots(fetch(zip_url, f"{slug}-prefs.zip", cache))
        names = [c["name"] for c in candidates]
        letters = {n: chr(65 + i) for i, n in enumerate(names)}
        unknown = {c for s in sequences for c in s} - set(names)
        if unknown:
            raise SystemExit(f"{name}: candidates in the ballots but not in the distribution: {unknown}")
        formal = sum(sequences.values())
        if formal != published["inCount"][0]:
            raise SystemExit(f"{name}: {formal} formal papers, the distribution says {published['inCount'][0]}")
        if informal != published["informal"]:
            raise SystemExit(f"{name}: {informal} informal papers, the distribution says {published['informal']}")
        first = Counter()
        for s, n in sequences.items():
            first[s[0]] += n
        for c in candidates:
            if first[c["name"]] != c["totals"][0]:
                raise SystemExit(f"{name}: {c['name']} has {first[c['name']]} first preferences, published {c['totals'][0]}")
        ballots = sorted((("".join(letters[c] for c in s), n) for s, n in sequences.items()), key=lambda x: (-x[1], x[0]))
        contests.append({
            "id": slug,
            "name": name,
            "election": "2023 New South Wales state election, Legislative Assembly",
            "date": "2023-03-25",
            "enrolled": enrolled,
            "formal": formal,
            "informal": informal,
            "candidates": [{"name": c["name"], "party": c["party"]} for c in candidates],
            "ballots": ballots,
            "published": {
                "excluded": [names.index(n) for n in published["excluded"]],
                "totals": [c["totals"] for c in candidates],
                "inCount": published["inCount"],
                "exhausted": published["exhausted"],
                "majority": published["majority"],
            },
            "urls": {"preferences": f"{BASE}/{slug}/preferences", "distribution": dop_url, "file": zip_url},
        })
        print(f"{name}: {formal} formal, {informal} informal, {len(ballots)} distinct sequences, "
              f"exclusions {published['excluded']}")

    data = {
        "retrieved": RETRIEVED,
        "publisher": "NSW Electoral Commission",
        "notice": NOTICE,
        "licence": "CC BY 4.0",
        "licenceUrl": "https://creativecommons.org/licenses/by/4.0/",
        "terms": "https://elections.nsw.gov.au/copyright",
        "changes": "Identical preference sequences are grouped and counted; markings are reduced to the counted order of preferences.",
        "contests": contests,
    }
    body = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    OUT.write_text(
        "// Generated by scripts/data/nsw_preferences.py. Do not edit by hand.\n"
        "// Every formal Legislative Assembly ballot in two districts at the 2023 New South Wales state election, as counted,\n"
        f"// with the published distribution of preferences. {NOTICE}. CC BY 4.0. Retrieved {RETRIEVED}.\n"
        f"export const NSW = {body};\n",
        encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), cache at {cache}")


if __name__ == "__main__":
    main()
