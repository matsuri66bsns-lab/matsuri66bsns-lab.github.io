/*
 * 入力モードA「PDFトレース」
 * PDF図面（または白紙）の上で給水配管をなぞり、器具・水源・立管を配置して管網を作る。
 *  座標は PDF のポイント単位（1pt = 1/72inch）で保持し、各ページの縮尺 [m/pt] で実長に換算する。
 *  ページ＝階として扱い、同じ記号の立管どうしを階高差の鉛直区間で自動接続する。
 */
(function (WPS) {
  'use strict';
  const U = () => WPS.util;

  const PT_PER_MM = 72 / 25.4;
  const scaleOf = (n) => (n / 1000) / PT_PER_MM; // 縮尺 1/n の [m/pt]
  const SCALE_PRESETS = [20, 30, 50, 100, 200, 300, 500];
  const BLANK_W = 1190.55; // A3横
  const BLANK_H = 841.89;

  function defaultTrace() {
    return {
      pdfName: '',
      pages: [newPage(0, '1F', 0)],
      nodes: [],
      segments: [],
      lineColor: null,
      colorTol: 70,
      gapTol: 6,
    };
  }

  function newPage(index, name, level, w, h) {
    return { index, name, level, pipeZ: 0.3, scale: scaleOf(100), scaleLabel: '1/100', width: w || BLANK_W, height: h || BLANK_H };
  }

  /* ---------- 管網の生成 ---------- */
  function build(state) {
    const tr = state.trace;
    const settings = state.settings;
    const fx = {};
    state.masters.fixtures.forEach((f) => { fx[f.id] = f; });
    const pages = tr.pages;
    const zOf = (n) => {
      const pg = pages[n.page] || pages[0];
      const level = U().num(pg.level, 0);
      if (n.kind === 'fixture') {
        const f = fx[n.fixtureId];
        const hgt = f && f.height !== '' && f.height !== null && f.height !== undefined ? U().num(f.height) : U().num(settings.fixtureHeight, 0.8);
        return level + hgt;
      }
      return level + U().num(pg.pipeZ, 0.3);
    };
    const nodes = tr.nodes.map((n) => {
      const pg = pages[n.page] || pages[0];
      const f = fx[n.fixtureId];
      let label = 'J';
      if (n.kind === 'fixture') label = (f ? f.name : '器具');
      else if (n.kind === 'source') label = '水源';
      else if (n.kind === 'riser') label = '立管 ' + (n.tag || '');
      return {
        id: n.id, kind: n.kind, fixtureId: n.fixtureId, z: zOf(n),
        label: pg.name + ' ' + label, floor: pg.name, short: f ? f.abbr : undefined,
      };
    });
    const zById = {};
    nodes.forEach((n) => { zById[n.id] = n.z; });
    const byId = {};
    tr.nodes.forEach((n) => { byId[n.id] = n; });

    const edges = [];
    const seq = {};
    tr.segments.forEach((s) => {
      const a = byId[s.a];
      const b = byId[s.b];
      if (!a || !b) return;
      const pg = pages[a.page] || pages[0];
      seq[a.page] = (seq[a.page] || 0) + 1;
      const plan = Math.hypot(a.x - b.x, a.y - b.y) * U().num(pg.scale, scaleOf(100));
      edges.push({
        id: s.id, a: s.a, b: s.b,
        length: plan + Math.abs(zById[s.a] - zById[s.b]),
        planLength: plan,
        label: pg.name + '-' + String(seq[a.page]).padStart(2, '0'),
      });
    });

    const groups = {};
    tr.nodes.filter((n) => n.kind === 'riser').forEach((n) => {
      const tag = (n.tag || 'R').trim();
      (groups[tag] = groups[tag] || []).push(n);
    });
    Object.keys(groups).forEach((tag) => {
      const list = groups[tag].slice().sort((p, q) => zById[p.id] - zById[q.id]);
      for (let i = 1; i < list.length; i++) {
        const lo = list[i - 1];
        const hi = list[i];
        edges.push({
          id: 'rv_' + lo.id + '_' + hi.id, a: lo.id, b: hi.id,
          length: Math.abs(zById[hi.id] - zById[lo.id]), vertical: true,
          label: `立管${tag} ${(pages[lo.page] || {}).name}→${(pages[hi.page] || {}).name}`,
        });
      }
    });
    return { nodes, edges, floors: pages.map((p) => ({ name: p.name, level: U().num(p.level, 0) })) };
  }

  /* ---------- 描画（画面・書き出し共通） ---------- */
  const STATUS_COLOR = { ok: '#0071e3', warn: '#c77700', ng: '#d70015' };

  function drawOverlay(ctx, state, pageIdx, k, opts) {
    opts = opts || {};
    const tr = state.trace;
    const res = opts.result;
    const byId = {};
    tr.nodes.forEach((n) => { byId[n.id] = n; });
    const fx = {};
    state.masters.fixtures.forEach((f) => { fx[f.id] = f; });

    tr.segments.forEach((s) => {
      const a = byId[s.a];
      const b = byId[s.b];
      if (!a || !b || a.page !== pageIdx) return;
      const row = res && res.edgeById[s.id];
      const sel = opts.selection && opts.selection.type === 'seg' && opts.selection.id === s.id;
      ctx.strokeStyle = sel ? '#ff9f0a' : (row ? STATUS_COLOR[row.status] : '#0a84ff');
      ctx.lineWidth = (sel ? 5 : 3.2) / k;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    if (res && opts.labels !== false) {
      tr.segments.forEach((s) => {
        const a = byId[s.a];
        const b = byId[s.b];
        if (!a || !b || a.page !== pageIdx) return;
        const row = res.edgeById[s.id];
        if (!row) return;
        const len = Math.hypot(a.x - b.x, a.y - b.y) * k;
        if (len < 26) return;
        const text = row.size + (opts.showFlow ? ` (${U().fmt(row.flow, 0)})` : '');
        drawTag(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2, text, STATUS_COLOR[row.status], k);
      });
    }

    tr.nodes.forEach((n) => {
      if (n.page !== pageIdx) return;
      const sel = opts.selection && opts.selection.type === 'node' && opts.selection.id === n.id;
      const r = 1 / k;
      ctx.lineWidth = 1.5 * r;
      if (n.kind === 'fixture') {
        const f = fx[n.fixtureId];
        const fr = res && res.fixtures.find((q) => q.nodeId === n.id);
        ctx.fillStyle = fr && !fr.ok ? '#ffe5e5' : '#ffffff';
        ctx.strokeStyle = sel ? '#ff9f0a' : (fr && !fr.ok ? '#d70015' : '#1d1d1f');
        ctx.beginPath();
        ctx.arc(n.x, n.y, 10 * r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1d1d1f';
        const abbr = f ? f.abbr : '?';
        ctx.font = `600 ${(abbr.length > 2 ? 7.5 : 9) * r}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(abbr, n.x, n.y + 0.5 * r);
      } else if (n.kind === 'source') {
        ctx.fillStyle = sel ? '#ff9f0a' : '#1d1d1f';
        roundRect(ctx, n.x - 15 * r, n.y - 10 * r, 30 * r, 20 * r, 4 * r);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${9 * r}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('水源', n.x, n.y + 0.5 * r);
      } else if (n.kind === 'riser') {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = sel ? '#ff9f0a' : '#1d1d1f';
        ctx.beginPath();
        ctx.arc(n.x, n.y, 8 * r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(n.x, n.y, 4.5 * r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#1d1d1f';
        ctx.font = `600 ${10 * r}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.tag || 'R', n.x + 11 * r, n.y - 9 * r);
      } else {
        ctx.fillStyle = sel ? '#ff9f0a' : '#0a84ff';
        ctx.beginPath();
        ctx.arc(n.x, n.y, (sel ? 5 : 3) * r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawTag(ctx, x, y, text, color, k) {
    const r = 1 / k;
    ctx.font = `600 ${11 * r}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    const w = ctx.measureText(text).width + 8 * r;
    const h = 15 * r;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * r;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 4 * r);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5 * r);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 画面（エディタ） ---------- */
  const rt = {
    app: null, root: null, canvas: null, ctx: null,
    pdf: null, bitmaps: {}, pixels: {},
    page: 0, zoom: 1, ox: 0, oy: 0,
    tool: 'pipe', fixtureId: 'lav', riserTag: 'R1',
    drawingLast: null, mouse: null, shift: false, space: false,
    selection: null, drag: null, pan: null, scalePts: [], message: '',
    showLabels: true, showFlow: false,
  };

  const TOOLS = [
    { id: 'select', label: '選択・移動', key: 'V' },
    { id: 'pipe', label: '配管を描く', key: 'P' },
    { id: 'trace', label: '線を自動認識', key: 'T' },
    { id: 'fixture', label: '器具', key: 'F' },
    { id: 'source', label: '水源', key: 'S' },
    { id: 'riser', label: '立管', key: 'R' },
    { id: 'erase', label: '削除', key: 'E' },
    { id: 'scale', label: '縮尺合わせ', key: 'K' },
    { id: 'pick', label: '線色を取得', key: 'I' },
    { id: 'pan', label: '移動（手のひら）', key: 'H' },
  ];

  const st = () => rt.app.state;
  const tr = () => st().trace;
  const page = () => tr().pages[rt.page] || tr().pages[0];

  function init(root, app) {
    rt.app = app;
    rt.root = root;
    const h = U().h;
    root.innerHTML = '';

    const fileInput = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'hidden', onchange: (e) => { const f = e.target.files[0]; if (f) loadPdf(f); e.target.value = ''; } });
    const toolbar = h('div', { class: 'trace-toolbar' });
    TOOLS.forEach((t) => {
      toolbar.append(h('button', { class: 'tool', 'data-tool': t.id, title: `${t.label}（${t.key}）`, onclick: () => setTool(t.id) }, t.label));
    });

    const side = h('aside', { class: 'trace-side' });
    const canvasWrap = h('div', { class: 'trace-canvas-wrap' });
    const canvas = h('canvas', { class: 'trace-canvas', tabindex: '0' });
    const hint = h('div', { class: 'trace-hint' });
    canvasWrap.append(canvas, hint);
    rt.canvas = canvas;
    rt.ctx = canvas.getContext('2d');
    rt.hint = hint;
    rt.side = side;

    root.append(
      h('div', { class: 'trace-top' },
        h('button', { class: 'btn', onclick: () => fileInput.click() }, 'PDF図面を読み込む'),
        h('button', { class: 'btn-secondary', onclick: addBlankPage }, '白紙ページを追加'),
        h('span', { class: 'muted pdf-name' }, ''),
        h('div', { class: 'spacer' }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: rt.showLabels, onchange: (e) => { rt.showLabels = e.target.checked; draw(); } }), '口径を表示'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: rt.showFlow, onchange: (e) => { rt.showFlow = e.target.checked; draw(); } }), '流量を表示'),
        h('button', { class: 'btn-secondary', onclick: fitView }, '全体表示'),
        fileInput),
      toolbar,
      h('div', { class: 'trace-body' }, canvasWrap, side));

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('dblclick', (e) => { e.preventDefault(); endChain(); });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); endChain(); });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') rt.shift = false; if (e.code === 'Space') rt.space = false; });
    window.addEventListener('resize', () => { if (isVisible()) resize(); });

    rt.fixtureId = (app.state.masters.fixtures[0] || {}).id;
    setTool('pipe');
    renderSide();
  }

  function isVisible() {
    return rt.canvas && rt.canvas.offsetParent !== null;
  }

  function onShow() {
    resize();
    if (!rt.fitted) { fitView(); rt.fitted = true; }
    renderSide();
    draw();
    ensureBitmap(rt.page);
  }

  function resize() {
    const wrap = rt.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const hh = wrap.clientHeight;
    rt.canvas.width = Math.max(1, Math.floor(w * dpr));
    rt.canvas.height = Math.max(1, Math.floor(hh * dpr));
    rt.canvas.style.width = w + 'px';
    rt.canvas.style.height = hh + 'px';
    rt.dpr = dpr;
    draw();
  }

  function fitView() {
    const pg = page();
    const wrap = rt.canvas.parentElement;
    const w = wrap.clientWidth || 800;
    const hh = wrap.clientHeight || 600;
    rt.zoom = Math.min((w - 40) / pg.width, (hh - 40) / pg.height);
    rt.ox = (w - pg.width * rt.zoom) / 2;
    rt.oy = (hh - pg.height * rt.zoom) / 2;
    draw();
  }

  function setTool(id) {
    rt.tool = id;
    rt.drawingLast = null;
    rt.scalePts = [];
    rt.root.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tool') === id));
    const hints = {
      select: '節点や配管をクリックして選択。節点はドラッグで移動、Deleteキーで削除。',
      pipe: 'クリックで折れ線を描画。既存の節点・配管上をクリックすると接続（分岐）します。Shiftで水平/垂直に拘束、ダブルクリック・右クリック・Escで終了。',
      trace: '図面上の配管線をクリックすると、線を追跡して曲がり角まで自動で配管化します（「線色を取得」で給水管の色を指定すると精度が上がります）。',
      fixture: '器具の種類を右パネルで選び、クリックで配置。近くの配管へ自動で接続します。',
      source: 'クリックで水源（引込・水槽・ポンプ）を配置。近くの配管へ自動で接続します。',
      riser: '立管記号を右パネルで指定してクリック。同じ記号の立管どうしが階をまたいで接続されます。',
      erase: '節点または配管をクリックして削除します。',
      scale: '図面上の寸法が分かる2点をクリックし、実寸を入力して縮尺を合わせます。',
      pick: '給水管の線をクリックして線色を取得します（自動認識で使用）。',
      pan: 'ドラッグで表示位置を移動。ホイールで拡大縮小。',
    };
    rt.message = hints[id] || '';
    updateHint();
    renderSide();
    draw();
  }

  function updateHint() {
    if (rt.hint) rt.hint.textContent = rt.message;
  }

  /* --- PDF --- */
  function pdfLib() {
    const lib = globalThis.pdfjsLib;
    if (lib && !lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    return lib;
  }

  async function loadPdf(file) {
    const lib = pdfLib();
    if (!lib) { alert('PDF読み込みライブラリ（pdf.js）が見つかりません。'); return; }
    try {
      rt.message = 'PDFを読み込んでいます…';
      updateHint();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await lib.getDocument({ data }).promise;
      rt.pdf = doc;
      rt.bitmaps = {};
      rt.pixels = {};
      const t = tr();
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        const old = t.pages[i - 1];
        if (old && t.pdfName === file.name) pages.push(Object.assign(old, { index: i - 1, width: vp.width, height: vp.height, blank: false }));
        else pages.push(Object.assign(old ? { ...old } : newPage(i - 1, i + 'F', (i - 1) * 3.5), { index: i - 1, width: vp.width, height: vp.height, blank: false }));
      }
      // 白紙ページは PDF ページの後ろに残す
      t.pages.slice(doc.numPages).filter((p) => p.blank).forEach((p) => pages.push(p));
      t.pages = pages;
      t.pdfName = file.name;
      rt.page = 0;
      rt.fitted = false;
      rt.root.querySelector('.pdf-name').textContent = file.name + `（${doc.numPages}ページ）`;
      onShow();
      setTool(rt.tool);
      rt.app.changed();
    } catch (err) {
      console.error(err);
      alert('PDFを読み込めませんでした: ' + err.message);
    }
  }

  function addBlankPage() {
    const t = tr();
    const last = t.pages[t.pages.length - 1];
    const idx = t.pages.length;
    const pg = newPage(idx, (idx + 1) + 'F', last ? U().num(last.level) + 3.5 : 0);
    pg.blank = true;
    t.pages.push(pg);
    rt.page = idx;
    rt.fitted = false;
    onShow();
    rt.app.changed();
  }

  async function ensureBitmap(idx) {
    const pg = tr().pages[idx];
    if (!rt.pdf || !pg || pg.blank || idx >= rt.pdf.numPages || rt.bitmaps[idx]) return rt.bitmaps[idx] || null;
    if (rt.bitmaps['loading' + idx]) return rt.bitmaps['loading' + idx];
    const job = (async () => {
      const p = await rt.pdf.getPage(idx + 1);
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(3, 4200 / Math.max(base.width, base.height));
      const vp = p.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: cx, viewport: vp }).promise;
      rt.bitmaps[idx] = { canvas: c, scale };
      delete rt.bitmaps['loading' + idx];
      draw();
      return rt.bitmaps[idx];
    })();
    rt.bitmaps['loading' + idx] = job;
    return job;
  }

  /* --- 座標・ヒットテスト --- */
  function toWorld(e) {
    const r = rt.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - rt.ox) / rt.zoom, y: (e.clientY - r.top - rt.oy) / rt.zoom };
  }

  const nodesOnPage = () => tr().nodes.filter((n) => n.page === rt.page);
  const nodeById = (id) => tr().nodes.find((n) => n.id === id);

  function findNode(p, tolPx) {
    const tol = (tolPx || 9) / rt.zoom;
    let best = null;
    let bd = tol;
    nodesOnPage().forEach((n) => {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= bd) { bd = d; best = n; }
    });
    return best;
  }

  function findSegment(p, tolPx) {
    const tol = (tolPx || 7) / rt.zoom;
    let best = null;
    tr().segments.forEach((s) => {
      const a = nodeById(s.a);
      const b = nodeById(s.b);
      if (!a || !b || a.page !== rt.page) return;
      const q = project(p, a, b);
      if (q.d <= tol && (!best || q.d < best.d)) best = Object.assign(q, { seg: s });
    });
    return best;
  }

  function project(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy || 1e-9;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const x = a.x + t * dx;
    const y = a.y + t * dy;
    return { x, y, t, d: Math.hypot(p.x - x, p.y - y) };
  }

  function degree(id) {
    return tr().segments.filter((s) => s.a === id || s.b === id).length;
  }

  /* --- 編集操作 --- */
  function addNode(x, y, kind, extra) {
    const n = Object.assign({ id: U().uid('n'), page: rt.page, x, y, kind: kind || 'junction' }, extra || {});
    tr().nodes.push(n);
    return n;
  }

  function addSegment(a, b) {
    if (!a || !b || a === b) return null;
    if (tr().segments.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))) return null;
    const s = { id: U().uid('s'), a, b };
    tr().segments.push(s);
    return s;
  }

  function splitSegment(seg, x, y) {
    const n = addNode(x, y, 'junction');
    const t = tr();
    t.segments = t.segments.filter((s) => s !== seg);
    addSegment(seg.a, n.id);
    addSegment(n.id, seg.b);
    return n;
  }

  /* クリック位置の節点を取得（既存節点 → 配管上で分岐 → 新規） */
  function nodeAt(p, allowSplit) {
    const n = findNode(p);
    if (n) return n;
    if (allowSplit !== false) {
      const hit = findSegment(p);
      if (hit) {
        const a = nodeById(hit.seg.a);
        const b = nodeById(hit.seg.b);
        if (Math.hypot(hit.x - a.x, hit.y - a.y) * rt.zoom < 9) return a;
        if (Math.hypot(hit.x - b.x, hit.y - b.y) * rt.zoom < 9) return b;
        return splitSegment(hit.seg, hit.x, hit.y);
      }
    }
    return addNode(p.x, p.y, 'junction');
  }

  function deleteNode(id) {
    const t = tr();
    t.nodes = t.nodes.filter((n) => n.id !== id);
    t.segments = t.segments.filter((s) => s.a !== id && s.b !== id);
    cleanup();
  }

  function deleteSegment(id) {
    const t = tr();
    t.segments = t.segments.filter((s) => s.id !== id);
    cleanup();
  }

  /* 孤立した分岐点を削除し、2本だけつながる直線上の分岐点を統合する */
  function cleanup() {
    const t = tr();
    t.nodes = t.nodes.filter((n) => n.kind !== 'junction' || degree(n.id) > 0 || n.id === rt.drawingLast);
  }

  /* 器具・水源・立管を配置し、近くの配管があれば接続する */
  function placeSpecial(p, kind, extra) {
    const existing = findNode(p);
    if (existing) {
      if (kind === 'source') tr().nodes.forEach((n) => { if (n.kind === 'source') n.kind = 'junction'; });
      Object.assign(existing, { kind }, extra);
      delete existing.fixtureId;
      delete existing.tag;
      Object.assign(existing, extra);
      return existing;
    }
    if (kind === 'source') tr().nodes.forEach((n) => { if (n.kind === 'source') n.kind = 'junction'; });
    const node = addNode(p.x, p.y, kind, extra);
    const hit = findSegment(p, 40);
    if (hit) {
      const a = nodeById(hit.seg.a);
      const b = nodeById(hit.seg.b);
      let target;
      if (Math.hypot(hit.x - a.x, hit.y - a.y) * rt.zoom < 12) target = a;
      else if (Math.hypot(hit.x - b.x, hit.y - b.y) * rt.zoom < 12) target = b;
      else target = splitSegment(hit.seg, hit.x, hit.y);
      addSegment(target.id, node.id);
    } else {
      const near = findNodeExcept(p, 40, node.id);
      if (near) addSegment(near.id, node.id);
    }
    return node;
  }

  function findNodeExcept(p, tolPx, exceptId) {
    const tol = tolPx / rt.zoom;
    let best = null;
    let bd = tol;
    nodesOnPage().forEach((n) => {
      if (n.id === exceptId) return;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= bd) { bd = d; best = n; }
    });
    return best;
  }

  function endChain() {
    if (rt.drawingLast) {
      rt.drawingLast = null;
      cleanup();
      commit();
    }
  }

  function commit() {
    rt.app.changed();
    renderSide();
    draw();
  }

  function constrain(p) {
    if (!rt.shift || !rt.drawingLast) return p;
    const last = nodeById(rt.drawingLast);
    if (!last) return p;
    return Math.abs(p.x - last.x) > Math.abs(p.y - last.y) ? { x: p.x, y: last.y } : { x: last.x, y: p.y };
  }

  /* --- マウス --- */
  function onDown(e) {
    rt.canvas.focus();
    const p = toWorld(e);
    if (e.button === 1 || rt.space || rt.tool === 'pan') {
      rt.pan = { x: e.clientX, y: e.clientY, ox: rt.ox, oy: rt.oy };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const tool = rt.tool;
    if (tool === 'select') {
      const n = findNode(p);
      if (n) {
        rt.selection = { type: 'node', id: n.id };
        rt.drag = { id: n.id, moved: false };
      } else {
        const hit = findSegment(p);
        rt.selection = hit ? { type: 'seg', id: hit.seg.id } : null;
      }
      renderSide();
      draw();
    } else if (tool === 'pipe') {
      const q = constrain(p);
      const n = nodeAt(q, true);
      if (rt.drawingLast && rt.drawingLast !== n.id) addSegment(rt.drawingLast, n.id);
      rt.drawingLast = n.id;
      commit();
    } else if (tool === 'trace') {
      autoTrace(p);
    } else if (tool === 'fixture') {
      if (!rt.fixtureId) { alert('器具の種類を選択してください。'); return; }
      placeSpecial(p, 'fixture', { fixtureId: rt.fixtureId });
      commit();
    } else if (tool === 'source') {
      placeSpecial(p, 'source', {});
      commit();
    } else if (tool === 'riser') {
      placeSpecial(p, 'riser', { tag: (rt.riserTag || 'R1').trim() });
      commit();
    } else if (tool === 'erase') {
      const n = findNode(p);
      if (n) deleteNode(n.id);
      else {
        const hit = findSegment(p);
        if (hit) deleteSegment(hit.seg.id);
      }
      rt.selection = null;
      commit();
    } else if (tool === 'scale') {
      rt.scalePts.push(p);
      if (rt.scalePts.length === 2) {
        const [a, b] = rt.scalePts;
        const dpt = Math.hypot(a.x - b.x, a.y - b.y);
        rt.scalePts = [];
        WPS.ui.ask('2点間の実寸を入力', '実寸 [m]', '1.0').then((v) => {
          const m = U().num(v, NaN);
          if (!(m > 0) || !(dpt > 0)) return;
          const pg = page();
          pg.scale = m / dpt;
          pg.scaleLabel = '実測 1/' + Math.round(pg.scale * PT_PER_MM * 1000);
          commit();
        });
      }
      draw();
    } else if (tool === 'pick') {
      pickColor(p);
    }
  }

  function onMove(e) {
    if (!rt.canvas) return;
    if (rt.pan) {
      rt.ox = rt.pan.ox + (e.clientX - rt.pan.x);
      rt.oy = rt.pan.oy + (e.clientY - rt.pan.y);
      draw();
      return;
    }
    if (e.target !== rt.canvas && !rt.drag) return;
    rt.shift = e.shiftKey;
    const p = toWorld(e);
    rt.mouse = p;
    if (rt.drag) {
      const n = nodeById(rt.drag.id);
      if (n) {
        n.x = p.x;
        n.y = p.y;
        rt.drag.moved = true;
      }
    }
    draw();
  }

  function onUp() {
    if (rt.pan) rt.pan = null;
    if (rt.drag) {
      if (rt.drag.moved) commit();
      rt.drag = null;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const r = rt.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const z = Math.max(0.05, Math.min(40, rt.zoom * f));
    rt.ox = mx - (mx - rt.ox) * (z / rt.zoom);
    rt.oy = my - (my - rt.oy) * (z / rt.zoom);
    rt.zoom = z;
    draw();
  }

  function onKey(e) {
    if (!isVisible()) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Shift') rt.shift = true;
    if (e.code === 'Space') { rt.space = true; e.preventDefault(); return; }
    if (e.key === 'Escape') { endChain(); rt.scalePts = []; draw(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && rt.selection) {
      if (rt.selection.type === 'node') deleteNode(rt.selection.id);
      else deleteSegment(rt.selection.id);
      rt.selection = null;
      commit();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (t) setTool(t.id);
  }

  /* --- 線の自動認識（ラスタ追跡） --- */
  function pixelsOf(idx) {
    const bm = rt.bitmaps[idx];
    if (!bm || !bm.canvas) return null;
    if (!rt.pixels[idx]) {
      const c = bm.canvas;
      rt.pixels[idx] = { data: c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, scale: bm.scale };
    }
    return rt.pixels[idx];
  }

  function makeInk(px) {
    const t = tr();
    const col = t.lineColor;
    const tol = U().num(t.colorTol, 70);
    const { data, w, h } = px;
    return (x, y) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (col) return Math.abs(r - col[0]) + Math.abs(g - col[1]) + Math.abs(b - col[2]) <= tol;
      return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
    };
  }

  function autoTrace(p) {
    const px = pixelsOf(rt.page);
    if (!px) {
      rt.message = 'このページには図面画像がないため自動認識できません。PDFを読み込むか「配管を描く」を使ってください。';
      updateHint();
      return;
    }
    const s = px.scale;
    const ink = makeInk(px);
    const gap = Math.max(1, Math.round(U().num(tr().gapTol, 6)));
    const inkBand = (x, y, dx, dy) => ink(x, y) || ink(x + dy, y + dx) || ink(x - dy, y - dx);

    // クリック点の近くのインクを探す
    let sx = p.x * s;
    let sy = p.y * s;
    let found = null;
    for (let r = 0; r <= 8 && !found; r++) {
      for (let dx = -r; dx <= r && !found; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (ink(sx + dx, sy + dy)) { found = { x: Math.round(sx + dx), y: Math.round(sy + dy) }; break; }
        }
      }
    }
    if (!found) {
      rt.message = 'クリック位置付近に線が見つかりません。線の真上をクリックするか、「線色を取得」で色を指定してください。';
      updateHint();
      return;
    }

    const run = (x, y, dx, dy) => {
      let cx = x;
      let cy = y;
      let miss = 0;
      let lx = x;
      let ly = y;
      for (let i = 0; i < 20000; i++) {
        cx += dx;
        cy += dy;
        if (inkBand(cx, cy, dx, dy)) { lx = cx; ly = cy; miss = 0; } else if (++miss > gap) break;
      }
      return { x: lx, y: ly, len: Math.abs(lx - x) + Math.abs(ly - y) };
    };
    const center = (x, y, horizontal) => {
      // 線幅方向の中心に寄せる
      let a = 0;
      let b = 0;
      if (horizontal) {
        while (a < 12 && ink(x, y - a - 1)) a++;
        while (b < 12 && ink(x, y + b + 1)) b++;
        return { x, y: y + (b - a) / 2 };
      }
      while (a < 12 && ink(x - a - 1, y)) a++;
      while (b < 12 && ink(x + b + 1, y)) b++;
      return { x: x + (b - a) / 2, y };
    };

    const hL = run(found.x, found.y, -1, 0);
    const hR = run(found.x, found.y, 1, 0);
    const vU = run(found.x, found.y, 0, -1);
    const vD = run(found.x, found.y, 0, 1);
    const horizontal = (hL.len + hR.len) >= (vU.len + vD.len);
    const c0 = center(found.x, found.y, horizontal);
    const minLen = 6;

    const follow = (start, dir) => {
      // dir: [dx,dy]。曲がり角を順にたどった点列を返す
      const pts = [];
      let cur = start;
      let d = dir;
      for (let k = 0; k < 40; k++) {
        const end = run(cur.x, cur.y, d[0], d[1]);
        if (end.len < 1 && k > 0) break;
        pts.push({ x: end.x, y: end.y });
        // 既存の節点・配管に到達したら終了（そこで接続する）
        const w = { x: end.x / s, y: end.y / s };
        if (findNode(w, 9) || findSegment(w, 6)) break;
        const perp = d[0] !== 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
        let best = null;
        perp.forEach((pd) => {
          for (let off = -3; off <= 2; off++) {
            const bx = end.x + d[0] * off;
            const by = end.y + d[1] * off;
            const r2 = run(bx, by, pd[0], pd[1]);
            if (r2.len >= Math.max(minLen * 2, 10) && (!best || r2.len > best.len)) best = { len: r2.len, x: bx, y: by, d: pd };
          }
        });
        if (!best) break;
        pts[pts.length - 1] = { x: best.x, y: best.y };
        cur = { x: best.x, y: best.y };
        d = best.d;
        if (pts.length > 2 && Math.hypot(cur.x - c0.x, cur.y - c0.y) < 4) break;
      }
      return pts;
    };

    const fwd = follow(c0, horizontal ? [1, 0] : [0, 1]);
    const back = follow(c0, horizontal ? [-1, 0] : [0, -1]);
    const chain = back.reverse().concat(fwd).map((q) => ({ x: q.x / s, y: q.y / s }));
    const total = chain.reduce((acc, q, i) => (i ? acc + Math.hypot(q.x - chain[i - 1].x, q.y - chain[i - 1].y) : 0), 0);
    if (chain.length < 2 || total * s < minLen) {
      rt.message = '線を認識できませんでした。';
      updateHint();
      return;
    }
    let prev = null;
    chain.forEach((q) => {
      const n = nodeAt(q, true);
      if (prev && prev !== n.id) addSegment(prev, n.id);
      prev = n.id;
    });
    rt.message = `線を認識しました（${chain.length - 1}区間）。続けてクリックできます。`;
    updateHint();
    commit();
  }

  function pickColor(p) {
    const px = pixelsOf(rt.page);
    if (!px) return;
    const s = px.scale;
    const x0 = Math.round(p.x * s);
    const y0 = Math.round(p.y * s);
    let best = null;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= px.w || y >= px.h) continue;
        const i = (y * px.w + x) * 4;
        const r = px.data[i];
        const g = px.data[i + 1];
        const b = px.data[i + 2];
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const dark = 765 - (r + g + b);
        const score = sat * 2 + dark;
        if (!best || score > best.score) best = { score, c: [r, g, b] };
      }
    }
    if (best) {
      tr().lineColor = best.c;
      rt.message = `線色を rgb(${best.c.join(',')}) に設定しました。「線を自動認識」でこの色の線だけを追跡します。`;
      updateHint();
      renderSide();
      rt.app.changed();
    }
  }

  /* --- 描画 --- */
  function draw() {
    if (!rt.ctx || !isVisible()) return;
    const ctx = rt.ctx;
    const dpr = rt.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e8e8ed';
    ctx.fillRect(0, 0, rt.canvas.width, rt.canvas.height);
    const pg = page();
    if (!pg) return;
    ctx.translate(rt.ox, rt.oy);
    ctx.scale(rt.zoom, rt.zoom);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur = 12;
    ctx.fillRect(0, 0, pg.width, pg.height);
    ctx.shadowBlur = 0;
    const bm = rt.bitmaps[rt.page];
    if (bm && bm.canvas) {
      ctx.imageSmoothingEnabled = rt.zoom * 1 < bm.scale;
      ctx.drawImage(bm.canvas, 0, 0, pg.width, pg.height);
    } else {
      drawGrid(ctx, pg);
      if (rt.pdf && !pg.blank) ensureBitmap(rt.page);
    }
    drawOverlay(ctx, st(), rt.page, rt.zoom, {
      result: rt.app.result, selection: rt.selection, labels: rt.showLabels, showFlow: rt.showFlow,
    });

    const r = 1 / rt.zoom;
    if (rt.tool === 'pipe' && rt.drawingLast && rt.mouse) {
      const last = nodeById(rt.drawingLast);
      if (last) {
        const q = constrain(rt.mouse);
        ctx.strokeStyle = '#0a84ff';
        ctx.setLineDash([6 * r, 4 * r]);
        ctx.lineWidth = 2 * r;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const len = Math.hypot(q.x - last.x, q.y - last.y) * U().num(pg.scale, scaleOf(100));
        ctx.fillStyle = '#1d1d1f';
        ctx.font = `${11 * r}px -apple-system, "Hiragino Sans", sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(U().fmt(len, 2) + ' m', q.x + 10 * r, q.y - 10 * r);
      }
    }
    if (rt.tool === 'scale' && rt.scalePts.length) {
      const a = rt.scalePts[0];
      ctx.strokeStyle = '#ff9f0a';
      ctx.lineWidth = 2 * r;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (rt.mouse) ctx.lineTo(rt.mouse.x, rt.mouse.y);
      ctx.stroke();
    }
    if (rt.mouse && ['pipe', 'trace', 'fixture', 'source', 'riser'].includes(rt.tool)) {
      const n = findNode(rt.mouse);
      if (n) {
        ctx.strokeStyle = '#ff9f0a';
        ctx.lineWidth = 2 * r;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 9 * r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawGrid(ctx, pg) {
    const step = 1 / U().num(pg.scale, scaleOf(100)); // 1m ごと
    if (!(step > 2)) return;
    ctx.strokeStyle = '#f0f0f3';
    ctx.lineWidth = 1 / rt.zoom;
    ctx.beginPath();
    for (let x = 0; x <= pg.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, pg.height); }
    for (let y = 0; y <= pg.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(pg.width, y); }
    ctx.stroke();
  }

  /* --- 右パネル --- */
  function renderSide() {
    if (!rt.side) return;
    const h = U().h;
    const t = tr();
    const pg = page();
    const side = rt.side;
    side.innerHTML = '';

    const pageSel = h('select', { class: 'input', onchange: (e) => { rt.page = +e.target.value; rt.selection = null; rt.drawingLast = null; fitView(); renderSide(); ensureBitmap(rt.page); } },
      t.pages.map((p, i) => h('option', { value: i, selected: i === rt.page ? 'selected' : null }, `${i + 1}. ${p.name}${p.blank ? '（白紙）' : ''}`)));
    const scaleSel = h('select', {
      class: 'input', onchange: (e) => {
        const n = +e.target.value;
        if (n > 0) { pg.scale = scaleOf(n); pg.scaleLabel = '1/' + n; commit(); }
      },
    }, h('option', { value: 0 }, pg.scaleLabel || '—'), SCALE_PRESETS.map((n) => h('option', { value: n }, '1/' + n)));

    side.append(h('section', { class: 'side-sec' },
      h('h4', null, 'ページ（階）'),
      pageSel,
      h('label', { class: 'field' }, h('span', null, '階名'), h('input', { class: 'input', value: pg.name, onchange: (e) => { pg.name = e.target.value; commit(); } })),
      h('div', { class: 'form-row tight' },
        h('label', { class: 'field' }, h('span', null, 'FL [m]'), h('input', { class: 'input num', type: 'number', step: 'any', value: pg.level, onchange: (e) => { pg.level = U().num(e.target.value); commit(); } })),
        h('label', { class: 'field' }, h('span', null, '配管高さ FL+ [m]'), h('input', { class: 'input num', type: 'number', step: 'any', value: pg.pipeZ, onchange: (e) => { pg.pipeZ = U().num(e.target.value); commit(); } }))),
      h('label', { class: 'field' }, h('span', null, '縮尺'), scaleSel),
      h('p', { class: 'muted small' }, '印刷縮尺と異なる場合は「縮尺合わせ」で実寸から設定してください。'),
      t.pages.length > 1 ? h('button', {
        class: 'btn-text danger', onclick: () => {
          if (!confirm(`ページ「${pg.name}」と、その上の配管・器具を削除しますか？`)) return;
          const idx = rt.page;
          const ids = new Set(t.nodes.filter((n) => n.page === idx).map((n) => n.id));
          t.nodes = t.nodes.filter((n) => n.page !== idx).map((n) => (n.page > idx ? Object.assign(n, { page: n.page - 1 }) : n));
          t.segments = t.segments.filter((s) => !ids.has(s.a) && !ids.has(s.b));
          t.pages.splice(idx, 1);
          t.pages.forEach((p, i) => { p.index = i; });
          if (rt.pdf) { rt.bitmaps = {}; rt.pixels = {}; }
          rt.page = Math.max(0, idx - 1);
          commit();
          fitView();
        },
      }, 'このページを削除') : null));

    if (rt.tool === 'fixture') {
      side.append(h('section', { class: 'side-sec' },
        h('h4', null, '配置する器具'),
        h('div', { class: 'fixture-list' }, st().masters.fixtures.map((f) => h('button', {
          class: 'fixture-btn' + (f.id === rt.fixtureId ? ' active' : ''),
          onclick: () => { rt.fixtureId = f.id; renderSide(); },
        }, h('span', { class: 'abbr' }, f.abbr), f.name)))));
    }
    if (rt.tool === 'riser') {
      side.append(h('section', { class: 'side-sec' },
        h('h4', null, '立管記号'),
        h('input', { class: 'input', value: rt.riserTag, oninput: (e) => { rt.riserTag = e.target.value; } }),
        h('p', { class: 'muted small' }, '各階の同じ位置に同じ記号の立管を配置すると、FL差の鉛直区間で自動接続されます。')));
    }
    if (rt.tool === 'trace' || rt.tool === 'pick') {
      side.append(h('section', { class: 'side-sec' },
        h('h4', null, '自動認識の設定'),
        h('div', { class: 'color-row' },
          h('span', { class: 'swatch', style: `background:${t.lineColor ? `rgb(${t.lineColor.join(',')})` : 'repeating-linear-gradient(45deg,#ccc 0 4px,#fff 4px 8px)'}` }),
          h('span', null, t.lineColor ? `rgb(${t.lineColor.join(', ')})` : '指定なし（濃い線を追跡）'),
          t.lineColor ? h('button', { class: 'btn-text', onclick: () => { t.lineColor = null; renderSide(); rt.app.changed(); } }, '解除') : null),
        h('label', { class: 'field' }, h('span', null, '色の許容差'), h('input', { class: 'input num', type: 'number', value: t.colorTol, onchange: (e) => { t.colorTol = U().num(e.target.value, 70); rt.app.changed(); } })),
        h('label', { class: 'field' }, h('span', null, '途切れ許容 [px]（破線用）'), h('input', { class: 'input num', type: 'number', value: t.gapTol, onchange: (e) => { t.gapTol = U().num(e.target.value, 6); rt.app.changed(); } }))));
    }

    // 選択中の要素
    if (rt.selection) {
      const sec = h('section', { class: 'side-sec' }, h('h4', null, '選択中'));
      if (rt.selection.type === 'node') {
        const n = nodeById(rt.selection.id);
        if (n) {
          const kindSel = h('select', {
            class: 'input', onchange: (e) => {
              const k = e.target.value;
              if (k === 'source') t.nodes.forEach((m) => { if (m.kind === 'source') m.kind = 'junction'; });
              n.kind = k;
              if (k === 'fixture' && !n.fixtureId) n.fixtureId = rt.fixtureId;
              if (k === 'riser' && !n.tag) n.tag = rt.riserTag;
              commit();
            },
          }, [['junction', '分岐点'], ['fixture', '器具'], ['source', '水源'], ['riser', '立管']].map(([v, l]) => h('option', { value: v, selected: n.kind === v ? 'selected' : null }, l)));
          sec.append(h('label', { class: 'field' }, h('span', null, '種類'), kindSel));
          if (n.kind === 'fixture') {
            sec.append(h('label', { class: 'field' }, h('span', null, '器具'), h('select', { class: 'input', onchange: (e) => { n.fixtureId = e.target.value; commit(); } },
              st().masters.fixtures.map((f) => h('option', { value: f.id, selected: f.id === n.fixtureId ? 'selected' : null }, f.name)))));
          }
          if (n.kind === 'riser') {
            sec.append(h('label', { class: 'field' }, h('span', null, '立管記号'), h('input', { class: 'input', value: n.tag || '', onchange: (e) => { n.tag = e.target.value; commit(); } })));
          }
          const res = rt.app.result;
          const fr = res && res.fixtures.find((q) => q.nodeId === n.id);
          if (fr) sec.append(h('p', { class: 'small' }, `残圧 ${U().fmt(fr.residual, 1)} kPa ／ 必要 ${U().fmt(fr.pmin, 0)} kPa ${fr.ok ? '（適合）' : '（不足）'}`));
          if (res && res.nodePressure[n.id] !== undefined && !fr) sec.append(h('p', { class: 'small' }, `圧力 ${U().fmt(res.nodePressure[n.id], 1)} kPa`));
          sec.append(h('button', { class: 'btn-text danger', onclick: () => { deleteNode(n.id); rt.selection = null; commit(); } }, '節点を削除'));
        }
      } else {
        const s = tr().segments.find((q) => q.id === rt.selection.id);
        if (s) {
          const a = nodeById(s.a);
          const b = nodeById(s.b);
          const len = a && b ? Math.hypot(a.x - b.x, a.y - b.y) * U().num(pg.scale) : 0;
          const row = rt.app.result && rt.app.result.edgeById[s.id];
          sec.append(h('p', { class: 'small' }, `平面長さ ${U().fmt(len, 2)} m`));
          if (row) {
            sec.append(h('p', { class: 'small' }, `${row.label}：${row.size} ／ ${U().fmt(row.flow, 1)} L/min ／ ${U().fmt(row.velocity, 2)} m/s`));
            sec.append(h('p', { class: 'small' }, `負荷単位 ${U().fmt(row.fu, 1)} ／ 摩擦損失 ${U().fmt(row.friction, 3)} kPa/m`));
            if (row.notes.length) sec.append(h('p', { class: 'small warn' }, row.notes.join('、')));
          }
          sec.append(h('button', { class: 'btn-text danger', onclick: () => { deleteSegment(s.id); rt.selection = null; commit(); } }, '配管を削除'));
        }
      }
      side.append(sec);
    }

    const counts = { seg: t.segments.length, fx: t.nodes.filter((n) => n.kind === 'fixture').length, src: t.nodes.filter((n) => n.kind === 'source').length, rs: t.nodes.filter((n) => n.kind === 'riser').length };
    side.append(h('section', { class: 'side-sec' },
      h('h4', null, '作図状況（全ページ）'),
      h('p', { class: 'small' }, `配管 ${counts.seg} 区間 ／ 器具 ${counts.fx} ／ 水源 ${counts.src} ／ 立管 ${counts.rs}`),
      counts.src === 0 ? h('p', { class: 'small warn' }, '水源が未配置です。') : null,
      t.pdfName && !rt.pdf ? h('p', { class: 'small warn' }, `図面「${t.pdfName}」を再読み込みすると背景が表示されます。`) : null,
      h('button', {
        class: 'btn-text danger', onclick: () => {
          if (!confirm('このページの配管・器具をすべて消去しますか？')) return;
          const ids = new Set(t.nodes.filter((n) => n.page === rt.page).map((n) => n.id));
          t.nodes = t.nodes.filter((n) => !ids.has(n.id));
          t.segments = t.segments.filter((s) => !ids.has(s.a) && !ids.has(s.b));
          rt.selection = null;
          commit();
        },
      }, 'このページの作図を消去')));
  }

  /* --- 書き出し（平面図） --- */
  async function renderPageImage(state, idx, result, opts) {
    const pg = state.trace.pages[idx];
    if (!pg) return null;
    let bm = null;
    if (rt.pdf && !pg.blank) bm = await ensureBitmap(idx);
    const k = bm ? bm.scale : Math.min(3, 3000 / Math.max(pg.width, pg.height));
    const c = document.createElement('canvas');
    c.width = Math.floor(pg.width * k);
    c.height = Math.floor(pg.height * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(k, k);
    if (bm) {
      ctx.globalAlpha = 0.55; // 背景図面を淡くして配管を目立たせる
      ctx.drawImage(bm.canvas, 0, 0, pg.width, pg.height);
      ctx.globalAlpha = 1;
    }
    // 書き出し画像は縮小表示されるため、画像幅に応じて線・文字を太らせる
    const thick = (opts && opts.thick) || Math.max(1.6, c.width / 1100);
    drawOverlay(ctx, state, idx, k / thick, { result, labels: true, showFlow: opts && opts.showFlow });
    return c.toDataURL('image/png');
  }

  WPS.trace = {
    defaultTrace, build, init, onShow, draw: () => { draw(); renderSide(); }, renderPageImage,
    hasPdf: () => !!rt.pdf,
    view: () => ({ zoom: rt.zoom, ox: rt.ox, oy: rt.oy, page: rt.page }),
    setPage(i) { rt.page = i; rt.selection = null; rt.drawingLast = null; fitView(); renderSide(); ensureBitmap(i); },
    reset() { rt.pdf = null; rt.bitmaps = {}; rt.pixels = {}; rt.page = 0; rt.fitted = false; rt.selection = null; rt.drawingLast = null; if (rt.root) { const el = rt.root.querySelector('.pdf-name'); if (el) el.textContent = ''; } },
  };
})(globalThis.WPS = globalThis.WPS || {});
