/* 計算結果の表・CSV・計算書（印刷用）の生成 */
(function (WPS) {
  'use strict';
  const U = () => WPS.util;

  const STATUS_TEXT = { ok: '適合', warn: '注意', ng: '不適合' };

  function edgeTable(res, opts) {
    const f = U().fmt;
    const esc = U().esc;
    const compact = opts && opts.compact;
    const rows = res.edges.map((r) => `
      <tr class="st-${r.status}">
        <td class="l">${esc(r.label)}</td>
        <td>${f(r.fu, 1)}</td>
        <td>${r.count}</td>
        <td class="l">${esc(r.flowBasis)}</td>
        <td>${f(r.flow, 1)}</td>
        <td>${f(r.length, 2)}</td>
        <td>${f(r.leq, 2)}</td>
        <td>${isFinite(r.rAllow) ? f(r.rAllow, 3) : '—'}</td>
        <td class="b">${esc(r.size)}</td>
        <td>${f(r.innerD, 1)}</td>
        <td>${f(r.velocity, 2)}</td>
        <td>${f(r.friction, 3)}</td>
        <td>${f(r.loss, 2)}</td>
        <td>${f(r.pEnd, 1)}</td>
        <td class="l">${STATUS_TEXT[r.status]}${r.notes.length ? `<span class="note">${esc(r.notes.join('、'))}</span>` : ''}</td>
      </tr>`).join('');
    return `<table class="tbl${compact ? ' compact' : ''}">
      <thead><tr>
        <th class="l">区間</th><th>負荷単位</th><th>器具数</th><th class="l">流量根拠</th><th>流量<br>L/min</th>
        <th>実長<br>m</th><th>相当長<br>m</th><th>許容損失<br>kPa/m</th><th>口径</th><th>内径<br>mm</th>
        <th>流速<br>m/s</th><th>摩擦損失<br>kPa/m</th><th>区間損失<br>kPa</th><th>末端圧力<br>kPa</th><th class="l">判定</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function fixtureTable(res, opts) {
    const f = U().fmt;
    const esc = U().esc;
    const rows = res.fixtures.map((x) => `
      <tr class="st-${x.ok ? 'ok' : 'ng'}">
        <td class="l">${esc(x.label)}</td>
        <td>${f(x.z, 2)}</td>
        <td>${f(x.leq, 2)}</td>
        <td>${f(x.staticLoss, 1)}</td>
        <td>${f(x.friction, 1)}</td>
        <td>${f(x.pmin, 0)}</td>
        <td class="b">${f(x.residual, 1)}</td>
        <td>${f(x.required, 1)}</td>
        <td class="l">${x.ok ? '適合' : '圧力不足'}</td>
      </tr>`).join('');
    return `<table class="tbl${opts && opts.compact ? ' compact' : ''}">
      <thead><tr><th class="l">器具</th><th>高さ<br>m</th><th>水源からの<br>相当長 m</th><th>静水頭<br>kPa</th><th>摩擦損失<br>kPa</th>
      <th>必要圧力<br>kPa</th><th>残圧<br>kPa</th><th>必要起点圧力<br>kPa</th><th class="l">判定</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function summaryCards(res, settings) {
    const s = res.summary;
    if (!s) return '';
    const f = U().fmt;
    const okP = s.sourcePressure >= s.requiredPressure - 1e-9;
    const card = (label, value, unit, cls, sub) => `<div class="stat ${cls || ''}"><div class="stat-label">${label}</div><div class="stat-value">${value}<span class="unit">${unit || ''}</span></div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
    return `<div class="stats">
      ${card('必要起点圧力', f(s.requiredPressure, 1), 'kPa', okP ? 'good' : 'bad', `設定 ${f(s.sourcePressure, 1)} kPa ／ 最不利: ${U().esc(s.critical ? s.critical.label : '—')}`)}
      ${card('主管口径', U().esc(s.mainSize), '', '', `流量 ${f(s.mainFlow, 1)} L/min`)}
      ${card('器具給水負荷単位', f(s.totalFu, 1), 'FU', '', settings.usage === 'private' ? '私室用' : '公衆用')}
      ${card('器具数', s.fixtureCount, '個', s.ngFixtures ? 'bad' : 'good', s.ngFixtures ? `圧力不足 ${s.ngFixtures} 個` : 'すべて必要圧力を確保')}
      ${card('不適合区間', s.ngEdges, '区間', s.ngEdges ? 'bad' : 'good', `管種 ${U().esc(s.material)}`)}
    </div>`;
  }

  function messages(res) {
    const esc = U().esc;
    const out = [];
    res.errors.forEach((m) => out.push(`<li class="err">${esc(m)}</li>`));
    res.warnings.forEach((m) => out.push(`<li class="warn">${esc(m)}</li>`));
    return out.length ? `<ul class="messages">${out.join('')}</ul>` : '';
  }

  function csvEdges(res) {
    const head = ['区間', '上流', '下流', '負荷単位', '器具数', '流量根拠', '流量[L/min]', '実長[m]', '相当長[m]', '許容摩擦損失[kPa/m]', '口径', '内径[mm]', '流速[m/s]', '摩擦損失[kPa/m]', '区間損失[kPa]', '末端圧力[kPa]', '判定', '備考'];
    const lines = [head];
    res.edges.forEach((r) => lines.push([r.label, r.fromLabel, r.toLabel, r.fu, r.count, r.flowBasis, r.flow.toFixed(2), r.length.toFixed(2), r.leq.toFixed(2),
      isFinite(r.rAllow) ? r.rAllow.toFixed(4) : '', r.size, r.innerD, r.velocity.toFixed(3), r.friction.toFixed(4), r.loss.toFixed(3), r.pEnd.toFixed(2), STATUS_TEXT[r.status], r.notes.join('、')]));
    return toCsv(lines);
  }

  function csvFixtures(res) {
    const lines = [['器具', '階', '高さ[m]', '相当長[m]', '静水頭[kPa]', '摩擦損失[kPa]', '必要圧力[kPa]', '残圧[kPa]', '必要起点圧力[kPa]', '判定']];
    res.fixtures.forEach((x) => lines.push([x.label, x.floor, x.z.toFixed(2), x.leq.toFixed(2), x.staticLoss.toFixed(2), x.friction.toFixed(2), x.pmin, x.residual.toFixed(2), x.required.toFixed(2), x.ok ? '適合' : '圧力不足']));
    return toCsv(lines);
  }

  function toCsv(lines) {
    return '﻿' + lines.map((l) => l.map((v) => {
      const s = String(v === undefined || v === null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }

  function conditionsTable(state) {
    const s = state.settings;
    const esc = U().esc;
    const pipe = state.masters.pipes.find((p) => p.id === s.material);
    const rows = [
      ['入力方式', state.mode === 'trace' ? 'PDFトレース（図面から作図）' : '簡易定義（階・エリア・器具数）'],
      ['給水方式', s.supply === 'down' ? '下向き供給（高置水槽方式）' : '上向き供給（直結・増圧・ポンプ直送）'],
      ['起点圧力', `${U().fmt(U().num(s.sourcePressure), 1)} kPa（起点高さ FL${U().num(s.sourceZ) >= 0 ? '+' : ''}${U().fmt(U().num(s.sourceZ), 2)} m）`],
      ['管種', `${esc(pipe ? pipe.name : '')}（C = ${pipe ? pipe.C : '—'}）`],
      ['同時使用流量', `器具給水負荷単位法（SHASE-S 206）／${s.usage === 'private' ? '私室用' : '公衆用'}／線図 ${s.curve === 'valve' ? '①洗浄弁' : s.curve === 'tank' ? '②洗浄タンク' : '自動（下流に洗浄弁があれば①）'}`],
      ['摩擦損失', 'ヘーゼン・ウィリアムス式'],
      ['局部損失', `相当長 = 実長 × ${U().fmt(U().num(s.equivFactor), 2)}`],
      ['口径選定', `流速 ≤ ${U().fmt(U().num(s.vmax), 2)} m/s かつ 摩擦損失 ≤ 許容摩擦損失 の最小口径（最小 ${s.minDn} mm）${s.connPriority ? '／器具単独の枝管は接続口径を優先' : ''}`],
    ];
    return `<table class="tbl kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  }

  async function buildReport(state, net, res) {
    const esc = U().esc;
    const s = state.settings;
    const today = new Date();
    const date = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    let plans = '';
    if (state.mode === 'trace') {
      for (let i = 0; i < state.trace.pages.length; i++) {
        const url = await WPS.trace.renderPageImage(state, i, res);
        if (url) plans += `<figure class="plan"><img src="${url}" alt="配管平面図 ${esc(state.trace.pages[i].name)}"><figcaption>配管平面図　${esc(state.trace.pages[i].name)}（縮尺 ${esc(state.trace.pages[i].scaleLabel || '')}）</figcaption></figure>`;
      }
    }
    return `
      <header class="rep-head">
        <div>
          <div class="rep-kicker">給水管口径計算書</div>
          <h1>${esc(s.projectName || '（物件名未設定）')}</h1>
        </div>
        <div class="rep-meta">作成日 ${date}${s.author ? `<br>作成者 ${esc(s.author)}` : ''}</div>
      </header>
      <section class="rep-sec"><h2>1. 設計条件</h2>${conditionsTable(state)}</section>
      <section class="rep-sec"><h2>2. 計算結果の概要</h2>${summaryCards(res, s)}${messages(res)}</section>
      <section class="rep-sec page-break"><h2>3. 給水系統図</h2><div class="rep-svg">${WPS.riser.render(net, res, { showFlow: true })}</div></section>
      ${plans ? `<section class="rep-sec page-break"><h2>4. 配管平面図</h2>${plans}</section>` : ''}
      <section class="rep-sec page-break"><h2>${plans ? 5 : 4}. 区間別計算表</h2>${edgeTable(res, { compact: true })}</section>
      <section class="rep-sec"><h2>${plans ? 6 : 5}. 器具別残圧の検討</h2>${fixtureTable(res, { compact: true })}</section>
      <section class="rep-sec"><h2>計算式</h2>
        <ul class="formula">
          <li>同時使用流量 Q：下流の器具給水負荷単位の合計から同時使用流量線図で求める。下流の器具が1個の区間は器具の給水流量とし、複数の場合も最大器具流量を下回らない値とする。</li>
          <li>摩擦損失（ヘーゼン・ウィリアムス式）：h/L = 10.666 · C<sup>−1.852</sup> · D<sup>−4.87</sup> · Q<sup>1.852</sup> ［m/m］、圧力換算 ρg = 9.80665 kPa/m</li>
          <li>許容摩擦損失 R = (起点圧力 − 器具の最低必要圧力 − 静水頭) / 水源から器具までの相当長。区間の R は下流器具の最小値。</li>
          <li>残圧 = 起点圧力 − Σ(摩擦損失 × 相当長) − ρg × 高低差</li>
        </ul>
        <p class="muted small">同時使用流量線図・器具給水負荷単位・管内径・器具の必要圧力は標準的な値を用いています。採用製品・水道事業体の基準と照合のうえ使用してください。</p>
      </section>`;
  }

  WPS.report = { edgeTable, fixtureTable, summaryCards, messages, csvEdges, csvFixtures, buildReport };
})(globalThis.WPS = globalThis.WPS || {});
