"""Generate 365projects/challenge-data.js (and each project's README) from the list and the built projects.

    python scripts/build_data.py

A project counts as built when 365projects/<N>/ holds index.html, meta.json and a
thumbnail at 365projects/img/<NNN>.jpg. The gallery and every project page read the
one generated JavaScript file, so nothing is fetched at runtime. The script fails
loudly if anything is inconsistent (missing thumbnail, unknown project, gaps in the
numbering, an incomplete meta.json).
"""

from __future__ import annotations

import csv
import json
import os
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPS = ROOT / "365projects"
OUT = APPS / "challenge-data.js"
META_KEYS = ("question", "finding", "limit", "sources", "built")


def load_built(apps: Path = APPS) -> list[dict]:
    """One entry per 365projects/<N>/meta.json, with the project number taken from the folder name.

    A page that is finished on this machine but not yet published (still under review, or held back) is left out
    by naming it in the environment: CHALLENGE_SKIP="35,49,50". Unpublished folders are never committed, so the
    variable is only ever needed locally.
    """
    skip = {int(n) for n in os.environ.get("CHALLENGE_SKIP", "").replace(" ", "").split(",") if n}
    built = []
    for meta in sorted(apps.glob("*/meta.json"), key=lambda p: int(p.parent.name) if p.parent.name.isdigit() else 0):
        if not meta.parent.name.isdigit() or int(meta.parent.name) in skip:
            continue
        entry = json.loads(meta.read_text(encoding="utf-8"))
        missing = [k for k in META_KEYS if k not in entry]
        if missing:
            raise ValueError(f"{meta.relative_to(apps.parent)} is missing {missing}")
        if not (meta.parent / "index.html").exists():
            raise FileNotFoundError(f"project {meta.parent.name} has meta.json but no index.html")
        built.append({"id": int(meta.parent.name), **{k: entry[k] for k in META_KEYS}})
    return built


def load() -> tuple[dict, list[dict], list[dict], list[dict]]:
    site = json.loads((ROOT / "data" / "site.json").read_text(encoding="utf-8"))
    sections = json.loads((ROOT / "data" / "sections.json").read_text(encoding="utf-8"))
    with open(ROOT / "data" / "challenge.tsv", encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    return site, sections, rows, load_built()


def assemble(site: dict, sections: list[dict], rows: list[dict], built: list[dict], img_dir: Path | None = None) -> dict:
    img_dir = img_dir or APPS / "img"
    start = date.fromisoformat(site["start"])
    by_id = {b["id"]: b for b in built}
    ids = [int(r["id"]) for r in rows]
    if ids != list(range(1, len(ids) + 1)):
        raise ValueError("project numbers in data/challenge.tsv must run 1..N without gaps")
    unknown = sorted(set(by_id) - set(ids))
    if unknown:
        raise ValueError(f"built projects not in the list: {unknown}")
    section_of = {}
    for s in sections:
        for number in range(s["first"], s["last"] + 1):
            section_of[number] = s["id"]

    projects = []
    for row in rows:
        number = int(row["id"])
        if section_of.get(number) != int(row["section"]):
            raise ValueError(f"project {number} is in section {row['section']} but data/sections.json puts it in {section_of.get(number)}")
        item = {
            "id": number,
            "title": row["title"],
            "desc": row["description"],
            "concept": row.get("concept", ""),
            "skills": row.get("skills", ""),
            "section": int(row["section"]),
            "date": (start + timedelta(days=number - 1)).isoformat(),
        }
        if number in by_id:
            b = by_id[number]
            if not (img_dir / f"{number:03d}.jpg").exists():
                raise FileNotFoundError(f"missing thumbnail for project {number}: {img_dir / f'{number:03d}.jpg'}")
            if not (b["question"] and b["finding"] and b["limit"]):
                raise ValueError(f"project {number}: question, finding and limit must not be empty")
            item.update(
                built=b["built"], question=b["question"], finding=b["finding"], limit=b["limit"],
                sources=b["sources"], img=f"img/{number:03d}.jpg", url=f"{number}/",
            )
        projects.append(item)

    return {
        "start": site["start"],
        "repo": site["repo"],
        "branch": site["branch"],
        "sections": sections,
        "projects": projects,
    }


def readme(project: dict, section: dict, site: dict) -> str:
    sources = ", ".join(project["sources"]) if project["sources"] else "None. Everything is computed in the browser."
    return f"""# Day {project['id']}: {project['title']}

{project['desc']}

Live at https://varad-patel.github.io/365projects/{project['id']}/ (part of [365 projects in 365 days](https://varad-patel.github.io/365projects/), section "{section['name']}").

| | |
|---|---|
| Question | {project['question']} |
| One finding | {project['finding']} |
| Main limit | {project['limit']} |
| PPE concept | {project['concept']} |
| Skills | {project['skills']} |
| Data | {sources} |

## Files

* `index.html`: the page, including the write-up (the idea, how it works, what it cannot tell you, extensions).
* `logic.js`: the model, with no DOM code, so it can be tested on its own.
* `app.js`: the interface, built on the shared kit in `../kit/`.
* `logic.test.mjs`: tests for the model. Run them from the repository root with `node --test 365projects/{project['id']}/logic.test.mjs`.

This file is generated by `scripts/build_data.py` from `meta.json` and `data/challenge.tsv`.
"""


def main() -> None:
    site, sections, rows, built = load()
    data = assemble(site, sections, rows, built)
    OUT.write_text(
        "// Generated by scripts/build_data.py. Do not edit by hand.\n"
        "window.CHALLENGE = " + json.dumps(data, indent=1, ensure_ascii=False) + ";\n",
        encoding="utf-8", newline="\n",
    )
    section_by_id = {s["id"]: s for s in sections}
    done = [p for p in data["projects"] if "built" in p]
    for p in done:
        (APPS / str(p["id"]) / "README.md").write_text(readme(p, section_by_id[p["section"]], site), encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(data['projects'])} projects, {len(done)} built, day 1 = {data['start']}")


if __name__ == "__main__":
    main()
