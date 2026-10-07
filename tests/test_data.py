import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_data  # noqa: E402
import import_projects  # noqa: E402

README = """# 003 · Unemployment Visualizer

> How does unemployment differ by country?

## Data

| Source | Series |
|---|---|
| World Bank (ILO modelled) | `SL.UEM.TOTL.ZS` |
| FRED | `CPIAUCSL` |

## Limits

* **Education data are thin.** Each series has a median of 9 years. Do not
  read the gaps as zeros. A third sentence that should be dropped because it runs past the length limit of the
  summary, which keeps going and going until it is clearly too long to keep in a gallery card.
* Second bullet.
"""


def test_parse_readme_extracts_question_limit_and_sources():
    parsed = import_projects.parse_readme(README)
    assert parsed["question"] == "How does unemployment differ by country?"
    assert parsed["sources"] == ["World Bank", "FRED"]
    assert parsed["limit"].startswith("Education data are thin. Each series has a median of 9 years.")
    assert "Second bullet" not in parsed["limit"]
    assert "*" not in parsed["limit"]


def test_parse_findings_reads_the_four_column_table():
    top = "| # | Project | Q | Finding |\n|--:|---|---|---|\n| 1 | [GDP](projects/001) | q | China grew **8%**. |\n| 2 | x | q | y |\n"
    assert import_projects.parse_findings(top) == {1: "China grew 8%.", 2: "y"}


def small_inputs(tmp_path, built_ids=(1,)):
    sections = [{"id": 1, "name": "A", "first": 1, "last": 3}]
    rows = [{"id": str(i), "section": "1", "title": f"T{i}", "description": f"D{i}"} for i in (1, 2, 3)]
    built = [{"id": i, "slug": f"00{i}-x", "question": "q", "finding": "f", "limit": "l", "sources": ["FRED"], "built": "2026-10-07"} for i in built_ids]
    for i in built_ids:
        (tmp_path / f"{i:03d}.jpg").write_bytes(b"x")
    return {"start": "2026-10-07", "repo": "https://example.com/r", "branch": "main"}, sections, rows, built


def test_dates_follow_the_start_day(tmp_path):
    data = build_data.assemble(*small_inputs(tmp_path), img_dir=tmp_path)
    assert [p["date"] for p in data["projects"]] == ["2026-10-07", "2026-10-08", "2026-10-09"]
    assert "built" in data["projects"][0] and "built" not in data["projects"][1]


def test_missing_thumbnail_is_an_error(tmp_path):
    inputs = small_inputs(tmp_path)
    (tmp_path / "001.jpg").unlink()
    with pytest.raises(FileNotFoundError):
        build_data.assemble(*inputs, img_dir=tmp_path)


def test_gaps_and_unknown_projects_are_errors(tmp_path):
    site, sections, rows, built = small_inputs(tmp_path)
    with pytest.raises(ValueError):
        build_data.assemble(site, sections, rows[:1] + rows[2:], built, img_dir=tmp_path)
    with pytest.raises(ValueError):
        build_data.assemble(site, sections, rows, built + [{**built[0], "id": 99}], img_dir=tmp_path)


def test_real_data_is_complete_and_the_generated_file_is_current():
    data = build_data.assemble(*build_data.load())
    assert len(data["projects"]) == 365
    assert data["projects"][-1]["date"] == "2027-10-06"  # day 365 when day 1 is 2026-10-07
    assert all(p["finding"] and p["question"] and p["limit"] and p["sources"] for p in data["projects"] if "built" in p)
    generated = (ROOT / "365" / "challenge-data.js").read_text(encoding="utf-8")
    expected = "window.CHALLENGE = " + json.dumps(data, indent=1, ensure_ascii=False) + ";\n"
    assert generated.endswith(expected), "365/challenge-data.js is stale: run python scripts/build_data.py"
