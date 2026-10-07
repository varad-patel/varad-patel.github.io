"""Refresh data/built.json from the projects repo (its READMEs and git history).

    python scripts/import_projects.py --repo ../365-projects

For every folder under projects/ it reads the README (question, first limit,
data sources), the one-line finding from the repo's top-level README table, and
the date of the folder's first commit. Nothing is typed in by hand, so the
gallery cannot drift from what the projects actually say.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Longest names first so "World Bank" is not shadowed by a shorter match.
SOURCE_PATTERNS = [
    ("World Bank", r"World Bank"),
    ("FRED", r"\bFRED\b"),
    ("Economist Big Mac index", r"Big Mac"),
    ("US Bureau of Economic Analysis", r"Bureau of Economic Analysis|\bBEA\b"),
    ("Bank for International Settlements", r"\bBIS\b"),
    ("Eurostat", r"Eurostat"),
    ("WITS", r"\bWITS\b"),
    ("Penn World Table", r"Penn World Table"),
]


def section(text: str, heading: str) -> str:
    """Body of the '## heading' section of a markdown file ('' if absent)."""
    match = re.search(rf"^## {re.escape(heading)}\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    return match.group(1) if match else ""


def plain(text: str) -> str:
    """Strip the markdown the gallery cannot render (bold, code, links)."""
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return re.sub(r"[*`]", "", text).strip()


def shorten(text: str, limit: int = 230) -> str:
    """Keep whole sentences up to roughly ``limit`` characters."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    out = sentences[0]
    for sentence in sentences[1:]:
        if len(out) + len(sentence) + 1 > limit:
            break
        out += " " + sentence
    return out


def parse_readme(text: str) -> dict:
    question = re.search(r"^>\s*(.+)$", text, re.M)
    limits = section(text, "Limits")
    bullet = re.search(r"^[*-]\s+(.+?)(?=^\s*[*-]\s|\n\n|\Z)", limits, re.M | re.S)
    data = section(text, "Data")
    sources = [name for name, pattern in SOURCE_PATTERNS if re.search(pattern, data)]
    return {
        "question": plain(question.group(1)) if question else "",
        "limit": shorten(plain(" ".join(bullet.group(1).split()))) if bullet else "",
        "sources": sources,
    }


def parse_findings(top_readme: str) -> dict[int, str]:
    """Map project number -> finding from the '| # | Project | ... | finding |' table."""
    findings = {}
    for line in top_readme.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 4 and cells[0].isdigit():
            findings[int(cells[0])] = plain(cells[3])
    return findings


def first_commit_date(repo: Path, folder: Path) -> str:
    out = subprocess.run(
        ["git", "-C", str(repo), "log", "--reverse", "--format=%as", "--", str(folder.relative_to(repo))],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    return out[0] if out else ""


def build(repo: Path) -> list[dict]:
    findings = parse_findings((repo / "README.md").read_text(encoding="utf-8"))
    built = []
    for folder in sorted((repo / "projects").glob("[0-9][0-9][0-9]-*")):
        readme = folder / "README.md"
        if not readme.exists() or not first_commit_date(repo, folder):
            continue  # unfinished or untracked work is not published
        number = int(folder.name[:3])
        entry = {"id": number, "slug": folder.name, **parse_readme(readme.read_text(encoding="utf-8"))}
        entry["finding"] = findings.get(number, "")
        entry["built"] = first_commit_date(repo, folder)
        built.append(entry)
    return built


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, default=ROOT.parent / "365-projects", help="path to the projects repo")
    args = parser.parse_args()
    built = build(args.repo.resolve())
    (ROOT / "data" / "built.json").write_text(json.dumps(built, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote data/built.json with {len(built)} projects")


if __name__ == "__main__":
    main()
