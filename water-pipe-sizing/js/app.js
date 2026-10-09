/* アプリ本体：状態管理・タブ・設定・マスタ・保存/読込 */
(function (WPS) {
  'use strict';
  const U = WPS.util;
  const h = U.h;
  const STORE_KEY = 'wps.project.v1';
  const FILE_VERSION = 1;

  const DEFAULT_SETTINGS = {
    projectName: '',
    author: '',
    material: 'HIVP',
    supply: 'up',
    sourcePressure: 250,
    sourceZ: 0,
    vmax: 2.0,
    equivFactor: 2.0,
    usage: 'public',
    curve: 'auto',
    minDn: 13,
    connPriority: true,
    fixtureHeight: 0.8,
    pipeZ: 0.3,
  };

  function newProject() {
    return {
      version: FILE_VERSION,
      mode: 'simple',
      settings: U.clone(DEFAULT_SETTINGS),
      masters: { fixtures: U.clone(WPS.DEFAULT_FIXTURES), pipes: U.clone(WPS.DEFAULT_PIPES) },
      simple: WPS.simple.defaultSimple(),
      trace: WPS.trace.defaultTrace(),
    };
  }

  function normalize(p) {
    const base = newProject();
    if (!p || typeof p !== 'object') return base;
    return {
      version: FILE_VERSION,
      mode: p.mode === 'trace' ? 'trace' : 'simple',
      settings: Object.assign(base.settings, p.settings || {}),
      masters: {
        fixtures: Array.isArray(p.masters && p.masters.fixtures) && p.masters.fixtures.length ? p.masters.fixtures : base.masters.fixtures,
        pipes: Array.isArray(p.masters && p.masters.pipes) && p.masters.pipes.length ? p.masters.pipes : base.masters.pipes,
      },
      simple: p.simple && Array.isArray(p.simple.floors) ? Object.assign(base.simple, p.simple) : base.simple,
      trace: p.trace && Array.isArray(p.trace.pages) && p.trace.pages.length ? Object.assign(base.trace, p.trace) : base.trace,
    };
  }

  const app = {
    state: normalize(U.storage.get(STORE_KEY)),
    net: null,
    result: null,
    tab: 'settings',
    changed: null,
  };

  /* ---------- 計算 ---------- */
  function buildNetwork() {
    return app.state.mode === 'trace' ? WPS.trace.build(app.state) : WPS.simple.build(app.state);
  }

  function recalc() {
    try {
      app.net = buildNetwork();
      app.result = WPS.network.compute(app.net, app.state.settings, app.state.masters);
    } catch (err) {
      console.error(err);
      app.result = { edges: [], fixtures: [], warnings: [], errors: ['計算中にエラーが発生しました: ' + err.message], summary: null, tree: null, edgeById: {}, nodePressure: {} };
    }
    U.storage.set(STORE_KEY, app.state);
    updateBadge();
    renderTab(false);
  }
  const recalcSoon = U.debounce(recalc, 120);
  app.changed = () => recalcSoon();

  function updateBadge() {
    const el = document.getElementById('status-badge');
    if (!el) return;
    const r = app.result;
    if (!r || r.errors.length) { el.className = 'badge bad'; el.textContent = r && r.errors.length ? '入力不足' : '—'; return; }
    const s = r.summary;
    const ok = s && s.sourcePressure >= s.requiredPressure - 1e-9 && !s.ngEdges && !s.ngFixtures;
    el.className = 'badge ' + (ok ? 'good' : 'bad');
    el.textContent = ok ? `適合　主管 ${s.mainSize}` : `要確認　必要起点圧力 ${U.fmt(s.requiredPressure, 0)} kPa`;
  }

  /* ---------- タブ ---------- */
  const TABS = [
    { id: 'settings', label: '設計条件' },
    { id: 'input', label: '入力・作図' },
    { id: 'results', label: '計算結果' },
    { id: 'riser', label: '系統図' },
    { id: 'plan', label: '平面図' },
    { id: 'masters', label: 'マスタ' },
    { id: 'report', label: '計算書' },
  ];

  function setTab(id) {
    app.tab = id;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + id; });
    try { localStorage.setItem('wps.tab', id); } catch (e) { /* noop */ }
    renderTab(true);
  }

  function renderTab(full) {
    switch (app.tab) {
      case 'settings': if (full) renderSettings(); break;
      case 'input': renderInput(full); break;
      case 'results': renderResults(); break;
      case 'riser': renderRiser(); break;
      case 'plan': if (full) renderPlan(); break;
      case 'masters': if (full) renderMasters(); break;
      case 'report': if (full) renderReport(); break;
      default: break;
    }
  }

  /* ---------- 設計条件 ---------- */
  function field(label, input, help) {
    return h('label', { class: 'field' }, h('span', null, label), input, help ? h('small', { class: 'help' }, help) : null);
  }

  function bindNum(obj, key, attrs) {
    return h('input', Object.assign({
      class: 'input num', type: 'number', step: 'any', value: obj[key],
      onchange: (e) => { obj[key] = U.num(e.target.value, obj[key]); app.changed(); },
    }, attrs || {}));
  }

  function bindText(obj, key, attrs) {
    return h('input', Object.assign({
      class: 'input', type: 'text', value: obj[key] || '',
      onchange: (e) => { obj[key] = e.target.value; app.changed(); },
    }, attrs || {}));
  }

  function bindSelect(obj, key, options, after) {
    return h('select', {
      class: 'input', onchange: (e) => {
        const v = e.target.value;
        obj[key] = typeof obj[key] === 'number' ? +v : v;
        app.changed();
        if (after) after();
      },
    }, options.map(([v, l]) => h('option', { value: v, selected: String(obj[key]) === String(v) ? 'selected' : null }, l)));
  }

  function segmented(obj, key, options, after) {
    const wrap = h('div', { class: 'segmented' });
    options.forEach(([v, l]) => {
      wrap.append(h('button', {
        class: obj[key] === v ? 'active' : '', type: 'button',
        onclick: () => { obj[key] = v; app.changed(); if (after) after(); else renderSettings(); },
      }, l));
    });
    return wrap;
  }

  function renderSettings() {
    const s = app.state.settings;
    const root = document.getElementById('view-settings');
    root.innerHTML = '';
    const pipes = app.state.masters.pipes.map((p) => [p.id, p.name]);
    const minOptions = [];
    const mat = app.state.masters.pipes.find((p) => p.id === s.material) || app.state.masters.pipes[0];
    [10, 13, 15, 16, 20, 25].forEach((d) => minOptions.push([d, d + ' mm']));
    root.append(
      h('div', { class: 'page-head' },
        h('h2', null, '設計条件'),
        h('p', { class: 'lead' }, '口径算定の前提を設定します。変更するとすぐに再計算されます。')),
      h('section', { class: 'card' },
        h('h3', null, '物件'),
        h('div', { class: 'grid2' },
          field('物件名', bindText(s, 'projectName', { placeholder: '例：〇〇ビル新築工事' })),
          field('作成者', bindText(s, 'author')))),
      h('section', { class: 'card' },
        h('h3', null, '給水方式と起点'),
        field('給水方式', segmented(s, 'supply', [['up', '上向き（直結・増圧・ポンプ直送）'], ['down', '下向き（高置水槽）']])),
        h('div', { class: 'grid2' },
          field('起点圧力 [kPa]', bindNum(s, 'sourcePressure'), s.supply === 'down' ? '高置水槽は通常 0（水槽水面＝起点高さとし、落差で圧力を得る）' : '配水管の最小動水圧、または増圧・ポンプの吐出圧'),
          field('起点の高さ [m]', bindNum(s, 'sourceZ'), s.supply === 'down' ? '最下階FL基準の水槽低水位（LWL）' : '最下階FL基準の引込・ポンプ位置（GL付近なら 0 前後）')),
        h('div', { class: 'grid2' },
          field('横引き配管の高さ FL+ [m]', bindNum(s, 'pipeZ'), '簡易定義モードで使用（PDFトレースはページごとに設定）'),
          field('器具取付高さ（既定値）[m]', bindNum(s, 'fixtureHeight'), 'マスタで器具ごとに指定がない場合に使用'))),
      h('section', { class: 'card' },
        h('h3', null, '計算方法'),
        h('div', { class: 'grid2' },
          field('管種', bindSelect(s, 'material', pipes, renderSettings), mat ? `C = ${mat.C}（${mat.note || ''}）` : ''),
          field('最小口径', bindSelect(s, 'minDn', minOptions))),
        h('div', { class: 'grid2' },
          field('器具の用途区分', segmented(s, 'usage', [['public', '公衆用'], ['private', '私室用']]), '器具給水負荷単位の列を切り替えます'),
          field('同時使用流量線図', bindSelect(s, 'curve', [['auto', '自動（下流に洗浄弁があれば①）'], ['valve', '①大便器洗浄弁が多い場合'], ['tank', '②大便器洗浄タンクが多い場合']]))),
        h('div', { class: 'grid2' },
          field('流速の上限 [m/s]', bindNum(s, 'vmax', { min: 0.3, max: 4 }), '一般に 2.0 m/s 以下'),
          field('相当長の倍率（実長 × α）', bindNum(s, 'equivFactor', { min: 1, max: 4 }), '継手・弁類の局部損失を見込む係数。一般に 1.5〜2.0')),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: s.connPriority, onchange: (e) => { s.connPriority = e.target.checked; app.changed(); } }),
          '器具単独の枝管は器具の接続口径を優先する（流速上限の判定から除外）')),
      h('section', { class: 'card muted-card' },
        h('h3', null, '計算の考え方'),
        h('ol', { class: 'steps' },
          h('li', null, '各区間の下流にある器具の給水負荷単位を合計し、同時使用流量線図から流量を求めます。'),
          h('li', null, '器具ごとに「(起点圧力 − 必要圧力 − 静水頭) ÷ 相当長」で許容摩擦損失を求め、区間ごとに最も厳しい値を採ります。'),
          h('li', null, 'ヘーゼン・ウィリアムス式で、流速上限と許容摩擦損失の両方を満たす最小口径を選び、下流より細くならないよう補正します。'),
          h('li', null, '決定口径で全器具の残圧を検算し、必要起点圧力を求めます。'))));
  }

  /* ---------- 入力・作図 ---------- */
  let traceInited = false;
  function renderInput(full) {
    const root = document.getElementById('view-input');
    const mode = app.state.mode;
    if (full || !root.dataset.mode || root.dataset.mode !== mode) {
      root.dataset.mode = mode;
      const head = root.querySelector('.input-head') || h('div', { class: 'input-head' });
      head.innerHTML = '';
      const seg = h('div', { class: 'segmented big' },
        h('button', { class: mode === 'simple' ? 'active' : '', onclick: () => switchMode('simple') }, '簡易定義（階・エリア・器具数）'),
        h('button', { class: mode === 'trace' ? 'active' : '', onclick: () => switchMode('trace') }, 'PDFトレース（図面から作図）'));
      head.append(h('div', { class: 'page-head row' },
        h('div', null, h('h2', null, '入力・作図'),
          h('p', { class: 'lead' }, mode === 'simple' ? '階ごとの水廻りエリアと器具数から、給水系統を自動で組み立てます。' : 'PDF図面の上で給水配管をなぞり、器具と水源を配置します。ページ＝階として扱います。')),
        seg));
      if (!head.parentNode) root.prepend(head);
      let simpleBox = root.querySelector('.simple-box');
      let traceBox = root.querySelector('.trace-box');
      if (!simpleBox) { simpleBox = h('div', { class: 'simple-box' }); root.append(simpleBox); }
      if (!traceBox) { traceBox = h('div', { class: 'trace-box' }); root.append(traceBox); }
      simpleBox.hidden = mode !== 'simple';
      traceBox.hidden = mode !== 'trace';
      if (mode === 'simple') renderSimple();
      else {
        if (!traceInited) { WPS.trace.init(traceBox, app); traceInited = true; }
        WPS.trace.onShow();
      }
    } else if (mode === 'trace') {
      WPS.trace.draw();
    }
  }

  function renderSimple() {
    const box = document.querySelector('#view-input .simple-box');
    const scrollY = window.scrollY;
    WPS.simple.render(box, app.state, (structural) => {
      app.changed();
      if (structural) { renderSimple(); }
    });
    window.scrollTo(0, scrollY);
  }

  function switchMode(mode) {
    app.state.mode = mode;
    app.changed();
    renderInput(true);
  }

  /* ---------- 計算結果 ---------- */
  function renderResults() {
    const root = document.getElementById('view-results');
    const r = app.result;
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head row' },
      h('div', null, h('h2', null, '計算結果'), h('p', { class: 'lead' }, '区間ごとの流量・口径・損失と、器具ごとの残圧です。')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn-secondary', onclick: () => U.download(fileBase() + '_区間計算.csv', WPS.report.csvEdges(app.result), 'text/csv') }, '区間表 CSV'),
        h('button', { class: 'btn-secondary', onclick: () => U.download(fileBase() + '_器具残圧.csv', WPS.report.csvFixtures(app.result), 'text/csv') }, '器具表 CSV'))));
    if (!r) return;
    const wrap = h('div', { html: WPS.report.summaryCards(r, app.state.settings) + WPS.report.messages(r) });
    root.append(wrap);
    if (r.edges.length) {
      root.append(h('section', { class: 'card flush' }, h('h3', null, '区間別計算表'), h('div', { class: 'table-wrap', html: WPS.report.edgeTable(r) })));
      root.append(h('section', { class: 'card flush' }, h('h3', null, '器具別残圧'), h('div', { class: 'table-wrap', html: WPS.report.fixtureTable(r) })));
    }
  }

  /* ---------- 系統図 ---------- */
  const riserOpts = { showFlow: false, zoom: 1 };
  function renderRiser() {
    const root = document.getElementById('view-riser');
    root.innerHTML = '';
    const svg = WPS.riser.render(app.net, app.result, { showFlow: riserOpts.showFlow });
    const holder = h('div', { class: 'svg-holder', html: svg });
    const svgEl = holder.querySelector('svg');
    const applyZoom = () => {
      if (!svgEl) return;
      svgEl.style.width = (svgEl.viewBox.baseVal.width * riserOpts.zoom) + 'px';
      svgEl.style.height = (svgEl.viewBox.baseVal.height * riserOpts.zoom) + 'px';
    };
    applyZoom();
    root.append(
      h('div', { class: 'page-head row' },
        h('div', null, h('h2', null, '給水系統図'), h('p', { class: 'lead' }, '計算結果から自動生成した系統図です。線色は判定（青＝適合、橙＝注意、赤＝不適合）を表します。')),
        h('div', { class: 'actions' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: riserOpts.showFlow, onchange: (e) => { riserOpts.showFlow = e.target.checked; renderRiser(); } }), '流量を表示'),
          h('button', { class: 'btn-secondary', onclick: () => { riserOpts.zoom = Math.max(0.3, riserOpts.zoom / 1.25); applyZoom(); } }, '縮小'),
          h('button', { class: 'btn-secondary', onclick: () => { riserOpts.zoom = Math.min(4, riserOpts.zoom * 1.25); applyZoom(); } }, '拡大'),
          h('button', { class: 'btn-secondary', onclick: () => U.download(fileBase() + '_系統図.svg', WPS.riser.render(app.net, app.result, { showFlow: riserOpts.showFlow }), 'image/svg+xml') }, 'SVG保存'),
          h('button', { class: 'btn-secondary', onclick: () => exportSvgPng(svgEl) }, 'PNG保存'))),
      h('section', { class: 'card flush' }, holder));
  }

  function exportSvgPng(svgEl) {
    if (!svgEl) return;
    const xml = new XMLSerializer().serializeToString(svgEl);
    const img = new Image();
    const w = svgEl.viewBox.baseVal.width;
    const hh = svgEl.viewBox.baseVal.height;
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w * 2;
      c.height = hh * 2;
      const ctx = c.getContext('2d');
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, w, hh);
      U.downloadDataUrl(fileBase() + '_系統図.png', c.toDataURL('image/png'));
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  /* ---------- 平面図 ---------- */
  async function renderPlan() {
    const root = document.getElementById('view-plan');
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head' }, h('h2', null, '配管平面図'),
      h('p', { class: 'lead' }, 'PDFトレースで作図した配管に、決定口径を記入した平面図です。')));
    if (app.state.mode !== 'trace') {
      root.append(h('section', { class: 'card empty-card' },
        h('p', null, '平面図は「PDFトレース」モードで作図した場合に作成されます。簡易定義モードでは系統図をご利用ください。'),
        h('button', { class: 'btn', onclick: () => { switchMode('trace'); setTab('input'); } }, 'PDFトレースに切り替える')));
      return;
    }
    if (!WPS.trace.hasPdf() && app.state.trace.pdfName) {
      root.append(h('p', { class: 'messages warn-inline' }, `背景図面「${app.state.trace.pdfName}」が読み込まれていません。「入力・作図」でPDFを再読み込みすると背景付きで出力されます。`));
    }
    const list = h('div', { class: 'plan-list' });
    root.append(list);
    const pages = app.state.trace.pages;
    for (let i = 0; i < pages.length; i++) {
      const url = await WPS.trace.renderPageImage(app.state, i, app.result);
      if (!url) continue;
      const name = pages[i].name;
      list.append(h('section', { class: 'card flush' },
        h('div', { class: 'card-head row' }, h('h3', null, name), h('div', { class: 'spacer' }),
          h('button', { class: 'btn-secondary', onclick: () => U.downloadDataUrl(`${fileBase()}_平面図_${name}.png`, url) }, 'PNG保存')),
        h('img', { class: 'plan-img', src: url, alt: '配管平面図 ' + name })));
    }
  }

  /* ---------- マスタ ---------- */
  function renderMasters() {
    const root = document.getElementById('view-masters');
    const m = app.state.masters;
    root.innerHTML = '';
    const fxRows = m.fixtures.map((f, i) => {
      const cell = (key, type, attrs) => h('td', null, h('input', Object.assign({
        class: 'input ' + (type === 'number' ? 'num' : ''), type, step: 'any', value: f[key] === undefined ? '' : f[key],
        onchange: (e) => { f[key] = type === 'number' ? (e.target.value === '' ? '' : U.num(e.target.value)) : e.target.value; app.changed(); },
      }, attrs || {})));
      return h('tr', null,
        cell('name', 'text', { class: 'input wide' }), cell('abbr', 'text', { class: 'input short' }),
        cell('fuPublic', 'number'), cell('fuPrivate', 'number'), cell('flow', 'number'), cell('pmin', 'number'), cell('conn', 'number'), cell('height', 'number'),
        h('td', { class: 'c' }, h('input', { type: 'checkbox', checked: f.flushValve, onchange: (e) => { f.flushValve = e.target.checked; app.changed(); } })),
        h('td', null, h('button', { class: 'btn-icon', title: '削除', onclick: () => { if (confirm(`「${f.name}」を削除しますか？`)) { m.fixtures.splice(i, 1); app.changed(); renderMasters(); } } }, '×')));
    });
    const mat = m.pipes.find((p) => p.id === app.state.settings.material) || m.pipes[0];
    const sizeRows = mat.sizes.map((s, i) => h('tr', null,
      h('td', null, h('input', { class: 'input short', value: s.label, onchange: (e) => { s.label = e.target.value; app.changed(); } })),
      h('td', null, h('input', { class: 'input num', type: 'number', step: 'any', value: s.dn, onchange: (e) => { s.dn = U.num(e.target.value); app.changed(); } })),
      h('td', null, h('input', { class: 'input num', type: 'number', step: 'any', value: s.id, onchange: (e) => { s.id = U.num(e.target.value); app.changed(); } })),
      h('td', null, h('button', { class: 'btn-icon', onclick: () => { mat.sizes.splice(i, 1); app.changed(); renderMasters(); } }, '×'))));

    root.append(
      h('div', { class: 'page-head row' },
        h('div', null, h('h2', null, 'マスタ'), h('p', { class: 'lead' }, '器具と管種の値はプロジェクトごとに保存されます。採用製品の値に合わせて調整してください。')),
        h('div', { class: 'actions' },
          h('button', { class: 'btn-secondary', onclick: () => { if (confirm('器具・管種マスタを初期値に戻しますか？')) { app.state.masters = { fixtures: U.clone(WPS.DEFAULT_FIXTURES), pipes: U.clone(WPS.DEFAULT_PIPES) }; app.changed(); renderMasters(); } } }, '初期値に戻す'))),
      h('section', { class: 'card flush' },
        h('div', { class: 'card-head row' }, h('h3', null, '器具マスタ'), h('div', { class: 'spacer' }),
          h('button', {
            class: 'btn-text', onclick: () => {
              m.fixtures.push({ id: U.uid('fx'), name: '新しい器具', abbr: 'X', fuPublic: 2, fuPrivate: 1, flow: 10, pmin: 30, conn: 13, flushValve: false, height: '' });
              app.changed();
              renderMasters();
            },
          }, '＋ 器具を追加')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'tbl edit' },
          h('thead', null, h('tr', null, ['器具名', '略号', '負荷単位<br>公衆用', '負荷単位<br>私室用', '給水流量<br>L/min', '必要圧力<br>kPa', '接続口径<br>mm', '取付高さ<br>m', '洗浄弁', ''].map((t) => h('th', { html: t })))),
          h('tbody', null, fxRows)))),
      h('section', { class: 'card flush' },
        h('div', { class: 'card-head row' }, h('h3', null, '管種：' + mat.name), h('div', { class: 'spacer' }),
          h('label', { class: 'field inline' }, h('span', null, '流速係数 C'),
            h('input', { class: 'input num', type: 'number', step: 'any', value: mat.C, onchange: (e) => { mat.C = U.num(e.target.value, mat.C); app.changed(); } }))),
        h('p', { class: 'muted small pad' }, (mat.note || '') + '　※表示中の管種は「設計条件」で選択したものです。'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'tbl edit narrow' },
          h('thead', null, h('tr', null, ['呼び径', '比較用口径 mm', '内径 mm', ''].map((t) => h('th', null, t)))),
          h('tbody', null, sizeRows))),
        h('button', { class: 'btn-text pad', onclick: () => { mat.sizes.push({ label: '新規', dn: 0, id: 0 }); app.changed(); renderMasters(); } }, '＋ 口径を追加')));
  }

  /* ---------- 計算書 ---------- */
  async function renderReport() {
    const root = document.getElementById('view-report');
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head row no-print' },
      h('div', null, h('h2', null, '計算書'), h('p', { class: 'lead' }, 'A4縦で印刷できます。PDFにする場合は印刷画面で「PDFに保存」を選んでください。')),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => window.print() }, '印刷 / PDF保存'))));
    const paper = h('article', { class: 'report-paper', id: 'report-paper' }, h('p', { class: 'muted' }, '作成中…'));
    root.append(paper);
    if (!app.result || !app.result.summary) {
      paper.innerHTML = '<p class="muted">計算結果がありません。入力内容を確認してください。</p>' + WPS.report.messages(app.result || { errors: [], warnings: [] });
      return;
    }
    paper.innerHTML = await WPS.report.buildReport(app.state, app.net, app.result);
  }

  /* ---------- ファイル ---------- */
  function fileBase() {
    const n = (app.state.settings.projectName || '給水口径計算').replace(/[\\/:*?"<>|]/g, '_');
    return n;
  }

  function saveFile() {
    U.download(fileBase() + '.wps.json', JSON.stringify(app.state, null, 2), 'application/json');
  }

  function openFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        app.state = normalize(data);
        afterLoad();
      } catch (err) {
        alert('プロジェクトファイルを読み込めませんでした: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function afterLoad() {
    WPS.trace.reset();
    recalc();
    setTab(app.tab);
  }

  /* ---------- 入力ダイアログ（Electron でも動くよう prompt を使わない） ---------- */
  WPS.ui = {
    ask(title, label, value) {
      return new Promise((resolve) => {
        const input = h('input', { class: 'input', value: value || '' });
        const close = (v) => { dlg.remove(); resolve(v); };
        const dlg = h('div', { class: 'modal-back' },
          h('div', { class: 'modal' },
            h('h3', null, title),
            h('label', { class: 'field' }, h('span', null, label), input),
            h('div', { class: 'actions end' },
              h('button', { class: 'btn-secondary', onclick: () => close(null) }, 'キャンセル'),
              h('button', { class: 'btn', onclick: () => close(input.value) }, 'OK'))));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') close(input.value);
          if (e.key === 'Escape') close(null);
        });
        document.body.append(dlg);
        input.focus();
        input.select();
      });
    },
  };

  /* ---------- 起動 ---------- */
  function boot() {
    const tabs = document.querySelector('.tabs');
    TABS.forEach((t) => tabs.append(h('button', { 'data-tab': t.id, onclick: () => setTab(t.id) }, t.label)));
    const openInput = document.getElementById('open-file');
    openInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
    document.getElementById('btn-open').addEventListener('click', () => openInput.click());
    document.getElementById('btn-save').addEventListener('click', saveFile);
    document.getElementById('btn-new').addEventListener('click', () => {
      if (!confirm('新しいプロジェクトを作成します。保存していない内容は失われます。よろしいですか？')) return;
      app.state = newProject();
      afterLoad();
    });
    window.addEventListener('beforeprint', () => {
      if (app.tab !== 'report') document.body.classList.add('print-current');
    });
    window.addEventListener('afterprint', () => document.body.classList.remove('print-current'));

    recalc();
    let tab = 'settings';
    try { tab = localStorage.getItem('wps.tab') || 'settings'; } catch (e) { /* noop */ }
    setTab(TABS.some((t) => t.id === tab) ? tab : 'settings');
  }

  WPS.app = app;
  document.addEventListener('DOMContentLoaded', boot);
})(globalThis.WPS = globalThis.WPS || {});
