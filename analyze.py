import csv
import sys

sys.stdout.reconfigure(encoding="utf-8")

CSV_PATH = "seoul-apt-latest.csv"
TARGET_GU = "은평구"
TOP_N = 5

rows = []

with open(CSV_PATH, encoding="cp949", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row["gu"] != TARGET_GU:
            continue

        price_str = row["price"].replace(",", "").strip()
        if not price_str:
            continue

        rows.append({
            "complex": row["complex"],
            "price": int(price_str),
            "contract_date": row["contract_date"],
        })

top_rows = sorted(rows, key=lambda r: r["price"], reverse=True)[:TOP_N]

print(f"은평구 아파트 물건금액 상위 {TOP_N}건")
for r in top_rows:
    print(f"{r['complex']} | {r['price']}만원 | {r['contract_date']}")
