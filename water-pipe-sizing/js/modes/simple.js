/*
 * 入力モードB「簡易定義」
 * 階・水廻りエリア・器具数から樹枝状管網を生成する。
 *   水源 ─主管─ 立管基部 ─立管─ 各階分岐 ─横引き枝管─ エリア ─器具間配管─ … ─器具枝管─ 器具
 * 上向き供給（直結・増圧・ポンプ直送）は下階から、下向き供給（高置水槽）は上階から立管を通す。
 */
(function (WPS) {
  'use strict';
  const U = () => WPS.util;

  function defaultSimple() {
    return {
      mainLength: 8,
      stubLength: 0.5,
      floors: [1, 2, 3].map((i) => ({
        id: U().uid('fl'),
        name: i + 'F',
        level: (i - 1) * 3.5,
        areas: [
          {
            id: U().uid('ar'), name: '男子便所', length: 6, spacing: 1.0,
            items: [{ fixtureId: 'wc_fv', count: 2 }, { fixtureId: 'ur_fv', count: 2 }, { fixtureId: 'lav', count: 2 }],
          },
          {
            id: U().uid('ar'), name: '女子便所', length: 9, spacing: 1.0,
            items: [{ fixtureId: 'wc_fv', count: 3 }, { fixtureId: 'lav', count: 2 }],
          },
          {
            id: U().uid('ar'), name: '給湯室', length: 12, spacing: 1.0,
            items: [{ fixtureId: 'sink_office', count: 1 }, { fixtureId: 'heater', count: 1 }],
          },
        ],
      })),
    };
  }

  function build(state) {
    const settings = state.settings;
    const sim = state.simple;
    const fxMap = {};
    state.masters.fixtures.forEach((f) => { fxMap[f.id] = f; });
    const nodes = [];
    const edges = [];
    const pipeZ = U().num(settings.pipeZ, 0.3);
    const down = settings.supply === 'down';
    const sourceZ = U().num(settings.sourceZ, 0);
    let eSeq = 0;
    const addEdge = (a, b, length, label, extra) => {
      edges.push(Object.assign({ id: 'e' + (++eSeq), a, b, length: Math.max(0, length), label }, extra || {}));
    };

    const floors = sim.floors.slice().sort((a, b) => U().num(a.level) - U().num(b.level));
    if (down) floors.reverse();

    nodes.push({ id: 'src', kind: 'source', z: sourceZ, label: down ? '高置水槽' : '水源（引込）', floor: '' });
    nodes.push({ id: 'rb', kind: 'junction', z: sourceZ, label: '立管基部', floor: '' });
    addEdge('src', 'rb', U().num(sim.mainLength, 0), '主管');

    let prev = 'rb';
    let prevZ = sourceZ;
    floors.forEach((fl) => {
      const level = U().num(fl.level, 0);
      const zr = level + pipeZ;
      const rid = 'r_' + fl.id;
      nodes.push({ id: rid, kind: 'riser', z: zr, label: '立管 ' + fl.name, floor: fl.name });
      addEdge(prev, rid, Math.abs(zr - prevZ), '立管 →' + fl.name, { vertical: true });
      prev = rid;
      prevZ = zr;

      (fl.areas || []).forEach((ar) => {
        const list = [];
        (ar.items || []).forEach((it) => {
          const n = Math.max(0, Math.round(U().num(it.count, 0)));
          for (let k = 0; k < n; k++) list.push(it.fixtureId);
        });
        if (!list.length) return;
        const hid = 'h_' + ar.id;
        nodes.push({ id: hid, kind: 'junction', z: zr, label: fl.name + ' ' + ar.name, floor: fl.name });
        addEdge(rid, hid, U().num(ar.length, 0), fl.name + ' ' + ar.name + ' 枝管');
        let tee = hid;
        const counters = {};
        list.forEach((fid, i) => {
          if (i > 0) {
            const tid = hid + '_t' + i;
            nodes.push({ id: tid, kind: 'junction', z: zr, label: fl.name + ' ' + ar.name + ' 分岐' + i, floor: fl.name });
            addEdge(tee, tid, U().num(ar.spacing, 1), fl.name + ' ' + ar.name + ' 器具間' + i);
            tee = tid;
          }
          const f = fxMap[fid];
          counters[fid] = (counters[fid] || 0) + 1;
          const fh = f && f.height !== '' && f.height !== undefined && f.height !== null
            ? U().num(f.height, U().num(settings.fixtureHeight, 0.8)) : U().num(settings.fixtureHeight, 0.8);
          const fzz = level + fh;
          const fidNode = hid + '_f' + i;
          const name = (f ? f.name : fid) + ' #' + counters[fid];
          nodes.push({ id: fidNode, kind: 'fixture', fixtureId: fid, z: fzz, label: fl.name + ' ' + ar.name + ' ' + name, floor: fl.name, short: f ? f.abbr : '?' });
          addEdge(tee, fidNode, U().num(sim.stubLength, 0.5) + Math.abs(fzz - zr), fl.name + ' ' + ar.name + ' ' + name);
        });
      });
    });

    return {
      nodes, edges,
      floors: sim.floors.map((f) => ({ name: f.name, level: U().num(f.level, 0) })),
    };
  }

  /* ---------- UI ---------- */
  function render(container, state, onChange) {
    const h = U().h;
    const sim = state.simple;
    container.innerHTML = '';

    const fixtureOptions = (sel) => state.masters.fixtures.map((f) =>
      h('option', { value: f.id, selected: f.id === sel ? 'selected' : null }, f.name));

    const numInput = (val, oninput, attrs) => h('input', Object.assign({
      type: 'number', step: 'any', value: val, class: 'input num',
      onchange: (e) => oninput(e.target.value),
    }, attrs || {}));

    // 一括生成
    const gen = { floors: sim.floors.length || 3, height: 3.5, base: 0 };
    const genCard = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, '階構成の一括設定'),
        h('p', { class: 'muted' }, '基準階（1番目の階）のエリア構成を全階にコピーして階を作り直します。')),
      h('div', { class: 'form-row' },
        h('label', { class: 'field' }, h('span', null, '階数'), numInput(gen.floors, (v) => { gen.floors = v; }, { min: 1, step: 1 })),
        h('label', { class: 'field' }, h('span', null, '階高 [m]'), numInput(gen.height, (v) => { gen.height = v; })),
        h('label', { class: 'field' }, h('span', null, '最下階FL [m]'), numInput(gen.base, (v) => { gen.base = v; })),
        h('button', {
          class: 'btn', onclick: () => {
            const n = Math.max(1, Math.round(U().num(gen.floors, 1)));
            const tpl = sim.floors[0] ? sim.floors[0].areas : [];
            const out = [];
            for (let i = 0; i < n; i++) {
              const old = sim.floors[i];
              out.push({
                id: old ? old.id : U().uid('fl'),
                name: (i + 1) + 'F',
                level: U().num(gen.base, 0) + i * U().num(gen.height, 3.5),
                areas: U().clone(tpl).map((a) => Object.assign(a, { id: U().uid('ar') })),
              });
            }
            sim.floors = out;
            onChange(true);
          },
        }, '階を生成')),
      h('div', { class: 'form-row' },
        h('label', { class: 'field' }, h('span', null, '主管長さ（水源→立管）[m]'), numInput(sim.mainLength, (v) => { sim.mainLength = U().num(v); onChange(); })),
        h('label', { class: 'field' }, h('span', null, '器具枝管の横引き長さ [m]'), numInput(sim.stubLength, (v) => { sim.stubLength = U().num(v); onChange(); }))));
    container.append(genCard);

    sim.floors.forEach((fl, fi) => {
      const areaBox = h('div', { class: 'areas' });
      (fl.areas || []).forEach((ar, ai) => {
        const items = h('div', { class: 'items' });
        (ar.items || []).forEach((it, ii) => {
          items.append(h('div', { class: 'item-row' },
            h('select', { class: 'input', onchange: (e) => { it.fixtureId = e.target.value; onChange(); } }, fixtureOptions(it.fixtureId)),
            numInput(it.count, (v) => { it.count = Math.max(0, Math.round(U().num(v))); onChange(); }, { min: 0, step: 1, class: 'input num short' }),
            h('span', { class: 'muted' }, '個'),
            h('button', { class: 'btn-icon', title: '削除', onclick: () => { ar.items.splice(ii, 1); onChange(true); } }, '×')));
        });
        areaBox.append(h('div', { class: 'area' },
          h('div', { class: 'area-head' },
            h('input', { class: 'input title', value: ar.name, onchange: (e) => { ar.name = e.target.value; onChange(); } }),
            h('button', { class: 'btn-icon', title: 'エリアを削除', onclick: () => { fl.areas.splice(ai, 1); onChange(true); } }, '×')),
          h('div', { class: 'form-row tight' },
            h('label', { class: 'field' }, h('span', null, '立管からの距離 [m]'), numInput(ar.length, (v) => { ar.length = U().num(v); onChange(); })),
            h('label', { class: 'field' }, h('span', null, '器具間隔 [m]'), numInput(ar.spacing, (v) => { ar.spacing = U().num(v); onChange(); }))),
          items,
          h('button', { class: 'btn-text', onclick: () => { ar.items.push({ fixtureId: state.masters.fixtures[0].id, count: 1 }); onChange(true); } }, '＋ 器具を追加')));
      });

      container.append(h('section', { class: 'card floor' },
        h('div', { class: 'card-head row' },
          h('input', { class: 'input title', value: fl.name, onchange: (e) => { fl.name = e.target.value; onChange(); } }),
          h('label', { class: 'field inline' }, h('span', null, 'FL [m]'), numInput(fl.level, (v) => { fl.level = U().num(v); onChange(); })),
          h('div', { class: 'spacer' }),
          h('button', {
            class: 'btn-text', onclick: () => {
              sim.floors.forEach((other, oi) => {
                if (oi !== fi) other.areas = U().clone(fl.areas).map((a) => Object.assign(a, { id: U().uid('ar') }));
              });
              onChange(true);
            },
          }, 'この階の構成を全階にコピー'),
          h('button', { class: 'btn-icon', title: '階を削除', onclick: () => { sim.floors.splice(fi, 1); onChange(true); } }, '×')),
        areaBox,
        h('button', {
          class: 'btn-text', onclick: () => {
            fl.areas.push({ id: U().uid('ar'), name: 'エリア' + (fl.areas.length + 1), length: 5, spacing: 1, items: [] });
            onChange(true);
          },
        }, '＋ 水廻りエリアを追加')));
    });

    container.append(h('button', {
      class: 'btn', onclick: () => {
        const last = sim.floors[sim.floors.length - 1];
        sim.floors.push({
          id: U().uid('fl'),
          name: (sim.floors.length + 1) + 'F',
          level: last ? U().num(last.level) + 3.5 : 0,
          areas: last ? U().clone(last.areas).map((a) => Object.assign(a, { id: U().uid('ar') })) : [],
        });
        onChange(true);
      },
    }, '＋ 階を追加'));
  }

  WPS.simple = { defaultSimple, build, render };
})(globalThis.WPS = globalThis.WPS || {});
