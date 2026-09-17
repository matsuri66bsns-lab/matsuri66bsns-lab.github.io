---
name: x-research
description: X（旧Twitter）の投稿をキーワード・期間・反響の大きさで収集し、話題ごとに整理したHTMLレポートを作る。「Xで〇〇について調べて」「Xの反応をまとめて」「X上の最新動向を知りたい」といった依頼や、定期的なXウォッチの実行時に使う。追加費用なしのWeb検索モードと、精度の高いGrok APIモードの2つを持つ。Xのスクレイピングはしない。
---

# X リサーチ

X上の投稿を収集し、話題のかたまりごとに整理したHTMLレポートを出す。

## モードを選ぶ

**2つのモードがあり、既定は A（無料）。** ユーザーが精度や網羅性を求めた場合、
または config に `"mode": "grok"` がある場合のみ B を使う。

| | A: Web検索モード（既定） | B: Grok APIモード |
| --- | --- | --- |
| 費用 | **かからない**（Claude Codeの検索機能を使う） | 従量課金。新規登録時の$25無料クレジット内なら実質無料 |
| APIキー | 不要 | `XAI_API_KEY` が必要 |
| この環境で動くか | **動く** | `api.x.ai` がブロックされる環境では動かない |
| 網羅性 | 検索にインデックスされた投稿のみ | Xのデータソースを直接検索 |
| いいね数・表示回数 | 取れない（フィルタもできない） | 下限を指定して絞り込める |
| 向いている用途 | 話題の把握、反響の大きい投稿の発見、日常的なウォッチ | 網羅的な調査、数値での足切りが要る調査 |

判断に迷ったら A で試し、物足りなければ B を提案する。

---

## モード A: Web検索モード（既定・無料）

Claude Code の WebSearch を `x.com` に絞って使う。スクリプトではなく、**自分で検索して整理する**。

### 1. 検索する

調査テーマから、日本語・英語・表記ゆれを含むクエリを3〜6本立てる。
各クエリで `allowed_domains: ["x.com"]` を指定して WebSearch を呼ぶ。

```
WebSearch(query: "Claude Code スキル 使い方", allowed_domains: ["x.com"])
WebSearch(query: "Claude Code skills workflow", allowed_domains: ["x.com"])
```

コツ:

- **クエリは短く具体的に。** 長い文章は検索エンジンでヒットしない
- 1テーマにつき3〜6クエリ。少ないと偏り、多いと冗長になる
- 期間で絞りたいときはクエリに月名や出来事名を足す。日付指定はできない
- `x.com/i/trending/...` はトレンドまとめページで、個別投稿より話題の全体像がつかめる
- `x.com/<handle>/article/...` は長文記事。まとまった解説が多い

### 2. 結果を評価する

検索結果をそのまま並べない。次を確認してから採用する。

- **URLが投稿を指しているか。** `x.com/<handle>/status/<数字>` が個別投稿。
  検索結果のタイトルだけで中身を判断しない
- **同じ話題の重複を畳む。** 同じニュースへの言及が5件並んでも1つの話題にまとめる
- **宣伝・情報商材的な投稿を落とす。** 「〇〇の全手法を無料公開」系は中身が薄いことが多い
- **取れなかった情報を捏造しない。** いいね数・正確な投稿日時は基本的に取れない。
  推測して書かず、空欄にする

### 3. JSONに整理する

`tools/x_research/templates/example.json` と同じ形式でJSONを書き、
`out/x-research/<日付>.json` に保存する。

いいね数・表示回数は取得できないので `null` のままにする。
`posted_at` は検索結果から確実にわかる場合のみ入れ、不明なら空文字にする。

### 4. レポートにする

```bash
python3 tools/x_research/render.py out/x-research/2026-09-17.json
```

同じ場所にHTMLが出るので、それをユーザーに提示する。

---

## モード B: Grok APIモード

xAI Grok API の X データソースを使う。いいね数・表示回数での足切りができる。

### 1. 前提を確認する

```bash
test -n "$XAI_API_KEY" && curl -sS -o /dev/null -w "%{http_code}\n" --max-time 15 \
  -H "Authorization: Bearer $XAI_API_KEY" https://api.x.ai/v1/models
```

`200` 以外なら、この環境からは実行できない。**モードAに切り替えるか、
GitHub Actions を使う**ようユーザーに伝える。キーの発行は https://console.x.ai/ 。

### 2. 条件を決める

`tools/x_research/config.json` を編集する。

| 項目 | 既定値 | 決め方 |
| --- | --- | --- |
| テーマ・キーワード | config の queries | 日本語・英語の表記ゆれを3〜5個 |
| 期間 | 直近7日 | 「最近」なら7日、「今日」なら1日、「この1ヶ月」なら30日 |
| いいね数の下限 | 30 | ノイズが多ければ上げる。ニッチな話題なら0〜10まで下げる |
| 表示回数の下限 | 5000 | 同上 |

短い期間を見るときは下限を下げる。投稿直後はまだ反響が伸びていないため。

### 3. 実行する

```bash
python3 tools/x_research/collect.py --config tools/x_research/config.json --days 7
python3 tools/x_research/render.py out/x-research/2026-09-17.json
```

主なオプション: `--days N` / `--from-date` `--to-date` / `--topic "テーマ名"` / `--out PATH`

`out/x-research/state.json` に既出URLが記録され、次回以降は新規投稿に `is_new` が立つ。

### 4. 結果を点検する

- `themes` が空、または極端に少ない → フィルタが厳しすぎる。下限を下げて再実行
- `result.parse_error` が `true` → モデル出力がJSONにならなかった。再実行
- `usage.num_sources_used` → 課金量の目安。想定より多ければ `max_search_results` を下げる

---

## 報告のしかた（両モード共通）

レポートの丸写しをしない。**何が新しいか**を先に書く。

- 2回目以降は `new_post_count` と `is_new` が立った投稿が前回からの差分
- 「見つからなかった」も結果として報告する。無理に埋めない
- モードAの場合、いいね数が空欄である理由を一度説明する（取得できないため）

## 定期実行

### GitHub Actions（モードB・実行環境を選ばない）

`.github/workflows/x-research.yml` が毎週月曜09:00 JSTに走る。
Settings → Secrets and variables → Actions に `XAI_API_KEY` を登録する。
結果は Actions の artifact からダウンロードでき、要約は実行画面の Summary で読める。
手動実行は Actions タブの「Run workflow」から。

### ローカルの Claude Code（両モード）

```
/loop 1d /x-research
```

モードAはAPIキーが要らないので、この方法だけで完結する。

## やらないこと

- Xへの直接アクセス（スクレイピング、非公式API、ログイン利用）はしない
- 収集結果を `out/` の外に出さない。このリポジトリは GitHub Pages で一般公開されるため、
  `out/` は `.gitignore` 済み。レポートをコミットしない
- 投稿内容・数値を創作しない。見つからなければ「見つからなかった」と報告する

## 詳細

APIパラメータ仕様、費用の内訳、各手段の比較は `reference.md` を参照する。
