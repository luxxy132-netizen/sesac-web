/* 모바일 게임 인앱 결제 대시보드
   데이터: data/purchases.json — rows = [countryIdx, genreIdx, segmentIdx, amountUSD]
   amount -1 = 결제 이력 없음, dim -1 = 인구통계 결측 */
(function () {
  "use strict";

  var COUNTRY = 0, GENRE = 1, SEGMENT = 2, AMOUNT = 3;
  var SEG_COLOR = { Whale: "var(--seg-whale)", Dolphin: "var(--seg-dolphin)", Minnow: "var(--seg-minnow)" };
  var SEG_KO = { Whale: "고래 Whale", Dolphin: "돌고래 Dolphin", Minnow: "피라미 Minnow" };

  var state = {
    data: null,
    country: null,           // dim index or null(전체)
    genre: null,
    countrySort: { key: "revenue", dir: -1 },
    genreSort: { key: "revenue", dir: -1 }
  };

  var el = {
    error: document.getElementById("errorBanner"),
    countrySelect: document.getElementById("countrySelect"),
    genreSelect: document.getElementById("genreSelect"),
    reset: document.getElementById("resetBtn"),
    filterSummary: document.getElementById("filterSummary"),
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

  /* ---------- aggregation ---------- */
  function matches(row, country, genre) {
    return (country === null || row[COUNTRY] === country) &&
           (genre === null || row[GENRE] === genre);
  }

  function summarize(rows) {
    var segCount = state.data.dims.segment.length;
    var out = {
      users: rows.length,
      payers: 0,
      revenue: 0,
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

  /* 랭킹은 교차 필터: 국가 랭킹은 장르 필터만, 장르 랭킹은 국가 필터만 반영한다.
     (선택한 축은 전체 목록을 유지해 비교 맥락을 잃지 않기 위함) */
  function rankBy(dimIndex) {
    var names = dimIndex === COUNTRY ? state.data.dims.country : state.data.dims.genre;
    var buckets = names.map(function (name, i) {
      return { index: i, name: name, revenue: 0, payers: 0, users: 0, whales: 0 };
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
      if (r[AMOUNT] >= 0) { b.payers++; b.revenue += r[AMOUNT]; }
    }
    buckets.forEach(function (b) { b.arppu = b.payers ? b.revenue / b.payers : 0; });
    return buckets.filter(function (b) { return b.users > 0; });
  }

  /* ---------- render: KPI ---------- */
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

  function renderKpi(cur, all) {
    var filtered = state.country !== null || state.genre !== null;
    var whaleIdx = state.data.dims.segment.indexOf("Whale");
    var cards = [
      {
        label: "총 매출",
        value: usd(cur.revenue),
        sub: filtered ? "전체 매출의 " + pct(cur.revenue, all.revenue) : "결제 유저 " + num(cur.payers) + "명 합계"
      },
      {
        label: "결제 유저", tip: "payers",
        value: num(cur.payers) + "명",
        sub: "전체 " + num(cur.users) + "명 중 " + pct(cur.payers, cur.users, 1)
      },
      {
        label: "ARPPU", tip: "arppu",
        value: usd(cur.arppu, 2),
        sub: filtered ? "전체 평균 " + usd(all.arppu, 2) : "결제 유저 1인당 평균 결제액"
      },
      {
        label: "고래 매출 비중", tip: "whaleShare",
        value: pct(cur.segRevenue[whaleIdx], cur.revenue),
        sub: "고래 " + num(cur.segUsers[whaleIdx]) + "명 (유저의 " + pct(cur.segUsers[whaleIdx], cur.users) + ")"
      }
    ];

    el.kpiRow.innerHTML = cards.map(function (c) {
      return '<article class="kpi-card">' +
        '<h3 class="kpi-label">' + c.label + (c.tip ? infoBtn(c.tip) : "") + "</h3>" +
        '<p class="kpi-value">' + c.value + "</p>" +
        '<p class="kpi-sub">' + c.sub + "</p>" +
        "</article>";
    }).join("");
  }

  /* ---------- render: segments ---------- */
  function renderSegments(cur) {
    var segs = state.data.dims.segment.map(function (name, i) {
      return {
        name: name,
        color: SEG_COLOR[name],
        users: cur.segUsers[i],
        payers: cur.segPayers[i],
        revenue: cur.segRevenue[i],
        arppu: cur.segPayers[i] ? cur.segRevenue[i] / cur.segPayers[i] : 0
      };
    });

    var whale = segs.find(function (s) { return s.name === "Whale"; }) || segs[0];
    el.segmentHeadline.innerHTML = cur.revenue
      ? "지금 화면에서 <strong>고래 " + num(whale.users) + "명(유저의 " + pct(whale.users, cur.users) +
        ")</strong>이 매출의 <strong>" + pct(whale.revenue, cur.revenue) + "</strong>를 만들고 있습니다."
      : "선택한 조건에 결제 데이터가 없습니다.";

    // 100% 매출 비중 스택 — 라벨은 들어갈 자리가 있을 때만(≥12%), 나머지는 범례·툴팁이 담당
    el.stackBar.innerHTML = segs.filter(function (s) { return s.revenue > 0; }).map(function (s) {
      var share = cur.revenue ? s.revenue / cur.revenue : 0;
      var label = SEG_KO[s.name].split(" ")[0] + " " + pct(s.revenue, cur.revenue, 0);
      return '<div class="stack-seg" style="flex:' + Math.max(share, 0.002) + ';background:' + s.color + '"' +
        ' data-label="' + label + '" data-tip="' + s.name + '" tabindex="0" role="img"' +
        ' aria-label="' + SEG_KO[s.name] + " 매출 " + usd(s.revenue) + ", 비중 " + pct(s.revenue, cur.revenue) + '">' +
        label + "</div>";
    }).join("");

    if (!el.stackBar.children.length) {
      el.stackBar.innerHTML = '<p class="caption" style="margin:0">표시할 매출이 없습니다.</p>';
    }
    fitStackLabels();

    el.stackLegend.innerHTML = segs.map(function (s) {
      return '<span><span class="swatch" style="background:' + s.color + '"></span>' +
        SEG_KO[s.name] + " · " + pct(s.revenue, cur.revenue) + "</span>";
    }).join("");

    el.segmentGrid.innerHTML = segs.map(function (s) {
      return '<article class="segment-tile">' +
        '<h3 class="segment-tile-head"><span class="segment-dot" style="background:' + s.color + '"></span>' +
        SEG_KO[s.name] + infoBtn(s.name) + "</h3>" +
        '<p class="segment-share">' + pct(s.revenue, cur.revenue) + '<span class="caption"> 매출 비중</span></p>' +
        '<div class="segment-stats">' +
        "<span>유저 <strong>" + num(s.users) + "명 (" + pct(s.users, cur.users) + ")</strong></span>" +
        "<span>매출 <strong>" + usd(s.revenue) + "</strong></span>" +
        "<span>ARPPU <strong>" + usd(s.arppu, 2) + "</strong></span>" +
        "</div></article>";
    }).join("");
  }

  /* 잘린 라벨을 두느니 지운다 — 값은 범례·툴팁·세그먼트 카드가 그대로 갖고 있다.
     data-label에 원래 문구를 보관해 화면이 넓어지면 되살린다. */
  function fitStackLabels() {
    Array.prototype.forEach.call(el.stackBar.children, function (seg) {
      var label = seg.getAttribute("data-label") || "";
      if (!label) return;
      seg.textContent = label;
      if (seg.scrollWidth > seg.clientWidth) seg.textContent = "";
    });
  }

  /* ---------- render: rankings ---------- */
  var COLUMNS = [
    { key: "name", label: "이름", sortable: false },
    { key: "revenue", label: "매출", bar: true },
    { key: "payers", label: "결제자" },
    { key: "arppu", label: "ARPPU" },
    { key: "whales", label: "고래" }
  ];

  function renderRanking(wrap, dimIndex, sort, selected, headLabel) {
    var rows = rankBy(dimIndex).sort(function (a, b) {
      var d = (a[sort.key] - b[sort.key]) * sort.dir;
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    var max = rows.reduce(function (m, r) { return Math.max(m, r.revenue); }, 0);

    var head = COLUMNS.map(function (c) {
      var label = c.key === "name" ? headLabel : c.label;
      if (c.sortable === false) return "<th>" + label + "</th>";
      var active = sort.key === c.key;
      var arrow = active ? (sort.dir < 0 ? " ↓" : " ↑") : "";
      return '<th aria-sort="' + (active ? (sort.dir < 0 ? "descending" : "ascending") : "none") + '">' +
        '<button type="button" data-sort="' + c.key + '">' + label + arrow + "</button></th>";
    }).join("");

    var body = rows.length ? rows.map(function (r) {
      var w = max ? Math.max(r.revenue / max * 100, 1) : 0;
      return '<tr data-index="' + r.index + '" tabindex="0"' +
        (r.index === selected ? ' aria-current="true"' : "") + ">" +
        '<td class="rank-name">' + r.name + "</td>" +
        '<td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
        '<div class="caption bar-value">' + usd(r.revenue) + "</div></td>" +
        "<td>" + num(r.payers) + "</td>" +
        "<td>" + usd(r.arppu, 0) + "</td>" +
        "<td>" + num(r.whales) + "</td>" +
        "</tr>";
    }).join("") : '<tr class="empty-row"><td colspan="5">해당 조건에 데이터가 없습니다.</td></tr>';

    // 막대 아래 금액을 함께 두어, 막대 없이 표만으로도 값이 읽히게 한다
    wrap.innerHTML = '<table class="ranking"><caption class="visually-hidden">' + headLabel +
      '별 매출 랭킹</caption><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  /* ---------- render: notes ---------- */
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
        "국가 미상 " + num(m.unknownCountry) + "명은 국가 랭킹에서, 장르 미상 " + num(m.unknownGenre) +
        "명은 장르 랭킹에서 제외했습니다(둘 다 미상인 유저 " +
        num(m.unknownCountry + m.unknownGenre - m.unknownDims) + "명). 그래서 랭킹의 매출 합계는 총 매출보다 작습니다."],
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

  function showTip(anchor) {
    var key = anchor.getAttribute("data-tip");
    var tip = TIP[key];
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

  function bindTooltips() {
    document.addEventListener("mouseover", function (e) {
      var t = e.target.closest("[data-tip]");
      if (t && t !== tipAnchor) showTip(t);
    });
    document.addEventListener("mouseout", function (e) {
      var t = e.target.closest("[data-tip]");
      if (t && t === tipAnchor && !t.contains(e.relatedTarget)) hideTip();
    });
    document.addEventListener("focusin", function (e) {
      var t = e.target.closest("[data-tip]");
      if (t) showTip(t); else if (tipAnchor) hideTip();
    });
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tip]");
      if (t) { if (t === tipAnchor) hideTip(); else showTip(t); }
      else if (tipAnchor) hideTip();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideTip(); });
    window.addEventListener("scroll", function () { if (tipAnchor) hideTip(); }, { passive: true });
  }

  /* ---------- wiring ---------- */
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
      : "전체 유저 " + num(cur.users) + "명 · 국가 " + state.data.dims.country.length + "개 · 장르 " + state.data.dims.genre.length + "개";

    renderKpi(cur, all);
    renderSegments(cur);
    renderRanking(el.countryTable, COUNTRY, state.countrySort, state.country, "국가");
    renderRanking(el.genreTable, GENRE, state.genreSort, state.genre, "장르");
  }

  function bindTable(wrap, dimIndex) {
    var sort = dimIndex === COUNTRY ? "countrySort" : "genreSort";
    var dim = dimIndex === COUNTRY ? "country" : "genre";

    function activate(target) {
      var sortBtn = target.closest("button[data-sort]");
      if (sortBtn) {
        var key = sortBtn.getAttribute("data-sort");
        if (state[sort].key === key) state[sort].dir *= -1;
        else state[sort] = { key: key, dir: -1 };
        render();
        return true;
      }
      var tr = target.closest("tr[data-index]");
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

  function init(data) {
    state.data = data;
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
    bindTooltips();

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

  fetch("data/purchases.json")
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(init)
    .catch(function (err) {
      el.error.hidden = false;
      el.error.textContent = "데이터를 불러오지 못했습니다: " + err.message;
    });
})();
