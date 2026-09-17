---
name: x-research
description: X（旧Twitter）の投稿をキーワード・期間・いいね数/表示回数の条件で収集し、話題ごとに整理したHTMLレポートを作る。「Xで〇〇について調べて」「Xの反応をまとめて」「X上の最新動向を知りたい」といった依頼や、定期的なXウォッチの実行時に使う。収集は xAI Grok API の X データソース経由で行い、Xのスクレイピングはしない。
---

# X リサーチ

X上の投稿を収集し、話題のかたまりごとに整理したレポートを出す。

## 前提の確認

実行前に `XAI_API_KEY` が設定されているか確認する。無ければユーザーに伝えて止める。
キーの発行は https://console.x.ai/ 。

```bash
test -n "$XAI_API_KEY" && echo "APIキーあり" || echo "XAI_API_KEY が未設定"
```

**重要な制約**: Claude Code をブラウザ版・リモート実行環境で動かしている場合、`api.x.ai` が
egress ポリシーでブロックされて実行できないことがある。その場合は、
ローカル環境の Claude Code で実行するか、GitHub Actions
（`.github/workflows/x-research.yml`）を使う。疎通確認:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 15 \
  -H "Authorization: Bearer $XAI_API_KEY" https://api.x.ai/v1/models
```

`200` 以外（特に `000` や `403`）なら、その環境からは実行できない。

## 手順

### 1. 調査条件を決める

ユーザーの依頼から次を決める。曖昧な点だけ確認し、それ以外は既定値で進める。

| 項目 | 既定値 | 決め方 |
| --- | --- | --- |
| テーマ | config.json の queries | 依頼文から。1回の実行で複数テーマ可 |
| キーワード | テーマから派生 | 日本語・英語の両方、表記ゆれを3〜5個 |
| 期間 | 直近7日 | 「最近」なら7日、「今日」なら1日、「この1ヶ月」なら30日 |
| いいね数の下限 | 30 | ノイズが多ければ上げる。ニッチな話題なら 0〜10 に下げる |
| 表示回数の下限 | 5000 | 同上 |

条件は `tools/x_research/config.json` を編集して指定する。
一時的な調査なら CLI 引数で上書きできる。

### 2. 収集する

```bash
python3 tools/x_research/collect.py --config tools/x_research/config.json --days 7
```

主なオプション:

- `--days N` — 遡る日数
- `--from-date YYYY-MM-DD` / `--to-date YYYY-MM-DD` — 期間を直接指定
- `--topic "テーマ名"` — config 内の特定テーマだけ実行（複数指定可）
- `--out PATH` — 出力JSONのパス

出力は `out/x-research/<日付>.json`。標準出力にそのパスが出る。
`out/x-research/state.json` に既出URLが記録され、次回以降は新規投稿に `is_new` が立つ。

### 3. レポートにする

```bash
python3 tools/x_research/render.py out/x-research/2026-09-17.json
```

同じ場所に `.html` が出る。ユーザーにはこのHTMLファイルを提示する。

### 4. 結果を読んで補う

生成された JSON を読み、次を確認してからユーザーに報告する。

- `themes` が空、または極端に少ない → フィルタが厳しすぎる。下限を下げて再実行する。
- `result.parse_error` が `true` → モデル出力がJSONにならなかった。再実行する。
- 投稿の `url` が `https://x.com/...` 以外、または明らかに不自然 → 信頼できない。
  レポートに残す場合はその旨を注記する。
- 同じ話題が複数テーマに重複 → レポート本文で統合して説明する。

報告では、レポートの丸写しではなく **何が新しいか** を先に書く。
`new_post_count` と `is_new` が立った投稿が、前回からの差分にあたる。

## 定期実行

### GitHub Actions（推奨。実行環境を選ばない）

`.github/workflows/x-research.yml` が毎週月曜09:00 JSTに走る。
リポジトリの Settings → Secrets and variables → Actions で `XAI_API_KEY` を登録する。
結果は Actions の artifact からダウンロードし、要約は実行画面の Summary で読める。

手動実行は Actions タブの「Run workflow」から。日数とテーマを指定できる。

### ローカルの Claude Code

```
/loop 1d /x-research
```

または cron に直接登録する:

```cron
0 9 * * 1 cd /path/to/repo && XAI_API_KEY=xai-... python3 tools/x_research/collect.py && python3 tools/x_research/render.py $(ls -t out/x-research/*.json | head -1)
```

## やらないこと

- Xへの直接アクセス（スクレイピング、非公式API、ログイン利用）はしない。
  収集は xAI が公式に提供する X データソース経由に限る。
- 収集結果を `out/` の外に出さない。このリポジトリは GitHub Pages で一般公開されるため、
  `out/` は `.gitignore` 済み。レポートをコミットしない。
- 投稿内容を創作しない。見つからなければ「見つからなかった」と報告する。

## 詳細

API のパラメータ仕様、コスト、既知の制約は `reference.md` を参照する。
