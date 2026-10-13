"""Build 365projects/37/data.js and 365projects/37/shapes.js for the Housing Affordability Map.

    pip install openpyxl
    python scripts/data/affordability.py [--cache DIR]

Sources (downloaded into --cache, never committed):
  * Office for National Statistics, "House price to workplace-based earnings ratio", released 26 March 2026
    (Open Government Licence v3.0). One workbook:
      Table 5a  median house price by local authority district, year ending September 1997 to 2025
      Table 6a  lower quartile house price, the same areas and years
      Table 5b  median gross annual workplace-based earnings of full-time employees, 1997 to 2025
      Tables 1a, 2a, 1b  the same three measures for England and Wales as a whole
    https://www.ons.gov.uk/peoplepopulationandcommunity/housing/datasets/ratioofhousepricetoworkplacebasedearningslowerquartileandmedian
  * ONS Open Geography Portal, "Local Authority Districts (December 2025) Boundaries UK BUC": boundaries
    generalised to 500 m and clipped to the coastline, in British National Grid metres (Open Government
    Licence v3.0; contains OS data, Crown copyright and database right). Only the districts of England and
    Wales are requested.

Cleaning rules:
  * A cell holding "[x]" (no data available) becomes null. Only the earnings table has any.
  * Every district in the workbook must have a boundary with the same code, and the other way round; the
    script stops if they do not match. Names are the workbook's.
  * Boundaries are snapped to a 200 m grid: x counts east from the western edge of the data, y counts south
    from the northern edge. Points that repeat after snapping are dropped, and so is any ring left with fewer
    than three different points or no area (islets smaller than the grid). Districts that share a border share
    its points, so snapping keeps the borders together.
  * Each district gets a point for its marker and for keyboard movement: the centroid of its largest ring, or,
    where that falls outside the ring, the middle of the widest stretch of the ring on the centroid's row.
"""

from __future__ import annotations

import argparse
import json
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "37"
UA = {"User-Agent": "varad-patel-365projects/1.0 (https://varad-patel.github.io)"}
ONS_URL = ("https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/housing/datasets/"
           "ratioofhousepricetoworkplacebasedearningslowerquartileandmedian/current/aff1ratioofhousepricetoworkplacebasedearnings.xlsx")
GEO_URL = ("https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/"
           "Local_Authority_Districts_DEC_2025_Boundaries_UK_BUC/FeatureServer/0/query?" + urllib.parse.urlencode({
               "where": "LAD25CD LIKE 'E%' OR LAD25CD LIKE 'W%'", "outFields": "LAD25CD,LAD25NM",
               "outSR": "27700", "geometryPrecision": "0", "f": "geojson"}))
YEARS = list(range(1997, 2026))
GRID = 200  # metres
RETRIEVED = "2026-10-11"


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        print("downloading", url[:100])
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=120) as res:
            path.write_bytes(res.read())
    return path


def table(wb, name: str, code_col: int, first_year_col: int) -> dict[str, dict]:
    """One sheet as {code: {"name", "region", "values"}}; the header row must carry the 29 years in order."""
    rows = list(wb[name].iter_rows(values_only=True))
    head = [str(c) if c is not None else "" for c in rows[1]]
    for k, year in enumerate(YEARS):
        if not head[first_year_col + k].endswith(str(year)):
            raise SystemExit(f"sheet {name}: column {first_year_col + k} is {head[first_year_col + k]!r}, expected {year}")
    out = {}
    for r in rows[2:]:
        if not r[code_col]:
            continue
        values = []
        for v in r[first_year_col:first_year_col + len(YEARS)]:
            if isinstance(v, (int, float)):
                values.append(round(v))
            elif v == "[x]":
                values.append(None)
            else:
                raise SystemExit(f"sheet {name}, {r[code_col]}: unexpected cell {v!r}")
        out[str(r[code_col]).strip()] = {"name": str(r[code_col + 1]).strip(), "region": str(r[1]).strip() if code_col == 2 else None, "values": values}
    return out


def ring_area(ring) -> float:
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2


def inside(pt, ring) -> bool:
    x, y = pt
    hit = False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % len(ring)]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def label_point(ring):
    a = ring_area(ring)
    cx = sum((ring[i][0] + ring[(i + 1) % len(ring)][0]) * (ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]) for i in range(len(ring))) / (6 * a)
    cy = sum((ring[i][1] + ring[(i + 1) % len(ring)][1]) * (ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]) for i in range(len(ring))) / (6 * a)
    if inside((cx, cy), ring):
        return [round(cx), round(cy)]
    # The middle of the widest stretch of the ring along the centroid's row.
    y = cy + 0.5 if float(cy).is_integer() else cy
    xs = sorted(x1 + (y - y1) * (x2 - x1) / (y2 - y1) for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]) if (y1 > y) != (y2 > y))
    best = max(zip(xs[0::2], xs[1::2]), key=lambda p: p[1] - p[0])
    return [round((best[0] + best[1]) / 2), round(cy)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path)
    args = ap.parse_args()
    cache = args.cache or Path(tempfile.mkdtemp(prefix="affordability-"))
    cache.mkdir(parents=True, exist_ok=True)

    wb = openpyxl.load_workbook(fetch(ONS_URL, cache / "aff1ratioofhousepricetoworkplacebasedearnings.xlsx"), read_only=True, data_only=True)
    median, lower, earnings = table(wb, "5a", 2, 4), table(wb, "6a", 2, 4), table(wb, "5b", 2, 4)
    nat = {k: table(wb, name, 0, 2)["K04000001"]["values"] for k, name in (("median", "1a"), ("lower", "2a"), ("earnings", "1b"))}
    if not (median.keys() == lower.keys() == earnings.keys()):
        raise SystemExit("the three district tables do not list the same districts")
    if any(v is None for a in list(median.values()) + list(lower.values()) for v in a["values"]) or any(v is None for s in nat.values() for v in s):
        raise SystemExit("a house price or a national figure is missing; the page assumes none is")

    geo = json.loads(fetch(GEO_URL, cache / "lad-dec-2025-buc-ew.geojson").read_text(encoding="utf-8"))
    if geo.get("crs", {}).get("properties", {}).get("name") != "EPSG:27700":
        raise SystemExit("the boundaries are not in British National Grid")
    feats = {f["properties"]["LAD25CD"]: f for f in geo["features"]}
    if feats.keys() != median.keys():
        raise SystemExit(f"districts and boundaries do not match: {sorted(feats.keys() ^ median.keys())}")

    polys = {code: (f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiPolygon" else [f["geometry"]["coordinates"]]) for code, f in feats.items()}
    xs = [p[0] for ps in polys.values() for poly in ps for ring in poly for p in ring]
    ys = [p[1] for ps in polys.values() for poly in ps for ring in poly for p in ring]
    west, north = min(xs), max(ys)
    snap = lambda p: (round((p[0] - west) / GRID), round((north - p[1]) / GRID))

    shapes, points_in, points_out = {}, 0, 0
    for code, ps in polys.items():
        rings = []
        for poly in ps:
            for ring in poly:
                points_in += len(ring)
                pts = []
                for p in map(snap, ring):
                    if not pts or pts[-1] != p:
                        pts.append(p)
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts.pop()
                if len(set(pts)) >= 3 and ring_area(pts) != 0:
                    rings.append(pts)
        if not rings:
            raise SystemExit(f"{code} vanished when snapped to the grid")
        points_out += sum(len(r) for r in rings)
        d = "".join("M%d,%d" % r[0] + "l" + " ".join("%d,%d" % (b[0] - a[0], b[1] - a[1]) for a, b in zip(r, r[1:])) + "z" for r in rings)
        allp = [p for r in rings for p in r]
        shapes[code] = {"d": d, "at": label_point(max(rings, key=lambda r: abs(ring_area(r)))),
                        "box": [min(p[0] for p in allp), min(p[1] for p in allp), max(p[0] for p in allp), max(p[1] for p in allp)]}
    width = max(s["box"][2] for s in shapes.values())
    height = max(s["box"][3] for s in shapes.values())

    regions = []
    for a in median.values():
        if a["region"] not in regions:
            regions.append(a["region"])
    areas = [{"code": code, "name": a["name"], "region": regions.index(a["region"]), "median": a["values"], "lower": lower[code]["values"], "earnings": earnings[code]["values"]}
             for code, a in median.items()]

    OUT.mkdir(parents=True, exist_ok=True)
    head = (f"// GENERATED by scripts/data/affordability.py. Do not edit by hand.\n"
            f"// Source: Office for National Statistics, House price to workplace-based earnings ratio (released 26 March 2026).\n"
            f"// Open Government Licence v3.0. Retrieved {RETRIEVED}.\n"
            f"// median and lower: median and lower quartile price paid for a home, pounds, year ending September of each year.\n"
            f"// earnings: median gross annual earnings of full-time employees working in the area, pounds, April of each year;\n"
            f"// null where the ONS publishes no figure. national holds the same three series for England and Wales.\n")
    data = {"source": "Office for National Statistics, House price to workplace-based earnings ratio, released 26 March 2026",
            "licence": "Open Government Licence v3.0", "retrieved": RETRIEVED, "years": YEARS, "regions": regions, "national": nat}
    lines = [f"  {k}: {json.dumps(v, ensure_ascii=False, separators=(',', ':'))}," for k, v in data.items()]
    lines.append("  areas: [\n" + ",\n".join("    " + json.dumps(a, ensure_ascii=False, separators=(",", ":")) for a in areas) + ",\n  ],")
    (OUT / "data.js").write_text(head + "export const AFFORD = {\n" + "\n".join(lines) + "\n};\n", encoding="utf-8", newline="\n")

    head = (f"// GENERATED by scripts/data/affordability.py. Do not edit by hand.\n"
            f"// Source: Office for National Statistics, Local Authority Districts (December 2025) Boundaries UK BUC, licensed under\n"
            f"// the Open Government Licence v3.0. Contains OS data (c) Crown copyright and database right 2026. Retrieved {RETRIEVED}.\n"
            f"// British National Grid, snapped to a {GRID} m grid: x east from easting {west}, y south from northing {north}.\n"
            f"// d is an SVG path, at the point for the district's marker, box its bounding box [x0, y0, x1, y1].\n")
    meta = {"source": "Office for National Statistics, Local Authority Districts (December 2025) Boundaries UK BUC",
            "licence": "Open Government Licence v3.0", "retrieved": RETRIEVED, "grid": GRID, "west": west, "north": north, "width": width, "height": height}
    lines = [f"  {k}: {json.dumps(v)}," for k, v in meta.items()]
    lines.append("  areas: {\n" + ",\n".join(f'    {json.dumps(code)}: {json.dumps(s, separators=(",", ":"))}' for code, s in shapes.items()) + ",\n  },")
    (OUT / "shapes.js").write_text(head + "export const SHAPES = {\n" + "\n".join(lines) + "\n};\n", encoding="utf-8", newline="\n")

    print(f"wrote data.js ({(OUT / 'data.js').stat().st_size:,} bytes): {len(areas)} districts, {len(YEARS)} years, {len(regions)} regions")
    print(f"wrote shapes.js ({(OUT / 'shapes.js').stat().st_size:,} bytes): {points_in:,} points in, {points_out:,} kept, {width} by {height} grid units")
    print("missing earnings cells:", sum(v is None for a in areas for v in a["earnings"]))


if __name__ == "__main__":
    main()
