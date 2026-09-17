#!/usr/bin/env python3
"""X（旧Twitter）の投稿を xAI Grok API の Live Search 経由で収集し、構造化JSONとして保存する。

Xを直接スクレイピングはしない。xAI が公式に提供する X データソースを使う。
標準ライブラリのみで動作する（追加の pip install は不要）。

使い方:
    export XAI_API_KEY=xai-...
    python3 tools/x_research/collect.py --config tools/x_research/config.json

環境変数:
    XAI_API_KEY   必須。https://console.x.ai/ で発行する。
    XAI_BASE_URL  任意。既定は https://api.x.ai
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE_URL = os.environ.get("XAI_BASE_URL", "https://api.x.ai").rstrip("/")
DEFAULT_MODEL = "grok-4-fast"

# Grok に返させる構造。プロンプトとスキーマの両方で指定して揺れを抑える。
RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "themes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "posts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "url": {"type": "string"},
                                "author": {"type": "string"},
                                "posted_at": {"type": "string"},
                                "excerpt": {"type": "string"},
                                "favorite_count": {"type": ["integer", "null"]},
                                "view_count": {"type": ["integer", "null"]},
                                "why_it_matters": {"type": "string"},
                            },
                            "required": ["url", "author", "excerpt", "why_it_matters"],
                        },
                    },
                },
                "required": ["title", "description", "posts"],
            },
        },
        "notable_accounts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "handle": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["handle", "reason"],
            },
        },
        "watch_items": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "themes"],
}

PROMPT_TEMPLATE = """あなたはX（旧Twitter）上の一次情報を調べるリサーチャーです。

# 調査テーマ
{topic}

# 検索キーワード（いずれかに該当する投稿を探す）
{keywords}

# 対象期間
{from_date} 〜 {to_date}

# 指示
1. 上記テーマについて、対象期間内のX上の投稿を調べる。
2. 内容の近いものをテーマ（話題のかたまり）ごとにまとめる。多くても6テーマまで。
3. 各テーマには、根拠となる実際の投稿を最大5件、反響の大きい順に挙げる。
4. 各投稿には必ず https://x.com/... 形式の実在するURL、投稿者のハンドル（@付き）、
   投稿日時（YYYY-MM-DD 形式、不明なら空文字）、本文の要点を抜粋として記載する。
5. いいね数・表示回数が判明するものは数値を入れる。判明しないものは null にする。
   推測した数値を書いてはいけない。
6. why_it_matters には、その投稿がなぜ注目に値するかを1〜2文で書く。
7. summary には全体の状況を日本語で5〜8文でまとめる。何が新しく、何が論点かを明示する。
8. watch_items には、今後続報を追うべき論点を箇条書きで3〜6件。
9. 憶測で投稿を創作してはいけない。検索で実際に見つかった投稿だけを使う。
   見つからなければテーマ数を減らし、summary にその旨を書く。

出力はすべて日本語。JSONのみを返す。
{extra_instructions}"""


def log(msg: str) -> None:
    print(f"[collect] {msg}", file=sys.stderr)


def build_x_source(cfg: dict) -> dict:
    """config から Live Search の X ソース定義を組み立てる。"""
    source: dict = {"type": "x"}
    filters = cfg.get("filters", {}) or {}

    # いいね数・表示回数の下限。ノイズを削る主要な手段。
    if filters.get("min_favorite_count") is not None:
        source["post_favorite_count"] = int(filters["min_favorite_count"])
    if filters.get("min_view_count") is not None:
        source["post_view_count"] = int(filters["min_view_count"])

    included = filters.get("included_x_handles") or []
    excluded = filters.get("excluded_x_handles") or []
    if included and excluded:
        raise SystemExit(
            "included_x_handles と excluded_x_handles は同時に指定できない（xAI API の制約）"
        )
    if included:
        source["included_x_handles"] = [h.lstrip("@") for h in included]
    if excluded:
        source["excluded_x_handles"] = [h.lstrip("@") for h in excluded]
    return source


def resolve_dates(cfg: dict, args: argparse.Namespace) -> tuple[str, str]:
    today = dt.date.today()
    to_date = args.to_date or cfg.get("to_date") or today.isoformat()
    if args.from_date or cfg.get("from_date"):
        from_date = args.from_date or cfg["from_date"]
    else:
        days = int(args.days if args.days is not None else cfg.get("lookback_days", 7))
        from_date = (dt.date.fromisoformat(to_date) - dt.timedelta(days=days)).isoformat()
    return from_date, to_date


def call_xai(payload: dict, api_key: str, timeout: int, retries: int = 3) -> dict:
    url = f"{DEFAULT_BASE_URL}/v1/chat/completions"
    body = json.dumps(payload).encode("utf-8")
    last_err: Exception | None = None

    for attempt in range(1, retries + 1):
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:800]
            # 4xx は投げ直しても直らない（キー不正・パラメータ不正）。即座に落とす。
            if 400 <= e.code < 500 and e.code != 429:
                raise SystemExit(f"xAI API エラー {e.code}: {detail}")
            last_err = RuntimeError(f"{e.code}: {detail}")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last_err = e

        if attempt < retries:
            wait = 2 ** attempt
            log(f"失敗（{last_err}）。{wait}秒後に再試行 {attempt}/{retries - 1}")
            time.sleep(wait)

    raise SystemExit(f"xAI API への接続に失敗した: {last_err}")


def extract_json(text: str) -> dict:
    """モデル出力から JSON を取り出す。コードフェンス付きでも拾えるようにする。"""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


def run_query(query: dict, cfg: dict, args: argparse.Namespace, api_key: str) -> dict:
    topic = query.get("topic") or query.get("name") or "（テーマ未設定）"
    keywords = query.get("keywords") or []
    from_date, to_date = resolve_dates(cfg, args)

    prompt = PROMPT_TEMPLATE.format(
        topic=topic,
        keywords="\n".join(f"- {k}" for k in keywords) or "- （指定なし。テーマから判断する）",
        from_date=from_date,
        to_date=to_date,
        extra_instructions=query.get("extra_instructions", ""),
    )

    payload = {
        "model": cfg.get("model", DEFAULT_MODEL),
        "messages": [{"role": "user", "content": prompt}],
        "temperature": cfg.get("temperature", 0),
        "search_parameters": {
            "mode": "on",              # 常に検索させる（auto だと検索を省くことがある）
            "return_citations": True,
            "from_date": from_date,
            "to_date": to_date,
            "max_search_results": int(cfg.get("max_search_results", 30)),
            "sources": [build_x_source(cfg)],
        },
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "x_research_result", "schema": RESULT_SCHEMA, "strict": False},
        },
    }

    log(f"検索中: {topic}（{from_date}〜{to_date}）")
    raw = call_xai(payload, api_key, timeout=int(cfg.get("timeout_sec", 180)))

    choice = (raw.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content") or ""
    try:
        result = extract_json(content)
    except (json.JSONDecodeError, ValueError):
        log(f"警告: {topic} の応答をJSONとして解釈できなかった。生テキストを保持する。")
        result = {"summary": content, "themes": [], "parse_error": True}

    usage = raw.get("usage") or {}
    return {
        "topic": topic,
        "keywords": keywords,
        "from_date": from_date,
        "to_date": to_date,
        "result": result,
        "citations": raw.get("citations") or [],
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            # 課金対象。1件あたりの単価は xAI の料金表に従う。
            "num_sources_used": (usage.get("num_sources_used")
                                 or usage.get("num_searches")),
        },
    }


def collect_urls(queries: list[dict]) -> set[str]:
    urls: set[str] = set()
    for q in queries:
        for theme in q.get("result", {}).get("themes") or []:
            for post in theme.get("posts") or []:
                if post.get("url"):
                    urls.add(post["url"].split("?")[0])
    return urls


def mark_new_posts(queries: list[dict], seen: set[str]) -> int:
    """前回までに出ていないURLに is_new を立てる。定期実行時の差分把握用。"""
    new_count = 0
    for q in queries:
        for theme in q.get("result", {}).get("themes") or []:
            for post in theme.get("posts") or []:
                url = (post.get("url") or "").split("?")[0]
                post["is_new"] = bool(url) and url not in seen
                if post["is_new"]:
                    new_count += 1
    return new_count


def main() -> int:
    ap = argparse.ArgumentParser(description="X の投稿を Grok API 経由で収集する")
    ap.add_argument("--config", default="tools/x_research/config.json")
    ap.add_argument("--out", help="出力JSONのパス（既定: out/x-research/<日付>.json）")
    ap.add_argument("--state", default="out/x-research/state.json",
                    help="既出URLを記録するファイル。差分判定に使う")
    ap.add_argument("--days", type=int, help="遡る日数（config の lookback_days を上書き）")
    ap.add_argument("--from-date", dest="from_date", help="YYYY-MM-DD")
    ap.add_argument("--to-date", dest="to_date", help="YYYY-MM-DD")
    ap.add_argument("--topic", action="append", dest="topics",
                    help="config 内の特定テーマだけ実行する（topic 名で指定、複数可）")
    args = ap.parse_args()

    api_key = os.environ.get("XAI_API_KEY")
    if not api_key:
        raise SystemExit(
            "環境変数 XAI_API_KEY が設定されていない。\n"
            "  export XAI_API_KEY=xai-...   （キーの発行は https://console.x.ai/ ）"
        )

    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)

    queries = cfg.get("queries") or []
    if args.topics:
        wanted = set(args.topics)
        queries = [q for q in queries if (q.get("topic") or q.get("name")) in wanted]
    if not queries:
        raise SystemExit("実行対象のクエリがない。config.json の queries を確認する。")

    results = [run_query(q, cfg, args, api_key) for q in queries]

    # 差分判定
    seen: set[str] = set()
    if os.path.exists(args.state):
        with open(args.state, encoding="utf-8") as f:
            seen = set(json.load(f).get("seen_urls") or [])
    new_count = mark_new_posts(results, seen)

    out_path = args.out or os.path.join(
        "out", "x-research", f"{dt.date.today().isoformat()}.json"
    )
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    doc = {
        "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "config_name": cfg.get("name", "x-research"),
        "new_post_count": new_count,
        "is_first_run": not seen,
        "queries": results,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)

    os.makedirs(os.path.dirname(args.state) or ".", exist_ok=True)
    with open(args.state, "w", encoding="utf-8") as f:
        json.dump(
            {"updated_at": doc["generated_at"],
             "seen_urls": sorted(seen | collect_urls(results))},
            f, ensure_ascii=False, indent=2,
        )

    total_sources = sum((q["usage"].get("num_sources_used") or 0) for q in results)
    log(f"完了: {out_path}（新規投稿 {new_count} 件 / 参照ソース {total_sources} 件）")
    print(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
