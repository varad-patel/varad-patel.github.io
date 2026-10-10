# Varad Patel: 365 projects in 365 days

Live at **https://varad-patel.github.io**, with the gallery at **https://varad-patel.github.io/365projects/**.

365 small interactive products on philosophy, economics and politics, built with maths, data and code. Each one
is a single page that runs entirely in the browser: a working model you can change, a write-up of the idea and
the method, an honest list of what it cannot tell you, and tests. Project N lives at `/365projects/N/`.

The site is static HTML, CSS and vanilla JavaScript with no framework and no build step. To preview it:

```bash
python -m http.server 8000        # then open http://localhost:8000/365projects/
```

## Where things are

```
365projects/<N>/                   one project: index.html, app.js, logic.js (the model), logic.test.mjs, meta.json
365projects/kit/                   the shared kit: controls, charts, statistics, seeded randomness
365projects/data/                  datasets shared between projects
365projects/index.html, app.js     the gallery
data/challenge.tsv                 the full list of 365, in 13 parts
docs/PROJECT_GUIDE.md              the standard every project is built to
scripts/                           data builders, the gallery data generator and the browser smoke test
```

## Tests

```bash
npm test                          # every project's model, with Node's built-in test runner
npm install && node scripts/smoke.mjs   # loads every page in a real browser and uses every control
python -m pytest -q               # checks that the gallery data is complete and current
```

## Data

Bundled datasets are snapshots of open data, each built by a script under `scripts/data/` that records its source:
the World Happiness Report 2026 (Figure 2.1), World Bank World Development Indicators (CC BY 4.0), Wikidata (CC0)
and the Argotario fallacy corpus (CC0). No page makes a network request.

Working on this with Claude Code? Start with [`CLAUDE.md`](CLAUDE.md).
