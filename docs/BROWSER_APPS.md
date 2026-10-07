# Browser apps: every project runs at /365projects/N/

## Goal

Visitors click a built project in the gallery and land on `https://varad-patel.github.io/365projects/N/`
(N is 1, 2, 3, with no zero padding), where the project's real Streamlit app runs **entirely in their browser**.
No server, no accounts, nothing to install. It should feel like a product page, not a demo: fast to understand,
clear about what it shows and what it cannot, and linked back to the code.

Decided with the owner on 2026-10-07: one page per project under `/365projects/N/`, apps run client-side, and
whatever has to change in the projects to make that work is in scope.

## Approach: stlite

[stlite](https://github.com/whitphx/stlite) is Streamlit compiled to run on Pyodide (Python in WebAssembly). The
project's Python stays the source of truth: the same `app.py` and analysis module that the tests cover.

### Verified on 2026-10-07

* `@stlite/browser` 1.9.2 is the latest npm release. Its `build/wheels/` ships `streamlit-1.62.0-cp313` and
  `stlite_lib-0.1.0`. The projects need `streamlit>=1.51` (`width="stretch"`), so this is new enough. The wheel is
  tagged cp313, so expect a Pyodide with Python 3.13 (0.29.x); confirm in the browser console.
* Files to load from jsDelivr: `https://cdn.jsdelivr.net/npm/@stlite/browser@1.9.2/build/stlite.js` and
  `.../build/stlite.css`. Pin the version. The package is about 110 MB unpacked (mostly source maps and Streamlit's
  frontend chunks), so do not vendor it into this repo.
* API (`build/stlite.d.ts`): `mount(options, container?)`. Useful options: `entrypoint`, `requirements` (installed
  with micropip), `prebuiltPackageNames` (Pyodide's own packages), `files` (path to a string, `{data}` or `{url}`),
  `archives` (`[{url, format: "zip"}]`, unpacked into the virtual file system), `streamlitConfig` (same keys as the
  `--section.option` CLI flags), `pyodideUrl`, `env`, `disableProgressToasts`.
* From the Claude cloud sandbox, `cdn.jsdelivr.net` and `registry.npmjs.org` answer 200, so a headless Chromium
  there can load stlite and Pyodide. Locally there is no restriction.

### Not verified yet (find out in step 1)

* That each of the 15 apps runs under Pyodide, how long a cold and a warm load take, and how many MB are
  transferred.
* Which Pyodide version stlite 1.9.2 pins and whether `plotly`, `statsmodels` and `scipy` resolve for it.

## What the projects need

What the repo looks like today (`NotNeverMe/365D365P`):

* `core/paths.py` sets `ROOT = Path(__file__).resolve().parents[1]` and `DATA = ROOT / "data"`. So in the browser
  file system `core/` and `data/` must be siblings, and `app.py` plus its module sit next to them. A zip with this
  layout, unpacked at the working directory, works with no code changes to `paths.py`:
  ```
  app.py
  <module>.py
  core/__init__.py core/*.py
  data/<source>/...      (only what the project reads)
  ```
* `core/http.py` imports `requests` at module level and downloads on a cache miss. In the browser there must be
  no network fetching. Change it to import `requests` lazily inside `get()` and to raise `DataUnavailable` with a
  clear message when `sys.platform == "emscripten"` (that is what Pyodide reports). Then `requests` is not needed
  in the browser requirements at all.
* Third-party imports across the 15 projects and `core/`: pandas, numpy, plotly, streamlit, scipy (3 files),
  statsmodels (3 files), requests (only `core/http.py`). pandas, numpy, scipy and statsmodels are Pyodide
  packages (`prebuiltPackageNames` or `requirements`); plotly is pure Python and comes from PyPI via micropip.
  If statsmodels is only used for a simple regression, consider `numpy.linalg.lstsq` to save a large download,
  but only if the results stay identical (the tests decide).
* Data caches are about 8.5 MB gzip-compressed across all sources (`worldbank`, `fred`, `bigmac`, `bea`, `bis`,
  `eurostat`, `wits`). Start with one zip per source directory, shared by every page and cached by the browser,
  plus a small per-project zip for the code. Add a per-project list of the sources it needs (a `web.json` in
  the project folder is fine) once the number of sources grows.

## Plan

Do these in order. After each step, run the tests and look at the result in a real browser.

1. **Prototype project 1 by hand.** Create `365projects/1/index.html`, a zip with the layout above, and a module
   script that calls `mount(...)`. Serve with `python -m http.server`, open it in Chromium (Playwright), wait
   for a plotly chart (`.js-plotly-plot`), read the console. Fix what breaks in the Python without changing any
   numbers. Record cold-load time and MB transferred in this file. Show the owner before going further.
2. **Make it generic.** Write `scripts/build_web.py --repo ../365-projects [N ...]` that, for each project folder,
   builds the code zip, copies or builds the data zips, and writes `365projects/N/index.html` from one template.
   Output is committed (the site has no CI build step). The script is idempotent. Add a test that the generated
   files exist for every built project and that the template has no unreplaced placeholders.
3. **Product shell** (spec below).
4. **Wire the gallery.** In `scripts/build_data.py` add an `app` field (`"N/"`) for projects whose
   `365projects/N/index.html` exists. In `365projects/app.js`, a built project's plate links straight to its page
   (a real `<a>`, keyboard friendly) and the `#NNN` deep links redirect to it. Projects not built yet still open
   the existing detail dialog (scheduled date, description). Update `tests/test_data.py`.
5. **Test every page** with `scripts/check_web.py` (Playwright): for each N open `/365projects/N/` at 1280 px and
   400 px, wait for the app, fail on any Streamlit exception box, any console error, no chart or table, or any
   request to a host other than this site, `cdn.jsdelivr.net`, `pypi.org` and `files.pythonhosted.org`. Change
   one widget per app and confirm it re-renders.
6. **Measure and trim.** Report cold and warm load for a typical page. If a cold load is much over 100 MB or
   takes more than about 30 s on broadband, trim before shipping: unused packages, statsmodels where
   avoidable, data subsets.
7. **Publish and check live.** Push to `main`, wait for the Pages build, then open the live pages (WebFetch cannot
   run the apps; use a real browser) and re-run `check_web.py` against `https://varad-patel.github.io`.
   Update the README.

## Product shell for each page

Use `assets/site.css` and the same header as the rest of the site. Plain, specific copy.

* A breadcrumb back to `/365projects/` and the project number and title. A one-line question (from
  `data/built.json`).
* The app, taking the full width under the title. Hide Streamlit's toolbar and menu
  (`streamlitConfig`: `client.toolbarMode: "minimal"`) and set the Streamlit theme to match the site tokens
  (`theme.base`, `theme.primaryColor`, `theme.backgroundColor`, `theme.textColor`, `theme.font`).
* A loading state shown until the first render: what is happening ("Starting Python in your browser"), that the
  first visit downloads the runtime and later visits are cached, and real progress if stlite exposes it. If
  WebAssembly or module workers are missing, or loading fails, say so in plain words and link to the code.
* An "About this project" panel under the app with the question, data sources, one honest limit, the finding
  with the command that reproduces it, the build date, and a "View code" link to the project's folder in the
  projects repo. This replaces the gallery's detail dialog for built projects.
* Per-page `<title>` ("GDP Growth Dashboard, Varad Patel") and meta description. Sensible at 400 px wide.

## Fallbacks if stlite turns out too heavy or breaks on a project

1. Host that one app on Streamlit Community Cloud (free, sleeps when idle) and link to it from the same page.
2. Port the app to plain JavaScript with Plotly.js. Chart specs translate almost one to one from the Python
   figures; test the JS maths against golden outputs generated by the Python module. Worth it only for a few
   flagships, not for 365 projects.

## Definition of done

* `/365projects/1/` to `/365projects/15/` each load, run and respond to controls in Chromium, with no
  exceptions, console errors or third-party requests beyond those listed.
* The gallery links every built project to its page and keeps working by keyboard.
* `pytest` passes in both repos and CI is green.
* Cold and warm load numbers are written down here.
* Adding project 16 needs only the commands in `CLAUDE.md` plus `python scripts/build_web.py ... 16`.
