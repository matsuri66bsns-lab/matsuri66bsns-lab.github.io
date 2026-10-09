/*
 * 管種マスタ（初期値）
 *  C     : ヘーゼン・ウィリアムス式の流速係数（設計値）
 *  sizes : label=表示呼び径, dn=比較用の呼び径[mm], id=内径[mm]
 * 内径は JIS 等の規格寸法（外径−2×厚さ）から求めた値。ライニング鋼管・架橋ポリエチレン管は
 * ライニング厚・管種区分により異なるため参考値とし、採用製品の資料で確認すること。
 */
(function (WPS) {
  'use strict';

  WPS.DEFAULT_PIPES = [
    {
      id: 'HIVP',
      name: '水道用耐衝撃性硬質ポリ塩化ビニル管（HIVP）',
      C: 140,
      note: 'JIS K 6742 寸法から算出',
      sizes: [
        { label: '13', dn: 13, id: 13.0 },
        { label: '16', dn: 16, id: 16.0 },
        { label: '20', dn: 20, id: 20.0 },
        { label: '25', dn: 25, id: 25.0 },
        { label: '30', dn: 30, id: 31.0 },
        { label: '40', dn: 40, id: 40.0 },
        { label: '50', dn: 50, id: 51.0 },
        { label: '65', dn: 65, id: 67.0 },
        { label: '75', dn: 75, id: 77.2 },
        { label: '100', dn: 100, id: 99.8 },
        { label: '125', dn: 125, id: 125.0 },
        { label: '150', dn: 150, id: 145.8 },
      ],
    },
    {
      id: 'VB',
      name: '水道用硬質塩化ビニルライニング鋼管（SGP-VB）',
      C: 130,
      note: 'SGP内径からライニング厚を差し引いた参考値',
      sizes: [
        { label: '15A', dn: 15, id: 13.1 },
        { label: '20A', dn: 20, id: 18.6 },
        { label: '25A', dn: 25, id: 24.6 },
        { label: '32A', dn: 32, id: 31.7 },
        { label: '40A', dn: 40, id: 37.6 },
        { label: '50A', dn: 50, id: 48.9 },
        { label: '65A', dn: 65, id: 62.9 },
        { label: '80A', dn: 80, id: 75.7 },
        { label: '100A', dn: 100, id: 100.3 },
        { label: '125A', dn: 125, id: 124.8 },
        { label: '150A', dn: 150, id: 149.2 },
      ],
    },
    {
      id: 'SUS',
      name: '一般配管用ステンレス鋼鋼管（SUS304）',
      C: 140,
      note: 'JIS G 3448 寸法から算出',
      sizes: [
        { label: '13Su', dn: 13, id: 14.28 },
        { label: '20Su', dn: 20, id: 20.22 },
        { label: '25Su', dn: 25, id: 26.58 },
        { label: '30Su', dn: 30, id: 31.6 },
        { label: '40Su', dn: 40, id: 40.3 },
        { label: '50Su', dn: 50, id: 46.2 },
        { label: '60Su', dn: 60, id: 57.5 },
        { label: '75Su', dn: 75, id: 73.3 },
        { label: '80Su', dn: 80, id: 85.1 },
        { label: '100Su', dn: 100, id: 110.3 },
        { label: '125Su', dn: 125, id: 135.8 },
        { label: '150Su', dn: 150, id: 159.2 },
      ],
    },
    {
      id: 'PEX',
      name: '架橋ポリエチレン管（住戸内）',
      C: 150,
      note: '参考値。採用製品の内径で上書きすること',
      sizes: [
        { label: '10A', dn: 10, id: 9.8 },
        { label: '13A', dn: 13, id: 13.0 },
        { label: '16A', dn: 16, id: 16.0 },
        { label: '20A', dn: 20, id: 20.0 },
        { label: '25A', dn: 25, id: 25.0 },
      ],
    },
  ];
})(globalThis.WPS = globalThis.WPS || {});
