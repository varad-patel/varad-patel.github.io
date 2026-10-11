# Independent review of a project page

Every project is reviewed by someone who did not build it, before it is published. The reviewer's job is
to find what is wrong and fix it, not to confirm that it is fine. A page passes only when every item
below has been done and the evidence is written down.

Work from the repository root. `N` is the project number. Edit only files inside `365projects/N/`.
If the shared kit (`365projects/kit/`) or a script is at fault, do not edit it: report it.

## 1. Know what it is supposed to do

Read the project's row in `data/challenge.tsv` and split the "description" into separate claims
("Play the game yourself", "run 100,000 simulated games", "watch the odds converge"). Read
`index.html`, `app.js`, `logic.js` and `logic.test.mjs` in full.

## 2. Use every feature on purpose, in a real browser

The smoke test only proves nothing throws. Write a short Playwright script (import `chromium` from
`playwright-core`, which is installed in the repository; serve the repository root with a static server
on a port of your own, for example `python -m http.server 82NN --bind 127.0.0.1`) and, for each claim
in the row and each control on the page:

* operate it the way a visitor would (type, click, drag a slider to a chosen value, upload a file);
* read the result back from the page's text and check that it is the right result, not merely a result;
* take a screenshot of the state at 1200 px and at 390 px wide and look at it.

Also check: the state on first load; what happens after "reset" or "start again"; that a reload keeps
what the page says it keeps and nothing else; that every example or preset button gives a sensible page.

## 3. Check the numbers independently

For at least three settings, one of them the setting behind "One finding", work out the answer without
using `logic.js` (by hand, from the formula in the write-up, or with a few lines of separate code) and
compare it with what the page displays. Check that the formulas printed in "How it works" are the ones
the code uses. If a test only checks that the code agrees with itself, add one that checks it against
a known result.

## 4. Try to break it

Empty input, zero, negative numbers, absurdly large numbers, text where numbers belong, the extreme ends
of every slider, every combination of mode switches, very long names, a malformed file, clicking things
in the wrong order, clicking quickly many times. The page must never show `NaN`, `undefined`,
`Infinity`, `null`, an empty chart with no explanation, or a broken layout, and must never log a console
error. Anything that takes more than about a second must show that it is working.

## 5. Other browsers

```bash
node scripts/smoke.mjs N --browser all
```

runs the page in Chromium, Firefox and WebKit (Safari's engine) at desktop and phone width and uses every
control once. It must pass in all three. Open `.smoke/0NN-firefox-app.png` and `.smoke/0NN-webkit-app.png`
and compare them with the Chromium ones.

## 6. Accessibility

The same command runs the axe-core audit (WCAG 2.1 A and AA) on load, after use and at phone width; it
must report nothing. Then check by hand, with a script that presses Tab through the page:

* every control inside `#app` can be reached and operated with the keyboard alone, in an order that makes
  sense, and shows a visible focus ring;
* every button, input, select and chart has an accessible name that says what it is;
* anything drawn on a canvas or in SVG has a text equivalent (a label that describes it, plus the same
  information as text or a table somewhere on the page);
* results that change when a control is used are announced (`role="status"` or `aria-live`) where a
  screen-reader user would otherwise miss them, without announcing on every animation frame;
* nothing moves on load for a visitor who has asked for reduced motion.

## 7. Check every fact and every reference against a source

Do not rely on memory, yours or the builder's. For each reference under "Sources" and each factual,
historical or numerical claim in the write-up and in the interface text (who said what, when, in which
publication, what a study found, what a figure was):

* look it up: the publisher's or journal's page, the Crossref API
  (`https://api.crossref.org/works?query.bibliographic=<text>&rows=3`), the Stanford Encyclopedia of
  Philosophy, a library catalogue, the original text where it is online;
* correct anything that is wrong (author names and order, year, title, journal, volume, pages, quotations);
* if a claim cannot be confirmed, remove it or reword it so that it says only what was confirmed;
* never leave a number, date or quotation in place that you could not verify.

Record each item as: the claim, the source you checked it against, and the verdict (correct, corrected
to ..., removed).

## 8. Read the page as a visitor

The first screen says what the page is and what to do. Labels and hints are clear. The five write-up
sections are substantive and accurate, the limits are honest, the "One finding" is reproduced by the
tool and by a test and matches `meta.json`. Plain British English: no hype, no "we", no exclamation
marks, no emoji. Nothing is cut off, overlapping or misaligned at either width.

## 9. Fix, retest, report

Fix everything found. Add a test for every bug in the model. Then:

```bash
node --test 365projects/N/logic.test.mjs
node scripts/smoke.mjs N --browser all
```

Report, for the page: what was exercised; the independent calculations; every defect found and how it
was fixed; the fact-check record from step 7; the accessibility findings; the cross-browser result; and
anything that still falls short, stated exactly. "Nothing found" is an acceptable result only when the
steps above were actually carried out.
