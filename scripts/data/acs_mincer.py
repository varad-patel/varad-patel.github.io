"""Build 365projects/54/data.js: Mincer earnings regressions fitted to the 2024 American Community Survey.

    python scripts/data/acs_mincer.py --cache DIR [--retrieved YYYY-MM-DD]

Only the fitted models and small summary tables are written. No microdata leaves the cache folder.
Standard library only; the run takes a few minutes. It needs `pdftotext` (Xpdf or Poppler) on the PATH
to read one table out of a World Bank PDF.

Sources (downloaded into --cache, never committed)
  1. US Census Bureau, American Community Survey, 2024 1-Year Public Use Microdata Sample, person file for
     the whole United States:
       https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_pus.zip   (575 MB)
     One row per person in the sample (about 3.4 million), with the person weight PWGTP and 80 replicate
     weights PWGTP1 to PWGTP80. Works of the US government are in the public domain.
  2. US Census Bureau, "PUMS estimates for user verification", 2024:
       https://www2.census.gov/programs-surveys/acs/tech_docs/pums/estimates/pums_estimates_24.csv
     Published totals with standard errors, used to check that this script reads the file and the replicate
     weights the way the Bureau does. The script stops if any of the four checks below fails.
  3. Montenegro, C. E., and Patrinos, H. A. (2014). Comparable estimates of returns to schooling around the
     world. World Bank Policy Research Working Paper 7020. Table 3a (page 11 of the paper, page 13 of the PDF):
       https://documents1.worldbank.org/curated/en/830831468147839247/pdf/WPS7020.pdf
     The PDF itself carries no licence statement. The World Bank's Open Knowledge Repository record for the
     paper, https://hdl.handle.net/10986/20340, gives its rights as CC BY 3.0 IGO (checked 12 October 2026).
     These are other people's estimates, from other countries, years and sample rules, and are bundled only
     as a labelled comparison.

Who is in the sample (every rule is applied in this order; the counts are written to the module)
  * AGEP from 25 to 64.
  * COW 1 to 5: employees of a private firm, a non-profit, or local, state or federal government.
    The self-employed (6, 7), unpaid family workers (8) and people with no recent job (9, blank) are left out.
  * WKHP of 35 or more usual hours a week and WKWN of 50 or more weeks worked in the past 12 months: the
    Bureau's own definition of a full-time, year-round worker.
  * WAGP above zero. WAGP is wage and salary income over the past 12 months, rounded and top-coded by the
    Bureau; it is multiplied by ADJINC / 1,000,000 (1.015250) to put it in 2024 dollars.
  * An implied hourly wage, WAGP * ADJINC / (WKHP * WKWN), of at least 3.625 dollars: half the federal
    minimum wage of 7.25 dollars. Lower figures are almost always reporting errors.
  Wages that the Bureau filled in for people who did not answer (FWAGP = 1) are kept, and their share is
  written to the module.

Variables
  * y is the natural logarithm of annual wage and salary income in 2024 dollars.
  * Schooling in years, S, is assigned from SCHL by YEARS below: the survey records the highest level
    completed, not years, so this is a convention (the nominal length of each stage in the United States).
  * Potential experience X = max(0, AGEP - S - 6).
  * Eight levels of education group the 24 SCHL codes: see LEVELS. Six of them hold one number of years each.
    Two mix several ("No high school diploma": 0 to 12 years; "Some college, no degree": 13 or 14), so people
    of one age in them have different experience. For those two the module carries, for each sex and single
    year of age, the weighted means of S, X, X^2, z, z^2, z^3 and z^4 over the whole sample ("mixed"). Because
    both models are linear in these terms, the coefficients times these means are exactly the model's average
    fitted value for the people in that group. Putting the level's average years into the formula instead
    would be out by up to 6% for young people with no diploma.

Method
  * A household is put in the held-out fifth when crc32(SERIALNO) % 5 == 0; everyone else is the training
    sample. Models are fitted on the training sample only, separately for men and women, by weighted least
    squares with PWGTP as the weight.
      "mincer":  y = a + r S + b1 X + b2 X^2                                   (Mincer 1974)
      "levels":  y = a_level + g1 z + g2 z^2 + g3 z^3 + g4 z^4,  z = (X - 20) / 10
  * The covariance matrix of each set of coefficients comes from the replicate weights, by the Bureau's
    successive difference replication formula: V = (4 / 80) * sum over r of (b_r - b)(b_r - b)', where b_r
    is the fit with replicate weight r.
  * Residual quantiles (weighted, of the "levels" model, training sample) are stored for each sex, age band
    (25-34, 35-44, 45-54, 55-64) and level: the 5th, 10th, 25th, 50th, 75th, 90th and 95th percentiles. A
    weighted quantile is the smallest residual at which the running share of weight reaches the percentile.
    To use them at one exact age, the page (and the coverage check below) reads each band's figures as belonging
    to the middle of the band (29.5, 39.5, 49.5, 59.5) and interpolates in a straight line between neighbouring
    bands; below 29.5 and above 59.5 the first and last bands are used as they are. Without this the range for
    one person would jump at 35, 45 and 55.
  * Out-of-sample error is measured on the held-out fifth: weighted root mean squared error and mean absolute
    error of y, R squared against the training mean, and the share of held-out people who fall inside the
    10th-to-90th and 25th-to-75th residual ranges.
  * Descriptive tables use the whole sample (training and held-out together): the weighted mean of y for
    each sex, level and single year of age, and a weighted histogram of y in bins of 0.05 for each sex, age
    band and level.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import io
import json
import math
import re
import subprocess
import sys
import urllib.request
import zipfile
import zlib
from operator import add
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "54" / "data.js"
UA = {"User-Agent": "varad-patel-365projects/1.0 (https://varad-patel.github.io)"}
YEAR = 2024
PUMS_URL = f"https://www2.census.gov/programs-surveys/acs/data/pums/{YEAR}/1-Year/csv_pus.zip"
PUMS_FILE = f"acs_pums_{YEAR}_1yr_csv_pus.zip"
CHECK_URL = "https://www2.census.gov/programs-surveys/acs/tech_docs/pums/estimates/pums_estimates_24.csv"
CHECK_FILE = "pums_estimates_24.csv"
WPS_URL = "https://documents1.worldbank.org/curated/en/830831468147839247/pdf/WPS7020.pdf"
WPS_FILE = "worldbank_wps7020.pdf"
WPS_RECORD = "https://hdl.handle.net/10986/20340"  # the Open Knowledge Repository record, which states the licence
WPS_PAGE = 13

# Years of schooling assigned to each SCHL code (index 1 to 24).
YEARS = [None, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 12, 13, 14, 14, 16, 18, 19, 20]
LEVELS = [
    ("none", "No high school diploma", range(1, 16)),
    ("hs", "High school diploma or equivalent", (16, 17)),
    ("some", "Some college, no degree", (18, 19)),
    ("assoc", "Associate's degree", (20,)),
    ("bach", "Bachelor's degree", (21,)),
    ("mast", "Master's degree", (22,)),
    ("prof", "Professional degree", (23,)),
    ("doct", "Doctorate", (24,)),
]
LEVEL_OF = {code: i for i, (_, _, codes) in enumerate(LEVELS) for code in codes}
# Levels whose SCHL codes are assigned more than one number of years.
MIXED = [i for i, (_, _, codes) in enumerate(LEVELS) if len({YEARS[c] for c in codes}) > 1]
AGE_LO, AGE_HI = 25, 64
BANDS = [(25, 34), (35, 44), (45, 54), (55, 64)]
PROBS = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]
HOURLY_FLOOR = 3.625
HIST_LO, HIST_STEP, HIST_BINS = 8.7, 0.05, 104
MIN_CELL = 100  # a mean for one year of age is published only if at least this many people are behind it
EXP_CENTRE, EXP_SCALE = 20, 10
REPS = 80


def download(url: str, path: Path) -> None:
    if path.exists():
        return
    print(f"downloading {url}", file=sys.stderr)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(path, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)


def band_of(age: int) -> int:
    return min(3, (age - 25) // 10)


MIDS = [(lo + hi) / 2 for lo, hi in BANDS]


def blend(age: float) -> list[tuple[int, float]]:
    """The age bands whose figures apply at an exact age, with their weights (see the docstring)."""
    if age <= MIDS[0]:
        return [(0, 1.0)]
    if age >= MIDS[-1]:
        return [(len(MIDS) - 1, 1.0)]
    b = max(i for i in range(len(MIDS) - 1) if MIDS[i] <= age)
    t = (age - MIDS[b]) / (MIDS[b + 1] - MIDS[b])
    return [(b, 1 - t), (b + 1, t)]


def solve(A: list[list[float]], b: list[float]) -> list[float]:
    """Solve A x = b by Gaussian elimination with partial pivoting."""
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-12:
            raise ValueError("singular normal equations")
        M[c], M[p] = M[p], M[c]
        for r in range(c + 1, n):
            f = M[r][c] / M[c][c]
            if f:
                for k in range(c, n + 1):
                    M[r][k] -= f * M[c][k]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (M[i][n] - sum(M[i][k] * x[k] for k in range(i + 1, n))) / M[i][i]
    return x


def x_mincer(S: float, age: int) -> list[float]:
    X = max(0.0, age - S - 6)
    return [1.0, S, X, X * X]


def x_levels(level: int, S: float, age: int) -> list[float]:
    z = (max(0.0, age - S - 6) - EXP_CENTRE) / EXP_SCALE
    return [1.0 if k == level else 0.0 for k in range(len(LEVELS))] + [z, z * z, z ** 3, z ** 4]


def fit(cells: dict, design) -> tuple[list[float], list[list[float]]]:
    """Weighted least squares from cell sums, once with the person weight and once with each replicate weight.

    cells maps a key to [sum of w_r, sum of w_r * y] (two lists of 81). design(key) is the row of regressors.
    Returns the coefficients and their successive-difference-replication covariance matrix.
    """
    rows = [(design(key), sw, swy) for key, (sw, swy) in cells.items()]
    p = len(rows[0][0])
    # Columns are rescaled to unit size before solving, so the normal equations are well conditioned.
    scale = [max(abs(x[j]) for x, _, _ in rows) or 1.0 for j in range(p)]
    betas = []
    for r in range(REPS + 1):
        A = [[0.0] * p for _ in range(p)]
        b = [0.0] * p
        for x, sw, swy in rows:
            w, wy = sw[r], swy[r]
            if w == 0 and wy == 0:
                continue
            xs = [x[j] / scale[j] for j in range(p)]
            for i in range(p):
                if xs[i] == 0:
                    continue
                b[i] += xs[i] * wy
                wi = w * xs[i]
                Ai = A[i]
                for j in range(i, p):
                    Ai[j] += wi * xs[j]
        for i in range(p):
            for j in range(i):
                A[i][j] = A[j][i]
        betas.append([v / scale[j] for j, v in enumerate(solve(A, b))])
    beta = betas[0]
    V = [[4 / REPS * sum((betas[r][i] - beta[i]) * (betas[r][j] - beta[j]) for r in range(1, REPS + 1)) for j in range(p)] for i in range(p)]
    return beta, V


def weighted_quantiles(pairs: list[tuple[float, float]], probs: list[float]) -> list[float]:
    """pairs is [(value, weight)]. The smallest value at which the running share of weight reaches each prob."""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    out, run, k = [], 0.0, 0
    for i, (v, w) in enumerate(pairs):
        run += w
        while k < len(probs) and run >= probs[k] * total - 1e-9:
            out.append(v)
            k += 1
    while len(out) < len(probs):
        out.append(pairs[-1][0])
    return out


def table_3a(pdf: Path) -> list[dict]:
    """Region averages from Table 3a of Montenegro and Patrinos (2014), read out of the PDF's own text."""
    text = subprocess.run(["pdftotext", "-raw", "-f", str(WPS_PAGE), "-l", str(WPS_PAGE), str(pdf), "-"], capture_output=True, check=True).stdout.decode("utf-8", "replace")
    start = text.index("Table 3a. Average Returns to Schooling")
    body = " ".join(text[start:].split())
    names = ["High Income economies", "East Asia & Pacific", "Europe & Central Asia", "Latin America & Caribbean", "Middle East & North Africa", "South Asia", "Sub-Saharan Africa", "All economies"]
    num = r"(\d+\.\d)"
    rows = []
    for name in names:
        m = re.search(re.escape(name) + rf" {num} {num} {num} {num} {num} {num} (\d+)\b", body)
        if not m:
            raise ValueError(f"Table 3a: no row for {name!r}")
        v = [float(g) for g in m.groups()[:6]]
        rows.append({"region": name.replace("&", "and").replace("High Income", "High-income"), "total": v[0], "men": v[1], "women": v[2], "economies": int(m.group(7))})
    if (rows[-1]["total"], rows[-1]["men"], rows[-1]["women"], rows[-1]["economies"]) != (9.7, 9.1, 11.4, 139):
        raise ValueError("Table 3a: the 'All economies' row is not the one printed in the paper")
    return rows


def published_checks(path: Path) -> dict:
    want = {"Total population": "total", "Total females (SEX=2)": "females", "Age 25-34": "age2534", "Age 35-44": "age3544"}
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row["STATE"] == "US" and row["CHARACTERISTIC"] in want:
                out[want[row["CHARACTERISTIC"]]] = {"estimate": int(row["PUMS_EST_24"]), "se": int(row["PUMS_SE_24"])}
    if len(out) != len(want):
        raise ValueError("the verification file lacks one of the national rows")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", required=True, help="folder for the downloads (575 MB)")
    ap.add_argument("--retrieved", default=datetime.date.today().isoformat())
    args = ap.parse_args()
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    for url, name in ((PUMS_URL, PUMS_FILE), (CHECK_URL, CHECK_FILE), (WPS_URL, WPS_FILE)):
        download(url, cache / name)

    other = table_3a(cache / WPS_FILE)
    published = published_checks(cache / CHECK_FILE)

    # ---- one pass over the person file ----
    steps = {"persons": 0, "aged": 0, "employees": 0, "fullTime": 0, "paid": 0, "kept": 0}
    verify = {"total": [0] * (REPS + 1), "females": [0] * (REPS + 1), "age2534": [0] * (REPS + 1), "age3544": [0] * (REPS + 1)}
    train_cells: dict = {}        # (sex, schl, age) -> [sum w_r, sum w_r y]
    rec_sex, rec_schl, rec_age, rec_y, rec_w, rec_test = [], [], [], [], [], []
    allocated_w = 0.0
    with zipfile.ZipFile(cache / PUMS_FILE) as z:
        for name in sorted(n for n in z.namelist() if n.lower().endswith(".csv")):
            print(f"reading {name}", file=sys.stderr)
            with z.open(name) as raw:
                rd = csv.reader(io.TextIOWrapper(raw, encoding="utf-8", newline=""))
                head = next(rd)
                col = {c: head.index(c) for c in ("SERIALNO", "ADJINC", "PWGTP", "AGEP", "COW", "SCHL", "SEX", "WAGP", "WKHP", "WKWN", "FWAGP")}
                r0 = head.index("PWGTP1")
                if head[r0:r0 + REPS] != [f"PWGTP{i}" for i in range(1, REPS + 1)]:
                    raise ValueError("replicate weights are not where they are expected")
                iS, iADJ, iW, iA, iC, iE, iX, iWAG, iH, iWK, iF = (col[c] for c in ("SERIALNO", "ADJINC", "PWGTP", "AGEP", "COW", "SCHL", "SEX", "WAGP", "WKHP", "WKWN", "FWAGP"))
                for row in rd:
                    steps["persons"] += 1
                    age = int(row[iA])
                    female = row[iX] == "2"
                    wts = [int(row[iW])] + [int(v) for v in row[r0:r0 + REPS]]
                    verify["total"] = list(map(add, verify["total"], wts))
                    if female:
                        verify["females"] = list(map(add, verify["females"], wts))
                    if 25 <= age <= 34:
                        verify["age2534"] = list(map(add, verify["age2534"], wts))
                    elif 35 <= age <= 44:
                        verify["age3544"] = list(map(add, verify["age3544"], wts))
                    if not AGE_LO <= age <= AGE_HI:
                        continue
                    steps["aged"] += 1
                    if row[iC] not in ("1", "2", "3", "4", "5"):
                        continue
                    steps["employees"] += 1
                    if not row[iH] or not row[iWK]:
                        continue
                    hours, weeks = int(row[iH]), int(row[iWK])
                    if hours < 35 or weeks < 50:
                        continue
                    steps["fullTime"] += 1
                    wage = int(row[iWAG] or 0) * int(row[iADJ]) / 1e6
                    if wage <= 0:
                        continue
                    steps["paid"] += 1
                    if wage / (hours * weeks) < HOURLY_FLOOR:
                        continue
                    steps["kept"] += 1
                    schl = int(row[iE])
                    y = math.log(wage)
                    test = zlib.crc32(row[iS].encode()) % 5 == 0
                    sex = 1 if female else 0
                    rec_sex.append(sex); rec_schl.append(schl); rec_age.append(age); rec_y.append(y); rec_w.append(wts[0]); rec_test.append(test)
                    if row[iF] == "1":
                        allocated_w += wts[0]
                    if not test:
                        cell = train_cells.get((sex, schl, age))
                        if cell is None:
                            cell = train_cells[(sex, schl, age)] = [[0] * (REPS + 1), [0.0] * (REPS + 1)]
                        cell[0] = list(map(add, cell[0], wts))
                        cell[1] = [a + y * b for a, b in zip(cell[1], wts)]
    n = len(rec_y)
    print(json.dumps(steps), file=sys.stderr)

    # ---- the reading is checked against the Bureau's own published totals and standard errors ----
    checks = {}
    for key, sums in verify.items():
        est = sums[0]
        se = math.sqrt(4 / REPS * sum((v - est) ** 2 for v in sums[1:]))
        pub = published[key]
        # The Bureau rounds its weights before publishing these totals: allow 5 people and 1 on the standard error.
        if abs(est - pub["estimate"]) > 5 or abs(se - pub["se"]) > 1.5:
            raise ValueError(f"check failed for {key}: computed {est} (se {se:.1f}), published {pub}")
        checks[key] = {"estimate": est, "se": round(se), "published": pub["estimate"], "publishedSe": pub["se"]}
    print("checks", json.dumps(checks), file=sys.stderr)

    # ---- fits, on the training sample ----
    models = {"mincer": {}, "levels": {}}
    by_sex = [{k: v for k, v in train_cells.items() if k[0] == s} for s in (0, 1)]
    for s, name in enumerate(("men", "women")):
        beta, V = fit(by_sex[s], lambda key: x_mincer(YEARS[key[1]], key[2]))
        models["mincer"][name] = {"beta": beta, "cov": V}
        beta, V = fit(by_sex[s], lambda key: x_levels(LEVEL_OF[key[1]], YEARS[key[1]], key[2]))
        models["levels"][name] = {"beta": beta, "cov": V}
    sexes = ("men", "women")
    dot = lambda a, b: sum(x * y for x, y in zip(a, b))
    pred_cache: dict = {}

    def predict(model: str, sex: int, schl: int, age: int) -> float:
        key = (model, sex, schl, age)
        if key not in pred_cache:
            x = x_mincer(YEARS[schl], age) if model == "mincer" else x_levels(LEVEL_OF[schl], YEARS[schl], age)
            pred_cache[key] = dot(x, models[model][sexes[sex]]["beta"])
        return pred_cache[key]

    # Training summaries: the overall mean, the mean by sex, the saturated cell means, mean years by level.
    tw = [0.0, 0.0]; twy = [0.0, 0.0]
    sat: dict = {}
    years_w = [0.0] * len(LEVELS); years_ws = [0.0] * len(LEVELS)
    level_n = [0] * len(LEVELS); level_w = [0.0] * len(LEVELS)
    resid_groups: dict = {}
    for i in range(n):
        s, c, a, y, w = rec_sex[i], rec_schl[i], rec_age[i], rec_y[i], rec_w[i]
        L = LEVEL_OF[c]
        level_n[L] += 1; level_w[L] += w
        if rec_test[i]:
            continue
        tw[s] += w; twy[s] += w * y
        cell = sat.setdefault((s, L, a), [0.0, 0.0]); cell[0] += w; cell[1] += w * y
        years_w[L] += w; years_ws[L] += w * YEARS[c]
        resid_groups.setdefault((s, band_of(a), L), []).append((y - predict("levels", s, c, a), w))
    mean_all = (twy[0] + twy[1]) / (tw[0] + tw[1])
    mean_sex = [twy[0] / tw[0], twy[1] / tw[1]]
    level_years = [years_ws[L] / years_w[L] for L in range(len(LEVELS))]

    quantiles = [[[None] * len(LEVELS) for _ in BANDS] for _ in sexes]
    smear = [[[None] * len(LEVELS) for _ in BANDS] for _ in sexes]
    group_n = [[[0] * len(LEVELS) for _ in BANDS] for _ in sexes]
    for (s, b, L), pairs in resid_groups.items():
        quantiles[s][b][L] = [round(q, 4) for q in weighted_quantiles(pairs, PROBS)]
        smear[s][b][L] = round(sum(w * math.exp(e) for e, w in pairs) / sum(w for _, w in pairs), 4)
        group_n[s][b][L] = len(pairs)

    # ---- out-of-sample error on the held-out fifth ----
    rules = ["mean", "sex", "mincer", "levels", "cells"]
    acc = {r: {"se": 0.0, "ae": 0.0} for r in rules}
    W = 0.0; tss = 0.0
    inside80 = inside50 = 0.0
    n_test = 0
    for i in range(n):
        if not rec_test[i]:
            continue
        n_test += 1
        s, c, a, y, w = rec_sex[i], rec_schl[i], rec_age[i], rec_y[i], rec_w[i]
        L = LEVEL_OF[c]
        cell = sat.get((s, L, a))
        guess = {
            "mean": mean_all, "sex": mean_sex[s], "mincer": predict("mincer", s, c, a), "levels": predict("levels", s, c, a),
            "cells": cell[1] / cell[0] if cell and cell[0] > 0 else predict("levels", s, c, a),
        }
        for r in rules:
            e = y - guess[r]
            acc[r]["se"] += w * e * e
            acc[r]["ae"] += w * abs(e)
        W += w
        q = [sum(wt * quantiles[s][b][L][i] for b, wt in blend(a)) for i in range(len(PROBS))]
        e = y - guess["levels"]
        if q[1] <= e <= q[5]:
            inside80 += w
        if q[2] <= e <= q[4]:
            inside50 += w
    tss = acc["mean"]["se"]
    out_of_sample = [{"rule": r, "rmse": round(math.sqrt(acc[r]["se"] / W), 4), "mae": round(acc[r]["ae"] / W, 4), "r2": round(1 - acc[r]["se"] / tss, 4)} for r in rules]

    # In-sample fit of the two models, for comparison with the held-out figures.
    in_se = {"mincer": 0.0, "levels": 0.0}; in_tss = 0.0; in_w = 0.0
    for i in range(n):
        if rec_test[i]:
            continue
        s, c, a, y, w = rec_sex[i], rec_schl[i], rec_age[i], rec_y[i], rec_w[i]
        for m in in_se:
            in_se[m] += w * (y - predict(m, s, c, a)) ** 2
        in_tss += w * (y - mean_all) ** 2; in_w += w
    in_sample = {m: {"rmse": round(math.sqrt(v / in_w), 4), "r2": round(1 - v / in_tss, 4)} for m, v in in_se.items()}

    # ---- descriptive tables, whole sample ----
    cell_w: dict = {}; hist: dict = {}
    mom: dict = {}  # (sex, mixed level, age) -> [sum w, sum w S, w X, w X^2, w z, w z^2, w z^3, w z^4]
    for i in range(n):
        s, c, a, y, w = rec_sex[i], rec_schl[i], rec_age[i], rec_y[i], rec_w[i]
        L = LEVEL_OF[c]
        if L in MIXED:
            S = YEARS[c]
            X = max(0.0, a - S - 6)
            z = (X - EXP_CENTRE) / EXP_SCALE
            acc_m = mom.setdefault((s, L, a), [0.0] * 8)
            for k, v in enumerate((1.0, S, X, X * X, z, z * z, z ** 3, z ** 4)):
                acc_m[k] += w * v
        cell = cell_w.setdefault((s, L, a), [0.0, 0.0, 0]); cell[0] += w; cell[1] += w * y; cell[2] += 1
        h = hist.setdefault((s, band_of(a), L), [0.0] * HIST_BINS)
        h[min(HIST_BINS - 1, max(0, int((y - HIST_LO) / HIST_STEP)))] += w
    ages = list(range(AGE_LO, AGE_HI + 1))
    cell_means = [[[(round(cell_w[(s, L, a)][1] / cell_w[(s, L, a)][0], 3) if (s, L, a) in cell_w and cell_w[(s, L, a)][2] >= MIN_CELL else None) for a in ages] for L in range(len(LEVELS))] for s in (0, 1)]
    hists = [[[None] * len(LEVELS) for _ in BANDS] for _ in sexes]
    hist_n = [[[0] * len(LEVELS) for _ in BANDS] for _ in sexes]
    for (s, b, L), h in hist.items():
        total = sum(h)
        hists[s][b][L] = [round(v / total * 100000) for v in h]  # shares per 100,000
    for i in range(n):
        hist_n[rec_sex[i]][band_of(rec_age[i])][LEVEL_OF[rec_schl[i]]] += 1
    for s in (0, 1):
        for L in MIXED:
            for a in ages:
                if (s, L, a) not in cell_w or cell_w[(s, L, a)][2] < MIN_CELL:
                    raise ValueError(f"fewer than {MIN_CELL} people of sex {s} and age {a} in mixed level {L}: its mean regressors would be unreliable")
    mixed = [[[[round(v / mom[(s, L, a)][0], 6) for v in mom[(s, L, a)][1:]] for a in ages] for L in MIXED] for s in (0, 1)]

    total_w = sum(rec_w)
    data = {
        "year": YEAR,
        "dollars": YEAR,
        "country": "United States",
        "source": "US Census Bureau, American Community Survey, 2024 1-Year Public Use Microdata Sample (person file, United States)",
        "url": PUMS_URL,
        "licence": "Public domain (a work of the US government)",
        "retrieved": args.retrieved,
        "sample": {
            "steps": steps,
            "people": n,
            "represents": round(total_w),
            "train": n - n_test,
            "test": n_test,
            "allocatedShare": round(allocated_w / total_w, 4),
            "hourlyFloor": HOURLY_FLOOR,
        },
        "checks": checks,
        "ages": [AGE_LO, AGE_HI],
        "bands": BANDS,
        "bandMids": MIDS,
        "levels": [{"key": k, "label": label, "years": round(level_years[L], 2), "people": level_n[L], "share": round(level_w[L] / total_w, 4)} for L, (k, label, _) in enumerate(LEVELS)],
        "yearsBySchl": YEARS[1:],
        "mixed": {"levels": MIXED, "terms": ["S", "X", "X2", "z", "z2", "z3", "z4"], "means": mixed},
        "expCentre": EXP_CENTRE,
        "expScale": EXP_SCALE,
        "models": models,
        "meanLog": {"all": round(mean_all, 4), "men": round(mean_sex[0], 4), "women": round(mean_sex[1], 4)},
        "probs": PROBS,
        "residualQuantiles": quantiles,
        "smear": smear,
        "groupPeople": group_n,
        "outOfSample": out_of_sample,
        "inSample": in_sample,
        "coverage": {"p10p90": round(inside80 / W, 4), "p25p75": round(inside50 / W, 4)},
        "cellMeans": cell_means,
        "minCell": MIN_CELL,
        "hist": {"lo": HIST_LO, "step": HIST_STEP, "bins": HIST_BINS, "shares": hists, "people": hist_n},
        "other": {
            "source": "Montenegro and Patrinos (2014), World Bank Policy Research Working Paper 7020, Table 3a, page 11",
            "url": WPS_URL,
            "record": WPS_RECORD,
            "licence": "CC BY 3.0 IGO",
            "note": "Average return to another year of schooling, in per cent, from the latest survey for each economy; wage employees; log earnings on years of schooling, potential experience and its square.",
            "rows": other,
        },
    }
    head = (
        "// GENERATED by scripts/data/acs_mincer.py. Do not edit by hand.\n"
        f"// Source: {data['source']}.\n"
        f"//   {PUMS_URL}\n"
        f"// Licence: public domain (a work of the US government). Retrieved {args.retrieved}.\n"
        "// Only fitted coefficients and summary tables are here: no person's record is in this file.\n"
        "// The comparison table under `other` is from Montenegro and Patrinos (2014), World Bank WPS 7020, Table 3a\n"
        f"//   (CC BY 3.0 IGO, as stated on its repository record, {WPS_RECORD}).\n"
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(head + "export const MINCER = " + json.dumps(data, separators=(",", ":")) + ";\n", encoding="utf-8", newline="\n")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB), {n} people, {n_test} held out", file=sys.stderr)


if __name__ == "__main__":
    main()
