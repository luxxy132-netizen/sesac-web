#!/usr/bin/env python3
"""Natural Earth GeoJSON -> game/data/world.json

세계지도 배경(육지 실루엣)과 데이터에 등장하는 나라의 좌표를 SVG 좌표로 미리 계산한다.
런타임에는 외부 요청 없이 이 JSON만 읽는다.

원본 (public domain, Natural Earth 110m):
  ne_110m_land.geojson
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson
  ne_110m_admin_0_countries.geojson
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson

사용법:  python build_world_data.py <land.geojson> <countries.geojson>
"""
import json
import os
import sys

OUT = os.path.join("game", "data", "world.json")

W, H = 1000.0, 460.0
LAT_TOP, LAT_BOTTOM = 84.0, -58.0     # 남극 대륙은 제외 (데이터에 없는 지역)
MIN_RING_AREA = 1.2                    # SVG 좌표 기준. 이보다 작은 섬은 생략

# CSV의 국가명 -> Natural Earth NAME
NE_NAME = {
    "USA": "United States of America",
    "UK": "United Kingdom",
    "South Korea": "South Korea",
    "Turkey": "Turkey",
    "Russia": "Russia",
    "Iran": "Iran",
}
# 최대 폴리곤 중심이 실제 국토 중심과 크게 어긋나는 경우만 보정 (경도, 위도)
LONLAT_OVERRIDE = {
    "USA": (-98.5, 39.5),      # 알래스카·하와이 제외한 본토
    "France": (2.5, 46.6),     # 해외 영토 제외
    "Norway": (9.0, 61.5),
    "Netherlands": (5.4, 52.2),
    "Denmark": (9.5, 56.0),
}


def project(lon, lat):
    x = (lon + 180.0) / 360.0 * W
    y = (LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM) * H
    return x, y


def rings(geometry):
    kind, coords = geometry["type"], geometry["coordinates"]
    if kind == "Polygon":
        return [coords[0]]
    if kind == "MultiPolygon":
        return [poly[0] for poly in coords]
    return []


def ring_area(points):
    total = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def ring_centroid(points):
    area = 0.0
    cx = cy = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        cross = x1 * y2 - x2 * y1
        area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    area /= 2.0
    if abs(area) < 1e-9:
        return points[0]
    return cx / (6 * area), cy / (6 * area)


def land_path(features):
    parts = []
    for feature in features:
        for ring in rings(feature["geometry"]):
            pts = [project(lon, max(min(lat, LAT_TOP), LAT_BOTTOM)) for lon, lat in ring]
            if len(pts) < 3 or ring_area(pts) < MIN_RING_AREA:
                continue
            # 이웃한 중복 좌표 제거 (0.1 단위로 반올림하면 겹치는 점이 생긴다)
            simplified = []
            for x, y in pts:
                p = (round(x, 1), round(y, 1))
                if not simplified or simplified[-1] != p:
                    simplified.append(p)
            if len(simplified) < 3:
                continue
            head = simplified[0]
            body = "".join("L%g %g" % p for p in simplified[1:])
            parts.append("M%g %g%sZ" % (head[0], head[1], body))
    return "".join(parts)


def country_points(features, wanted):
    by_name = {}
    for feature in features:
        props = feature["properties"]
        for key in ("NAME", "NAME_LONG", "ADMIN"):
            if props.get(key):
                by_name.setdefault(props[key], feature)

    points, missing = {}, []
    for name in wanted:
        if name in LONLAT_OVERRIDE:
            points[name] = [round(v, 1) for v in project(*LONLAT_OVERRIDE[name])]
            continue
        feature = by_name.get(NE_NAME.get(name, name)) or by_name.get(name)
        if not feature:
            missing.append(name)
            continue
        biggest = max(rings(feature["geometry"]), key=ring_area)
        lon, lat = ring_centroid(biggest)
        points[name] = [round(v, 1) for v in project(lon, max(min(lat, LAT_TOP), LAT_BOTTOM))]
    return points, missing


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    land_src, countries_src = sys.argv[1], sys.argv[2]

    with open(land_src, encoding="utf-8") as f:
        land = json.load(f)
    with open(countries_src, encoding="utf-8") as f:
        countries = json.load(f)

    with open(os.path.join("game", "data", "purchases.json"), encoding="utf-8") as f:
        wanted = json.load(f)["dims"]["country"]

    points, missing = country_points(countries["features"], wanted)
    payload = {
        "width": W,
        "height": H,
        "source": "Natural Earth 110m (public domain)",
        "land": land_path(land["features"]),
        "points": points,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)

    print(f"{OUT}: {os.path.getsize(OUT)/1024:.1f} KB · 좌표 {len(points)}/{len(wanted)}개국")
    if missing:
        print("  좌표를 찾지 못한 국가:", ", ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
