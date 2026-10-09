/*
 * 器具マスタ（初期値）
 *  fuPublic / fuPrivate : 器具給水負荷単位（SHASE-S 206 の表に準拠。表で「—」の欄は他方の値を流用）
 *  flow   : 器具単独の給水流量 [L/min]（設計で一般に用いられる標準値。製品により異なる）
 *  pmin   : 器具の最低必要圧力 [kPa]
 *  conn   : 器具接続口径 [mm]
 *  flushValve : 洗浄弁か（同時使用流量線図①/②の自動判定に使用）
 *  height : 器具取付高さ（FLから）[m]。空欄なら設定値を使用
 * 値はアプリの「マスタ」タブで変更でき、プロジェクトファイルに保存される。
 */
(function (WPS) {
  'use strict';

  WPS.DEFAULT_FIXTURES = [
    { id: 'wc_fv',      name: '大便器（洗浄弁）',         abbr: 'WCv', fuPublic: 10, fuPrivate: 6,   flow: 70, pmin: 70, conn: 25, flushValve: true,  height: 0.6 },
    { id: 'wc_tank',    name: '大便器（洗浄タンク）',     abbr: 'WC',  fuPublic: 5,  fuPrivate: 3,   flow: 12, pmin: 30, conn: 13, flushValve: false, height: 0.6 },
    { id: 'ur_fv',      name: '小便器（洗浄弁）',         abbr: 'URv', fuPublic: 5,  fuPrivate: 5,   flow: 30, pmin: 70, conn: 13, flushValve: true,  height: 1.2 },
    { id: 'ur_tank',    name: '小便器（洗浄タンク）',     abbr: 'UR',  fuPublic: 3,  fuPrivate: 3,   flow: 12, pmin: 30, conn: 13, flushValve: false, height: 1.2 },
    { id: 'lav',        name: '洗面器',                   abbr: 'L',   fuPublic: 2,  fuPrivate: 1,   flow: 10, pmin: 30, conn: 13, flushValve: false, height: 0.8 },
    { id: 'hand',       name: '手洗器',                   abbr: 'HL',  fuPublic: 1,  fuPrivate: 0.5, flow: 8,  pmin: 30, conn: 13, flushValve: false, height: 0.8 },
    { id: 'lav_med',    name: '医療用洗面器',             abbr: 'ML',  fuPublic: 3,  fuPrivate: 3,   flow: 15, pmin: 30, conn: 13, flushValve: false, height: 0.8 },
    { id: 'sink_office',name: '事務室用流し',             abbr: 'OS',  fuPublic: 3,  fuPrivate: 3,   flow: 15, pmin: 30, conn: 13, flushValve: false, height: 0.9 },
    { id: 'sink_kitchen',name:'台所流し',                 abbr: 'KS',  fuPublic: 3,  fuPrivate: 3,   flow: 15, pmin: 30, conn: 13, flushValve: false, height: 0.9 },
    { id: 'sink_cook',  name: '料理場流し',               abbr: 'CS',  fuPublic: 4,  fuPrivate: 2,   flow: 20, pmin: 30, conn: 20, flushValve: false, height: 0.9 },
    { id: 'sink_dish',  name: '食器洗流し',               abbr: 'DS',  fuPublic: 5,  fuPrivate: 5,   flow: 20, pmin: 30, conn: 20, flushValve: false, height: 0.9 },
    { id: 'sink_combo', name: '連合流し',                 abbr: 'US',  fuPublic: 3,  fuPrivate: 3,   flow: 15, pmin: 30, conn: 13, flushValve: false, height: 0.9 },
    { id: 'sink_wash',  name: '洗面流し（水栓1個につき）',abbr: 'WS',  fuPublic: 2,  fuPrivate: 2,   flow: 10, pmin: 30, conn: 13, flushValve: false, height: 0.8 },
    { id: 'sink_service',name:'掃除用流し',               abbr: 'SS',  fuPublic: 4,  fuPrivate: 3,   flow: 15, pmin: 30, conn: 20, flushValve: false, height: 0.6 },
    { id: 'bath',       name: '浴槽',                     abbr: 'BT',  fuPublic: 4,  fuPrivate: 2,   flow: 30, pmin: 30, conn: 20, flushValve: false, height: 0.6 },
    { id: 'shower',     name: 'シャワー',                 abbr: 'SH',  fuPublic: 4,  fuPrivate: 2,   flow: 12, pmin: 70, conn: 13, flushValve: false, height: 1.0 },
    { id: 'bathset_fv', name: '浴室一そろい（大便器洗浄弁）', abbr: 'BRv', fuPublic: 8, fuPrivate: 8, flow: 70, pmin: 70, conn: 25, flushValve: true, height: 0.6 },
    { id: 'bathset_tank',name:'浴室一そろい（大便器洗浄タンク）', abbr: 'BR', fuPublic: 6, fuPrivate: 6, flow: 30, pmin: 30, conn: 20, flushValve: false, height: 0.6 },
    { id: 'drink',      name: '水飲器',                   abbr: 'DF',  fuPublic: 2,  fuPrivate: 1,   flow: 5,  pmin: 30, conn: 13, flushValve: false, height: 0.8 },
    { id: 'heater',     name: '湯沸し器',                 abbr: 'WH',  fuPublic: 2,  fuPrivate: 2,   flow: 10, pmin: 40, conn: 13, flushValve: false, height: 1.2 },
    { id: 'hose',       name: '散水栓・車庫',             abbr: 'HB',  fuPublic: 5,  fuPrivate: 5,   flow: 20, pmin: 30, conn: 13, flushValve: false, height: 0.3 },
  ];
})(globalThis.WPS = globalThis.WPS || {});
