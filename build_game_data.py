#!/usr/bin/env python3
"""mobile_game_inapp_purchases.csv -> game/data/purchases.json

Columnar payload for the in-app purchase dashboard: dimension dictionaries plus
one integer/float row per user. Keeps the browser payload small enough to filter
client-side without a build step.

Missing-data policy (surfaced in the UI, see game/PRD.md):
  - no InAppPurchaseAmount (136 users) -> non-payer, excluded from revenue
  - no Country/GameGenre (60 users)    -> excluded from rankings, kept in totals
"""
import csv
import json
import os

SRC = "mobile_game_inapp_purchases.csv"
OUT = os.path.join("game", "data", "purchases.json")

SEGMENT_ORDER = ["Whale", "Dolphin", "Minnow"]
MISSING = ("", "nan", "NaN", "None")


def clean(value):
    return None if value is None or value.strip() in MISSING else value.strip()


def main():
    with open(SRC, encoding="utf-8") as f:
        raw = list(csv.DictReader(f))

    countries = sorted({c for r in raw if (c := clean(r["Country"]))})
    genres = sorted({g for r in raw if (g := clean(r["GameGenre"]))})
    country_idx = {c: i for i, c in enumerate(countries)}
    genre_idx = {g: i for i, g in enumerate(genres)}
    segment_idx = {s: i for i, s in enumerate(SEGMENT_ORDER)}

    rows = []
    dropped = 0
    for r in raw:
        segment = clean(r["SpendingSegment"])
        if segment not in segment_idx:
            dropped += 1
            continue
        country = clean(r["Country"])
        genre = clean(r["GameGenre"])
        amount = clean(r["InAppPurchaseAmount"])
        rows.append([
            country_idx.get(country, -1),
            genre_idx.get(genre, -1),
            segment_idx[segment],
            round(float(amount), 2) if amount is not None else -1,
        ])

    payers = [r for r in rows if r[3] >= 0]
    dates = sorted(d for r in raw if (d := clean(r["LastPurchaseDate"])))

    # Segment thresholds are read off the data so the UI tooltips can state the
    # real dollar ranges instead of a remembered rule of thumb.
    segments = []
    for name, i in segment_idx.items():
        amounts = [r[3] for r in payers if r[2] == i]
        segments.append({
            "name": name,
            "users": sum(1 for r in rows if r[2] == i),
            "payers": len(amounts),
            "min": round(min(amounts), 2) if amounts else 0,
            "max": round(max(amounts), 2) if amounts else 0,
        })

    payload = {
        "meta": {
            "source": SRC,
            "users": len(rows),
            "payers": len(payers),
            "nonPayers": len(rows) - len(payers),
            "unknownDims": sum(1 for r in rows if r[0] < 0 or r[1] < 0),
            "unknownCountry": sum(1 for r in rows if r[0] < 0),
            "unknownGenre": sum(1 for r in rows if r[1] < 0),
            "revenue": round(sum(r[3] for r in payers), 2),
            "dateFrom": dates[0] if dates else None,
            "dateTo": dates[-1] if dates else None,
            "segments": segments,
        },
        "dims": {
            "country": countries,
            "genre": genres,
            "segment": SEGMENT_ORDER,
        },
        # [countryIdx, genreIdx, segmentIdx, amountUSD]  (-1 = unknown / no purchase)
        "rows": rows,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)

    size = os.path.getsize(OUT) / 1024
    print(f"{OUT}: {len(rows)} rows, {len(countries)} countries, {len(genres)} genres, {size:.1f} KB")
    if dropped:
        print(f"  skipped {dropped} rows with an unrecognized SpendingSegment")
    print(f"  payers {len(payers)} / revenue ${payload['meta']['revenue']:,.2f}")
    for s in segments:
        print(f"  {s['name']:<8} users={s['users']:<5} payers={s['payers']:<5} ${s['min']:.2f}-${s['max']:.2f}")


if __name__ == "__main__":
    main()
