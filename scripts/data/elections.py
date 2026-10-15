"""Build 365projects/data/elections.js: US presidential polls and results shared by projects 86 (Election
Forecast Model), 87 (Polling Error and House Effects) and 88 (Electoral College Simulator).

    python scripts/data/elections.py                 download afresh and rewrite the snapshot
    python scripts/data/elections.py --cache DIR     keep the downloads in DIR; a second run with the same DIR
                                                     rebuilds the same file without touching the network

Needs openpyxl, xlrd and pypdf. The module is written only after every check below has passed.

Sources (downloaded into --cache, never committed)
  1. Polls. FiveThirtyEight, pollster-ratings/raw_polls.csv in https://github.com/fivethirtyeight/data: "all of the
     polls analyzed to give each pollster a rating", one row per poll question, with the poll's two leading
     candidates' shares and the actual result. Terms, from the repository's README.md (read 14 October 2026):
     "Unless otherwise noted, our data sets are available under the Creative Commons Attribution 4.0
     International License" (https://creativecommons.org/licenses/by/4.0/). The pollster-ratings README notes no
     other licence. 538's 2024 poll files (projects.fivethirtyeight.com/polls-page/data/...) redirect to
     abcnews.go.com as of 14 October 2026, so the latest presidential cycle with open poll-level data here is 2020.
  2. Results by state. Federal Election Commission, "Federal Elections 2012", "Federal Elections 2016", "Federal
     Elections 2020" (Table 2, Presidential Electoral and Popular Vote) and "Official 2024 Presidential General
     Election Results", with Table 2 of Federal Elections 2004 and 2008 (https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/).
     The FEC compiles them from the states' certified returns. Terms: works of the US government are not subject
     to copyright (17 U.S.C. 105), so they are in the public domain.
  3. Electoral votes. US Census Bureau, "Table 1. Apportionment population and number of representatives by
     state: 2020 Census" (apportionment-2020-table01.xlsx), which gives each state's seats from the 2020 census and
     the change from 2010. A state's electoral votes are its House seats plus its two senators; the District of
     Columbia has three (23rd Amendment). The 2010 apportionment applies to 2012 to 2020, the 2020 one to 2024.
     Census regions and state names: Census Bureau, state-geocodes-v2024.xlsx. Public domain (17 U.S.C. 105).
  4. Maine's and Nebraska's congressional districts. The states' certificates of ascertainment for 2012 (Maine's
     amended certificate), 2016, 2020 and 2024, as published by the US National Archives
     (https://www.archives.gov/electoral-college/<year>): the votes each party's electors received statewide and in
     each district, as certified by the governor. Terms: the National Archives' notice (archives.gov privacy and
     copyright page, read 14 October 2026) says "Generally, materials produced by Federal agencies are in the public
     domain and may be reproduced without permission" and that "not all materials appearing on this website are in
     the public domain". The certificates are state documents; only the official vote counts on them are taken.

What is kept
  * Polls: every presidential general-election question in raw_polls.csv for the cycles 2004 to 2020 (538 keeps
    polls whose median field date is within 61 days of the election), for a state, the District of Columbia, a
    congressional district of Maine or Nebraska, or the whole country. Fields: where, pollster (538's rating id
    and name), days from the median field date to the election, sample size (538 fills a missing sample size
    with the median for races of the same type and does not flag it), the Democrat's and the Republican's shares
    as published, and the partisan flag. In every kept row candidate 1 is the Democrat and candidate 2 the
    Republican (checked). The file has one question per poll and place (checked).
  * Results by state for 2004 and 2008 (FEC, Federal Elections 2004 and 2008, Table 2), used by project 87 to
    measure poll error; 538's own recorded results are used only to check the district figures, because for New
    York in 2004 to 2020 they differ from the certified count by up to 2.2 points of two-party share (2008).
  * Results for 2012, 2016, 2020 and 2024: for each state the Democrat's and the Republican's votes and the total
    vote, as the FEC prints them (fusion lines such as Working Families are already included in the candidate's
    figure); for each district the votes for the Democrat's and the Republican's district electors. Maine's 2012
    and 2016 certificates note 415 and 184 overseas and military votes that were not tallied by district: they are
    in the statewide figures only.
  * Electoral votes by state for each results year; Maine and Nebraska split theirs: two for the statewide
    winner, one for the winner of each district.

Changes made to the CC BY data (noted on the pages): only presidential general-election rows from 2004 to 2020
are kept; districts are renamed (M1 -> ME-1 and so on); shares are kept as published and turned into two-party
shares by the pages; pollsters are stored once in a list.

Checks, run on every build (any failure stops the script with the reason)
  1. 538's README still states the CC BY 4.0 licence; raw_polls.csv has the expected columns; every kept row has
     a known place, the Democrat as candidate 1 and the Republican as candidate 2, shares between 0 and 100, a
     positive sample size and 0 to 61 days to the election, and no poll appears twice for one place.
  2. The FEC national totals match the FEC's own summary table and the anchors below.
  3. Electoral votes add up to 538 in each year; the 2020 apportionment matches the FEC's 2024 electoral votes
     state by state; in 2012, 2020 and 2024 each state's awarded votes equal its allocation (2016 has seven
     faithless electors in Hawaii, Texas and Washington, which the FEC notes).
  4. On each certificate the statewide votes equal the FEC's; Nebraska's three districts add up to the statewide
     votes; Maine's two districts add up to the statewide votes less at most the votes not tallied by district.
  5. Each district's two-party share agrees with 538's recorded actual result, where 538 has one, to 0.15 points.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import logging
import os
import re
import tempfile
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl
import pypdf
import xlrd

logging.getLogger("pypdf").setLevel(logging.ERROR)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "data" / "elections.js"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
GH = "https://raw.githubusercontent.com/fivethirtyeight/data/master/"
FEC = "https://www.fec.gov/documents/"
NARA = "https://www.archives.gov/files/electoral-college/"
FILES = {
    "readme.md": GH + "README.md",
    "raw_polls.csv": GH + "pollster-ratings/raw_polls.csv",
    "fec2004.xls": FEC + "1631/2004tables.xls",
    "fec2008.xls": FEC + "1666/federalelections2008.xls",
    "fec2012.xls": FEC + "1691/federalelections2012.xls",
    "fec2016.xlsx": FEC + "1890/federalelections2016.xlsx",
    "fec2020.xlsx": FEC + "4228/federalelections2020.xlsx",
    "fec2024.xlsx": FEC + "5645/2024presgeresults.xlsx",
    "apportionment.xlsx": "https://www2.census.gov/programs-surveys/decennial/2020/data/apportionment/apportionment-2020-table01.xlsx",
    "geocodes.xlsx": "https://www2.census.gov/programs-surveys/popest/geographies/2024/state-geocodes-v2024.xlsx",
    "maine2012.pdf": NARA + "2012/2012-ascertainment-maine.pdf",
    "maine2016.pdf": NARA + "2016/ascertainment-maine.pdf",
    "maine2020.pdf": NARA + "2020/ascertainment-maine.pdf",
    "maine2024.pdf": NARA + "2024/ascertainment-maine.pdf",
    "nebraska2012.pdf": NARA + "2012/2012-ascertainment-nebraska.pdf",
    "nebraska2016.pdf": NARA + "2016/ascertainment-nebraska.pdf",
    "nebraska2020.pdf": NARA + "2020/ascertainment-nebraska.pdf",
    "nebraska2024.pdf": NARA + "2024/ascertainment-nebraska.pdf",
}
CYCLES = [2004, 2008, 2012, 2016, 2020]
STATE_YEARS = [2004, 2008]  # results by state only, for measuring poll error
YEARS = [2012, 2016, 2020, 2024]
NOMINEES = {2004: ("John Kerry", "George W. Bush"), 2008: ("Barack Obama", "John McCain"), 2012: ("Barack Obama", "Mitt Romney"), 2016: ("Hillary Clinton", "Donald Trump"),
            2020: ("Joe Biden", "Donald Trump"), 2024: ("Kamala Harris", "Donald Trump")}
DISTRICTS = {"M1": "ME-1", "M2": "ME-2", "N1": "NE-1", "N2": "NE-2", "N3": "NE-3"}
# The FEC's own national totals (Table 1 of each publication; the 2024 results sheet's total row).
ANCHORS = {2004: (59028444, 62040610), 2008: (69498516, 59948323), 2012: (65915795, 60933504), 2016: (65853514, 62984828), 2020: (81283501, 74223975), 2024: (75017613, 77302580)}
# Faithless electors noted under the FEC's 2016 Table 2: state -> electors cast for neither nominee.
FAITHLESS_2016 = {"TX": 2, "WA": 4, "HI": 1}


def fetch(name: str, cache: Path) -> Path:
    path = cache / name
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(FILES[name], headers=UA), timeout=300) as r:
            body = r.read()
        if name.endswith((".xls", ".xlsx", ".pdf")) and body[:5] == b"<!DOC":
            raise SystemExit(f"{name}: the server sent a web page, not the file")
        path.write_bytes(body)
        path.with_suffix(path.suffix + ".date").write_text(dt.date.today().isoformat(), encoding="utf-8")
    return path


def retrieved(path: Path) -> str:
    stamp = path.with_suffix(path.suffix + ".date")
    return stamp.read_text(encoding="utf-8").strip() if stamp.exists() else dt.date.fromtimestamp(path.stat().st_mtime).isoformat()


def rows_xlsx(path: Path, sheet: str | int = 0) -> list[tuple]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[sheet] if isinstance(sheet, int) else wb[sheet]
    return [tuple(r) for r in ws.iter_rows(values_only=True)]


def num(v) -> int:
    if isinstance(v, (int, float)):
        return int(round(v))
    return int(str(v).replace(",", "").replace("*", "").strip())


# ------------------------------------------------------------------ states, regions, electoral votes

def states_and_regions(cache: Path) -> list[dict]:
    """The 50 states and DC in alphabetical order of postal code, with Census region (1 Northeast .. 4 West)."""
    names = {}
    for r in rows_xlsx(fetch("geocodes.xlsx", cache)):
        if r[0] in ("1", "2", "3", "4") and r[2] not in (None, "00") and isinstance(r[3], str):
            names[r[3].strip()] = int(r[0])
    if len(names) != 51:
        raise SystemExit(f"3: the Census geocodes list {len(names)} states, not 51")
    return names


def apportionment(cache: Path) -> tuple[dict, dict]:
    seats20, seats10 = {}, {}
    for r in rows_xlsx(fetch("apportionment.xlsx", cache)):
        if isinstance(r[0], str) and isinstance(r[2], (int, float)) and isinstance(r[3], (int, float)):
            seats20[r[0].strip()] = int(r[2])
            seats10[r[0].strip()] = int(r[2]) - int(r[3])
    if len(seats20) != 50 or sum(seats20.values()) != 435 or sum(seats10.values()) != 435:
        raise SystemExit("3: the apportionment table does not give 435 seats for 50 states in 2010 and 2020")
    return seats10, seats20


# ------------------------------------------------------------------ FEC results by state

def fec_table2(path: Path, year: int) -> dict:
    """{postal: [dem, rep, total, ev_dem, ev_rep]} from Table 2, Presidential Electoral and Popular Vote."""
    if path.suffix == ".xls":
        b = xlrd.open_workbook(path)
        sh = next(s for s in b.sheets() if s.name.startswith("Table 2"))
        rows = [tuple(sh.row_values(i)) for i in range(sh.nrows)]
    else:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        rows = [tuple(r) for r in next(ws for ws in wb.worksheets if "Table 2" in ws.title).iter_rows(values_only=True)]
    head = next(r for r in rows if any(isinstance(c, str) and "(D)" in c for c in r))
    labels = [c for c in head if isinstance(c, str) and c.strip()]
    dem_first = "(D)" in labels[0]
    out, total_row = {}, None
    for r in rows:
        c0 = r[0].strip() if isinstance(r[0], str) else r[0]
        if isinstance(c0, str) and re.fullmatch(r"[A-Z]{2}\*?", c0):
            c0 = c0.rstrip("*")  # 2020 marks Maine and Nebraska, which split their electoral votes
            ev_a = 0 if r[1] in ("", None) else num(r[1])
            ev_b = 0 if r[2] in ("", None) else num(r[2])
            pv_a, pv_b, total = num(r[3]), num(r[4]), num(r[6])
            dem, rep = (pv_a, pv_b) if dem_first else (pv_b, pv_a)
            ev_d, ev_r = (ev_a, ev_b) if dem_first else (ev_b, ev_a)
            out[c0] = [dem, rep, total, ev_d, ev_r]
        elif isinstance(c0, str) and c0.startswith("Total:"):
            total_row = r
    if len(out) != 51:
        raise SystemExit(f"2: FEC {year} Table 2 has {len(out)} states, not 51")
    a, b = num(total_row[3]), num(total_row[4])
    tot = (a, b) if dem_first else (b, a)
    if tot != ANCHORS[year] or (sum(v[0] for v in out.values()), sum(v[1] for v in out.values())) != ANCHORS[year]:
        raise SystemExit(f"2: FEC {year} national totals {tot} differ from {ANCHORS[year]}")
    return out


def fec_2024(path: Path) -> tuple[dict, dict]:
    rows = rows_xlsx(path, 0)
    head = list(rows[0])
    col = {h: i for i, h in enumerate(head) if isinstance(h, str)}
    out, alloc = {}, {}
    for r in rows[1:]:
        if isinstance(r[0], str) and re.fullmatch(r"[A-Z]{2}", r[0].strip()):
            s = r[0].strip()
            g = lambda h: num(r[col[h]]) if r[col[h]] not in (None, "") else 0
            out[s] = [g("HARRIS"), g("TRUMP"), g("TOTAL VOTES"), g("ELECTORAL VOTE: HARRIS (D)"), g("ELECTORAL VOTE: TRUMP (R)")]
            alloc[s] = g("ELECTORAL VOTES")
        elif isinstance(r[0], str) and r[0].startswith("Total:"):
            if (num(r[col["HARRIS"]]), num(r[col["TRUMP"]])) != ANCHORS[2024]:
                raise SystemExit("2: FEC 2024 national totals differ from the anchors")
    if len(out) != 51 or (sum(v[0] for v in out.values()), sum(v[1] for v in out.values())) != ANCHORS[2024]:
        raise SystemExit("2: FEC 2024 states do not add up to the national totals")
    return out, alloc


# ------------------------------------------------------------------ Maine and Nebraska districts

def pdf_text(path: Path) -> str:
    return "\n".join((p.extract_text() or "") for p in pypdf.PdfReader(path).pages)


def maine_certificate(path: Path, year: int, statewide: tuple[int, int]) -> tuple[dict, int]:
    """Votes for each party's district electors on Maine's certificate of ascertainment.

    Each party's block lists its electors in the order first district, second district, at large, at large, each
    followed (or, in 2016, all followed) by the votes. The scan's text has stray spaces inside numbers ("142,93 7").
    Returns {1: [dem, rep], 2: [dem, rep]} and the overseas and military votes the certificate says were not tallied
    by district (0 when it says nothing)."""
    text = pdf_text(path)
    joined = re.sub(r"(?<=[\d,])[ \t]+(?=[\d,])", "", text)
    m = re.search(r"There were ([\d,]+) votes cast for President and Vice President by Uniformed Service", joined)
    untallied = int(m.group(1).replace(",", "")) if m else 0
    found = {}
    for party in ("DEMOCRATIC", "REPUBLICAN"):
        m = re.search(rf"The {party} PARTY Electors(.*?)(?=The [A-Z ,.'’]+ PARTY Electors|The NON-PARTY|In Testimony|$)", joined, re.S)
        if not m:
            raise SystemExit(f"4: Maine {year}: no {party.lower()} block on the certificate")
        # First district, second district, at large, at large. The block can run on into a party whose heading
        # the scan has broken across lines, so only the first four numbers are taken.
        votes = [int(x.replace(",", "")) for x in re.findall(r"\d{1,3}(?:,\d{3})+", m.group(1))][:4]
        if len(votes) != 4 or votes[2] != votes[3]:  # first district, second district, at large twice
            raise SystemExit(f"4: Maine {year}: {party.lower()} votes read as {votes}")
        found[party] = votes
    d, r = found["DEMOCRATIC"], found["REPUBLICAN"]
    if (d[2], r[2]) != statewide:
        raise SystemExit(f"4: Maine {year}: at-large votes {(d[2], r[2])} differ from the FEC's {statewide}")
    for v in (d, r):
        if not 0 <= v[2] - v[0] - v[1] <= untallied:
            raise SystemExit(f"4: Maine {year}: districts {v[:2]} do not add up to {v[2]} less the untallied votes")
    return {1: [d[0], r[0]], 2: [d[1], r[1]]}, untallied


def nebraska_certificate(path: Path, year: int, statewide: tuple[int, int]) -> dict:
    """Votes for each party's electors on Nebraska's certificate of ascertainment: statewide, then the first,
    second and third districts, each on a line ending "Total Votes Received: N". The 2012 scan's text is rough
    ("Recei ed", "140 976"), so lines are matched loosely and checked by adding them up."""
    lines = pdf_text(path).splitlines()
    found, party = {}, None
    for line in lines:
        m = re.match(r"\s*(Republican|Democratic|[A-Z][a-z]+) Party\b", line)
        if m:
            party = m.group(1) if m.group(1) in ("Republican", "Democratic") else None
            continue
        if party and re.search(r"Votes\s*Rec", line):
            v = re.sub(r"[^\d]", "", line.rsplit(":", 1)[-1])
            found.setdefault(party, []).append(int(v))
    d, r = found.get("Democratic", []), found.get("Republican", [])
    if len(d) != 4 or len(r) != 4:
        raise SystemExit(f"4: Nebraska {year}: read {d} and {r}")
    if (d[0], r[0]) != statewide or sum(d[1:]) != d[0] or sum(r[1:]) != r[0]:
        raise SystemExit(f"4: Nebraska {year}: districts {d[1:]}, {r[1:]} do not add up to the FEC's {statewide}")
    return {k: [d[k], r[k]] for k in (1, 2, 3)}


# ------------------------------------------------------------------ polls

def polls(cache: Path, units: list[str]) -> dict:
    readme = fetch("readme.md", cache).read_text(encoding="utf-8")
    if "Creative Commons Attribution 4.0 International License" not in readme:
        raise SystemExit("1: 538's README no longer states the CC BY 4.0 licence")
    text = fetch("raw_polls.csv", cache).read_text(encoding="utf-8")
    reader = csv.DictReader(io.StringIO(text))
    need = {"poll_id", "cycle", "location", "type_simple", "pollster", "pollster_rating_id", "partisan", "electiondate",
            "time_to_election", "samplesize", "cand1_name", "cand1_party", "cand1_pct", "cand1_actual", "cand2_name",
            "cand2_party", "cand2_pct", "cand2_actual"}
    if not need <= set(reader.fieldnames or []):
        raise SystemExit(f"1: raw_polls.csv lacks {sorted(need - set(reader.fieldnames or []))}")
    places = units + ["US"]
    pollsters, pindex = [], {}
    cycles = {c: {"rows": [], "actual": {}, "names": None, "election": None} for c in CYCLES}
    seen = set()
    for x in reader:
        if x["type_simple"] != "Pres-G" or int(x["cycle"]) not in cycles:
            continue
        c = cycles[int(x["cycle"])]
        loc = DISTRICTS.get(x["location"], x["location"])
        if loc not in places:
            raise SystemExit(f"1: unknown place {x['location']!r}")
        if (x["cand1_party"], x["cand2_party"]) != ("DEM", "REP"):
            raise SystemExit(f"1: poll {x['poll_id']}: candidate 1 is not the Democrat or 2 is not the Republican")
        names = (x["cand1_name"], x["cand2_name"])
        if c["names"] not in (None, names):
            raise SystemExit(f"1: cycle {x['cycle']} has two pairs of candidates")
        c["names"] = names
        if c["election"] not in (None, x["electiondate"]):
            raise SystemExit(f"1: cycle {x['cycle']} has two election dates")
        c["election"] = x["electiondate"]
        key = (x["cycle"], x["poll_id"], loc)
        if key in seen:
            raise SystemExit(f"1: poll {x['poll_id']} appears twice for {loc}")
        seen.add(key)
        d, r, n, days = float(x["cand1_pct"]), float(x["cand2_pct"]), float(x["samplesize"]), int(x["time_to_election"])
        if not (0 < d < 100 and 0 < r < 100 and d + r <= 100.5 and n > 0 and 0 <= days <= 61):
            raise SystemExit(f"1: poll {x['poll_id']} has a value out of range: {d}, {r}, {n}, {days}")
        pid = x["pollster_rating_id"]
        if pid not in pindex:
            pindex[pid] = len(pollsters)
            pollsters.append([int(pid), x["pollster"]])
        elif pollsters[pindex[pid]][1] != x["pollster"]:
            raise SystemExit(f"1: rating id {pid} has two names")
        part = {"NA": 0, "DEM": 1, "REP": 2}.get(x["partisan"], 3)
        c["rows"].append([places.index(loc), pindex[pid], days, int(round(n)), round(d, 2), round(r, 2), part])
        act = (round(float(x["cand1_actual"]), 3), round(float(x["cand2_actual"]), 3))
        if c["actual"].get(loc, act) != act:
            raise SystemExit(f"1: {loc} {x['cycle']} has two actual results")
        c["actual"][loc] = act
    for cy, c in cycles.items():
        c["rows"].sort(key=lambda r: (-r[2], r[0], r[1]))
        if len(c["rows"]) < 500:
            raise SystemExit(f"1: only {len(c['rows'])} polls for {cy}")
    return {"places": places, "pollsters": pollsters, "cycles": cycles}


# ------------------------------------------------------------------ build

def build(cache: Path) -> None:
    regions = states_and_regions(cache)
    seats10, seats20 = apportionment(cache)
    fec = {2004: fec_table2(fetch("fec2004.xls", cache), 2004), 2008: fec_table2(fetch("fec2008.xls", cache), 2008),
           2012: fec_table2(fetch("fec2012.xls", cache), 2012), 2016: fec_table2(fetch("fec2016.xlsx", cache), 2016),
           2020: fec_table2(fetch("fec2020.xlsx", cache), 2020)}
    fec[2024], alloc24 = fec_2024(fetch("fec2024.xlsx", cache))
    postal = sorted(fec[2024])
    # Names: the FEC uses postal codes, the Census full names. Pair them through the 2020 results sheet.
    wb = openpyxl.load_workbook(fetch("fec2020.xlsx", cache), read_only=True, data_only=True)
    name_of = {}
    for r in wb["9. 2020 Pres General Results"].iter_rows(values_only=True):
        if isinstance(r[3], str) and re.fullmatch(r"[A-Z]{2}", r[3].strip()) and isinstance(r[2], str):
            name_of[r[3].strip()] = r[2].strip()
    if sorted(name_of) != postal or set(name_of.values()) != set(regions):
        raise SystemExit("3: state names in the FEC and the Census files do not match")
    units = postal + ["ME-1", "ME-2", "NE-1", "NE-2", "NE-3"]

    def ev(seats: dict) -> list[int]:
        out = []
        for s in postal:
            if s == "DC":
                out.append(3)
            else:
                e = seats[name_of[s]] + 2
                out.append(e - seats[name_of[s]] if s in ("ME", "NE") else e)  # at-large pair for the split states
        out += [1, 1, 1, 1, 1]
        if sum(out) != 538:
            raise SystemExit(f"3: electoral votes add up to {sum(out)}")
        return out

    ev10, ev20 = ev(seats10), ev(seats20)
    full = lambda evs, s: evs[postal.index(s)] + (2 if s == "ME" else 3 if s == "NE" else 0)
    for s in postal:
        if full(ev20, s) != alloc24[s]:
            raise SystemExit(f"3: {s} has {full(ev20, s)} electoral votes from the 2020 census, the FEC says {alloc24[s]}")
    for year in YEARS:
        evs = ev20 if year == 2024 else ev10
        for s in postal:
            got = fec[year][s][3] + fec[year][s][4] + (FAITHLESS_2016.get(s, 0) if year == 2016 else 0)
            if got != full(evs, s):
                raise SystemExit(f"3: {year} {s}: {got} electoral votes awarded, {full(evs, s)} allocated")

    me, ne, untallied = {}, {}, {}
    for y in YEARS:
        me[y], untallied[y] = maine_certificate(fetch(f"maine{y}.pdf", cache), y, tuple(fec[y]["ME"][:2]))
        ne[y] = nebraska_certificate(fetch(f"nebraska{y}.pdf", cache), y, tuple(fec[y]["NE"][:2]))

    results = {}
    for y in STATE_YEARS:
        results[str(y)] = {"dem": NOMINEES[y][0], "rep": NOMINEES[y][1], "statesOnly": True,
                           "d": [fec[y][s][0] for s in postal], "r": [fec[y][s][1] for s in postal], "t": [fec[y][s][2] for s in postal]}
    for y in YEARS:
        d = [fec[y][s][0] for s in postal] + [me[y][1][0], me[y][2][0], ne[y][1][0], ne[y][2][0], ne[y][3][0]]
        r = [fec[y][s][1] for s in postal] + [me[y][1][1], me[y][2][1], ne[y][1][1], ne[y][2][1], ne[y][3][1]]
        results[str(y)] = {"dem": NOMINEES[y][0], "rep": NOMINEES[y][1], "ev": ev20 if y == 2024 else ev10, "d": d, "r": r,
                           "t": [fec[y][s][2] for s in postal],
                           "evWon": [sum(fec[y][s][3] for s in postal), sum(fec[y][s][4] for s in postal)]}

    p = polls(cache, units)
    # 5. Districts against 538's recorded results (shares of the whole vote; compare two-party shares).
    for cy, c in p["cycles"].items():
        if str(cy) not in results:
            continue
        res = results[str(cy)]
        for loc, (a, b) in c["actual"].items():
            if loc == "US" or (res.get("statesOnly") and "-" in loc):
                continue
            i = units.index(loc)
            ours = 100 * res["d"][i] / (res["d"][i] + res["r"][i])
            theirs = 100 * a / (a + b)
            if abs(ours - theirs) > 0.15:
                if "-" in loc:
                    raise SystemExit(f"5: {loc} {cy}: two-party share {ours:.3f} here, {theirs:.3f} in 538's file")
                print(f"  note: {loc} {cy}: FEC two-party share {ours:.3f}, 538's recorded result {theirs:.3f}")

    stamp = lambda *names: " to ".join(sorted({retrieved(cache / n) for n in names}))
    fec_files = ["fec2004.xls", "fec2008.xls", "fec2012.xls", "fec2016.xlsx", "fec2020.xlsx", "fec2024.xlsx"]
    certificates = [f"{s}{y}.pdf" for s in ("maine", "nebraska") for y in YEARS]
    data = {
        "retrieved": stamp(*FILES),
        "sources": {
            "polls": {"name": "FiveThirtyEight, pollster ratings: raw_polls.csv", "url": "https://github.com/fivethirtyeight/data/tree/master/pollster-ratings",
                      "licence": "CC BY 4.0", "licenceUrl": "https://creativecommons.org/licenses/by/4.0/", "retrieved": stamp("raw_polls.csv")},
            "results": {"name": "Federal Election Commission, Federal Elections 2004, 2008, 2012, 2016 and 2020 (Table 2) and Official 2024 Presidential General Election Results",
                        "url": "https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/", "licence": "Public domain (a work of the US government)", "retrieved": stamp(*fec_files)},
            "ev": {"name": "US Census Bureau, apportionment of the House of Representatives, 2010 and 2020 censuses (Table 1, 2020 Census)",
                   "url": "https://www.census.gov/data/tables/2020/dec/2020-apportionment-data.html", "licence": "Public domain (a work of the US government)", "retrieved": stamp("apportionment.xlsx", "geocodes.xlsx")},
            "districts": {"name": "Certificates of ascertainment of Maine and Nebraska, 2012 to 2024 (votes for each party's district electors), published by the US National Archives",
                          "url": "https://www.archives.gov/electoral-college", "licence": "Official vote counts certified by the states", "retrieved": stamp(*certificates)},
        },
        "units": units,
        "names": [name_of[s] for s in postal] + ["Maine 1st district", "Maine 2nd district", "Nebraska 1st district", "Nebraska 2nd district", "Nebraska 3rd district"],
        "region": [regions[name_of[s]] for s in postal] + [1, 1, 2, 2, 2],
        "regions": ["Northeast", "Midwest", "South", "West"],
        "results": results,
        "untallied": {str(y): untallied[y] for y in YEARS if untallied[y]},
        "polls": {
            "places": p["places"],
            "pollsters": p["pollsters"],
            "fields": ["place", "pollster", "daysBefore", "sampleSize", "dem", "rep", "partisan"],
            "cycles": {str(cy): {"election": c["election"], "dem": c["names"][0], "rep": c["names"][1], "rows": c["rows"],
                                 } for cy, c in p["cycles"].items()},
        },
    }
    text = (
        "// Generated by scripts/data/elections.py. Do not edit by hand.\n"
        "// US presidential results by state 2004-2024 (FEC, public domain) and by Maine and Nebraska district 2012-2024\n"
        "// (certificates of ascertainment, National Archives), electoral votes (Census Bureau, public domain) and 538's\n"
        "// presidential polls 2004-2020 (CC BY 4.0), retrieved "
        f"{data['retrieved']}.\n"
        "// results[year]: d, r = the Democrat's and the Republican's votes per unit; t = all votes per state; ev = electoral\n"
        "// votes per unit (Maine and Nebraska: the two statewide votes, then one per district). polls.cycles[year].rows:\n"
        "// [place index, pollster index, days from median field date to election, sample size, dem %, rep %, partisan 0-3].\n"
        "export const ELECTIONS = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    if "NaN" in text or "Infinity" in text:
        raise SystemExit("the output holds a value that is not a number")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    for y in YEARS:
        r = results[str(y)]
        print(f"  {y}: D {sum(r['d'][:51]):,} R {sum(r['r'][:51]):,} EV {r['evWon']}; districts "
              + ", ".join(f"{u} {r['d'][51 + i]:,}/{r['r'][51 + i]:,}" for i, u in enumerate(units[51:])))
    for cy, c in p["cycles"].items():
        print(f"  polls {cy}: {len(c['rows'])} questions, {len({r[1] for r in c['rows']})} pollsters, election {c['election']}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", default=None, help="folder for the downloads; reused if they are already there")
    args = ap.parse_args()
    if args.cache:
        Path(args.cache).mkdir(parents=True, exist_ok=True)
        build(Path(args.cache))
    else:
        with tempfile.TemporaryDirectory() as tmp:
            build(Path(tmp))


if __name__ == "__main__":
    main()
