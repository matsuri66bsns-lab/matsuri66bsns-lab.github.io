# リファレンス — xAI Grok API で X を検索する

## 使っているAPI

エンドポイント: `POST https://api.x.ai/v1/chat/completions`（OpenAI互換）

X の投稿を検索させるのは `search_parameters`（Live Search）。
`sources` に `{"type": "x"}` を含めると、モデルが X の投稿を検索してから回答する。

```json
{
  "model": "grok-4-fast",
  "messages": [{"role": "user", "content": "..."}],
  "search_parameters": {
    "mode": "on",
    "return_citations": true,
    "from_date": "2026-09-10",
    "to_date": "2026-09-17",
    "max_search_results": 30,
    "sources": [{
      "type": "x",
      "post_favorite_count": 30,
      "post_view_count": 5000,
      "included_x_handles": ["anthropicai"]
    }]
  }
}
```

### search_parameters

| パラメータ | 意味 |
| --- | --- |
| `mode` | `on`（常に検索）/ `auto`（モデル判断）/ `off`。確実に検索させたいので `on` を使う |
| `sources` | データソースの配列。`x` のほか `web` `news` `rss` が指定できる |
| `from_date` / `to_date` | 検索対象期間（YYYY-MM-DD） |
| `max_search_results` | 参照する最大ソース数。**課金はこの実参照数に比例する** |
| `return_citations` | 参照した投稿のURLをレスポンスに含める |

### `type: "x"` のサブパラメータ

| パラメータ | 意味 |
| --- | --- |
| `post_favorite_count` | いいね数の**下限**。これ未満の投稿は検索対象から外れる |
| `post_view_count` | 表示回数の**下限**。同上 |
| `included_x_handles` | 指定ハンドルの投稿のみ（最大10件程度） |
| `excluded_x_handles` | 指定ハンドルを除外 |

`included_x_handles` と `excluded_x_handles` は**同時に指定できない**。
`collect.py` は両方が設定されていればエラーで落ちる。

## 注意すべき挙動

### いいね数・表示回数は「フィルタ条件」であって「取得できる値」ではない

`post_favorite_count` は閾値でのふるい分けには確実に効く。
一方、レスポンスに各投稿の実数値が必ず含まれるとは限らない。
`collect.py` はモデルに数値を書かせるが、不明なら `null` を入れるよう指示している。
**レポートの数値が欠けている場合、それは取得できなかったということ**で、
推測値ではない。正確な数値が必要なら X API v2 を併用する。

### 期間フィルタと閾値はトレードオフになる

期間を短く切ると、その期間内に閾値を超えた投稿がまだ存在しない
（いいねが伸びる前）ことがある。直近24時間を見るときは
`min_favorite_count` を 0〜10 程度まで下げる。

### モデル出力はJSONスキーマで縛っているが完全ではない

`response_format: json_schema` を付けているが、`strict: false` で運用している。
JSONとして解釈できなかった場合、`collect.py` は生テキストを `summary` に入れ
`parse_error: true` を立てる。その場合は再実行する。

## コスト

2026年9月時点の xAI の料金体系（変更されるため、実行前に
https://docs.x.ai/developers/pricing で最新を確認する）:

- Live Search: 参照ソース1,000件あたり $25
- X Search（新しい Agent Tools API 側）: 2026年9月21日から、
  取得投稿1,000件あたり $5 / ユーザープロフィール1,000件あたり $10
- 上記とは別にトークン課金がかかる

`max_search_results: 30` × テーマ2件 = 1実行あたり最大60ソース。
Live Search 換算で1実行あたり $1.5 程度が上限の目安。
週次実行なら月$6前後。**テーマ数と `max_search_results` を増やすと比例して増える**ので、
定期実行の設定時は必ず見積もる。

## 確認できていない点

このリポジトリを作成した環境からは `docs.x.ai` および `api.x.ai` への
通信がブロックされていたため、**実際のAPIレスポンスでの動作確認はできていない**。
上記の仕様は公開情報にもとづく。初回実行時は次を確認する。

1. `--days 7` かつテーマ1件の小さい条件で試す
2. 出力JSONの `usage.num_sources_used` に値が入っているか（課金量の把握）
3. `citations` に実在する x.com のURLが並んでいるか
4. 400番台エラーが出た場合、エラーメッセージが指すパラメータ名を
   https://docs.x.ai/docs/guides/live-search の最新仕様と突き合わせて修正する

`post_favorite_count` などのパラメータ名が変わっていた場合は、
`collect.py` の `build_x_source()` を直す。

## 代替手段

| 手段 | 向き | 難点 |
| --- | --- | --- |
| **Grok API（本ツール）** | 話題の把握、要約、横断調査 | 数値が取れないことがある。網羅性は保証されない |
| X API v2 | 正確な数値、網羅的な収集 | Basic で月$200。検索は過去7日まで |
| 手動エクスポート | 確実・無料 | 自動化できない |

X を直接スクレイピングする方法（非公式API、nitter系ミラー）は
利用規約上の問題と安定性の問題があるため使わない。
