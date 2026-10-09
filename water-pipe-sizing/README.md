# 給水管口径計算（water-pipe-sizing）

給水配管の口径を **器具給水負荷単位法（SHASE-S 206）** と **許容摩擦損失・流速法（ヘーゼン・ウィリアムス式）** で算定し、給水系統図と配管平面図を作るアプリです。ビルド不要の HTML / JavaScript で作ってあり、そのままブラウザで動きます。あとから Electron でデスクトップアプリ（実行ファイル）にできる構成です。

詳しい使い方と計算の根拠は [docs/guide.html](docs/guide.html) にまとめています。

## 2つの入力モード

| モード | 入力 | 出力 |
| --- | --- | --- |
| 簡易定義 | 階数・階高、階ごとの水廻りエリア、エリアごとの器具と個数 | 系統図・計算表・計算書 |
| PDFトレース | PDF図面（ページ＝階）の上で配管をなぞり、器具・水源・立管を配置 | 配管平面図（口径記入）・系統図・計算表・計算書 |

PDFトレースでは、配管線をクリックすると曲がり角まで線を追跡して配管にする「線を自動認識」が使えます。給水管の線色を「線色を取得」で指定しておくと、壁などの線を拾いにくくなります。

## 使い方

- ブラウザ: `index.html` をダブルクリックで開く（file:// でも動作）。または `npm run serve` で http://localhost:8080 を開く
- 保存: 画面右上の「保存」でプロジェクトを `.wps.json` に書き出し、「開く」で読み込む（作業中の内容はブラウザにも自動保存）
- 計算書: 「計算書」タブ →「印刷 / PDF保存」
- 試用: `samples/sample-plan.pdf`（2階分の平面図、縮尺 1/100）を PDFトレースで読み込めます

## テスト

```sh
npm test   # = node tests/calc.test.js（Node.js 18 以降、依存パッケージ不要）
```

## デスクトップアプリ化（Electron）

```sh
npm install
npm start          # 開発起動
npm run dist:win   # Windows 用ポータブル exe を dist/ に出力
```

`desktop/main.js` が `index.html` をそのまま読み込みます。Web 版と同じコードで動くよう、ES Modules やビルドツールは使わず、`window.prompt` も使っていません。

## ファイル構成

```
index.html            画面
css/app.css           スタイル
js/core.js            共通ユーティリティ
js/data/              器具マスタ・管種マスタ（初期値）
js/calc/              同時使用流量・水理計算・口径算定エンジン
js/modes/simple.js    入力モード「簡易定義」
js/modes/trace.js     入力モード「PDFトレース」
js/draw/riser.js      系統図（SVG）生成
js/report.js          計算表・CSV・計算書
js/app.js             状態管理・タブ・保存/読込
vendor/pdfjs/         pdf.js 3.11.174（Apache-2.0）
desktop/main.js       Electron 起動スクリプト
tests/calc.test.js    計算エンジンの単体テスト
```

## 注意

同時使用流量線図・器具給水負荷単位・管内径・器具の必要圧力は、標準的な値を初期値として入れています。実際の設計では、採用製品の資料と水道事業体の基準に照らして「マスタ」タブで値を調整してください。対応しているのは樹枝状の配管だけで、ループ配管は計算から除外します。
