/* 모바일 게임 인앱 결제 대시보드
   data/purchases.json — rows = [countryIdx, genreIdx, segmentIdx, amountUSD]
                          amount -1 = 결제 이력 없음, dim -1 = 국가/장르 결측
   data/world.json     — 육지 실루엣 path + 국가별 SVG 좌표 (Natural Earth 110m, public domain) */
(function () {
  "use strict";

  var COUNTRY = 0, GENRE = 1, SEGMENT = 2, AMOUNT = 3;
  var SEG_COLOR = { Whale: "var(--seg-whale)", Dolphin: "var(--seg-dolphin)", Minnow: "var(--seg-minnow)" };
  var SEG_ICON = { Whale: "#icon-whale", Dolphin: "#icon-dolphin", Minnow: "#icon-minnow" };
  var SEG_KO = { Whale: "고래 Whale", Dolphin: "돌고래 Dolphin", Minnow: "피라미 Minnow" };
  // 채움 색 위에 올리는 글자색은 채움의 밝기로 고른다 (어두운 Minnow 위에서는 흰 글자)
  var SEG_INK = { Whale: "#0B141C", Dolphin: "#0B141C", Minnow: "#F2F7FA" };
  var SEG_SHORT = { Whale: "고래", Dolphin: "돌고래", Minnow: "피라미" };

  var state = {
    data: null,
    world: null,
    country: null,
    genre: null,
    mapMetric: "revenue",
    countrySort: { key: "revenue", dir: -1 },
    genreSort: { key: "revenue", dir: -1 }
  };

  var el = {
    error: document.getElementById("errorBanner"),
    countrySelect: document.getElementById("countrySelect"),
    genreSelect: document.getElementById("genreSelect"),
    reset: document.getElementById("resetBtn"),
    filterSummary: document.getElementById("filterSummary"),
    map: document.getElementById("worldMap"),
    mapSummary: document.getElementById("mapSummary"),
    mapLegend: document.getElementById("mapLegend"),
    kpiRow: document.getElementById("kpiRow"),
    segmentHeadline: document.getElementById("segmentHeadline"),
    stackBar: document.getElementById("stackBar"),
    stackLegend: document.getElementById("stackLegend"),
    segmentGrid: document.getElementById("segmentGrid"),
    countryTable: document.getElementById("countryTableWrap"),
    genreTable: document.getElementById("genreTableWrap"),
    notes: document.getElementById("notesList"),
    tooltip: document.getElementById("tooltipPop")
  };

  /* ---------- formatting ---------- */
  function usd(v, digits) {
    var d = digits === undefined ? 0 : digits;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function num(v) { return v.toLocaleString("ko-KR"); }
  function pct(part, whole, digits) {
    if (!whole) return "0%";
    var d = digits === undefined ? 1 : digits;
    return (part / whole * 100).toFixed(d) + "%";
  }
  function icon(name, cls) {
    return '<svg class="seg-icon' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="' +
      SEG_ICON[name] + '"/></svg>';
  }

  /* ---------- aggregation ---------- */
  function matches(row, country, genre) {
    return (country === null || row[COUNTRY] === country) &&
           (genre === null || row[GENRE] === genre);
  }

  function summarize(rows) {
    var segCount = state.data.dims.segment.length;
    var out = {
      users: rows.length, payers: 0, revenue: 0,
      segRevenue: new Array(segCount).fill(0),
      segUsers: new Array(segCount).fill(0),
      segPayers: new Array(segCount).fill(0)
    };
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], s = r[SEGMENT];
      out.segUsers[s]++;
      if (r[AMOUNT] >= 0) {
        out.payers++;
        out.revenue += r[AMOUNT];
        out.segRevenue[s] += r[AMOUNT];
        out.segPayers[s]++;
      }
    }
    out.arppu = out.payers ? out.revenue / out.payers : 0;
    return out;
  }

  /* 랭킹·지도는 교차 필터: 국가 집계는 장르 필터만, 장르 집계는 국가 필터만 반영한다.
     (선택한 축은 전체 목록을 유지해 비교 맥락을 잃지 않기 위함) */
  function rankBy(dimIndex) {
    var names = dimIndex === COUNTRY ? state.data.dims.country : state.data.dims.genre;
    var buckets = names.map(function (name, i) {
      return { index: i, name: name, revenue: 0, payers: 0, users: 0, whales: 0, whaleRevenue: 0 };
    });
    var country = dimIndex === COUNTRY ? null : state.country;
    var genre = dimIndex === GENRE ? null : state.genre;
    var rows = state.data.rows;
    var whaleIdx = state.data.dims.segment.indexOf("Whale");

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], key = r[dimIndex];
      if (key < 0 || !matches(r, country, genre)) continue;
      var b = buckets[key];
      b.users++;
      if (r[SEGMENT] === whaleIdx) b.whales++;
      if (r[AMOUNT] >= 0) {
        b.payers++;
        b.revenue += r[AMOUNT];
        if (r[SEGMENT] === whaleIdx) b.whaleRevenue += r[AMOUNT];
      }
    }
    buckets.forEach(function (b) {
      b.arppu = b.payers ? b.revenue / b.payers : 0;
      b.whaleShare = b.revenue ? b.whaleRevenue / b.revenue : 0;
    });
    return buckets.filter(function (b) { return b.users > 0; });
  }

  /* ---------- tooltip 내용 ---------- */
  var TIP = {
    arppu: { title: "ARPPU", body: "Average Revenue Per Paying User. 결제한 유저 1명이 쓴 평균 금액(총 매출 ÷ 결제 유저 수). 결제하지 않은 유저는 계산에서 빠집니다." },
    whaleShare: { title: "고래 매출 비중", body: "전체 매출 중 Whale 세그먼트가 만든 금액의 비율. 이 값이 높을수록 소수 유저에 매출이 쏠려 있어, 고래 이탈 시 타격이 큽니다." },
    payers: { title: "결제 유저", body: "결제 이력이 있는 유저 수. 전체 유저 중 결제 금액이 기록되지 않은 유저는 미결제로 봅니다." },
    Whale: { title: "고래 Whale", body: "가장 많이 쓰는 상위 소비층. 이 데이터에서는 누적 결제 $608 이상이며, 인원은 적지만 매출의 절반 이상을 만듭니다." },
    Dolphin: { title: "돌고래 Dolphin", body: "중간 소비층. 누적 결제 약 $21~$498. 고래만큼 쓰지는 않지만 인원이 많아 매출 기여가 안정적입니다." },
    Minnow: { title: "피라미 Minnow", body: "소액 결제층. 누적 결제 $20 이하. 인원 비중은 가장 크지만 매출 기여는 작습니다. 대부분의 결제 유저가 여기 속합니다." }
  };

  function infoBtn(key) {
    return '<button type="button" class="info-btn" data-tip="' + key + '" aria-label="' + TIP[key].title + ' 설명">?</button>';
  }

  /* ---------- 세계지도 ---------- */
  var MAP_METRIC = {
    revenue: { label: "고래 매출", format: function (b) { return usd(b.whaleRevenue); }, value: function (b) { return b.whaleRevenue; } },
    share: { label: "고래 매출 비중", format: function (b) { return pct(b.whaleRevenue, b.revenue); }, value: function (b) { return b.whaleShare; } }
  };

  /* 데이터에 나오는 나라만 담기게 지도를 잘라 쓴다 — 빈 바다를 버리면 같은 폭에서 버블이 커진다.
     필터와 무관하게 27개국 전체 기준으로 한 번만 계산해, 선택할 때마다 지도가 튀지 않게 한다. */
  var mapViewBox = null;
  function viewBox(world) {
    if (mapViewBox) return mapViewBox;
    var xs = [], ys = [];
    Object.keys(world.points).forEach(function (name) {
      xs.push(world.points[name][0]);
      ys.push(world.points[name][1]);
    });
    var pad = 62;
    var x0 = Math.max(0, Math.min.apply(null, xs) - pad);
    var y0 = Math.max(0, Math.min.apply(null, ys) - pad);
    var x1 = Math.min(world.width, Math.max.apply(null, xs) + pad);
    var y1 = Math.min(world.height, Math.max.apply(null, ys) + pad);
    mapViewBox = [x0, y0, x1 - x0, y1 - y0];
    return mapViewBox;
  }

  function renderMap() {
    var world = state.world;
    if (!world) return;
    var vb = viewBox(world);
    el.map.setAttribute("viewBox", vb.join(" "));

    var metric = MAP_METRIC[state.mapMetric];
    var buckets = rankBy(COUNTRY).filter(function (b) { return world.points[b.name] && metric.value(b) > 0; });
    var max = buckets.reduce(function (m, b) { return Math.max(m, metric.value(b)); }, 0);
    var ranked = buckets.slice().sort(function (a, b) { return metric.value(b) - metric.value(a); });

    // 면적 비례(√)로 반지름 결정 — 값의 비율이 원 크기로 그대로 읽히게
    function radius(b) {
      if (!max) return 0;
      return 4.5 + Math.sqrt(metric.value(b) / max) * 19.5;
    }

    // 큰 원부터 그려서 작은 원이 위에 오게 한다 (유럽처럼 몰려 있는 곳에서 작은 원이 묻히지 않도록)
    var bubbles = ranked.map(function (b) {
      var p = world.points[b.name];
      var selected = state.country === b.index;
      return '<circle class="map-bubble' + (selected ? " is-selected" : "") + '" cx="' + p[0] + '" cy="' + p[1] +
        '" r="' + radius(b).toFixed(1) + '" data-index="' + b.index + '" tabindex="0" role="button"' +
        ' data-tip-title="' + b.name + '"' +
        ' data-tip-body="고래 ' + num(b.whales) + '명 · 고래 매출 ' + usd(b.whaleRevenue) +
        ' · 이 나라 매출의 ' + pct(b.whaleRevenue, b.revenue) + '"' +
        ' aria-label="' + b.name + " " + metric.label + " " + metric.format(b) + ', 누르면 필터">' +
        "</circle>";
    }).join("");

    var labels = ranked.slice(0, 3).map(function (b) {
      var p = world.points[b.name];
      var anchor = p[0] > vb[0] + vb[2] - 150 ? "end" : "start";
      var dx = anchor === "end" ? -(radius(b) + 6) : radius(b) + 6;
      return '<text class="map-label" x="' + (p[0] + dx) + '" y="' + (p[1] + 4) + '" text-anchor="' + anchor + '">' +
        b.name + " " + metric.format(b) + "</text>";
    }).join("");

    el.map.innerHTML = '<path class="map-land" d="' + world.land + '"/>' + bubbles + labels;

    var totalWhaleRevenue = buckets.reduce(function (s, b) { return s + b.whaleRevenue; }, 0);
    el.mapSummary.textContent = state.genre === null
      ? "전체 장르 기준 · 고래가 있는 나라 " + num(buckets.length) + "개국 · 고래 매출 합계 " + usd(totalWhaleRevenue)
      : state.data.dims.genre[state.genre] + " 기준 · 고래가 있는 나라 " + num(buckets.length) + "개국 · 고래 매출 합계 " + usd(totalWhaleRevenue);

    var top = ranked[0];
    el.mapLegend.innerHTML =
      '<span><span class="bubble-key" style="width:10px;height:10px"></span>작음</span>' +
      '<span><span class="bubble-key" style="width:22px;height:22px"></span>큼 — 원 넓이가 ' + metric.label + '에 비례</span>' +
      (top ? '<span>가장 큰 나라: <strong style="color:var(--amber)">' + top.name + " " + metric.format(top) + "</strong></span>" : "") +
      (state.mapMetric === "share"
        ? '<span>결제자가 적은 나라는 비중이 크게 흔들립니다 — 규모는 “고래 매출”로 확인하세요.</span>'
        : '<span>정확한 값은 아래 국가 랭킹 표에서 볼 수 있습니다.</span>');
  }

  function bounce(node) {
    if (!node) return;
    node.classList.remove("is-bouncing");
    void node.getBoundingClientRect();     // 리플로우로 애니메이션 재시작
    node.classList.add("is-bouncing");
    setTimeout(function () { node.classList.remove("is-bouncing"); }, 700);
  }

  /* ---------- KPI ---------- */
  function renderKpi(cur, all) {
    var filtered = state.country !== null || state.genre !== null;
    var whaleIdx = state.data.dims.segment.indexOf("Whale");
    var cards = [
      { label: "총 매출", tone: "is-amber", value: usd(cur.revenue),
        sub: filtered ? "전체 매출의 " + pct(cur.revenue, all.revenue) : "결제 유저 " + num(cur.payers) + "명 합계" },
      { label: "결제 유저", tip: "payers", value: num(cur.payers) + "명",
        sub: "전체 " + num(cur.users) + "명 중 " + pct(cur.payers, cur.users, 1) },
      { label: "ARPPU", tip: "arppu", value: usd(cur.arppu, 2),
        sub: filtered ? "전체 평균 " + usd(all.arppu, 2) : "결제 유저 1인당 평균 결제액" },
      { label: "고래 매출 비중", tip: "whaleShare", tone: "is-teal", iconName: "Whale",
        value: pct(cur.segRevenue[whaleIdx], cur.revenue),
        sub: "고래 " + num(cur.segUsers[whaleIdx]) + "명 (유저의 " + pct(cur.segUsers[whaleIdx], cur.users) + ")" }
    ];

    el.kpiRow.innerHTML = cards.map(function (c) {
      return '<article class="kpi-card">' +
        '<h3 class="kpi-label">' + (c.iconName ? icon(c.iconName, "is-sm") : "") + c.label + (c.tip ? infoBtn(c.tip) : "") + "</h3>" +
        '<p class="kpi-value ' + (c.tone || "") + '">' + c.value + "</p>" +
        '<p class="kpi-sub">' + c.sub + "</p>" +
        "</article>";
    }).join("");
  }

  /* ---------- 세그먼트 ---------- */
  function renderSegments(cur) {
    var segs = state.data.dims.segment.map(function (name, i) {
      return {
        name: name, color: SEG_COLOR[name],
        users: cur.segUsers[i], payers: cur.segPayers[i], revenue: cur.segRevenue[i],
        arppu: cur.segPayers[i] ? cur.segRevenue[i] / cur.segPayers[i] : 0
      };
    });

    var whale = segs.find(function (s) { return s.name === "Whale"; }) || segs[0];
    el.segmentHeadline.innerHTML = cur.revenue
      ? "지금 화면에서 <strong>고래 " + num(whale.users) + "명(유저의 " + pct(whale.users, cur.users) +
        ")</strong>이 매출의 <strong>" + pct(whale.revenue, cur.revenue) + "</strong>를 만들고 있습니다."
      : "선택한 조건에 결제 데이터가 없습니다.";

    el.stackBar.innerHTML = segs.filter(function (s) { return s.revenue > 0; }).map(function (s) {
      var share = cur.revenue ? s.revenue / cur.revenue : 0;
      var label = SEG_SHORT[s.name] + " " + pct(s.revenue, cur.revenue, 0);
      return '<div class="stack-seg" style="flex:' + Math.max(share, 0.002) + ';background:' + s.color +
        ";color:" + SEG_INK[s.name] + '"' +
        ' data-label="' + label + '" data-seg="' + s.name + '" data-tip="' + s.name + '" tabindex="0" role="img"' +
        ' aria-label="' + SEG_KO[s.name] + " 매출 " + usd(s.revenue) + ", 비중 " + pct(s.revenue, cur.revenue) + '">' +
        "</div>";
    }).join("");
    if (!el.stackBar.children.length) {
      el.stackBar.innerHTML = '<p class="caption" style="margin:0">표시할 매출이 없습니다.</p>';
    }
    fitStackLabels();

    el.stackLegend.innerHTML = segs.map(function (s) {
      return '<span class="legend-item"><span style="color:' + s.color + '">' + icon(s.name, "is-sm") + "</span>" +
        SEG_KO[s.name] + " · " + pct(s.revenue, cur.revenue) + "</span>";
    }).join("");

    el.segmentGrid.innerHTML = segs.map(function (s) {
      return '<article class="segment-tile' + (s.name === "Whale" ? " whale-tile" : "") + '" data-seg-tile="' + s.name + '">' +
        '<h3 class="segment-tile-head"><span style="color:' + s.color + '">' + icon(s.name) + "</span>" +
        SEG_KO[s.name] + infoBtn(s.name) + "</h3>" +
        '<p class="segment-share" style="color:' + s.color + '">' + pct(s.revenue, cur.revenue) +
        '<span class="caption"> 매출 비중</span></p>' +
        '<div class="segment-stats">' +
        "<span>유저 <strong>" + num(s.users) + "명 (" + pct(s.users, cur.users) + ")</strong></span>" +
        "<span>매출 <strong>" + usd(s.revenue) + "</strong></span>" +
        "<span>ARPPU <strong>" + usd(s.arppu, 2) + "</strong></span>" +
        "</div></article>";
    }).join("");
  }

  /* 잘린 라벨을 두느니 지운다 — 값은 범례·툴팁·세그먼트 카드가 그대로 갖고 있다. */
  function fitStackLabels() {
    Array.prototype.forEach.call(el.stackBar.children, function (seg) {
      var label = seg.getAttribute("data-label");
      var name = seg.getAttribute("data-seg");
      if (!label || !name) return;
      seg.innerHTML = icon(name, "is-sm") + label;
      if (seg.scrollWidth > seg.clientWidth) {
        seg.innerHTML = icon(name, "is-sm");                 // 아이콘만이라도
        if (seg.scrollWidth > seg.clientWidth) seg.innerHTML = "";
      }
    });
  }

  /* ---------- 랭킹 ---------- */
  var COLUMNS = {
    country: [
      { key: "name", label: "국가", sortable: false },
      { key: "revenue", label: "매출", bar: true },
      { key: "payers", label: "결제자" },
      { key: "whales", label: "고래" },
      { key: "whaleShare", label: "고래 비중" }
    ],
    genre: [
      { key: "name", label: "장르", sortable: false },
      { key: "revenue", label: "매출", bar: true },
      { key: "payers", label: "결제자" },
      { key: "arppu", label: "ARPPU" },
      { key: "whales", label: "고래" }
    ]
  };

  function cellValue(row, key) {
    if (key === "revenue") return usd(row.revenue);
    if (key === "payers") return num(row.payers);
    if (key === "arppu") return usd(row.arppu, 0);
    if (key === "whales") return num(row.whales);
    if (key === "whaleShare") return pct(row.whaleRevenue, row.revenue, 0);
    return row[key];
  }

  function renderRanking(wrap, dimIndex, sort, selected) {
    var columns = COLUMNS[dimIndex === COUNTRY ? "country" : "genre"];
    var rows = rankBy(dimIndex).sort(function (a, b) {
      var d = (a[sort.key] - b[sort.key]) * sort.dir;
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    var max = rows.reduce(function (m, r) { return Math.max(m, r.revenue); }, 0);
    var headLabel = columns[0].label;

    var head = columns.map(function (c) {
      if (c.sortable === false) return "<th>" + c.label + "</th>";
      var active = sort.key === c.key;
      var arrow = active ? (sort.dir < 0 ? " ↓" : " ↑") : "";
      return '<th aria-sort="' + (active ? (sort.dir < 0 ? "descending" : "ascending") : "none") + '">' +
        '<button type="button" data-sort="' + c.key + '">' + c.label + arrow + "</button></th>";
    }).join("");

    var body = rows.length ? rows.map(function (r) {
      var w = max ? Math.max(r.revenue / max * 100, 1) : 0;
      var cells = columns.map(function (c) {
        if (c.key === "name") return '<td class="rank-name">' + r.name + "</td>";
        if (c.bar) {
          return '<td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
            '<div class="caption bar-value">' + usd(r.revenue) + "</div></td>";
        }
        return "<td>" + cellValue(r, c.key) + "</td>";
      }).join("");
      return '<tr data-index="' + r.index + '" tabindex="0"' + (r.index === selected ? ' aria-current="true"' : "") + ">" +
        cells + "</tr>";
    }).join("") : '<tr class="empty-row"><td colspan="' + columns.length + '">해당 조건에 데이터가 없습니다.</td></tr>';

    wrap.innerHTML = '<table class="ranking"><caption class="visually-hidden">' + headLabel +
      '별 매출 랭킹</caption><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  /* ---------- 각주 ---------- */
  function renderNotes() {
    var m = state.data.meta;
    var seg = {};
    m.segments.forEach(function (s) { seg[s.name] = s; });
    var items = [
      ["세그먼트 기준 (이 데이터 실측)",
        "Whale " + usd(seg.Whale.min) + " 이상 · Dolphin " + usd(seg.Dolphin.min) + "~" + usd(seg.Dolphin.max) +
        " · Minnow " + usd(seg.Minnow.max) + " 이하. 원본의 SpendingSegment 값을 그대로 사용했습니다."],
      ["ARPPU", "총 매출 ÷ 결제 유저 수. 결제하지 않은 유저는 분모에서 제외합니다."],
      ["결제 이력 없는 유저 " + num(m.nonPayers) + "명",
        "결제 금액이 비어 있어 매출 집계에서 제외했습니다. 전체 유저 수와 유저 비중 계산에는 포함됩니다."],
      ["국가 · 장르 결측 " + num(m.unknownDims) + "명",
        "국가 미상 " + num(m.unknownCountry) + "명은 국가 랭킹·지도에서, 장르 미상 " + num(m.unknownGenre) +
        "명은 장르 랭킹에서 제외했습니다(둘 다 미상인 유저 " +
        num(m.unknownCountry + m.unknownGenre - m.unknownDims) + "명). 그래서 랭킹의 매출 합계는 총 매출보다 작습니다."],
      ["지도 읽는 법",
        "원의 넓이가 선택한 지표(고래 매출 또는 고래 매출 비중)에 비례합니다. 고래가 없는 나라는 원이 표시되지 않습니다. 배경 지도는 Natural Earth 110m(퍼블릭 도메인) 데이터를 미리 SVG로 변환해 넣었습니다."],
      ["데이터 기준", "유저 " + num(m.users) + "명 · 결제 유저 " + num(m.payers) + "명 · 총 매출 " + usd(m.revenue) +
        " · 마지막 결제일 " + m.dateFrom + " ~ " + m.dateTo + " (스냅샷 1회분)"],
      ["추이 차트가 없는 이유",
        "원본에 '마지막 결제일' 한 컬럼만 있어 월별 매출로 집계하면 실제 매출 추이가 아니라 이탈 시점 분포가 됩니다. 오독을 피하려고 넣지 않았습니다."]
    ];
    el.notes.innerHTML = items.map(function (it) {
      return "<div><dt>" + it[0] + "</dt><dd>" + it[1] + "</dd></div>";
    }).join("");
  }

  /* ---------- tooltip ---------- */
  var tipAnchor = null;

  function tipContent(anchor) {
    var dynamic = anchor.getAttribute("data-tip-title");
    if (dynamic) return { title: dynamic, body: anchor.getAttribute("data-tip-body") || "" };
    return TIP[anchor.getAttribute("data-tip")] || null;
  }

  function showTip(anchor) {
    var tip = tipContent(anchor);
    if (!tip) return;
    tipAnchor = anchor;
    el.tooltip.innerHTML = "<strong>" + tip.title + "</strong>" + tip.body;
    el.tooltip.hidden = false;
    if (anchor.classList.contains("info-btn")) anchor.setAttribute("aria-expanded", "true");

    var box = anchor.getBoundingClientRect();
    var pop = el.tooltip.getBoundingClientRect();
    var left = box.left + window.scrollX + box.width / 2 - pop.width / 2;
    var maxLeft = window.scrollX + document.documentElement.clientWidth - pop.width - 8;
    var top = box.top + window.scrollY - pop.height - 8;
    if (top < window.scrollY + 4) top = box.bottom + window.scrollY + 8;
    el.tooltip.style.left = Math.max(window.scrollX + 8, Math.min(left, maxLeft)) + "px";
    el.tooltip.style.top = top + "px";
  }

  function hideTip() {
    if (tipAnchor && tipAnchor.classList.contains("info-btn")) tipAnchor.setAttribute("aria-expanded", "false");
    tipAnchor = null;
    el.tooltip.hidden = true;
  }

  function closest(node, selector) {
    return node && node.closest ? node.closest(selector) : null;
  }

  function bindTooltips() {
    document.addEventListener("mouseover", function (e) {
      var t = closest(e.target, "[data-tip],[data-tip-title]");
      if (t && t !== tipAnchor) showTip(t);
    });
    document.addEventListener("mouseout", function (e) {
      var t = closest(e.target, "[data-tip],[data-tip-title]");
      if (t && t === tipAnchor && !t.contains(e.relatedTarget)) hideTip();
    });
    document.addEventListener("focusin", function (e) {
      var t = closest(e.target, "[data-tip],[data-tip-title]");
      if (t) showTip(t); else if (tipAnchor) hideTip();
    });
    document.addEventListener("click", function (e) {
      var t = closest(e.target, "[data-tip],[data-tip-title]");
      if (t) { if (t === tipAnchor) hideTip(); else showTip(t); }
      else if (tipAnchor) hideTip();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideTip(); });
    window.addEventListener("scroll", function () { if (tipAnchor) hideTip(); }, { passive: true });
  }

  /* ---------- 렌더 ---------- */
  function fillSelect(select, names, allLabel) {
    select.innerHTML = '<option value="">' + allLabel + "</option>" +
      names.map(function (n, i) { return '<option value="' + i + '">' + n + "</option>"; }).join("");
  }

  function render() {
    var rows = state.data.rows.filter(function (r) { return matches(r, state.country, state.genre); });
    var cur = summarize(rows);
    var all = summarize(state.data.rows);

    el.countrySelect.value = state.country === null ? "" : String(state.country);
    el.genreSelect.value = state.genre === null ? "" : String(state.genre);
    var filtered = state.country !== null || state.genre !== null;
    el.reset.disabled = !filtered;
    el.filterSummary.textContent = filtered
      ? "필터: " + (state.country === null ? "전체 국가" : state.data.dims.country[state.country]) + " · " +
        (state.genre === null ? "전체 장르" : state.data.dims.genre[state.genre]) + " → 유저 " + num(cur.users) + "명"
      : "전체 유저 " + num(cur.users) + "명 · 국가 " + state.data.dims.country.length + "개 · 장르 " +
        state.data.dims.genre.length + "개";

    renderMap();
    renderKpi(cur, all);
    renderSegments(cur);
    renderRanking(el.countryTable, COUNTRY, state.countrySort, state.country);
    renderRanking(el.genreTable, GENRE, state.genreSort, state.genre);
  }

  /* ---------- 이벤트 ---------- */
  function bindTable(wrap, dimIndex) {
    var sortKey = dimIndex === COUNTRY ? "countrySort" : "genreSort";
    var dim = dimIndex === COUNTRY ? "country" : "genre";

    function activate(target) {
      var sortBtn = closest(target, "button[data-sort]");
      if (sortBtn) {
        var key = sortBtn.getAttribute("data-sort");
        if (state[sortKey].key === key) state[sortKey].dir *= -1;
        else state[sortKey] = { key: key, dir: -1 };
        render();
        return true;
      }
      var tr = closest(target, "tr[data-index]");
      if (tr) {
        var idx = Number(tr.getAttribute("data-index"));
        state[dim] = state[dim] === idx ? null : idx;
        render();
        return true;
      }
      return false;
    }

    wrap.addEventListener("click", function (e) { activate(e.target); });
    wrap.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (activate(e.target)) e.preventDefault();
    });
  }

  function selectBubble(bubble) {
    var idx = Number(bubble.getAttribute("data-index"));
    bounce(bubble);                       // 먼저 튀고, 그 다음 다시 그린다
    setTimeout(function () {
      state.country = state.country === idx ? null : idx;
      render();
      var next = el.map.querySelector('.map-bubble[data-index="' + idx + '"]');
      if (next && state.country === idx) bounce(next);
    }, 190);
  }

  function bindMap() {
    el.map.addEventListener("click", function (e) {
      var bubble = closest(e.target, ".map-bubble");
      if (bubble) selectBubble(bubble);
    });
    el.map.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var bubble = closest(e.target, ".map-bubble");
      if (bubble) { e.preventDefault(); selectBubble(bubble); }
    });

    Array.prototype.forEach.call(document.querySelectorAll(".metric-btn"), function (btn) {
      btn.addEventListener("click", function () {
        state.mapMetric = btn.getAttribute("data-metric");
        syncMetricButtons();
        renderMap();
      });
    });
    syncMetricButtons();
  }

  function syncMetricButtons() {
    Array.prototype.forEach.call(document.querySelectorAll(".metric-btn"), function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-metric") === state.mapMetric));
    });
  }

  /* 고래 아이콘을 누르면 쫀득하게 튄다 (지도 버블 · 세그먼트 카드 · 스택 바) */
  function bindWhaleBounce() {
    document.addEventListener("click", function (e) {
      var tile = closest(e.target, '[data-seg-tile="Whale"], [data-seg="Whale"]');
      if (!tile) return;
      var target = tile.querySelector(".seg-icon") || tile;
      bounce(target);
    });
  }

  function init(data, world) {
    state.data = data;
    state.world = world;
    fillSelect(el.countrySelect, data.dims.country, "전체 국가");
    fillSelect(el.genreSelect, data.dims.genre, "전체 장르");

    el.countrySelect.addEventListener("change", function () {
      state.country = this.value === "" ? null : Number(this.value);
      render();
    });
    el.genreSelect.addEventListener("change", function () {
      state.genre = this.value === "" ? null : Number(this.value);
      render();
    });
    el.reset.addEventListener("click", function () {
      state.country = null; state.genre = null; render();
    });

    bindTable(el.countryTable, COUNTRY);
    bindTable(el.genreTable, GENRE);
    bindMap();
    bindTooltips();
    bindWhaleBounce();

    var resizeTimer = null;
    function refit() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitStackLabels, 120);
    }
    window.addEventListener("resize", refit);
    if (window.ResizeObserver) new ResizeObserver(refit).observe(el.stackBar);

    renderNotes();
    render();
  }

  function loadJson(path) {
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error(path + " HTTP " + res.status);
      return res.json();
    });
  }

  Promise.all([loadJson("data/purchases.json"), loadJson("data/world.json")])
    .then(function (results) { init(results[0], results[1]); })
    .catch(function (err) {
      el.error.hidden = false;
      el.error.textContent = "데이터를 불러오지 못했습니다: " + err.message;
    });
})();
