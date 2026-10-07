# Personal site

A small static site: a home page and a gallery for the **365 projects in 365 days** challenge. There is no
build step and no framework. Open `365projects/index.html` in a browser to preview it, or run
`python -m http.server` in this folder and visit http://localhost:8000.

```
index.html                         home page (edit the text freely)
365projects/index.html             the gallery: year calendar, filters, project cards, coming-up list
365projects/app.js                 gallery logic (plain JavaScript)
365projects/challenge-data.js      generated data file, do not edit by hand
365projects/img/NNN.jpg            one screenshot per built project
assets/                            stylesheet and self-hosted fonts (Literata and Hanken Grotesk, SIL OFL)
data/challenge.tsv                 the full list of 365 projects
data/sections.json                 the eight sections and their day ranges
data/site.json                     start date, code repository, branch
data/built.json                    generated from the projects repo
scripts/                           import, build and screenshot helpers
```

## Publish it

The home page is `index.html` at the root and the gallery is the `365projects/` folder, so the site is laid out as
`https://<host>/` and `https://<host>/365projects/`.

GitHub Pages serves a repository named exactly `<account>.github.io` at `https://<account>.github.io/`, where
`<account>` is a GitHub user or organization. To publish:

1. Create a public repository named `<account>.github.io` and push this site to its `main` branch.
2. In that repository open **Settings, Pages, Build and deployment, Deploy from a branch**, choose `main` and
   `/ (root)`, and save. The site is live within a minute or two.

The account name has to be free on GitHub, so a short name such as `varad` is usually already taken. A free
organization works as well as a personal account, and it can be created without touching your own account.
A custom domain (for example `varadpatel.dev`) can be pointed at the same repository under Settings, Pages,
Custom domain, and the layout stays the same. All paths in the site are relative, so it also works under a
sub-path, such as a repository that is not named `<account>.github.io`, without any change.

If the projects repository moves, change `repo` in `data/site.json` and run `python scripts/build_data.py` so the
"View code" links follow it.

## Add a project

After a new project is committed in the projects repo (say #16):

```bash
python scripts/import_projects.py --repo ../365-projects   # refresh data/built.json from READMEs and git history
python scripts/shoot.py --repo ../365-projects 016         # screenshot the app into 365projects/img/016.jpg
python scripts/build_data.py                               # regenerate 365projects/challenge-data.js
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
