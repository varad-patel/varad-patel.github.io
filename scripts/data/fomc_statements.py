"""Build 365projects/73/data.js: the policy statements of the US Federal Open Market Committee (FOMC) behind project 73
(Central Bank Language Tracker).

    python scripts/data/fomc_statements.py                 download afresh and rewrite the snapshot
    python scripts/data/fomc_statements.py --cache DIR     keep the downloads in DIR; a second run with the same DIR
                                                           rebuilds the same file without touching the network

Standard library only. The module is written only after every check below has passed.

Source (downloaded into --cache, never committed):
  Board of Governors of the Federal Reserve System, FOMC meeting calendars and statements:
  https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (2021 onwards) and
  https://www.federalreserve.gov/monetarypolicy/fomchistoricalYYYY.htm (1999 to 2020), each linking the HTML statement
  of every scheduled meeting and of the unscheduled meetings and conference calls that issued one.
  Terms: the statements are works of the US government. The Board's website policy
  (https://www.federalreserve.gov/disclaimer.htm, read 14 October 2026), under "Copyright/trademark": "Unless otherwise
  indicated, information on Board's website is in the public domain and may be copied and distributed without
  permission. Please cite to the Board as the source of the information." No statement marks third-party material.

What is kept
  * Every statement from 2 February 2000 (the dictionary the page uses was built on statements from January 2000 on)
    to the latest one. The 1999 page is read only for the target rate in force at the end of 1999.
  * The text of each press release as published: its paragraphs, in order, joined with a blank line, including the
    voting record and any related action of the Board of Governors in the same release. Left out are the page
    furniture (headings, release time, share links, the media contact, the address), the line that says the
    statement was approved "by a 12-0 vote" (the 2026 format), and the link to the separate implementation note.
  * The federal funds target after the decision, read from the statement's own words: a single rate before
    16 December 2008 and the top of the target range from then on, in percent. A statement that says only that the
    target was not changed keeps the previous target. The change is the difference from the previous decision (the
    first from the target set on 16 November 1999, 5-1/2 percent). Six statements announce no decision on the target
    (liquidity and swap-line statements of 2007, 2008 and 2010, the reserve-management statement of October 2019 and
    the statement of 23 March 2020); they are kept, with no target and no change.
  * Encoding, to keep the module small: every distinct sentence is stored once, and a statement is a list of
    paragraphs, each a list of sentence numbers. Decoding (sentences joined by one space, paragraphs by a blank line)
    gives back the text exactly; the script checks this for every statement.

Checks, run on every build (any failure stops the script with the reason)
  1. Every year from 1999 to the latest has at least six statements, and every statement has at least 40 words.
  2. A target rate is found in every statement, and it lies between 0 and 10 percent.
  3. Every change in the target is a multiple of 1/4 point, no larger than 1-1/2 points.
  4. The anchors below (decision dates and targets, taken on 14 October 2026) are unchanged.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "73" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; data-snapshot/1.0)"}  # anonymous: no name or address
BASE = "https://www.federalreserve.gov"
FIRST_YEAR = 1999  # read for the rate in force at the end of 1999; statements are kept from 2000
KEEP_FROM = "2000-01-01"

# (date, target after the decision, change in percentage points) as read on 14 October 2026.
ANCHORS = {"2000-05-16": (6.5, 0.5), "2001-01-03": (6.0, -0.5), "2008-12-16": (0.25, -0.75),
           "2015-12-16": (0.5, 0.25), "2020-03-15": (0.25, -1.0), "2022-06-15": (1.75, 0.75)}


def fetch(url: str, path: Path) -> str:
    if not path.exists():
        for attempt in range(5):
            time.sleep(0.4 + 3 * attempt)  # be gentle with the Board's server, and wait longer after a failure
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                    body = r.read()
                break
            except urllib.error.HTTPError:
                raise
            except OSError:
                if attempt == 4:
                    raise
        path.write_bytes(body)
        stamp = path.parent / "retrieved.date"
        if not stamp.exists():
            stamp.write_text(dt.date.today().isoformat(), encoding="utf-8")
    return path.read_bytes().decode("utf-8", errors="replace")


def statement_links(cache: Path) -> dict[str, str]:
    """date (YYYY-MM-DD) -> URL of the HTML statement."""
    links = {}
    year = FIRST_YEAR
    while True:
        try:
            page = fetch(f"{BASE}/monetarypolicy/fomchistorical{year}.htm", cache / f"historical{year}.htm")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                break
            raise
        for href in re.findall(r'href="([^"]+)"[^>]*>\s*Statement\s*</a>', page):
            m = re.search(r"(\d{8})", href)
            if m:
                d = m.group(1)
                links[f"{d[:4]}-{d[4:6]}-{d[6:]}"] = BASE + href if href.startswith("/") else href
        year += 1
    page = fetch(f"{BASE}/monetarypolicy/fomccalendars.htm", cache / "calendars.htm")
    for d, label in re.findall(r'href="/newsevents/pressreleases/monetary(\d{8})a\.htm"[^>]*>([^<]*)', page):
        if "Longer-Run Goals" in label:  # the strategy statement, not a policy statement
            continue
        links[f"{d[:4]}-{d[4:6]}-{d[6:]}"] = f"{BASE}/newsevents/pressreleases/monetary{d}a.htm"
    return dict(sorted(links.items()))


def clean(fragment: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    text = text.replace(" ", " ").replace("‑", "-")
    return re.sub(r"\s+", " ", text).strip()


SKIP = re.compile(r"^(For release at|For immediate release|Release Date|For media inquiries|Implementation Note|"
                  r"Board of Governors of the Federal Reserve System$|20th Street and Constitution|Share$|Last update|"
                  r"The Federal Open Market Committee approved the following statement for release)", re.I)


def paragraphs(page: str, date: str) -> list[str]:
    i = page.find('<div id="article"')
    if i >= 0:  # 2006 onwards: the article body
        body = page[i:]
        marker = '<div class="col-xs-12 col-sm-8 col-md-8">'
        j = body.find(marker)
        if j < 0:
            raise SystemExit(f"1: {date}: the statement page has no article body")
        body = body[j + len(marker):]
        end = body.find("Last Update")
        body = body[:end] if end >= 0 else body
    else:  # 1999 to 2005: a plain page
        body = re.sub(r"(?is)<script.*?</script>|<title>.*?</title>", "", page)
        end = re.search(r'(?i)<a href="/boarddocs/press/(monetary|general)/\d{4}"', body)
        body = body[:end.start()] if end else body
    parts = re.split(r"(?i)<p\b[^>]*>|</p>|<br\s*/?>\s*<br\s*/?>", body)
    out = []
    for p in parts:
        t = clean(p)
        if len(t) < 3 or SKIP.match(t) or re.fullmatch(r"\d{4} Monetary policy|Home.*|Accessibility.*", t):
            continue
        out.append(t)
    return out


FRACTION = {"": 0, "1/8": 0.125, "1/4": 0.25, "3/8": 0.375, "1/2": 0.5, "5/8": 0.625, "3/4": 0.75, "7/8": 0.875}


def number(s: str) -> float:
    m = re.fullmatch(r"(\d+)?(?:[- ]?(\d/\d))?", s)
    if not m or (m.group(1) is None and m.group(2) is None):
        raise ValueError(s)
    return int(m.group(1) or 0) + FRACTION[m.group(2) or ""]


NUM = r"(\d+(?:[- ]\d/\d)?|\d/\d)"
# "keep its target for the federal funds rate at 6-1/2 percent", "raise ... by 1/4 percentage point to 3-3/4 to 4 percent",
# "establish a target range for the federal funds rate of 0 to 1/4 percent", and with the number first,
# "the current 0 to 1/4 percent target range for the federal funds rate".
TARGETS = [
    re.compile(r"target (?:range )?for the federal funds rate(?: unchanged)?(?: (?:by )?[\d/ -]+(?:basis points?|percentage points?))?,?\s+(?:at|to|of)\s+"
               + NUM + r"(?:\s+(?:to|and)\s+" + NUM + r")?\s+percent", re.I),
    re.compile(r"\b" + NUM + r"(?:\s+to\s+" + NUM + r")?\s+percent target (?:range )?for the federal funds rate", re.I),
]
SENTENCE = re.compile(r"(?<=[.;:])\s(?=[A-Z])")  # where the stored text is cut into sentences
NO_CHANGE = re.compile(r"made no change today in its target for the federal funds rate", re.I)


def target(text: str, prev: float | None) -> float | None:
    """The target after the decision. A statement that only says the target was not changed keeps the previous one."""
    found = [m for m in (rx.search(text) for rx in TARGETS) if m]
    if found:
        m = min(found, key=lambda m: m.start())  # the first mention of the target in the text
        return number(m.group(2) or m.group(1))
    if prev is not None and NO_CHANGE.search(text):
        return prev
    return None  # a statement that announces no decision on the target


def build(cache: Path) -> None:
    links = statement_links(cache)
    stmts = []
    for date, url in links.items():
        page = fetch(url, cache / f"s{date}.htm")
        paras = paragraphs(page, date)
        text = "\n\n".join(paras)
        stmts.append({"date": date, "url": url, "text": text})

    by_year = {}
    for s in stmts:
        by_year[s["date"][:4]] = by_year.get(s["date"][:4], 0) + 1
        if len(s["text"].split()) < 40:
            raise SystemExit(f"1: {s['date']} has only {len(s['text'].split())} words: {s['text'][:200]}")
    last_year = max(int(y) for y in by_year)
    for y in range(FIRST_YEAR, last_year + 1):
        if by_year.get(str(y), 0) < 6:
            raise SystemExit(f"1: {y} has {by_year.get(str(y), 0)} statements")

    prev = None
    kept, undecided = [], []
    for s in stmts:
        if s["date"] < "1999-11-16":  # earlier 1999 statements do not all name the target; only the last one is needed
            continue
        t = target(s["text"], prev)
        if t is None:
            undecided.append(s["date"])
            if s["date"] >= KEEP_FROM:
                kept.append({"date": s["date"], "target": None, "change": None, "url": s["url"], "text": s["text"]})
            continue
        if not 0 <= t <= 10:
            raise SystemExit(f"2: {s['date']} target {t}")
        change = None if prev is None else round(t - prev, 4)
        if change is not None and (abs(change * 4 - round(change * 4)) > 1e-9 or abs(change) > 1.5):
            raise SystemExit(f"3: {s['date']} change {change}")
        prev = t
        if s["date"] >= KEEP_FROM:
            kept.append({"date": s["date"], "target": t, "change": change, "url": s["url"], "text": s["text"]})

    if len(undecided) > 12:
        raise SystemExit(f"2: no target rate in {len(undecided)} statements: {undecided}")
    for date, (t, c) in ANCHORS.items():
        s = next((x for x in kept if x["date"] == date), None)
        if s is None or s["target"] != t or s["change"] != c:
            raise SystemExit(f"4: {date} is {s and (s['target'], s['change'])}, was {(t, c)}")

    stamp = cache / "retrieved.date"
    data = {
        "retrieved": stamp.read_text(encoding="utf-8").strip() if stamp.exists() else dt.date.today().isoformat(),
        "source": {
            "name": "Board of Governors of the Federal Reserve System, FOMC statements",
            "url": "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
            "terms": "Public domain: \"Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source of the information.\" (https://www.federalreserve.gov/disclaimer.htm)",
        },
        "sentences": [],
        "statements": [],
    }
    # Statements repeat many sentences word for word, so each distinct sentence is stored once and a statement is a
    # list of paragraphs, each a list of sentence numbers. Joining a paragraph's sentences with one space and the
    # paragraphs with a blank line gives back the text exactly (checked here).
    number_of = {}
    for s in kept:
        paras = []
        for para in s["text"].split("\n\n"):
            ids = []
            for sentence in SENTENCE.split(para):
                if sentence not in number_of:
                    number_of[sentence] = len(data["sentences"])
                    data["sentences"].append(sentence)
                ids.append(number_of[sentence])
            paras.append(ids)
        if "\n\n".join(" ".join(data["sentences"][i] for i in ids) for ids in paras) != s["text"]:
            raise SystemExit(f"5: {s['date']} does not survive the sentence encoding")
        data["statements"].append([s["date"], s["target"], s["change"], paras])
    text = (
        "// Generated by scripts/data/fomc_statements.py. Do not edit by hand.\n"
        "// FOMC policy statements (works of the US government, public domain) as published by the Federal Reserve Board,\n"
        f"// retrieved {data['retrieved']}. statements[i] = [date, federal funds target after the decision (percent; top of the\n"
        "// range from December 2008; null if the statement announced no decision on it), change from the previous decision\n"
        "// (percentage points), paragraphs]: each paragraph is a list of numbers of sentences, sentences joined by one space.\n"
        "export const FOMC = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)
    moves = sum(1 for s in kept if s["change"])
    print("  statements that announce no decision on the target:", ", ".join(undecided))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB), {len(kept)} statements {kept[0]['date']} to {kept[-1]['date']}, {moves} with a change in the target")


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
