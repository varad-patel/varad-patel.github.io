"""Screenshot project apps into 365projects/img/NNN.jpg for the gallery.

    python scripts/shoot.py --repo ../365-projects 016 017

Boots each project's Streamlit app headless, waits for the charts to draw,
collapses the sidebar and saves a 1200 px wide JPEG. With no project numbers it
does every project that has an app.py. Needs the projects repo's dependencies
plus Playwright and Pillow (pip install playwright pillow). Projects whose first
tab is not the most telling one can name a tab in data/shots.json, for example
{"6": {"tab": "Price level vs income"}}.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "365projects" / "img"
VIEWPORT = {"width": 1440, "height": 1000}
CROP = {"x": 0, "y": 48, "width": 1440, "height": 952}  # drops Streamlit's empty header strip
WIDTH = 1200


def to_thumbnail(png: bytes | Path, out: Path) -> None:
    """Resize a screenshot to the gallery size and save it as JPEG."""
    image = Image.open(BytesIO(png) if isinstance(png, bytes) else png).convert("RGB")
    height = round(image.height * WIDTH / image.width)
    image.resize((WIDTH, height), Image.LANCZOS).save(out, "JPEG", quality=82, optimize=True, progressive=True)


def wait_healthy(port: int, seconds: int = 60) -> None:
    for _ in range(seconds):
        try:
            if urllib.request.urlopen(f"http://127.0.0.1:{port}/_stcore/health", timeout=2).read() == b"ok":
                return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f"Streamlit did not start on port {port}")


def shoot(browser, repo: Path, folder: Path, port: int, tab: str | None) -> None:
    proc = subprocess.Popen(
        [sys.executable, "-m", "streamlit", "run", str(folder / "app.py"), "--server.headless", "true",
         "--server.port", str(port), "--browser.gatherUsageStats", "false", "--theme.base", "light",
         "--server.fileWatcherType", "none", "--client.toolbarMode", "minimal"],
        cwd=repo, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        wait_healthy(port)
        page = browser.new_page(viewport=VIEWPORT)
        page.goto(f"http://127.0.0.1:{port}", wait_until="domcontentloaded")
        page.wait_for_selector('[data-testid="stMain"]', timeout=60000)
        time.sleep(3)
        try:
            page.wait_for_selector('[data-testid="stStatusWidget"]', state="detached", timeout=90000)
            page.wait_for_selector(".js-plotly-plot .main-svg", timeout=40000)
        except Exception:
            print(f"  {folder.name}: no chart detected, taking the screenshot anyway")
        collapse = page.locator('[data-testid="stSidebarCollapseButton"] button')
        if collapse.count():
            collapse.first.click()
        if tab:
            page.get_by_role("tab", name=tab).click()
            time.sleep(2)
        time.sleep(4)
        if page.locator('[data-testid="stException"]').count():
            raise RuntimeError(f"{folder.name} shows an exception on screen; fix the app before taking a thumbnail")
        number = int(folder.name[:3])
        to_thumbnail(page.screenshot(clip=CROP), IMG / f"{number:03d}.jpg")
        print(f"  wrote 365projects/img/{number:03d}.jpg")
        page.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> None:
    from playwright.sync_api import sync_playwright

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, default=ROOT.parent / "365-projects")
    parser.add_argument("numbers", nargs="*", help="project numbers such as 016; default is every project with an app")
    args = parser.parse_args()
    repo = args.repo.resolve()
    wanted = {int(n) for n in args.numbers}
    tabs = json.loads((ROOT / "data" / "shots.json").read_text()) if (ROOT / "data" / "shots.json").exists() else {}
    folders = [f for f in sorted((repo / "projects").glob("[0-9][0-9][0-9]-*")) if (f / "app.py").exists()]
    folders = [f for f in folders if not wanted or int(f.name[:3]) in wanted]
    IMG.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-proxy-server"])
        for i, folder in enumerate(folders):
            print(folder.name)
            shoot(browser, repo, folder, 8700 + i, tabs.get(str(int(folder.name[:3])), {}).get("tab"))
        browser.close()


if __name__ == "__main__":
    main()
