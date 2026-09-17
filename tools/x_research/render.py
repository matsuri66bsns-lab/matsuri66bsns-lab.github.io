#!/usr/bin/env python3
"""collect.py が出力したJSONを、読みやすいHTMLレポートに変換する。

使い方:
    python3 tools/x_research/render.py out/x-research/2026-09-17.json
    python3 tools/x_research/render.py out/x-research/2026-09-17.json --out report.html
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import sys

CSS = """
:root {
  --bg: #FFFFFF;
  --bg-soft: #F5F5F7;
  --card: #FFFFFF;
  --text: #1D1D1F;
  --muted: #6E6E73;
  --line: #E5E5EA;
  --accent: #0066CC;
  --new: #0B8A4B;
  --new-bg: #E8F6EE;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg-soft);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP",
               "Helvetica Neue", Arial, sans-serif;
  line-height: 1.75;
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 860px; margin: 0 auto; padding: 56px 20px 96px; }
header.page { text-align: center; margin-bottom: 44px; }
header.page h1 {
  font-size: clamp(30px, 5vw, 44px);
  letter-spacing: -0.02em;
  font-weight: 650;
  margin: 0 0 10px;
}
header.page .meta { color: var(--muted); font-size: 15px; margin: 0; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 22px; }
.stat {
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 12px 18px; min-width: 120px;
}
.stat .n { font-size: 24px; font-weight: 640; letter-spacing: -0.01em; display: block; }
.stat .l { font-size: 13px; color: var(--muted); }
section.topic {
  background: var(--card); border: 1px solid var(--line); border-radius: 18px;
  padding: 28px 26px; margin-bottom: 26px;
}
section.topic > h2 {
  font-size: 22px; font-weight: 640; letter-spacing: -0.01em; margin: 0 0 6px;
}
.range { color: var(--muted); font-size: 14px; margin: 0 0 18px; }
.summary {
  background: var(--bg-soft); border-radius: 12px; padding: 16px 18px;
  margin: 0 0 26px; font-size: 15px;
}
h3.theme {
  font-size: 18px; font-weight: 640; margin: 26px 0 4px;
  padding-top: 20px; border-top: 1px solid var(--line);
}
h3.theme:first-of-type { border-top: none; padding-top: 0; }
.theme-desc { color: var(--muted); font-size: 15px; margin: 0 0 14px; }
.post {
  border-left: 3px solid var(--line); padding: 2px 0 2px 16px; margin: 0 0 18px;
}
.post.is-new { border-left-color: var(--new); }
.post .head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.post .author { font-weight: 600; font-size: 15px; }
.post .date { color: var(--muted); font-size: 13px; }
.badge {
  font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
  background: var(--new-bg); color: var(--new);
  border-radius: 999px; padding: 2px 9px;
}
.post .excerpt { margin: 6px 0; font-size: 15px; }
.post .why { margin: 6px 0; font-size: 14px; color: var(--muted); }
.metrics { font-size: 13px; color: var(--muted); display: flex; gap: 14px; flex-wrap: wrap; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
ul.plain { padding-left: 20px; margin: 8px 0 0; }
ul.plain li { margin-bottom: 6px; font-size: 15px; }
.empty { color: var(--muted); font-style: normal; font-size: 15px; }
footer.page {
  text-align: center; color: var(--muted); font-size: 13px;
  margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--line);
}
@media (max-width: 600px) {
  .wrap { padding: 36px 16px 64px; }
  section.topic { padding: 22px 18px; border-radius: 14px; }
}
"""


def e(v) -> str:
    return html.escape(str(v if v is not None else ""))


def fmt_num(n) -> str | None:
    if n is None:
        return None
    try:
        return f"{int(n):,}"
    except (TypeError, ValueError):
        return None


def render_post(post: dict) -> str:
    url = post.get("url") or ""
    cls = "post is-new" if post.get("is_new") else "post"
    parts = [f'<div class="{cls}">']

    head = ['<div class="head">']
    author = post.get("author") or "（投稿者不明）"
    if url:
        head.append(f'<a class="author" href="{e(url)}" target="_blank" rel="noopener">{e(author)}</a>')
    else:
        head.append(f'<span class="author">{e(author)}</span>')
    if post.get("posted_at"):
        head.append(f'<span class="date">{e(post["posted_at"])}</span>')
    if post.get("is_new"):
        head.append('<span class="badge">NEW</span>')
    head.append("</div>")
    parts.append("".join(head))

    if post.get("excerpt"):
        parts.append(f'<p class="excerpt">{e(post["excerpt"])}</p>')
    if post.get("why_it_matters"):
        parts.append(f'<p class="why">{e(post["why_it_matters"])}</p>')

    metrics = []
    fav, view = fmt_num(post.get("favorite_count")), fmt_num(post.get("view_count"))
    if fav:
        metrics.append(f"いいね {fav}")
    if view:
        metrics.append(f"表示 {view}")
    if url:
        metrics.append(f'<a href="{e(url)}" target="_blank" rel="noopener">投稿を開く</a>')
    if metrics:
        parts.append('<div class="metrics">' + "".join(f"<span>{m}</span>" for m in metrics) + "</div>")

    parts.append("</div>")
    return "".join(parts)


def render_query(q: dict) -> str:
    res = q.get("result") or {}
    out = ['<section class="topic">']
    out.append(f'<h2>{e(q.get("topic"))}</h2>')
    out.append(f'<p class="range">{e(q.get("from_date"))} 〜 {e(q.get("to_date"))}'
               f' ／ キーワード: {e("、".join(q.get("keywords") or []) or "指定なし")}</p>')

    if res.get("summary"):
        out.append(f'<div class="summary">{e(res["summary"])}</div>')

    themes = res.get("themes") or []
    if not themes:
        out.append('<p class="empty">条件に合う投稿が見つからなかった。'
                   'フィルタのいいね数・表示回数の下限を下げるか、期間を広げて再実行する。</p>')
    for theme in themes:
        out.append(f'<h3 class="theme">{e(theme.get("title"))}</h3>')
        if theme.get("description"):
            out.append(f'<p class="theme-desc">{e(theme["description"])}</p>')
        for post in theme.get("posts") or []:
            out.append(render_post(post))

    accounts = res.get("notable_accounts") or []
    if accounts:
        out.append('<h3 class="theme">注目アカウント</h3><ul class="plain">')
        for a in accounts:
            handle = (a.get("handle") or "").lstrip("@")
            link = f'<a href="https://x.com/{e(handle)}" target="_blank" rel="noopener">@{e(handle)}</a>'
            out.append(f"<li>{link} — {e(a.get('reason'))}</li>")
        out.append("</ul>")

    watch = res.get("watch_items") or []
    if watch:
        out.append('<h3 class="theme">追うべき論点</h3><ul class="plain">')
        out.extend(f"<li>{e(w)}</li>" for w in watch)
        out.append("</ul>")

    out.append("</section>")
    return "\n".join(out)


def render(doc: dict) -> str:
    queries = doc.get("queries") or []
    post_total = sum(
        len(t.get("posts") or [])
        for q in queries for t in (q.get("result") or {}).get("themes") or []
    )
    theme_total = sum(len((q.get("result") or {}).get("themes") or []) for q in queries)
    gen = doc.get("generated_at") or dt.datetime.now().isoformat(timespec="seconds")
    title = f'X リサーチ・ダイジェスト — {e(doc.get("config_name", "x-research"))}'

    stats = [
        ("テーマ", len(queries)),
        ("話題", theme_total),
        ("投稿", post_total),
    ]
    if not doc.get("is_first_run"):
        stats.append(("新規", doc.get("new_post_count", 0)))

    body = [
        '<div class="wrap">',
        '<header class="page">',
        f"<h1>{title}</h1>",
        f'<p class="meta">生成: {e(gen)}</p>',
        '<div class="stats">',
    ]
    body += [f'<div class="stat"><span class="n">{n}</span><span class="l">{e(l)}</span></div>'
             for l, n in stats]
    body.append("</div></header>")
    body += [render_query(q) for q in queries]
    body.append('<footer class="page">xAI Grok API の X データソース経由で収集。'
                'いいね数・表示回数は取得できた投稿にのみ表示される。</footer>')
    body.append("</div>")

    return (
        "<!DOCTYPE html>\n"
        '<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="robots" content="noindex, nofollow">\n'
        f"<title>{title}</title>\n<style>{CSS}</style>\n</head>\n<body>\n"
        + "\n".join(body)
        + "\n</body>\n</html>\n"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="収集JSONをHTMLレポートにする")
    ap.add_argument("input", help="collect.py が出力したJSON")
    ap.add_argument("--out", help="出力HTML（既定: 入力と同じ場所の .html）")
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        doc = json.load(f)

    # 手書きJSON（WebSearchモード）を受け付けるため、最低限の形だけ検証する。
    if not isinstance(doc, dict) or not isinstance(doc.get("queries"), list):
        raise SystemExit(
            f"{args.input} の形式が違う。トップレベルは "
            '{"queries": [...]} のオブジェクトである必要がある。'
        )
    for i, q in enumerate(doc["queries"]):
        if not isinstance(q, dict) or not isinstance(q.get("result"), dict):
            raise SystemExit(f"queries[{i}] に result オブジェクトがない。")

    out_path = args.out or os.path.splitext(args.input)[0] + ".html"
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(render(doc))

    print(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
