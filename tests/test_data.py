import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_data  # noqa: E402


def small_inputs(tmp_path, built_ids=(1,)):
    sections = [{"id": 1, "name": "A", "first": 1, "last": 3}]
    rows = [{"id": str(i), "section": "1", "title": f"T{i}", "description": f"D{i}", "concept": "c", "skills": "s"} for i in (1, 2, 3)]
    built = [{"id": i, "question": "q", "finding": "f", "limit": "l", "sources": [], "built": "2026-10-10"} for i in built_ids]
    for i in built_ids:
        (tmp_path / f"{i:03d}.jpg").write_bytes(b"x")
    return {"start": "2026-10-10", "repo": "https://example.com/r", "branch": "main"}, sections, rows, built


def test_dates_follow_the_start_day(tmp_path):
    data = build_data.assemble(*small_inputs(tmp_path), img_dir=tmp_path)
    assert [p["date"] for p in data["projects"]] == ["2026-10-10", "2026-10-11", "2026-10-12"]
    assert data["projects"][0]["url"] == "1/" and "built" not in data["projects"][1]


def test_missing_thumbnail_is_an_error(tmp_path):
    inputs = small_inputs(tmp_path)
    (tmp_path / "001.jpg").unlink()
    with pytest.raises(FileNotFoundError):
        build_data.assemble(*inputs, img_dir=tmp_path)


def test_gaps_unknown_projects_and_wrong_sections_are_errors(tmp_path):
    site, sections, rows, built = small_inputs(tmp_path)
    with pytest.raises(ValueError):
        build_data.assemble(site, sections, rows[:1] + rows[2:], built, img_dir=tmp_path)
    with pytest.raises(ValueError):
        build_data.assemble(site, sections, rows, built + [{**built[0], "id": 99}], img_dir=tmp_path)
    with pytest.raises(ValueError):
        build_data.assemble(site, sections, [{**rows[0], "section": "2"}] + rows[1:], built, img_dir=tmp_path)


def test_real_data_is_complete_and_the_generated_file_is_current():
    data = build_data.assemble(*build_data.load())
    assert len(data["projects"]) == 365
    assert len(data["sections"]) == 13
    assert data["projects"][-1]["date"] == "2027-10-09"  # day 365 when day 1 is 2026-10-10
    generated = (ROOT / "365projects" / "challenge-data.js").read_text(encoding="utf-8")
    expected = "window.CHALLENGE = " + json.dumps(data, indent=1, ensure_ascii=False) + ";\n"
    assert generated.endswith(expected), "365projects/challenge-data.js is stale: run python scripts/build_data.py"


REQUIRED_HEADINGS = ["One finding", "The idea", "How it works", "What this cannot tell you", "Improvements and extensions"]


def test_every_built_project_has_its_page_logic_tests_and_write_up():
    built = build_data.load_built()
    for b in built:
        folder = ROOT / "365projects" / str(b["id"])
        for name in ("index.html", "app.js", "logic.js", "logic.test.mjs", "meta.json", "README.md"):
            assert (folder / name).exists(), f"project {b['id']} is missing {name}"
        page = (folder / "index.html").read_text(encoding="utf-8")
        assert f'data-day="{b["id"]}"' in page, f"project {b['id']}: <body> must carry data-day"
        headings = re.findall(r"<h2[^>]*>(.*?)</h2>", page, re.S)
        for heading in REQUIRED_HEADINGS:
            assert heading in headings, f"project {b['id']} has no '{heading}' section"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", b["built"])
        assert isinstance(b["sources"], list)
