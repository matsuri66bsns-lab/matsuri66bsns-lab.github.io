/*
 * 樹枝状給水管網の口径算定エンジン
 *
 * 入力（両入力モード共通の管網）
 *   net.nodes : { id, kind: 'source'|'junction'|'riser'|'fixture', fixtureId?, z[m], label, floor }
 *   net.edges : { id, a, b, length[m], label, vertical? }   ※向きは問わない。水源から BFS で向きを決める
 *   net.floors: { name, level }                              ※系統図用
 *
 * 手順
 *   1. 水源から BFS で上流→下流を決定（ループ区間は除外して警告）
 *   2. 各区間の下流側の器具給水負荷単位を集計し、同時使用流量線図から流量を求める
 *      （下流の器具が1個なら器具の給水流量。複数なら max(線図流量, 下流の最大器具流量)）
 *   3. 器具ごとに 許容摩擦損失 R = (起点圧力 − 器具最低必要圧力 − 静水頭) / 水源からの相当長 を求め、
 *      区間の R は下流器具の最小値とする
 *   4. 流速 ≤ 上限 かつ 摩擦損失 ≤ R を満たす最小口径を選ぶ（下流より細くならないよう補正）
 *   5. 決定口径で各器具の残圧を検算する
 */
(function (WPS) {
  'use strict';

  const hyd = () => WPS.hyd;

  function compute(net, settings, masters) {
    const res = {
      edges: [], fixtures: [], warnings: [], errors: [],
      summary: null, tree: null, edgeById: {}, nodePressure: {},
    };
    const pipe = (masters.pipes || []).find((p) => p.id === settings.material);
    if (!pipe) {
      res.errors.push('管種が選択されていません。');
      return res;
    }
    const C = WPS.util.num(pipe.C, 130);
    const sizes = pipe.sizes.slice().sort((a, b) => a.id - b.id)
      .filter((s) => s.dn >= WPS.util.num(settings.minDn, 0));
    if (!sizes.length) {
      res.errors.push('最小口径の条件を満たす口径が管種マスタにありません。');
      return res;
    }
    const fixtureMap = {};
    (masters.fixtures || []).forEach((f) => { fixtureMap[f.id] = f; });

    const P0 = WPS.util.num(settings.sourcePressure, 0);
    const vmax = WPS.util.num(settings.vmax, 2.0);
    const factor = Math.max(1, WPS.util.num(settings.equivFactor, 1.0));
    const usagePrivate = settings.usage === 'private';

    const nodes = new Map();
    (net.nodes || []).forEach((n) => nodes.set(n.id, n));
    const adj = new Map();
    nodes.forEach((n, id) => adj.set(id, []));
    (net.edges || []).forEach((e) => {
      if (!nodes.has(e.a) || !nodes.has(e.b) || e.a === e.b) return;
      adj.get(e.a).push({ e, other: e.b });
      adj.get(e.b).push({ e, other: e.a });
    });

    const sources = (net.nodes || []).filter((n) => n.kind === 'source');
    if (!sources.length) {
      res.errors.push('水源（起点）が配置されていません。');
      return res;
    }
    if (sources.length > 1) res.warnings.push('水源が複数あります。最初の水源のみを起点として計算しました。');
    const root = sources[0];

    // 1. BFS で向き付け
    const parent = new Map();       // childId -> { e, p }
    const children = new Map();
    const order = [];
    const seen = new Set([root.id]);
    const usedEdges = new Set();
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      children.set(id, []);
      adj.get(id).forEach(({ e, other }) => {
        if (usedEdges.has(e.id)) return;
        usedEdges.add(e.id);
        if (seen.has(other)) {
          res.warnings.push(`区間「${e.label || e.id}」はループを形成するため計算から除外しました（樹枝状配管のみ対応）。`);
          return;
        }
        seen.add(other);
        parent.set(other, { e, p: id });
        children.get(id).push(other);
        queue.push(other);
      });
    }
    let orphanFixtures = 0;
    nodes.forEach((n, id) => {
      if (!seen.has(id) && n.kind === 'fixture') orphanFixtures++;
    });
    if (orphanFixtures) res.warnings.push(`水源につながっていない器具が ${orphanFixtures} 個あります。`);

    const fixOf = (n) => {
      if (n.kind !== 'fixture') return null;
      const f = fixtureMap[n.fixtureId];
      if (!f) res.warnings.push(`器具「${n.label || n.id}」の種類がマスタにありません。`);
      return f || null;
    };

    // 2. 下流集計（後順）
    const agg = new Map();
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      const n = nodes.get(id);
      const a = { fu: 0, valve: false, maxFlow: 0, count: 0, maxConn: 0 };
      const f = fixOf(n);
      if (f) {
        a.fu += WPS.util.num(usagePrivate ? f.fuPrivate : f.fuPublic, 0);
        a.valve = !!f.flushValve;
        a.maxFlow = WPS.util.num(f.flow, 0);
        a.count = 1;
        a.maxConn = WPS.util.num(f.conn, 0);
      }
      children.get(id).forEach((c) => {
        const ca = agg.get(c);
        a.fu += ca.fu;
        a.valve = a.valve || ca.valve;
        a.maxFlow = Math.max(a.maxFlow, ca.maxFlow);
        a.count += ca.count;
        a.maxConn = Math.max(a.maxConn, ca.maxConn);
      });
      agg.set(id, a);
    }

    // 3. 器具ごとの許容摩擦損失（前順で水源からの相当長を累積）
    const cumLeq = new Map([[root.id, 0]]);
    order.forEach((id) => {
      if (id === root.id) return;
      const { e, p } = parent.get(id);
      cumLeq.set(id, cumLeq.get(p) + Math.max(0, WPS.util.num(e.length, 0)) * factor);
    });
    const fixR = new Map();
    order.forEach((id) => {
      const n = nodes.get(id);
      const f = fixtureMap[n.fixtureId];
      if (n.kind !== 'fixture' || !f) return;
      const dz = WPS.util.num(n.z, 0) - WPS.util.num(root.z, 0);
      const avail = P0 - WPS.util.num(f.pmin, 0) - hyd().staticKPa(dz);
      const L = cumLeq.get(id);
      fixR.set(id, L > 0 ? avail / L : (avail >= 0 ? Infinity : -Infinity));
    });
    const minR = new Map();
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      let r = fixR.has(id) ? fixR.get(id) : Infinity;
      children.get(id).forEach((c) => { r = Math.min(r, minR.get(c)); });
      minR.set(id, r);
    }

    // 4. 口径選定
    const rows = new Map(); // childId -> row
    order.forEach((id) => {
      if (id === root.id) return;
      const { e, p } = parent.get(id);
      const a = agg.get(id);
      const curve = settings.curve === 'valve' || settings.curve === 'tank'
        ? settings.curve : (a.valve ? 'valve' : 'tank');
      let flow = 0;
      let flowBasis = '—';
      if (a.count === 1) {
        flow = a.maxFlow;
        flowBasis = '器具流量';
      } else if (a.count > 1) {
        const q = WPS.flow.fuToFlow(a.fu, curve);
        flow = Math.max(q, a.maxFlow);
        flowBasis = q >= a.maxFlow ? WPS.flow.CURVE_LABEL[curve] : '最大器具流量';
      }
      const length = Math.max(0, WPS.util.num(e.length, 0));
      const row = {
        edgeId: e.id, label: e.label || e.id, from: p, to: id,
        fromLabel: nodes.get(p).label || '', toLabel: nodes.get(id).label || '',
        vertical: !!e.vertical,
        fu: a.fu, count: a.count, curve, flowBasis, flow,
        length, leq: length * factor, rAllow: minR.get(id),
        single: a.count === 1, conn: a.count === 1 ? a.maxConn : 0,
        sizeIdx: 0, notes: [], status: 'ok',
      };
      row.sizeIdx = pickSize(row, sizes, C, vmax, settings);
      rows.set(id, row);
    });

    // 下流より細くならないよう補正（後順）
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      const row = rows.get(id);
      if (!row) continue;
      let maxChild = -1;
      children.get(id).forEach((c) => {
        const cr = rows.get(c);
        if (cr) maxChild = Math.max(maxChild, cr.sizeIdx);
      });
      if (maxChild > row.sizeIdx) {
        row.sizeIdx = maxChild;
        row.notes.push('下流口径に合わせ増径');
      }
    }

    // 5. 決定口径での損失・残圧
    const P = new Map([[root.id, P0]]);
    order.forEach((id) => {
      if (id === root.id) return;
      const row = rows.get(id);
      const s = sizes[row.sizeIdx];
      row.size = s.label;
      row.dn = s.dn;
      row.innerD = s.id;
      row.velocity = hyd().velocity(row.flow, s.id);
      row.friction = hyd().frictionKPaPerM(row.flow, s.id, C);
      row.loss = row.friction * row.leq;
      const dz = WPS.util.num(nodes.get(id).z, 0) - WPS.util.num(nodes.get(row.from).z, 0);
      row.dz = dz;
      P.set(id, P.get(row.from) - row.loss - hyd().staticKPa(dz));
      row.pEnd = P.get(id);

      const vOver = row.velocity > vmax + 1e-9;
      if (vOver) {
        if (row.single && settings.connPriority) row.notes.push('器具接続口径優先（流速超過）');
        else { row.notes.push('流速上限超過'); row.status = 'ng'; }
      }
      if (row.rAllow > 0 && row.friction > row.rAllow + 1e-9) {
        row.notes.push('許容摩擦損失超過');
        row.status = 'ng';
      }
      if (row.rAllow <= 0) {
        row.notes.push('静水頭・器具必要圧力だけで起点圧力を超過');
        row.status = 'ng';
      }
      if (row.notes.includes('最大口径でも条件を満たさない')) row.status = 'ng';
      if (row.count === 0) row.notes.push('下流に器具なし');
      if (row.status === 'ok' && row.notes.length && !row.notes.every((n) => n === '下流口径に合わせ増径')) row.status = 'warn';
      res.edges.push(row);
      res.edgeById[row.edgeId] = row;
    });
    P.forEach((v, k) => { res.nodePressure[k] = v; });

    // 器具の検算
    let critical = null;
    order.forEach((id) => {
      const n = nodes.get(id);
      const f = fixtureMap[n.fixtureId];
      if (n.kind !== 'fixture' || !f) return;
      const pmin = WPS.util.num(f.pmin, 0);
      const residual = P.get(id);
      const dz = WPS.util.num(n.z, 0) - WPS.util.num(root.z, 0);
      const staticLoss = hyd().staticKPa(dz);
      const friction = P0 - residual - staticLoss;
      const required = pmin + friction + staticLoss;
      const item = {
        nodeId: id, label: n.label || f.name, floor: n.floor || '', name: f.name, abbr: f.abbr,
        pmin, z: WPS.util.num(n.z, 0), staticLoss, friction, residual, required,
        leq: cumLeq.get(id), ok: residual >= pmin - 1e-9,
      };
      res.fixtures.push(item);
      if (!critical || item.required > critical.required) critical = item;
    });

    const rootRows = children.get(root.id).map((c) => rows.get(c)).filter(Boolean);
    res.summary = {
      sourcePressure: P0,
      requiredPressure: critical ? critical.required : 0,
      critical,
      totalFu: agg.get(root.id).fu,
      fixtureCount: res.fixtures.length,
      ngFixtures: res.fixtures.filter((f) => !f.ok).length,
      ngEdges: res.edges.filter((r) => r.status === 'ng').length,
      mainFlow: rootRows.reduce((s, r) => s + r.flow, 0),
      mainSize: rootRows.length ? rootRows.map((r) => r.size).join(' / ') : '—',
      material: pipe.name,
      C,
    };
    if (!res.fixtures.length) res.warnings.push('水源につながった器具がありません。');

    const childObj = {};
    children.forEach((v, k) => { childObj[k] = v.slice(); });
    const parentObj = {};
    parent.forEach((v, k) => { parentObj[k] = v.e.id; });
    res.tree = { root: root.id, children: childObj, parentEdge: parentObj, order };
    return res;
  }

  function pickSize(row, sizes, C, vmax, settings) {
    let first = 0;
    if (row.single && row.conn > 0) {
      const k = sizes.findIndex((s) => s.dn >= row.conn);
      first = k < 0 ? sizes.length - 1 : k;
    }
    if (!(row.flow > 0)) return first;
    for (let i = first; i < sizes.length; i++) {
      const s = sizes[i];
      const v = hyd().velocity(row.flow, s.id);
      const fr = hyd().frictionKPaPerM(row.flow, s.id, C);
      const vOK = (row.single && settings.connPriority) ? true : v <= vmax + 1e-9;
      const rOK = row.rAllow <= 0 ? true : fr <= row.rAllow + 1e-9;
      if (vOK && rOK) return i;
    }
    row.notes.push('最大口径でも条件を満たさない');
    return sizes.length - 1;
  }

  WPS.network = { compute };
})(globalThis.WPS = globalThis.WPS || {});
