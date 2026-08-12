#!/usr/bin/env python3
"""
build_data.py — CSV -> trend.json + complexes.json for the static dashboard.

Reads seoul-apt-latest.csv (cp949 encoded) and produces two compact JSON
files under data/ using only the Python standard library.
"""
import sys
import os
import csv
import json
import statistics
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(REPO_ROOT, "seoul-apt-latest.csv")
DATA_DIR = os.path.join(REPO_ROOT, "data")

DEAL_TYPES = ["매매", "전세", "월세"]
PYEONG = 3.3058


def to_float(s):
    if s is None:
        return None
    s = s.strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def normalize_ym(s):
    # contract_ym looks like "2025-07-01" -> "2025-07"
    s = s.strip()
    parts = s.split("-")
    if len(parts) >= 2:
        return f"{parts[0]}-{parts[1]}"
    return s


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    total_rows = 0
    skipped = {dt: 0 for dt in DEAL_TYPES}

    # series[gu][deal_type][ym] -> list of dicts with amount, ppp, rent
    amounts = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    ppps = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    rents = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    counts = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))

    gus_set = set()
    months_set = set()

    # complex aggregation: key (gu, dong, complex)
    complex_counts = defaultdict(lambda: defaultdict(int))
    complex_sale_amounts = defaultdict(list)  # 매매 price
    complex_sale_ppps = defaultdict(list)     # 매매 price_per_pyeong
    complex_last_date = {}

    assert os.path.exists(CSV_PATH), f"CSV not found at {CSV_PATH}"

    with open(CSV_PATH, encoding="cp949", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_rows += 1
            deal_type = row["deal_type"].strip()
            assert deal_type in DEAL_TYPES, f"unexpected deal_type: {deal_type!r}"

            gu = row["gu"].strip()
            dong = row["dong"].strip()
            complex_name = row["complex"].strip()
            ym = normalize_ym(row["contract_ym"])
            contract_date = row["contract_date"].strip()

            gus_set.add(gu)
            months_set.add(ym)

            area = to_float(row["area_m2"])

            if deal_type == "매매":
                amount = to_float(row["price"])
                ppp = to_float(row["price_per_pyeong"])
                rent = None
            elif deal_type == "전세":
                amount = to_float(row["deposit"])
                rent = None
                if amount is not None and area is not None and area > 0:
                    ppp = amount / (area / PYEONG)
                else:
                    ppp = None
            else:  # 월세
                amount = to_float(row["deposit"])
                rent = to_float(row["monthly_rent"])
                if amount is not None and area is not None and area > 0:
                    ppp = amount / (area / PYEONG)
                else:
                    ppp = None

            if amount is None:
                skipped[deal_type] += 1
            else:
                counts[gu][deal_type][ym] += 1
                amounts[gu][deal_type][ym].append(amount)
                if ppp is not None:
                    ppps[gu][deal_type][ym].append(ppp)
                if deal_type == "월세" and rent is not None:
                    rents[gu][deal_type][ym].append(rent)

            # complex aggregation (independent of amount parse success,
            # counts all transactions for the complex, per deal_type)
            ckey = (gu, dong, complex_name)
            complex_counts[ckey][deal_type] += 1
            if contract_date:
                prev = complex_last_date.get(ckey)
                if prev is None or contract_date > prev:
                    complex_last_date[ckey] = contract_date
            if deal_type == "매매":
                if amount is not None:
                    complex_sale_amounts[ckey].append(amount)
                if ppp is not None:
                    complex_sale_ppps[ckey].append(ppp)

    months = sorted(months_set)
    gus_sorted = sorted(gus_set)
    gu_list = ["서울전체"] + gus_sorted

    assert len(months) == 12, f"expected 12 months, got {len(months)}: {months}"
    assert len(gus_sorted) == 25, f"expected 25 gu, got {len(gus_sorted)}: {gus_sorted}"

    def build_month_entry(gu, dt, ym):
        amt_list = amounts[gu][dt][ym]
        ppp_list = ppps[gu][dt][ym]
        rent_list = rents[gu][dt][ym]
        cnt = counts[gu][dt][ym]
        if cnt == 0:
            return {"ym": ym, "medianPrice": None, "medianPpp": None, "count": 0, "medianRent": None}
        median_price = round(statistics.median(amt_list)) if amt_list else None
        median_ppp = round(statistics.median(ppp_list)) if ppp_list else None
        median_rent = round(statistics.median(rent_list)) if (dt == "월세" and rent_list) else None
        return {
            "ym": ym,
            "medianPrice": median_price,
            "medianPpp": median_ppp,
            "count": cnt,
            "medianRent": median_rent,
        }

    series = {}

    # per-gu series
    for gu in gus_sorted:
        series[gu] = {}
        for dt in DEAL_TYPES:
            series[gu][dt] = [build_month_entry(gu, dt, ym) for ym in months]

    # 서울전체 synthetic aggregate: recompute directly from raw lists across all gu
    seoul_amounts = defaultdict(lambda: defaultdict(list))
    seoul_ppps = defaultdict(lambda: defaultdict(list))
    seoul_rents = defaultdict(lambda: defaultdict(list))
    seoul_counts = defaultdict(lambda: defaultdict(int))
    for gu in gus_sorted:
        for dt in DEAL_TYPES:
            for ym in months:
                seoul_amounts[dt][ym].extend(amounts[gu][dt][ym])
                seoul_ppps[dt][ym].extend(ppps[gu][dt][ym])
                seoul_rents[dt][ym].extend(rents[gu][dt][ym])
                seoul_counts[dt][ym] += counts[gu][dt][ym]

    series["서울전체"] = {}
    for dt in DEAL_TYPES:
        entries = []
        for ym in months:
            cnt = seoul_counts[dt][ym]
            if cnt == 0:
                entries.append({"ym": ym, "medianPrice": None, "medianPpp": None, "count": 0, "medianRent": None})
                continue
            amt_list = seoul_amounts[dt][ym]
            ppp_list = seoul_ppps[dt][ym]
            rent_list = seoul_rents[dt][ym]
            entries.append({
                "ym": ym,
                "medianPrice": round(statistics.median(amt_list)) if amt_list else None,
                "medianPpp": round(statistics.median(ppp_list)) if ppp_list else None,
                "count": cnt,
                "medianRent": round(statistics.median(rent_list)) if (dt == "월세" and rent_list) else None,
            })
        series["서울전체"][dt] = entries

    trend = {
        "meta": {
            "months": months,
            "gus": gu_list,
            "dealTypes": DEAL_TYPES,
            "totalRows": total_rows,
            "source": "seoul-apt-latest.csv",
        },
        "series": series,
    }

    trend_path = os.path.join(DATA_DIR, "trend.json")
    with open(trend_path, "w", encoding="utf-8") as f:
        json.dump(trend, f, ensure_ascii=False, separators=(",", ":"))

    # ---- complexes.json ----
    complex_entries = []
    for ckey, dt_counts in complex_counts.items():
        gu, dong, cname = ckey
        sale_amts = complex_sale_amounts.get(ckey, [])
        sale_ppps = complex_sale_ppps.get(ckey, [])
        median_price = round(statistics.median(sale_amts)) if sale_amts else None
        median_ppp = round(statistics.median(sale_ppps)) if sale_ppps else None
        counts_out = {dt: c for dt, c in dt_counts.items() if c > 0}
        total = sum(dt_counts.values())
        complex_entries.append({
            "name": cname,
            "gu": gu,
            "dong": dong,
            "counts": counts_out,
            "medianPrice": median_price,
            "medianPpp": median_ppp,
            "lastDate": complex_last_date.get(ckey),
            "_total": total,
        })

    complex_entries.sort(key=lambda e: e["_total"], reverse=True)
    for e in complex_entries:
        del e["_total"]

    assert len(complex_entries) == 8216, f"expected 8216 complexes, got {len(complex_entries)}"

    complexes_out = {
        "meta": {"count": len(complex_entries), "source": "seoul-apt-latest.csv"},
        "complexes": complex_entries,
    }

    complexes_path = os.path.join(DATA_DIR, "complexes.json")
    with open(complexes_path, "w", encoding="utf-8") as f:
        json.dump(complexes_out, f, ensure_ascii=False, separators=(",", ":"))

    # ---- Verification ----
    print("=== Verification ===")
    trend_size = os.path.getsize(trend_path)
    complexes_size = os.path.getsize(complexes_path)
    print(f"data/trend.json size: {trend_size:,} bytes ({trend_size/1024:.1f} KB)")
    print(f"data/complexes.json size: {complexes_size:,} bytes ({complexes_size/1024:.1f} KB)")

    assert len(trend["meta"]["gus"]) == 26, "expected 26 gus (서울전체 + 25)"
    assert len(trend["meta"]["months"]) == 12
    for gu in trend["meta"]["gus"]:
        assert set(trend["series"][gu].keys()) == set(DEAL_TYPES)
    print("Assertions passed: 26 gus, 12 months, 3 deal types each.")

    print("\n서울전체 / 매매 series:")
    for e in series["서울전체"]["매매"]:
        print(f"  {e}")

    # Cross-check: independently recompute 서울전체 매매 median price for last month
    last_month = months[-1]
    cross_amts = []
    with open(CSV_PATH, encoding="cp949", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["deal_type"].strip() != "매매":
                continue
            if normalize_ym(row["contract_ym"]) != last_month:
                continue
            amt = to_float(row["price"])
            if amt is not None:
                cross_amts.append(amt)
    cross_median = round(statistics.median(cross_amts)) if cross_amts else None
    json_median = None
    for e in series["서울전체"]["매매"]:
        if e["ym"] == last_month:
            json_median = e["medianPrice"]
            break
    print(f"\nCross-check 서울전체/매매 median price for {last_month}:")
    print(f"  from JSON:            {json_median}")
    print(f"  independent recompute: {cross_median}")
    assert json_median == cross_median, "MISMATCH between JSON and independent recompute!"
    print("  MATCH")

    null_price_count = sum(1 for e in complex_entries if e["medianPrice"] is None)
    print(f"\nComplexes with medianPrice=null (no 매매 transactions): {null_price_count} / {len(complex_entries)}")

    print("\nSkipped/unparseable rows per deal type:")
    for dt in DEAL_TYPES:
        print(f"  {dt}: {skipped[dt]}")
    print(f"Total rows processed: {total_rows}")


if __name__ == "__main__":
    main()
