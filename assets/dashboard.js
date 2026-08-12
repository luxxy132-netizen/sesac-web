/* Seoul apartment dashboard — vanilla JS, no dependencies. */
(function () {
  'use strict';

  var TREND_URL = 'data/trend.json';
  var COMPLEXES_URL = 'data/complexes.json';

  var state = {
    trend: null,
    gu: '서울전체',
    dealType: '매매',
    metric: 'ppp', // 'ppp' | 'price'
    sortKey: 'ppp',
    sortDir: 'desc',
    complexes: null,
    complexesLoading: false,
    complexesError: null,
    searchTimer: null
  };

  // ---------- formatting helpers ----------

  function fmtEok(manwon) {
    if (manwon === null || manwon === undefined) return '—';
    var eok = manwon / 10000;
    if (Math.abs(manwon) >= 10000) {
      return (Math.round(eok * 10) / 10).toFixed(1) + '억';
    }
    return Math.round(manwon).toLocaleString('ko-KR') + '만원';
  }

  function fmtManwon(v, unit) {
    if (v === null || v === undefined) return '—';
    return Math.round(v).toLocaleString('ko-KR') + (unit || '만원');
  }

  function fmtCount(v) {
    if (v === null || v === undefined) return '—';
    return v.toLocaleString('ko-KR') + '건';
  }

  function pctChange(cur, prev) {
    if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
    if (prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  }

  function fmtPct(p) {
    if (p === null || p === undefined) return '—';
    var sign = p > 0 ? '+' : '';
    return sign + p.toFixed(1) + '%';
  }

  function deltaDirection(p) {
    if (p === null || p === undefined) return 'na';
    if (p > 0.05) return 'up';
    if (p < -0.05) return 'down';
    return 'flat';
  }

  function arrowFor(dir) {
    if (dir === 'up') return '▲';
    if (dir === 'down') return '▼';
    if (dir === 'flat') return '＝';
    return '';
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  // ---------- data access ----------

  function getSeries(gu, dealType) {
    if (!state.trend) return [];
    var g = state.trend.series[gu];
    if (!g) return [];
    return g[dealType] || [];
  }

  // ---------- F1: KPI row ----------

  function renderKPIs() {
    var root = document.getElementById('kpiRow');
    root.innerHTML = '';
    var series = getSeries(state.gu, state.dealType);
    if (series.length === 0) {
      root.appendChild(el('p', { class: 'empty-state', text: '데이터가 없습니다.' }));
      return;
    }
    var last = series[series.length - 1];
    var prev = series.length >= 2 ? series[series.length - 2] : null;

    var cards = [
      {
        label: '중위가격 (' + last.ym + ')',
        value: fmtEok(last.medianPrice),
        title: last.medianPrice !== null ? last.medianPrice.toLocaleString('ko-KR') + '만원' : '',
        delta: pctChange(last.medianPrice, prev ? prev.medianPrice : null)
      },
      {
        label: '중위 평당가',
        value: fmtManwon(last.medianPpp, '만원/평'),
        delta: pctChange(last.medianPpp, prev ? prev.medianPpp : null)
      },
      {
        label: '거래량',
        value: fmtCount(last.count),
        delta: pctChange(last.count, prev ? prev.count : null),
        caveat: '최근월 잠정치'
      }
    ];

    if (state.dealType === '월세') {
      cards.push({
        label: '중위 월세',
        value: fmtManwon(last.medianRent, '만원'),
        delta: pctChange(last.medianRent, prev ? prev.medianRent : null)
      });
    }

    cards.forEach(function (c) {
      var dir = deltaDirection(c.delta);
      var deltaEl = el('span', {
        class: 'kpi-delta is-' + dir,
        'aria-label': (dir === 'up' ? '상승 ' : dir === 'down' ? '하락 ' : '보합 ') + fmtPct(c.delta)
      }, [
        document.createTextNode(arrowFor(dir) + ' ' + fmtPct(c.delta))
      ]);
      var valueEl = el('div', { class: 'kpi-value', text: c.value });
      if (c.title) valueEl.setAttribute('title', c.title);
      var subText = '전월 대비' + (c.caveat ? ' · ' + c.caveat : '');
      var subEl = el('div', { class: 'kpi-sub', text: subText });
      if (c.caveat) subEl.setAttribute('title', '최근월은 실거래 신고 지연으로 아직 반영되지 않은 거래가 있을 수 있습니다.');
      var card = el('div', { class: 'kpi-card' }, [
        el('div', { class: 'kpi-label', text: c.label }),
        valueEl,
        deltaEl,
        subEl
      ]);
      root.appendChild(card);
    });
  }

  // ---------- F2: trend chart ----------

  function renderChart() {
    var wrap = document.getElementById('chartSvgWrap');
    wrap.innerHTML = '';
    var series = getSeries(state.gu, state.dealType);
    var tooltip = document.getElementById('chartTooltip');

    if (series.length === 0) {
      wrap.appendChild(el('p', { class: 'empty-state', text: '데이터가 없습니다.' }));
      return;
    }

    var W = 720, H = 320;
    var padL = 56, padR = 16, padT = 16, padB = 36;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var metricKey = state.metric === 'ppp' ? 'medianPpp' : 'medianPrice';
    var values = series.map(function (d) { return d[metricKey]; }).filter(function (v) { return v !== null; });
    var counts = series.map(function (d) { return d.count || 0; });

    var vMax = values.length ? Math.max.apply(null, values) : 1;
    var vMin = values.length ? Math.min.apply(null, values) : 0;
    if (vMax === vMin) { vMax = vMax + 1; vMin = Math.max(0, vMin - 1); }
    var vPad = (vMax - vMin) * 0.15;
    vMax += vPad;
    vMin = Math.max(0, vMin - vPad);

    var cMax = Math.max.apply(null, counts.concat([1]));

    var n = series.length;
    var stepX = n > 1 ? plotW / (n - 1) : 0;

    function xAt(i) { return padL + i * stepX; }
    function yAt(v) {
      if (v === null || v === undefined) return null;
      return padT + plotH - ((v - vMin) / (vMax - vMin)) * plotH;
    }
    function barH(c) { return (c / cMax) * plotH; }

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', state.gu + ' ' + state.dealType + ' 12개월 추이 차트 (최근월은 신고 지연으로 인한 잠정치)');

    // hatch pattern used to mark the most recent (provisional) month's volume bar
    var defs = document.createElementNS(svgNS, 'defs');
    var pattern = document.createElementNS(svgNS, 'pattern');
    pattern.setAttribute('id', 'volProvisionalPattern');
    pattern.setAttribute('width', '6');
    pattern.setAttribute('height', '6');
    pattern.setAttribute('patternTransform', 'rotate(45)');
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    var patternBg = document.createElementNS(svgNS, 'rect');
    patternBg.setAttribute('width', '6'); patternBg.setAttribute('height', '6');
    patternBg.setAttribute('fill', 'var(--color-primary-bg)');
    var patternLine = document.createElementNS(svgNS, 'line');
    patternLine.setAttribute('x1', '0'); patternLine.setAttribute('y1', '0');
    patternLine.setAttribute('x2', '0'); patternLine.setAttribute('y2', '6');
    patternLine.setAttribute('stroke', 'var(--color-primary-normal)');
    patternLine.setAttribute('stroke-width', '2');
    patternLine.setAttribute('opacity', '0.45');
    pattern.appendChild(patternBg);
    pattern.appendChild(patternLine);
    defs.appendChild(pattern);
    svg.appendChild(defs);

    // gridlines (horizontal, 4 divisions)
    var gridG = document.createElementNS(svgNS, 'g');
    for (var gi = 0; gi <= 4; gi++) {
      var gv = vMin + ((vMax - vMin) * gi) / 4;
      var gy = yAt(gv);
      var line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
      line.setAttribute('y1', gy); line.setAttribute('y2', gy);
      line.setAttribute('stroke', 'var(--color-line-solid)');
      line.setAttribute('stroke-width', '1');
      gridG.appendChild(line);
      var label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', padL - 8);
      label.setAttribute('y', gy + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', 'var(--color-label-alternative)');
      label.textContent = Math.round(gv).toLocaleString('ko-KR');
      gridG.appendChild(label);
    }
    svg.appendChild(gridG);

    // volume bars (secondary scale)
    var barG = document.createElementNS(svgNS, 'g');
    var barW = Math.max(4, stepX * 0.5);
    var lastIdx = n - 1;
    series.forEach(function (d, i) {
      var h = barH(d.count || 0);
      var isProvisional = i === lastIdx;
      var rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', xAt(i) - barW / 2);
      rect.setAttribute('y', padT + plotH - h);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', h);
      if (isProvisional) {
        rect.setAttribute('fill', 'url(#volProvisionalPattern)');
        rect.setAttribute('stroke', 'var(--color-primary-normal)');
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('stroke-dasharray', '2 2');
        rect.setAttribute('aria-label', d.ym + ' 거래량 잠정치');
      } else {
        rect.setAttribute('fill', 'var(--color-primary-bg)');
      }
      barG.appendChild(rect);
    });
    svg.appendChild(barG);

    // month axis labels
    var narrow = window.innerWidth < 480;
    var axisG = document.createElementNS(svgNS, 'g');
    series.forEach(function (d, i) {
      if (narrow && i % 2 === 1) return;
      var t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', xAt(i));
      t.setAttribute('y', H - padB + 16);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '10');
      t.setAttribute('fill', 'var(--color-label-alternative)');
      t.textContent = d.ym.slice(5); // MM
      axisG.appendChild(t);
    });
    svg.appendChild(axisG);

    // line path, breaking on nulls; the segment leading into the final
    // (provisional) month is drawn dashed so it reads as not-yet-final
    var visiblePts = [];
    series.forEach(function (d, i) {
      var v = d[metricKey];
      var y = yAt(v);
      if (y === null) return;
      visiblePts.push({ i: i, x: xAt(i), y: y });
    });

    var lastVisible = visiblePts.length ? visiblePts[visiblePts.length - 1] : null;
    var lastIsProvisional = !!lastVisible && lastVisible.i === lastIdx;
    var prevVisible = visiblePts.length >= 2 ? visiblePts[visiblePts.length - 2] : null;

    // solid portion: every consecutive run, minus the final dashed edge
    var solidD = '';
    var drawing = false;
    series.forEach(function (d, i) {
      var v = d[metricKey];
      var y = yAt(v);
      if (y === null) { drawing = false; return; }
      var x = xAt(i);
      var isFinalDashedEdge = lastIsProvisional && prevVisible && i === lastIdx;
      if (isFinalDashedEdge) { drawing = false; return; } // stop solid path before the last point
      solidD += (drawing ? ' L ' : ' M ') + x + ' ' + y;
      drawing = true;
    });
    if (solidD) {
      var path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', solidD);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--color-primary-normal)');
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    }

    // dashed final edge (into the provisional month)
    if (lastIsProvisional && prevVisible) {
      var dashedPath = document.createElementNS(svgNS, 'path');
      dashedPath.setAttribute('d', 'M ' + prevVisible.x + ' ' + prevVisible.y + ' L ' + lastVisible.x + ' ' + lastVisible.y);
      dashedPath.setAttribute('fill', 'none');
      dashedPath.setAttribute('stroke', 'var(--color-primary-normal)');
      dashedPath.setAttribute('stroke-width', '2.5');
      dashedPath.setAttribute('stroke-linecap', 'round');
      dashedPath.setAttribute('stroke-dasharray', '5 4');
      svg.appendChild(dashedPath);
    }

    // points (with hover/tap targets)
    var pointG = document.createElementNS(svgNS, 'g');
    series.forEach(function (d, i) {
      var v = d[metricKey];
      var y = yAt(v);
      if (y === null) return;
      var x = xAt(i);

      var isProvisionalPoint = i === lastIdx;

      var hit = document.createElementNS(svgNS, 'circle');
      hit.setAttribute('cx', x);
      hit.setAttribute('cy', y);
      hit.setAttribute('r', 10);
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('class', 'chart-point');
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('role', 'img');
      hit.setAttribute('aria-label', d.ym + ' ' + (state.metric === 'ppp' ? '중위 평당가' : '중위가격') + ' ' + fmtManwon(v) + ', 거래량 ' + fmtCount(d.count) + (isProvisionalPoint ? ' (잠정치, 신고 지연 가능)' : ''));

      var dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      if (isProvisionalPoint) {
        // hollow ring instead of a solid dot marks this month as provisional
        dot.setAttribute('r', 4.5);
        dot.setAttribute('fill', 'var(--color-bg-normal)');
        dot.setAttribute('stroke', 'var(--color-primary-normal)');
        dot.setAttribute('stroke-width', '2');
        dot.setAttribute('stroke-dasharray', '2 1.5');
      } else {
        dot.setAttribute('r', 3.5);
        dot.setAttribute('fill', 'var(--color-primary-strong)');
      }

      function showTip() {
        var metricLabel = state.metric === 'ppp' ? '중위 평당가' : '중위가격';
        var valStr = state.metric === 'ppp' ? fmtManwon(v, '만원/평') : fmtEok(v);
        var provisionalNote = isProvisionalPoint ? ' <span style="opacity:.8">(잠정치)</span>' : '';
        tooltip.innerHTML = '<strong>' + d.ym + provisionalNote + '</strong><br>' + metricLabel + ': ' + valStr + '<br>거래량: ' + fmtCount(d.count) + (isProvisionalPoint ? ' (신고 지연으로 증가 가능)' : '');
        var rect = svg.getBoundingClientRect();
        var wrapRect = wrap.getBoundingClientRect();
        var scale = rect.width / W;
        var px = rect.left - wrapRect.left + x * scale + wrap.scrollLeft;
        var py = rect.top - wrapRect.top + y * scale;
        tooltip.style.left = px + 'px';
        tooltip.style.top = py + 'px';
        tooltip.classList.add('is-visible');
      }
      function hideTip() { tooltip.classList.remove('is-visible'); }

      hit.addEventListener('mouseenter', showTip);
      hit.addEventListener('mousemove', showTip);
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('focus', showTip);
      hit.addEventListener('blur', hideTip);
      hit.addEventListener('click', function (e) {
        e.stopPropagation();
        showTip();
      });

      pointG.appendChild(hit);
      pointG.appendChild(dot);
    });
    svg.appendChild(pointG);
    wrap.appendChild(svg);

    document.addEventListener('click', function onDocClick(e) {
      if (!wrap.contains(e.target)) { hideAllTooltip(); }
    }, { once: true });

    function hideAllTooltip() { tooltip.classList.remove('is-visible'); }
  }

  // ---------- F3: gu ranking ----------

  var RANK_COLUMNS = [
    { key: 'gu', label: '구' },
    { key: 'ppp', label: '중위 평당가' },
    { key: 'price', label: '중위가격' },
    { key: 'count', label: '거래량' },
    { key: 'change', label: '전월비' }
  ];

  function buildRankingRows() {
    if (!state.trend) return [];
    var gus = state.trend.meta.gus.filter(function (g) { return g !== '서울전체'; });
    return gus.map(function (gu) {
      var series = getSeries(gu, state.dealType);
      var last = series[series.length - 1] || {};
      var prev = series.length >= 2 ? series[series.length - 2] : null;
      return {
        gu: gu,
        ppp: last.medianPpp !== undefined ? last.medianPpp : null,
        price: last.medianPrice !== undefined ? last.medianPrice : null,
        count: last.count !== undefined ? last.count : null,
        change: pctChange(last.medianPpp, prev ? prev.medianPpp : null)
      };
    });
  }

  function renderRanking() {
    var container = document.getElementById('rankingTableWrap');
    container.innerHTML = '';
    var rows = buildRankingRows();

    rows.sort(function (a, b) {
      var av = a[state.sortKey], bv = b[state.sortKey];
      if (state.sortKey === 'gu') {
        return state.sortDir === 'asc' ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko');
      }
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return state.sortDir === 'asc' ? av - bv : bv - av;
    });

    var table = el('table', { class: 'ranking', 'aria-label': '구별 랭킹 (' + state.dealType + ')' });
    var thead = el('thead');
    var headRow = el('tr');
    RANK_COLUMNS.forEach(function (col) {
      var isSorted = state.sortKey === col.key;
      var th = el('th', {
        scope: 'col',
        'aria-sort': isSorted ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
      });
      var btn = el('button', {
        type: 'button',
        text: col.label + (isSorted ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : ''),
        onclick: function () {
          if (state.sortKey === col.key) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.sortKey = col.key;
            state.sortDir = col.key === 'gu' ? 'asc' : 'desc';
          }
          renderRanking();
        }
      });
      th.appendChild(btn);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (r) {
      var dir = deltaDirection(r.change);
      var bg = 'transparent';
      if (dir === 'up') {
        var alphaUp = Math.min(0.9, Math.abs(r.change || 0) / 10);
        bg = 'rgba(229, 34, 34, ' + (0.08 + alphaUp * 0.35).toFixed(2) + ')';
      } else if (dir === 'down') {
        var alphaDown = Math.min(0.9, Math.abs(r.change || 0) / 10);
        bg = 'rgba(37, 99, 235, ' + (0.08 + alphaDown * 0.35).toFixed(2) + ')';
      }
      var tr = el('tr', {
        'aria-current': r.gu === state.gu ? 'true' : 'false',
        tabindex: '0',
        role: 'button',
        'aria-label': r.gu + ' 선택',
        onclick: function () {
          state.gu = r.gu;
          document.getElementById('guSelect').value = r.gu;
          renderAll();
        },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            state.gu = r.gu;
            document.getElementById('guSelect').value = r.gu;
            renderAll();
          }
        }
      }, [
        el('td', { class: 'rank-name', text: r.gu }),
        el('td', { text: fmtManwon(r.ppp, '만원/평') }),
        el('td', { text: fmtEok(r.price) }),
        el('td', { text: fmtCount(r.count) }),
        el('td', { class: 'delta-cell', style: 'background:' + bg, text: (arrowFor(dir) + ' ' + fmtPct(r.change)).trim() })
      ]);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // ---------- F4: complex search ----------

  function ensureComplexesLoaded(cb) {
    if (state.complexes || state.complexesError) { cb(); return; }
    if (state.complexesLoading) return;
    state.complexesLoading = true;
    renderSearchStatus('단지 데이터를 불러오는 중입니다…');
    fetch(COMPLEXES_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.complexes = data.complexes || [];
        state.complexesLoading = false;
        renderSearchStatus('');
        cb();
      })
      .catch(function (err) {
        state.complexesLoading = false;
        state.complexesError = err;
        renderSearchStatus('');
        var resultsEl = document.getElementById('searchResults');
        resultsEl.innerHTML = '';
        resultsEl.appendChild(el('p', { class: 'error-state', text: '단지 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }));
      });
  }

  function renderSearchStatus(text) {
    document.getElementById('searchStatus').textContent = text;
  }

  function renderSearchResults() {
    var input = document.getElementById('complexSearch');
    var q = input.value.trim();
    var resultsEl = document.getElementById('searchResults');
    resultsEl.innerHTML = '';

    if (state.complexesLoading) return;
    if (state.complexesError) return;
    if (!state.complexes) return;

    if (!q) {
      renderSearchStatus('단지명을 입력해 검색하세요. (전체 ' + state.complexes.length.toLocaleString('ko-KR') + '개 단지)');
      return;
    }

    var matches = state.complexes.filter(function (c) { return c.name.indexOf(q) !== -1; }).slice(0, 30);

    if (matches.length === 0) {
      renderSearchStatus('');
      resultsEl.appendChild(el('p', { class: 'empty-state', text: '"' + q + '"과 일치하는 단지가 없습니다.' }));
      return;
    }

    renderSearchStatus(matches.length + '개 결과 (최대 30개 표시)');

    matches.forEach(function (c) {
      var maemae = c.counts && c.counts['매매'] ? c.counts['매매'] : 0;
      var jeonse = c.counts && c.counts['전세'] ? c.counts['전세'] : 0;
      var wolse = (c.counts && c.counts['월세']) || 0;
      var item = el('div', { class: 'complex-item' }, [
        el('div', { class: 'complex-main' }, [
          el('span', { class: 'complex-name', text: c.name }),
          el('span', { class: 'complex-loc', text: (c.gu || '') + ' · ' + (c.dong || '') })
        ]),
        el('div', { class: 'complex-stats' }, [
          el('span', { html: '매매 <strong>' + maemae + '</strong> · 전세 <strong>' + jeonse + '</strong> · 월세 <strong>' + wolse + '</strong>' }),
          el('span', { html: '평당가 <strong>' + fmtManwon(c.medianPpp, '만원/평') + '</strong>' }),
          el('span', { html: '거래가 <strong>' + fmtEok(c.medianPrice) + '</strong>' }),
          el('span', { html: '최근거래 <strong>' + (c.lastDate || '—') + '</strong>' })
        ])
      ]);
      resultsEl.appendChild(item);
    });
  }

  function debouncedSearch() {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(function () {
      ensureComplexesLoaded(renderSearchResults);
    }, 150);
  }

  // ---------- controls ----------

  function renderControls() {
    var guSelect = document.getElementById('guSelect');
    guSelect.innerHTML = '';
    state.trend.meta.gus.forEach(function (gu) {
      var opt = el('option', { value: gu, text: gu });
      guSelect.appendChild(opt);
    });
    guSelect.value = state.gu;
    guSelect.addEventListener('change', function () {
      state.gu = guSelect.value;
      renderAll();
    });

    var tabsWrap = document.getElementById('dealTypeTabs');
    tabsWrap.innerHTML = '';
    state.trend.meta.dealTypes.forEach(function (dt) {
      var btn = el('button', {
        type: 'button',
        class: 'tab-btn',
        role: 'tab',
        id: 'tab-' + dt,
        'aria-selected': dt === state.dealType ? 'true' : 'false',
        text: dt,
        onclick: function () {
          state.dealType = dt;
          if (state.sortKey === 'change' && dt !== '월세') { /* no-op */ }
          renderAll();
        }
      });
      tabsWrap.appendChild(btn);
    });

    var metricToggle = document.getElementById('metricToggle');
    metricToggle.innerHTML = '';
    [{ key: 'ppp', label: '평당가' }, { key: 'price', label: '가격' }].forEach(function (m) {
      var btn = el('button', {
        type: 'button',
        class: 'metric-btn',
        'aria-pressed': state.metric === m.key ? 'true' : 'false',
        text: m.label,
        onclick: function () {
          state.metric = m.key;
          renderControls_metricOnly();
          renderChart();
        }
      });
      metricToggle.appendChild(btn);
    });
  }

  function renderControls_metricOnly() {
    var buttons = document.querySelectorAll('#metricToggle .metric-btn');
    buttons.forEach(function (b) {
      var isPpp = b.textContent === '평당가';
      var active = (isPpp && state.metric === 'ppp') || (!isPpp && state.metric === 'price');
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateTabsUI() {
    document.querySelectorAll('#dealTypeTabs .tab-btn').forEach(function (b) {
      b.setAttribute('aria-selected', b.textContent === state.dealType ? 'true' : 'false');
    });
  }

  function renderProvisionalNote() {
    var noteEl = document.getElementById('provisionalNote');
    if (!noteEl || !state.trend) return;
    var months = state.trend.meta.months;
    var lastYm = months[months.length - 1];
    noteEl.textContent = 'ⓘ 최근월(' + lastYm + ')은 실거래 신고 지연으로 거래량이 실제보다 적게 집계될 수 있습니다.';
  }

  function renderAll() {
    updateTabsUI();
    renderProvisionalNote();
    renderKPIs();
    renderChart();
    renderRanking();
    var heading = document.getElementById('selectionSummary');
    if (heading) heading.textContent = state.gu + ' · ' + state.dealType;
  }

  // ---------- init ----------

  function init() {
    var errorBanner = document.getElementById('errorBanner');
    fetch(TREND_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.trend = data;
        renderControls();
        renderAll();
      })
      .catch(function (err) {
        errorBanner.hidden = false;
        errorBanner.textContent = '시세 데이터를 불러오지 못했습니다 (' + err.message + '). 새로고침 후 다시 시도해 주세요.';
      });

    var searchInput = document.getElementById('complexSearch');
    var focused = false;
    searchInput.addEventListener('focus', function () {
      if (!focused) {
        focused = true;
        ensureComplexesLoaded(renderSearchResults);
      }
    });
    searchInput.addEventListener('input', debouncedSearch);

    window.addEventListener('resize', function () {
      if (state.trend) renderChart();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
