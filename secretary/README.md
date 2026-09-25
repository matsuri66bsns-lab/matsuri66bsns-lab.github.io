# 秘書AI

Outlook の業務メールと打合せ記録を、クラウドの Claude Code（定期実行ルーチン）が解析し、Google Drive 上の Markdown に案件ごとに集約するしくみです。

- 設計書・導入手順: [index.html](./index.html)（GitHub Pages では `/secretary/`）
- Apps Script 一式（ジョブ作成・結果の反映・文字起こし・ダッシュボード）: [gas/](./gas/)
- Claude Code の手順書・結果の形式・検証スクリプト: [agent/](./agent/)
- ダッシュボード: [gas/Dashboard.html](./gas/Dashboard.html)（Apps Script 外で開くとデモデータで動作）

## 開発時の確認

```sh
node secretary/agent/build-schemas.mjs          # Schemas.gs を変えたら schemas.json を作り直す
node secretary/agent/validate.mjs mail secretary/agent/examples/mail.json
node secretary/test/pipeline.test.mjs           # Drive を模した環境で一連の流れを確認
```
