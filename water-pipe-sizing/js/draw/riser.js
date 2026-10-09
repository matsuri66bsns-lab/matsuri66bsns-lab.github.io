/*
 * 給水系統図（SVG）の自動生成
 * 管網の木構造から、縦位置＝高さ(z)、横位置＝分岐順 で配置する。
 * 立管（鉛直区間）は同じ列に揃え、各階の横引き・器具はその右側に並べる。
 */
(function (WPS) {
  'use strict';
  const U = () => WPS.util;

  const COLORS = { ok: '#0071e3', warn: '#c77700', ng: '#d70015', none: '#86868b' };

  function render(net, res, opts) {
    opts = opts || {};
    const esc = U().esc;
    if (!res || !res.tree) {
      return '<p class="empty">計算結果がありません。入力内容を確認してください。</p>';
    }
    const nodes = {};
    net.nodes.forEach((n) => { nodes[n.id] = n; });
    const edges = {};
    net.edges.forEach((e) => { edges[e.id] = e; });
    const tree = res.tree;
    const kids = (id) => tree.children[id] || [];
    const pEdge = (id) => edges[tree.parentEdge[id]];
    const isVert = (e, a, b) => !!(e && (e.vertical || Math.abs(U().num(nodes[a].z) - U().num(nodes[b].z)) >= 1.5));
    const vertKid = (id, k) => isVert(pEdge(k), id, k);
    const band = (id) => nodes[id].floor || '_';
    const ownSlot = (id) => {
      if (id === tree.root) return true;
      const pe = pEdge(id);
      if (pe && isVert(pe, pe.a, pe.b)) return true;
      return kids(id).some((k) => vertKid(id, k));
    };

    const X = {};
    const cursor = {};
    const cur = (b) => cursor[b] || 0;
    const bump = (b, x) => { cursor[b] = Math.max(cur(b), x + 1); };
    const chainBands = (id, acc) => {
      acc.push(band(id));
      kids(id).filter((k) => vertKid(id, k)).forEach((k) => chainBands(k, acc));
      return acc;
    };
    const sortKids = (id) => {
      const ks = kids(id).slice();
      const rank = (k) => (vertKid(id, k) ? 0 : (nodes[k].kind === 'fixture' && !kids(k).length ? 1 : 2));
      return ks.sort((a, b) => rank(a) - rank(b));
    };

    function placeAt(id, x) {
      X[id] = x;
      bump(band(id), x);
      sortKids(id).forEach((k) => {
        if (vertKid(id, k)) placeAt(k, x);
        else place(k, x + 1);
      });
    }

    function place(id, minX) {
      if (ownSlot(id)) {
        const bands = chainBands(id, []);
        const x = Math.max(minX, ...bands.map(cur));
        placeAt(id, x);
        return;
      }
      const ks = sortKids(id);
      if (!ks.length) {
        const x = Math.max(minX, cur(band(id)));
        X[id] = x;
        bump(band(id), x);
        return;
      }
      place(ks[0], minX);
      X[id] = X[ks[0]];
      bump(band(id), X[id]);
      ks.slice(1).forEach((k) => place(k, X[id] + 1));
    }
    place(tree.root, 0);

    const placed = Object.keys(X);
    const zs = placed.map((id) => U().num(nodes[id].z));
    (net.floors || []).forEach((f) => zs.push(U().num(f.level)));
    const zmax = Math.max(...zs) + 0.8;
    const zmin = Math.min(...zs) - 0.6;
    const pxPerM = opts.pxPerM || 40;
    const colW = opts.colW || 62;
    const left = 110;
    const top = 30;
    const maxX = Math.max(0, ...placed.map((id) => X[id]));
    const width = Math.max(560, left + (maxX + 1) * colW + 80);
    // 凡例（器具略号）を先に組んで、折り返し行数ぶん高さを確保する
    const legendItems = [];
    const seenAbbr = {};
    (res.fixtures || []).forEach((f) => {
      const abbr = nodes[f.nodeId].short || f.abbr;
      if (!seenAbbr[abbr]) { seenAbbr[abbr] = 1; legendItems.push(`${abbr}: ${f.name}`); }
    });
    const legendLines = [[]];
    let lineW = 34;
    legendItems.forEach((t) => {
      const w = t.length * 10 + 16;
      if (lineW + w > width - 60 && legendLines[legendLines.length - 1].length) { legendLines.push([]); lineW = 34; }
      legendLines[legendLines.length - 1].push({ t, x: lineW });
      lineW += w;
    });
    const plotH = top + (zmax - zmin) * pxPerM;
    const height = plotH + 40 + legendLines.length * 16 + 24;
    const px = (id) => left + X[id] * colW;
    const py = (z) => top + (zmax - z) * pxPerM;

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="riser-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif">`);
    out.push('<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>');

    // 階のFLライン
    (net.floors || []).forEach((f) => {
      const y = py(U().num(f.level));
      out.push(`<line x1="${left - 70}" y1="${y}" x2="${width - 20}" y2="${y}" stroke="#d2d2d7" stroke-dasharray="6 4"/>`);
      out.push(`<text x="${left - 72}" y="${y - 6}" font-size="13" font-weight="600" fill="#1d1d1f">${esc(f.name)}</text>`);
      out.push(`<text x="${left - 72}" y="${y + 14}" font-size="10" fill="#86868b">FL${U().num(f.level) >= 0 ? '+' : ''}${U().fmt(U().num(f.level), 2)}</text>`);
    });

    // 同じ節点から横へ複数の枝が出る場合、2本目以降は少し下を通して重なりを避ける
    const lane = {};
    placed.forEach((id) => {
      let i = 0;
      sortKids(id).forEach((k) => {
        if (X[k] === undefined || vertKid(id, k) || X[k] === X[id]) return;
        if (nodes[k].kind === 'fixture' && !kids(k).length && i === 0) return;
        lane[k] = i++;
      });
    });

    // 区間
    const labels = [];
    placed.forEach((id) => {
      if (id === tree.root) return;
      const e = pEdge(id);
      if (!e) return;
      const pid = e.a === id ? e.b : e.a;
      if (X[pid] === undefined) return;
      const row = res.edgeById[e.id];
      const color = COLORS[row ? row.status : 'none'];
      const x1 = px(pid);
      const y1 = py(U().num(nodes[pid].z));
      const x2 = px(id);
      const y2 = py(U().num(nodes[id].z));
      const vert = isVert(e, pid, id);
      const w = vert ? 3 : 2;
      const dy = lane[id] ? Math.min(lane[id] * 14, 70) : 0;
      const yr = y1 + dy;
      out.push(`<path d="M${x1} ${y1}${dy ? ` V${yr}` : ''} H${x2} V${y2}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"><title>${esc(e.label || '')}${row ? ` ${row.size} Q=${U().fmt(row.flow, 1)}L/min v=${U().fmt(row.velocity, 2)}m/s` : ''}</title></path>`);
      if (!row) return;
      let text = row.size;
      if (opts.showFlow) text += ` (${U().fmt(row.flow, 0)})`;
      if (x2 !== x1) labels.push({ x: x2 - colW / 2, y: yr - 5, text, color, anchor: 'middle' });
      else if (vert) labels.push({ x: x1 + 7, y: (y1 + y2) / 2 + 4, text, color, anchor: 'start' });
      else if (Math.abs(y2 - y1) >= 2) labels.push({ x: x1 + 6, y: (y1 + y2) / 2 + 9, text, color, anchor: 'start', small: true });
    });
    labels.forEach((l) => {
      out.push(`<text x="${l.x}" y="${l.y}" text-anchor="${l.anchor}" font-size="${l.small ? 9 : 11}" font-weight="600" fill="${l.color}" paint-order="stroke" stroke="#ffffff" stroke-width="3">${esc(l.text)}</text>`);
    });

    // 節点・器具
    const fxStatus = {};
    (res.fixtures || []).forEach((f) => { fxStatus[f.nodeId] = f; });
    placed.forEach((id) => {
      const n = nodes[id];
      const x = px(id);
      const y = py(U().num(n.z));
      if (n.kind === 'source') {
        out.push(`<rect x="${x - 16}" y="${y - 11}" width="32" height="22" rx="4" fill="#1d1d1f"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">水源</text>`);
        out.push(`<text x="${x}" y="${y + 26}" text-anchor="middle" font-size="10" fill="#1d1d1f">${esc(n.label || '')}</text>`);
      } else if (n.kind === 'fixture') {
        const f = fxStatus[id];
        const ok = !f || f.ok;
        const abbr = n.short || (f && f.abbr) || '器';
        out.push(`<g><title>${esc(n.label || '')}${f ? ` 残圧 ${U().fmt(f.residual, 1)}kPa（必要 ${U().fmt(f.pmin, 0)}kPa）` : ''}</title><circle cx="${x}" cy="${y - 9}" r="10" fill="${ok ? '#ffffff' : '#ffe5e5'}" stroke="${ok ? '#1d1d1f' : COLORS.ng}" stroke-width="1.4"/><text x="${x}" y="${y - 6}" text-anchor="middle" font-size="${abbr.length > 2 ? 7.5 : 9}" font-weight="600" fill="#1d1d1f">${esc(abbr)}</text></g>`);
      } else if (n.kind === 'riser') {
        out.push(`<circle cx="${x}" cy="${y}" r="3.5" fill="#ffffff" stroke="#1d1d1f" stroke-width="1.4"/>`);
      } else {
        out.push(`<circle cx="${x}" cy="${y}" r="2.2" fill="#1d1d1f"/>`);
      }
    });

    // 凡例
    const legendY = plotH + 34;
    out.push(`<text x="${left - 70}" y="${legendY}" font-size="10" fill="#86868b">凡例</text>`);
    legendLines.forEach((line, li) => {
      line.forEach((it) => {
        out.push(`<text x="${left - 70 + it.x}" y="${legendY + li * 16}" font-size="10" fill="#1d1d1f">${esc(it.t)}</text>`);
      });
    });
    const ly2 = legendY + legendLines.length * 16 + 6;
    [['ok', '適合'], ['warn', '注意'], ['ng', '不適合']].forEach(([k, t], i) => {
      const x = left - 36 + i * 80;
      out.push(`<line x1="${x}" y1="${ly2 - 4}" x2="${x + 22}" y2="${ly2 - 4}" stroke="${COLORS[k]}" stroke-width="3"/><text x="${x + 28}" y="${ly2}" font-size="10" fill="#1d1d1f">${t}</text>`);
    });
    out.push(`<text x="${left + 210}" y="${ly2}" font-size="10" fill="#86868b">数値＝呼び径${opts.showFlow ? '（流量 L/min）' : ''}</text>`);
    out.push('</svg>');
    return out.join('');
  }

  WPS.riser = { render, COLORS };
})(globalThis.WPS = globalThis.WPS || {});
