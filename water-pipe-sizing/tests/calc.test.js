/* 計算エンジンの単体テスト: node tests/calc.test.js */
'use strict';
const assert = require('assert');
const path = require('path');
['core.js', 'data/fixtures.js', 'data/pipes.js', 'calc/flow.js', 'calc/hydraulics.js', 'calc/network.js', 'modes/simple.js', 'modes/trace.js']
  .forEach((f) => require(path.join(__dirname, '..', 'js', f)));
const WPS = globalThis.WPS;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  NG  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`);

const masters = { fixtures: WPS.util.clone(WPS.DEFAULT_FIXTURES), pipes: WPS.util.clone(WPS.DEFAULT_PIPES) };
const baseSettings = {
  material: 'HIVP', sourcePressure: 300, sourceZ: 0, vmax: 2.0, equivFactor: 2.0, usage: 'public',
  curve: 'auto', minDn: 13, connPriority: true, fixtureHeight: 0.8, pipeZ: 0.3, supply: 'up',
};

test('同時使用流量: 洗浄タンク 100FU ≒ 43.5gpm', () => near(WPS.flow.fuToFlow(100, 'tank'), 43.5 * 3.785411784, 0.01));
test('同時使用流量: 洗浄弁 50FU ≒ 50gpm', () => near(WPS.flow.fuToFlow(50, 'valve'), 50 * 3.785411784, 0.01));
test('同時使用流量: 補間', () => near(WPS.flow.fuToFlow(55, 'valve'), 52 * 3.785411784, 0.01));
test('同時使用流量: 1000FU 以上は両曲線一致', () => near(WPS.flow.fuToFlow(2000, 'valve'), WPS.flow.fuToFlow(2000, 'tank'), 1e-9));

test('ヘーゼン・ウィリアムス: 100L/min, 内径40mm, C=140', () => {
  // 手計算: Q=1.6667e-3 m3/s, h/L=10.666*140^-1.852*0.04^-4.87*Q^1.852 ≒ 0.0521 m/m → 0.510 kPa/m
  near(WPS.hyd.frictionKPaPerM(100, 40, 140), 0.510, 0.005);
  near(WPS.hyd.velocity(100, 40), 1.326, 0.005);
});

function chainNet(fixtureId, length, z) {
  return {
    nodes: [
      { id: 's', kind: 'source', z: 0, label: '水源' },
      { id: 'j', kind: 'junction', z: 0, label: 'J' },
      { id: 'f', kind: 'fixture', fixtureId, z: z || 0, label: '器具' },
    ],
    edges: [{ id: 'e1', a: 's', b: 'j', length }, { id: 'e2', a: 'j', b: 'f', length: 1 }],
  };
}

test('単独器具: 器具流量を採用し接続口径以上', () => {
  const r = WPS.network.compute(chainNet('lav', 10), baseSettings, masters);
  assert.strictEqual(r.errors.length, 0);
  const e2 = r.edgeById.e2;
  assert.strictEqual(e2.flow, 10);
  assert.ok(e2.dn >= 13);
  assert.ok(r.fixtures[0].ok);
});

test('静水頭: 高さ20mの器具で残圧が約196kPa減る', () => {
  const r = WPS.network.compute(chainNet('lav', 10, 20), baseSettings, masters);
  const f = r.fixtures[0];
  near(f.staticLoss, 20 * 9.80665, 1e-6);
  near(f.residual, 300 - f.friction - f.staticLoss, 1e-6);
});

test('圧力不足は NG 判定', () => {
  const r = WPS.network.compute(chainNet('wc_fv', 10, 25), Object.assign({}, baseSettings, { sourcePressure: 250 }), masters);
  assert.strictEqual(r.fixtures[0].ok, false);
  assert.ok(r.edges.some((e) => e.status === 'ng'));
});

test('ループは除外して警告', () => {
  const net = chainNet('lav', 5);
  net.edges.push({ id: 'e3', a: 's', b: 'f', length: 3 });
  const r = WPS.network.compute(net, baseSettings, masters);
  assert.ok(r.warnings.some((w) => w.includes('ループ')));
});

test('簡易定義: 3階建てモデルで上流ほど太い', () => {
  const state = { settings: baseSettings, masters, simple: WPS.simple.defaultSimple() };
  const net = WPS.simple.build(state);
  const r = WPS.network.compute(net, baseSettings, masters);
  assert.strictEqual(r.errors.length, 0, r.errors.join());
  assert.strictEqual(r.fixtures.length, 3 * (6 + 5 + 2));
  const byTo = {};
  r.edges.forEach((e) => { byTo[e.to] = e; });
  r.edges.forEach((e) => {
    const parentRow = byTo[e.from];
    if (parentRow) assert.ok(parentRow.dn >= e.dn, `${parentRow.label}(${parentRow.size}) < ${e.label}(${e.size})`);
  });
  const main = r.edgeById.e1;
  // 公衆用: 1フロア 10*2+5*2+2*2+10*3+2*2+3+2 = 73FU ×3 = 219FU
  near(main.fu, 219, 1e-9);
  assert.strictEqual(main.curve, 'valve');
  console.log(`      主管 ${main.size} / Q=${main.flow.toFixed(1)} L/min / v=${main.velocity.toFixed(2)} m/s / 必要起点圧力 ${r.summary.requiredPressure.toFixed(1)} kPa`);
});

test('下向き供給（高置水槽）でも計算できる', () => {
  const s = Object.assign({}, baseSettings, { supply: 'down', sourceZ: 14, sourcePressure: 0 });
  const state = { settings: s, masters, simple: WPS.simple.defaultSimple() };
  const r = WPS.network.compute(WPS.simple.build(state), s, masters);
  assert.strictEqual(r.errors.length, 0);
  const top = r.fixtures.filter((f) => f.floor === '3F');
  const low = r.fixtures.filter((f) => f.floor === '1F');
  assert.ok(Math.min(...low.map((f) => f.residual)) > Math.min(...top.map((f) => f.residual)));
});

test('PDFトレース: 縮尺換算と立管の階間接続', () => {
  const t = WPS.trace.defaultTrace();
  t.pages = [
    { index: 0, name: '1F', level: 0, pipeZ: 0.3, scale: 0.01, width: 1000, height: 800 },
    { index: 1, name: '2F', level: 3.5, pipeZ: 0.3, scale: 0.01, width: 1000, height: 800 },
  ];
  t.nodes = [
    { id: 's', page: 0, x: 0, y: 0, kind: 'source' },
    { id: 'r1', page: 0, x: 500, y: 0, kind: 'riser', tag: 'R1' },
    { id: 'r2', page: 1, x: 500, y: 0, kind: 'riser', tag: 'R1' },
    { id: 'f', page: 1, x: 500, y: 300, kind: 'fixture', fixtureId: 'lav' },
  ];
  t.segments = [{ id: 'a', a: 's', b: 'r1' }, { id: 'b', a: 'r2', b: 'f' }];
  const state = { settings: baseSettings, masters, trace: t };
  const net = WPS.trace.build(state);
  const rv = net.edges.find((e) => e.vertical);
  assert.ok(rv, '立管の鉛直区間が生成されていない');
  near(rv.length, 3.5, 1e-9);
  near(net.edges.find((e) => e.id === 'a').length, 5, 1e-9);
  // 器具枝管: 平面 3m + 高低差 (0.8-0.3)
  near(net.edges.find((e) => e.id === 'b').length, 3 + 0.5, 1e-9);
  const r = WPS.network.compute(net, baseSettings, masters);
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.fixtures.length, 1);
  near(r.fixtures[0].z, 3.5 + 0.8, 1e-9);
});

console.log(`\n${passed} 件成功`);
