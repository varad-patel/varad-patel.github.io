# Personal site

A small static site: a home page and a gallery for the **365 projects in 365 days** challenge. There is no
build step and no framework. Open `365/index.html` in a browser to preview it, or run
`python -m http.server` in this folder and visit http://localhost:8000.

```
index.html                 home page (edit the text freely)
365/index.html             the gallery: year calendar, filters, project cards, coming-up list
365/app.js                 gallery logic (plain JavaScript)
365/challenge-data.js      generated data file, do not edit by hand
365/img/NNN.jpg            one screenshot per built project
assets/                    stylesheet and self-hosted fonts (Literata and Hanken Grotesk, SIL OFL)
data/challenge.tsv         the full list of 365 projects
data/sections.json         the eight sections and their day ranges
data/site.json             start date, code repository, branch
data/built.json            generated from the projects repo
scripts/                   import, build and screenshot helpers
```

## Publish it

GitHub Pages serves a repository named `<account>.github.io` at `https://<account>.github.io/`. For the address
`https://days365projects.github.io/`:

1. Create a free GitHub organization named `days365projects` (github.com/organizations/plan). The name was
   unregistered when this was written (github.com/days365projects returned 404).
2. In it, create a public repository named exactly `days365projects.github.io` and push this site to its `main` branch.
3. In that repository open **Settings, Pages, Build and deployment, Deploy from a branch**, choose `main` and
   `/ (root)`, and save. The site is live within a minute or two.

The same site also works from your own account without a new organization: a repository named
`NotNeverMe.github.io` is served at `https://notneverme.github.io/`, and any other repository is served under a
sub-path such as `https://notneverme.github.io/<repo-name>/`. All paths in the site are relative, so every
variant works unchanged, and so does a custom domain.

If the projects repository moves, change `repo` in `data/site.json` and run `python scripts/build_data.py` so the
"View code" links follow it.

## Add a project

After a new project is committed in the projects repo (say #16):

```bash
python scripts/import_projects.py --repo ../365-projects   # refresh data/built.json from READMEs and git history
python scripts/shoot.py --repo ../365-projects 016         # screenshot the app into 365/img/016.jpg
python scripts/build_data.py                               # regenerate 365/challenge-data.js
pytest                                                     # checks the data and that the generated file is current
git add -A && git commit -m "Add project 16" && git push
```

`import_projects.py` takes the question, first limit, data sources and build date from the project's own
README and git log, and the one-line finding from the projects repo's top-level README table, so the gallery
repeats what the projects say. A project is only published once its folder has a README and a commit.
`shoot.py` needs `pip install playwright pillow` plus the projects repo's dependencies.

## Dates

Day 1 is the `start` date in `data/site.json` and every later project is one day after the previous one, so
each project has a scheduled date. The detail view also shows when it was actually built. Projects 1 to 15
were built ahead of schedule on 7 October 2026. To move the whole calendar, change `start` and run
`python scripts/build_data.py`.

## Credits

Fonts are Literata and Hanken Grotesk under the SIL Open Font License (copies in `assets/fonts/`). Code was
written with help from Claude (Anthropic); commits carry a co-author trailer.
