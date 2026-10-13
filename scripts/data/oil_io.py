"""Build 365projects/41/data.js: a 21-sector input-output table of the United States for 2023.

    pip install openpyxl
    python scripts/data/oil_io.py [--cache DIR]

Source (downloaded into --cache, never committed):
  U.S. Bureau of Economic Analysis, Input-Output Accounts, summary level (71 industries, 73 commodities),
  annual tables for 1997 to 2023 as published in BEA's static archives. Files dated September 2024.
    https://apps.bea.gov/industry/iTables%20Static%20Files/AllTablesIO.zip
      IOMake_After_Redefinitions_PRO_1997-2023_Summary.xlsx   (the make table: industries by commodities)
      IOUse_After_Redefinitions_PRO_1997-2023_Summary.xlsx    (the use table, producers' prices)
    https://apps.bea.gov/industry/iTables%20Static%20Files/AllTablesSUP.zip
      IxI_TR_1997-2023_Summary.xlsx                           (BEA's own total requirements, used only as a check)
  Public domain: "Unless stated otherwise, the information posted on this web site is in the public domain"
  (https://www.bea.gov/help/faq/147). All values are millions of US dollars for 2023.

What the script does:
  1. Reads the 2023 sheets. BEA prints "..." for a zero; it is read as 0.
  2. Turns the two rectangular tables into one square industry-by-industry table the way BEA does for its
     published requirements tables. With V the make table (industry by commodity), q commodity output,
     U the intermediate part of the use table (commodity by industry) and g industry output:
         D = V / q   (market shares: the share of each commodity made by each industry, columns sum to 1)
         Z = D U     (flows from industry to industry)
     Imports are not separated: an imported input is valued like the same good made at home.
  3. Checks the procedure against the source. With all 73 commodity rows shared out by D, including the two
     that no industry produces to order ("Used": scrap and second-hand goods; "Other": noncomparable
     imports), (I - Z / g)^-1 at the 71-industry level must agree with BEA's published industry-by-industry
     total requirements table to within 0.0001 in every cell.
  4. Builds the table the page uses from the 71 produced commodities only. The "Used" and "Other" rows are
     left out of the flows and written separately as `outside`: inputs from outside the table, whose prices
     the page holds fixed like value added. Shared out by D they would be credited to whichever industries
     happen to make a little scrap or, for noncomparable imports, wholly to federal non-defence government
     (the only entry in that column of the make table), so that 92% of what airlines "bought from
     government" was really their spending abroad. The same D spreads household consumption (column F010)
     of the 71 produced commodities over the industries that make them; household spending in the "Used"
     and "Other" rows is left out of the basket.
  5. Adds the 71 industries up into the 21 sectors listed in SECTORS (flows, output, value added, outside
     inputs and household consumption are all simple sums) and writes them as whole millions of dollars.
  6. Also writes, for each sector, what the use table itself records it buying of the commodity "oil and
     gas extraction" (`oilGasCommodity`). This differs from the sector's purchases from the oil and gas
     industry in the square table, because that industry also makes 43,242 of what BEA classes as petroleum
     and coal products, and D credits it with that share (5.6%) of every buyer's petroleum products.
  7. Works out one figure at full detail for the page's note on aggregation: the rise in the price of the
     household basket per unit rise in the price of oil and gas extraction, with 71 industries.

Cleaning rules: none beyond the above. No value is edited, filled in or dropped.
"""

from __future__ import annotations

import argparse
import json
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "365projects" / "41" / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; varad-patel-365projects/1.0; +https://varad-patel.github.io)"}
BASE = "https://apps.bea.gov/industry/iTables%20Static%20Files/"
YEAR = "2023"
MAKE = ("AllTablesIO.zip", "IOMake_After_Redefinitions_PRO_1997-2023_Summary.xlsx")
USE = ("AllTablesIO.zip", "IOUse_After_Redefinitions_PRO_1997-2023_Summary.xlsx")
TOTAL = ("AllTablesSUP.zip", "IxI_TR_1997-2023_Summary.xlsx")
RETRIEVED = "2026-10-11"

# id, name shown on the page, BEA summary industry codes, a note on what is inside.
SECTORS = [
    ("oil", "Oil and gas extraction", ["211"], "Crude oil and natural gas at the wellhead. BEA has one industry for both."),
    ("petroleum", "Petroleum and coal products", ["324"], "Refineries: petrol, diesel, jet fuel, asphalt, lubricants."),
    ("mining", "Other mining and mining support", ["212", "213"], "Coal, ores, stone, and drilling services."),
    ("utilities", "Utilities", ["22"], "Privately owned electricity, gas distribution and water."),
    ("farms", "Farming, forestry and fishing", ["111CA", "113FF"], ""),
    ("construction", "Construction", ["23"], ""),
    ("food", "Food, drink and tobacco", ["311FT"], ""),
    ("chemicals", "Chemicals", ["325"], "Includes fertiliser, plastics resins and pharmaceuticals."),
    ("plastics", "Plastics and rubber", ["326"], ""),
    ("metals", "Metals and mineral products", ["327", "331", "332"], "Cement, glass, steel, aluminium and fabricated metal."),
    ("machinery", "Machinery, electronics and vehicles", ["333", "334", "335", "3361MV", "3364OT"], ""),
    ("othergoods", "Wood, paper, textiles and other goods", ["321", "337", "339", "313TT", "315AL", "322", "323"], ""),
    ("trade", "Wholesale and retail trade", ["42", "441", "445", "452", "4A0"], ""),
    ("air", "Air transport", ["481"], ""),
    ("transport", "Road, rail, water and other transport", ["482", "483", "484", "485", "486", "487OS", "493"], "Includes pipelines and warehousing."),
    ("information", "Information and telecoms", ["511", "512", "513", "514"], ""),
    ("finance", "Finance, insurance and property", ["521CI", "523", "524", "525", "HS", "ORE", "532RL"], "Includes housing, with the rent owner-occupiers are counted as paying themselves."),
    ("business", "Professional and business services", ["5411", "5415", "5412OP", "55", "561", "562"], ""),
    ("edhealth", "Education and health", ["61", "621", "622", "623", "624"], "Privately provided; public schools and hospitals are in government."),
    ("leisure", "Leisure, hospitality and other services", ["711AS", "713", "721", "722", "81"], ""),
    ("government", "Government", ["GFGD", "GFGN", "GFE", "GSLG", "GSLE"], "Includes publicly owned utilities, transit and the postal service."),
]


def fetch(name: str, cache: Path) -> Path:
    path = cache / name
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(BASE + name, headers=UA), timeout=300) as r:
            path.write_bytes(r.read())
    return path


def sheet(cache: Path, source: tuple[str, str]):
    import openpyxl

    archive, member = source
    with zipfile.ZipFile(fetch(archive, cache)) as z, z.open(member) as f:
        book = openpyxl.load_workbook(f, read_only=True, data_only=True)
        return [list(r) for r in book[YEAR].iter_rows(values_only=True)]


def num(x) -> float:
    return 0.0 if x in (None, "...") else float(x)


def inverse(a: list[list[float]]) -> list[list[float]]:
    """Gauss-Jordan with partial pivoting."""
    n = len(a)
    m = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        if abs(m[p][c]) < 1e-12:
            raise SystemExit("singular matrix")
        m[c], m[p] = m[p], m[c]
        d = m[c][c]
        m[c] = [v / d for v in m[c]]
        for r in range(n):
            if r != c and m[r][c] != 0.0:
                f = m[r][c]
                m[r] = [v - f * w for v, w in zip(m[r], m[c])]
    return [row[n:] for row in m]


def price_rise(flows, output, k):
    """Rise in each sector's price per unit rise in the price of sector k: L[k][j] / L[k][k]."""
    n = len(output)
    a = [[flows[i][j] / output[j] for j in range(n)] for i in range(n)]
    L = inverse([[(1.0 if i == j else 0.0) - a[i][j] for j in range(n)] for i in range(n)])
    return [L[k][j] / L[k][k] for j in range(n)], L


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    cache = Path(args.cache) if args.cache else Path(tempfile.mkdtemp())
    cache.mkdir(parents=True, exist_ok=True)

    use, make, total = sheet(cache, USE), sheet(cache, MAKE), sheet(cache, TOTAL)

    # ---- the use table: rows 7..79 are the 73 commodities, columns 2..72 the 71 industries
    industries = [c for c in use[5][2:73]]
    commodities = [r[0] for r in use[7:80]]
    if len(industries) != 71 or commodities[:71] != industries or commodities[71:] != ["Used", "Other"]:
        raise SystemExit("the use table is not laid out as expected")
    names = {r[0]: r[1] for r in use[7:78]}
    U = [[num(v) for v in r[2:73]] for r in use[7:80]]
    labelled = {r[1]: r for r in use[80:86]}
    g = [num(v) for v in labelled["Total Industry Output"][2:73]]
    va = [num(v) for v in labelled["Total Value Added"][2:73]]
    if use[5][74] != "F010" or not str(use[6][74]).startswith("Personal consumption"):
        raise SystemExit("personal consumption expenditures are not where expected in the use table")
    pce = [num(r[74]) for r in use[7:80]]

    # ---- the make table: rows 7..77 are the 71 industries, columns 2..74 the 73 commodities
    if [r[0] for r in make[7:78]] != industries or list(make[5][2:75]) != commodities:
        raise SystemExit("the make table is not laid out as expected")
    V = [[num(v) for v in r[2:75]] for r in make[7:78]]
    q = [num(v) for v in make[78][2:75]]
    if max(abs(num(r[75]) - gi) for r, gi in zip(make[7:78], g)) > 0.5:
        raise SystemExit("industry output differs between the make and the use table")

    # ---- industry by industry, with every commodity row, to check the procedure against BEA's own table
    D = [[V[i][c] / q[c] for c in range(73)] for i in range(71)]
    Z = [[sum(D[i][c] * U[c][j] for c in range(73)) for j in range(71)] for i in range(71)]

    # ---- check against BEA's own total requirements
    if [r[0] for r in total[7:78]] != industries or list(total[5][2:73]) != industries:
        raise SystemExit("the total requirements table is not laid out as expected")
    k71 = industries.index("211")
    _, L = price_rise(Z, g, k71)
    worst = max(abs(L[i][j] - num(total[7 + i][2 + j])) for i in range(71) for j in range(71))
    if worst > 1e-4:
        raise SystemExit(f"derived total requirements differ from BEA's by {worst}")

    # ---- the table the page uses: the 71 produced commodities only; "Used" and "Other" are inputs from outside
    Z = [[sum(D[i][c] * U[c][j] for c in range(71)) for j in range(71)] for i in range(71)]
    outside71 = [U[71][j] + U[72][j] for j in range(71)]
    pce_ind = [sum(D[i][c] * pce[c] for c in range(71)) for i in range(71)]
    c211, c324 = commodities.index("211"), commodities.index("324")
    oil_gas71 = U[c211]
    rise71, _ = price_rise(Z, g, k71)
    basket71 = sum(p * r for p, r in zip(pce_ind, rise71)) / sum(pce_ind)

    # ---- aggregate
    where = {}
    for s, (_, _, codes, _) in enumerate(SECTORS):
        for code in codes:
            if code in where or code not in industries:
                raise SystemExit(f"industry {code} is listed twice or does not exist")
            where[code] = s
    if len(where) != 71:
        raise SystemExit("not every industry is in a sector")
    S = len(SECTORS)
    idx = [where[c] for c in industries]
    flows = [[0.0] * S for _ in range(S)]
    output, value_added, cons, outside, oil_gas = [0.0] * S, [0.0] * S, [0.0] * S, [0.0] * S, [0.0] * S
    for i in range(71):
        output[idx[i]] += g[i]
        value_added[idx[i]] += va[i]
        cons[idx[i]] += pce_ind[i]
        outside[idx[i]] += outside71[i]
        oil_gas[idx[i]] += oil_gas71[i]
        for j in range(71):
            flows[idx[i]][idx[j]] += Z[i][j]
    flows = [[round(v) for v in row] for row in flows]
    output, value_added, cons = [round(v) for v in output], [round(v) for v in value_added], [round(v) for v in cons]
    outside, oil_gas = [round(v) for v in outside], [round(v) for v in oil_gas]
    rise21, _ = price_rise(flows, output, 0)
    basket21 = sum(p * r for p, r in zip(cons, rise21)) / sum(cons)

    out = {
        "source": {
            "name": "U.S. Bureau of Economic Analysis, Input-Output Accounts: make and use tables after redefinitions, summary level, 2023",
            "files": [MAKE[1], USE[1]],
            "url": BASE + MAKE[0],
            "licence": "Public domain (U.S. government work)",
            "vintage": "files dated September 2024",
            "retrieved": RETRIEVED,
        },
        "year": int(YEAR),
        "unit": "millions of US dollars, producers' prices",
        "sectors": [{"id": i, "name": n, "bea": codes, "members": [names[c] for c in codes], "note": note} for i, n, codes, note in SECTORS],
        # flows[i][j]: what sector j bought from sector i for use in production.
        "flows": flows,
        "output": output,
        "valueAdded": value_added,
        # Household consumption of the 71 produced commodities, by the sector that makes them.
        "consumption": cons,
        # Inputs from outside the table, bought by each sector: scrap and second-hand goods, and imports with no
        # American equivalent. Their prices are held fixed. flows + valueAdded + outside = output, column by column.
        "outside": outside,
        # What BEA's use table records each sector buying of the commodity oil and gas itself.
        "oilGasCommodity": oil_gas,
        "detail": {
            "industries": 71,
            # The basket's rise per unit rise in the oil and gas price at the full 71-industry detail.
            "basketPerUnit": round(basket71, 6),
            "maxGapToBeaTotalRequirements": float(f"{worst:.2g}"),
            # The make table's row for oil and gas extraction: what the industry produces, by commodity.
            "oilIndustryMakes": {"oilAndGas": round(V[k71][c211]), "petroleumProducts": round(V[k71][c324])},
            "petroleumProductsMade": round(q[c324]),
            # Personal consumption of the commodity oil and gas itself, straight from the use table.
            "householdOilGas": round(pce[c211]),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by scripts/data/oil_io.py. Do not edit by hand.\n"
        "// U.S. Bureau of Economic Analysis input-output accounts for 2023, 71 industries added up into 21 sectors.\n"
        "// Public domain. Retrieved " + RETRIEVED + ".\n"
        "export const IO = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n",
    )

    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes): {S} sectors from 71 industries, {YEAR}")
    print(f"largest gap to BEA's published total requirements: {worst:.2e}")
    print(f"BEA figures for the tests: output of 211 = {g[k71]:.0f}, value added of 211 = {va[k71]:.0f}, "
          f"output of 324 = {g[industries.index('324')]:.0f}, GDP (sum of value added) = {sum(va):.0f}, "
          f"personal consumption = {sum(pce):.0f}, total industry output = {sum(g):.0f}")
    print(f"household basket per unit oil price rise: {basket71:.5f} with 71 industries, {basket21:.5f} with {S} sectors")
    print(f"outside inputs: {sum(outside71):.0f} (Used {sum(U[71]):.0f}, Other {sum(U[72]):.0f}); household consumption kept: {sum(pce_ind):.0f} of {sum(pce):.0f}")
    print(f"use table, commodity 211 bought by: 324 = {U[c211][industries.index('324')]:.0f}, 481 = {U[c211][industries.index('481')]:.0f}, 22 = {U[c211][industries.index('22')]:.0f}; "
          f"industry 211 makes {V[k71][c211]:.0f} of commodity 211 and {V[k71][c324]:.0f} of commodity 324 (total made {q[c324]:.0f})")
    for s, (sid, name, codes, _) in enumerate(SECTORS):
        single = f"  (71-industry figure {rise71[industries.index(codes[0])]:.4f})" if len(codes) == 1 else ""
        print(f"  {name:42s} {rise21[s]:.4f}{single}")


if __name__ == "__main__":
    main()
