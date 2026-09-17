# x_research

X（旧Twitter）の投稿を xAI Grok API 経由で収集し、HTMLレポートにするツール。
標準ライブラリのみで動く（追加インストール不要）。

```bash
export XAI_API_KEY=xai-...

# 収集（出力パスが標準出力に出る）
python3 tools/x_research/collect.py --config tools/x_research/config.json --days 7

# レポート化
python3 tools/x_research/render.py out/x-research/2026-09-17.json
```

調査テーマ・キーワード・フィルタは `config.json` で設定する。

使い方の詳細は `.claude/skills/x-research/SKILL.md`、
API仕様とコストは `.claude/skills/x-research/reference.md` を参照。
