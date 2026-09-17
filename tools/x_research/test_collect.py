"""API呼び出しをモックして collect.py のロジックを検証する。

リポジトリのルートで実行する:
    python3 tools/x_research/test_collect.py
"""
import importlib.util, json, os, sys, tempfile, datetime as dt

spec = importlib.util.spec_from_file_location("collect", "tools/x_research/collect.py")
collect = importlib.util.module_from_spec(spec); spec.loader.exec_module(collect)

captured = {}
def fake_call(payload, api_key, timeout, retries=3):
    captured["payload"] = payload
    content = json.dumps({
        "summary": "要約テキスト",
        "themes": [{"title": "話題A", "description": "説明",
                    "posts": [{"url": "https://x.com/a/status/1?s=20", "author": "@a",
                               "posted_at": "2026-09-15", "excerpt": "本文",
                               "favorite_count": 100, "view_count": 9000,
                               "why_it_matters": "理由"}]}],
        "notable_accounts": [], "watch_items": ["論点1"],
    }, ensure_ascii=False)
    return {"choices": [{"message": {"content": "```json\n" + content + "\n```"}}],
            "citations": ["https://x.com/a/status/1"],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "num_sources_used": 7}}
collect.call_xai = fake_call

os.environ["XAI_API_KEY"] = "test-key"
tmp = tempfile.mkdtemp()
cfg_path = os.path.join(tmp, "config.json")
json.dump({"name": "t", "lookback_days": 5, "max_search_results": 12,
           "filters": {"min_favorite_count": 30, "min_view_count": 5000,
                       "excluded_x_handles": ["@spam"]},
           "queries": [{"topic": "テーマ1", "keywords": ["k1", "k2"]}]},
          open(cfg_path, "w"), ensure_ascii=False)

out1 = os.path.join(tmp, "r1.json"); state = os.path.join(tmp, "state.json")
sys.argv = ["collect.py", "--config", cfg_path, "--out", out1, "--state", state]
collect.main()

sp = captured["payload"]["search_parameters"]
src = sp["sources"][0]
assert sp["mode"] == "on" and sp["max_search_results"] == 12, sp
assert src == {"type": "x", "post_favorite_count": 30, "post_view_count": 5000,
               "excluded_x_handles": ["spam"]}, src
days = (dt.date.fromisoformat(sp["to_date"]) - dt.date.fromisoformat(sp["from_date"])).days
assert days == 5, days
print("  検索パラメータ組み立て: OK（@除去・期間5日・閾値反映）")

d1 = json.load(open(out1, encoding="utf-8"))
assert d1["is_first_run"] is True and d1["new_post_count"] == 1, d1["new_post_count"]
assert d1["queries"][0]["result"]["themes"][0]["posts"][0]["is_new"] is True
assert d1["queries"][0]["usage"]["num_sources_used"] == 7
print("  初回実行: OK（コードフェンス付きJSONの抽出・新規判定・usage記録）")

# 2回目: 同じURLなので新規ゼロになるはず
out2 = os.path.join(tmp, "r2.json")
sys.argv = ["collect.py", "--config", cfg_path, "--out", out2, "--state", state]
collect.main()
d2 = json.load(open(out2, encoding="utf-8"))
assert d2["is_first_run"] is False and d2["new_post_count"] == 0, d2["new_post_count"]
print("  2回目実行: OK（既出URLを差分から除外・クエリ文字列を無視）")

# included と excluded の同時指定は落ちること
try:
    collect.build_x_source({"filters": {"included_x_handles": ["a"], "excluded_x_handles": ["b"]}})
    raise AssertionError("例外が出るべき")
except SystemExit:
    print("  included/excluded 同時指定: OK（想定どおり停止）")

# --topic 絞り込み
json.dump({"queries": [{"topic": "A", "keywords": []}, {"topic": "B", "keywords": []}],
           "filters": {}}, open(cfg_path, "w"), ensure_ascii=False)
out3 = os.path.join(tmp, "r3.json")
sys.argv = ["collect.py", "--config", cfg_path, "--out", out3, "--state", state, "--topic", "B"]
collect.main()
d3 = json.load(open(out3, encoding="utf-8"))
assert len(d3["queries"]) == 1 and d3["queries"][0]["topic"] == "B"
assert "sources" in captured["payload"]["search_parameters"]
print("  --topic 絞り込み: OK")

# フィルタ未設定なら X ソースは type だけ
assert captured["payload"]["search_parameters"]["sources"][0] == {"type": "x"}
print("  フィルタ未設定時: OK（余計なキーを送らない）")

# レンダリングまで通ること
import subprocess
html_path = subprocess.run([sys.executable, "tools/x_research/render.py", out1],
                           capture_output=True, text=True, check=True).stdout.strip()
html = open(html_path, encoding="utf-8").read()
assert "話題A" in html and "NEW" in html and "いいね 100" in html and "表示 9,000" in html
print("  収集→レポート生成の一気通し: OK")
print("すべて通った")
