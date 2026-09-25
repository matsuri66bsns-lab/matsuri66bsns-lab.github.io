// 導入ガイド（secretary/setup.html）を作る。Apps Script のコードを1ファイルにまとめて埋め込む。
// 使い方: node secretary/tools/build-setup.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gas = join(root, 'gas');
const ORDER = ['Config', 'Util', 'Db', 'Schemas', 'Queue', 'Projects', 'Attachments', 'Mail', 'Records', 'Daily', 'Bootstrap', 'Tasks', 'WebApp', 'Main'];
const code = '/* 秘書AI（Apps Script）— secretary/gas/*.gs を1ファイルにまとめたもの。直接編集せず、リポジトリ側を更新してください。 */\n\n' +
  ORDER.map(n => '/* ===== ' + n + '.gs ===== */\n' + readFileSync(join(gas, n + '.gs'), 'utf8')).join('\n');
const dashboard = readFileSync(join(gas, 'Dashboard.html'), 'utf8');
const manifest = readFileSync(join(gas, 'appsscript.json'), 'utf8');
const routinePrompt = readFileSync(join(root, 'agent', 'routine-prompt.txt'), 'utf8').trim();

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = s => s.split('\n').length.toLocaleString();

// Power Automate に貼る式・JSON
const PA = {
  key: "concat(formatDateTime(convertFromUtc(triggerOutputs()?['body/receivedDateTime'], 'Tokyo Standard Time'), 'yyyyMMdd-HHmmss'), '_', substring(replace(guid(), '-', ''), 0, 8))",
  body: "triggerOutputs()?['body/body']",
  attachments: "triggerOutputs()?['body/attachments']",
  isInline: "item()?['isInline']",
  attachName: "concat(variables('key'), '__', item()?['name'])",
  attachContent: "base64ToBinary(item()?['contentBytes'])",
  selectMap: '{\n  "name": "@{item()?[\'name\']}",\n  "contentType": "@{item()?[\'contentType\']}",\n  "size": "@{item()?[\'size\']}",\n  "isInline": "@{item()?[\'isInline\']}"\n}',
  mailJson: JSON.stringify({
    schema: 'mail.v1',
    direction: 'in',
    id: "@{triggerOutputs()?['body/id']}",
    internetMessageId: "@{triggerOutputs()?['body/internetMessageId']}",
    conversationId: "@{triggerOutputs()?['body/conversationId']}",
    receivedAt: "@{triggerOutputs()?['body/receivedDateTime']}",
    from: "@{triggerOutputs()?['body/from']}",
    to: "@{triggerOutputs()?['body/toRecipients']}",
    cc: "@{triggerOutputs()?['body/ccRecipients']}",
    subject: "@{triggerOutputs()?['body/subject']}",
    importance: "@{triggerOutputs()?['body/importance']}",
    bodyText: "@{body('html2text')}",
    bodyPreview: "@{triggerOutputs()?['body/bodyPreview']}",
    attachments: "@body('attachments_select')",
    webLink: "https://outlook.office.com/mail/deeplink/read/@{encodeUriComponent(triggerOutputs()?['body/id'])}",
  }, null, 2),
  mailName: "concat(variables('key'), '.json')",
  mailContent: "string(outputs('mail_json'))",
  bootDay: "formatDateTime(addDays(triggerBody()?['text'], variables('i')), 'yyyy-MM-dd')",
  bootQuery: "concat('received:', variables('day'))",
  bootMap: '{\n  "receivedAt": "@{item()?[\'receivedDateTime\']}",\n  "direction": "in",\n  "from": "@{item()?[\'from\']}",\n  "to": "@{item()?[\'toRecipients\']}",\n  "subject": "@{item()?[\'subject\']}",\n  "preview": "@{item()?[\'bodyPreview\']}",\n  "conversationId": "@{item()?[\'conversationId\']}"\n}',
  bootName: "concat(variables('day'), '.json')",
  bootContent: "string(union(body('select_in'), body('select_out')))",
};

let copyId = 0;
const copy = (label, text, big) => {
  const id = 'c' + (++copyId);
  return `<div class="copy${big ? ' big' : ''}"><div class="copy-h"><span>${label}</span><button type="button" class="cbtn" data-copy="${id}">コピー</button></div>` +
    `<textarea id="${id}" readonly spellcheck="false" rows="${big ? 3 : Math.min(12, text.split('\n').length)}">${esc(text)}</textarea></div>`;
};
const step = (id, title, time, body) => `<li class="step" id="${id}"><label class="done"><input type="checkbox" data-step="${id}"><span></span></label><div class="step-b"><h3>${title}<span class="time">${time}</span></h3>${body}</div></li>`;

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>秘書AI 導入ガイド</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+JP:wght@400;500;700&display=swap">
<style>
:root {
  color-scheme: light;
  --bg: #FFFFFF; --bg-2: #F5F5F7; --ink: #1D1D1F; --ink-2: #515154; --ink-3: #86868B; --line: #E3E3E8;
  --accent: #0066CC; --accent-soft: #E8F1FB; --green: #1D8A5B; --green-soft: #E4F4EC; --amber-soft: #FFF6E5;
  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.8 var(--font); -webkit-font-smoothing: antialiased; font-feature-settings: "palt" 1; }
a { color: var(--accent); }
code { font-family: var(--mono); font-size: 0.86em; background: var(--bg-2); border-radius: 5px; padding: 1px 6px; overflow-wrap: anywhere; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.top { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: rgba(255,255,255,0.8); -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px); border-bottom: 1px solid var(--line); }
.top-in { max-width: 860px; margin: 0 auto; padding: 10px 20px; display: flex; align-items: center; gap: 14px; }
.top b { font-size: 16px; white-space: nowrap; }
.bar { flex: 1; height: 6px; border-radius: 999px; background: var(--bg-2); overflow: hidden; }
.bar i { display: block; height: 100%; width: 0; background: var(--green); border-radius: 999px; transition: width .3s; }
.count { font-family: var(--mono); font-size: 13px; color: var(--ink-2); white-space: nowrap; }
.wrap { max-width: 860px; margin: 0 auto; padding-inline: 20px; }
header.hero { padding-block: 48px 20px; }
.eyebrow { font-size: 13px; color: var(--ink-3); }
h1 { font-size: clamp(30px, 5vw, 42px); line-height: 1.2; margin: 6px 0 12px; }
.lead { font-size: 17px; color: var(--ink-2); }
.done-box { background: var(--green-soft); border-radius: 18px; padding: 16px 20px; margin: 20px 0; }
.done-box h2 { font-size: 15px; margin: 0 0 6px; color: var(--green); }
.done-box ul { margin: 0; padding-left: 1.2em; font-size: 14.5px; }
h2.part { font-size: 22px; margin: 44px 0 4px; }
.part-sub { color: var(--ink-2); font-size: 14.5px; margin: 0 0 14px; }
ol.steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
.step { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px; border: 1px solid var(--line); border-radius: 18px; padding: 16px 18px; background: #fff; }
.step.is-done { background: var(--bg-2); }
.step.is-done h3 { color: var(--ink-3); }
.step h3 { font-size: 17px; margin: 2px 0 6px; line-height: 1.45; display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; }
.time { font-size: 12.5px; font-weight: 400; color: var(--ink-3); }
.step ol, .step ul { padding-left: 1.3em; margin: 6px 0; }
.step li { margin: 5px 0; font-size: 15px; }
.done input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.done span { display: block; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--line); margin-top: 2px; cursor: pointer; }
.done input:checked + span { background: var(--green); border-color: var(--green); box-shadow: inset 0 0 0 4px #fff; }
.done input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
.note { font-size: 14px; color: var(--ink-2); background: var(--bg-2); border-radius: 12px; padding: 10px 14px; margin: 10px 0; }
.note.warn { background: var(--amber-soft); color: #5E4200; }
.copy { border: 1px solid var(--line); border-radius: 12px; margin: 8px 0 12px; overflow: hidden; }
.copy-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 8px 6px 12px; background: var(--bg-2); font-size: 13px; color: var(--ink-2); }
.cbtn { border: 0; background: var(--accent); color: #fff; border-radius: 999px; padding: 4px 14px; font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.cbtn.ok { background: var(--green); }
.copy textarea { display: block; width: 100%; border: 0; resize: vertical; padding: 10px 12px; font: 12.5px/1.6 var(--mono); color: var(--ink); background: #fff; white-space: pre; overflow: auto; }
.copy.big textarea { color: var(--ink-3); }
.kv { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 2px 12px; font-size: 14.5px; margin: 6px 0; }
.kv dt { color: var(--ink-3); } .kv dd { margin: 0; }
footer { color: var(--ink-3); font-size: 13px; padding-block: 40px 60px; }
@media (max-width: 640px) { .kv { grid-template-columns: 1fr; } .kv dt { margin-top: 6px; } .step { grid-template-columns: 28px minmax(0, 1fr); padding: 14px; } }
</style>
</head>
<body>
<div class="top"><div class="top-in"><b>秘書AI 導入ガイド</b><div class="bar" aria-hidden="true"><i id="bar"></i></div><span class="count" id="count">0 / 9</span></div></div>
<main class="wrap">
<header class="hero">
  <div class="eyebrow">所要時間 約40分（動作確認の待ち時間を除く）</div>
  <h1>ここから先は、あなたのアカウントでの操作です。</h1>
  <p class="lead">Apps Script・Gemini・Power Automate は、あなたの Google と Microsoft 365 のアカウントでしか作成できません。すべての手順を「コピーして貼る」だけで済むようにしてあります。終えた手順は左の丸を押すと記録されます（この端末のブラウザに保存）。</p>
  <div class="done-box">
    <h2>Claude が済ませたこと</h2>
    <ul>
      <li>コード一式と Claude Code 用の手順書を GitHub の main に反映</li>
      <li>解析ルーチン「秘書AI 解析ルーチン」を作成（毎日 6:49〜17:49 の毎時・Claude Sonnet 5）。Google Drive コネクタの追加待ちのため<b>停止中</b>です（手順5）</li>
      <li>Apps Script のコードを1ファイルにまとめ、スクリプトプロパティの入力をダッシュボードの設定画面に置き換え</li>
    </ul>
  </div>
</header>

<h2 class="part">Google 側</h2>
<p class="part-sub">個人の Google アカウント（Drive に「秘書AI」を置くアカウント）で行います。</p>
<ol class="steps">
${step('s1', '1. Apps Script のプロジェクトを作る', '約5分', `
  <ol>
    <li><a href="https://script.new" target="_blank" rel="noopener">script.new</a> を開き、左上の「無題のプロジェクト」を「秘書AI」に変えます。</li>
    <li>「コード.gs」の中身をすべて消し、下のコードを貼って保存します（Ctrl+S / ⌘S）。</li>
  </ol>
  ${copy('コード.gs に貼る（' + lines(code) + '行）', code, true)}
  <ol start="3">
    <li>左の「ファイル」の＋ →「HTML」→ 名前を <code>Dashboard</code> にして作成。中身をすべて消し、下を貼って保存します。</li>
  </ol>
  ${copy('Dashboard.html に貼る（' + lines(dashboard) + '行）', dashboard, true)}
  <ol start="4">
    <li>左の歯車「プロジェクトの設定」→「『appsscript.json』マニフェスト ファイルをエディタで表示する」にチェック。エディタに戻り、<code>appsscript.json</code> の中身を下に置き換えて保存します。</li>
  </ol>
  ${copy('appsscript.json に貼る', manifest)}
`)}
${step('s2', '2. ウェブアプリとして公開する（自分だけ）', '約3分', `
  <ol>
    <li>右上の「デプロイ」→「新しいデプロイ」→ 歯車「種類の選択」→「ウェブアプリ」。</li>
    <li>次のユーザーとして実行 =「自分」、アクセスできるユーザー =「自分のみ」→「デプロイ」。</li>
    <li>「アクセスを承認」→ アカウントを選択 →「このアプリは Google で確認されていません」と出たら「詳細」→「秘書AI（安全ではないページ）に移動」→「許可」。</li>
    <li>表示された「ウェブアプリ」の URL を開いてブックマークします。iPhone では Safari の共有 →「ホーム画面に追加」。</li>
  </ol>
  <div class="note">「確認されていません」の警告は、自分で作った未公開のスクリプトでは必ず出るものです。許可するのは、このスクリプトがあなたの Drive・カレンダー（祝日の参照）・外部通信（Gemini）を使うことです。</div>
`)}
${step('s3', '3. Gemini の API キーを発行する', '約2分', `
  <ol>
    <li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio の API キー画面</a>を開き、「API キーを作成」。</li>
    <li>表示されたキー（AIza… で始まる）をコピーします。次の手順で使います。</li>
  </ol>
  <div class="note warn">キーはチャットや他人に送らないでください。手順4の設定画面にだけ貼ります。</div>
`)}
${step('s4', '4. ダッシュボードで初期設定をする', '約1分', `
  <ol>
    <li>手順2の URL を開くと「秘書AI の初期設定」が表示されます。</li>
    <li>氏名、業務用メールアドレス（Outlook のアドレス。複数あればカンマ区切り）、Gemini API キーを入れて「保存して開始する」。</li>
  </ol>
  <p>マイドライブに「秘書AI」フォルダができ、10分おきの取り込みと毎朝5時半の段取り作成が始まります。設定はあとから「稼働状況 → 設定」で変えられます。</p>
`)}
</ol>

<h2 class="part">Claude 側</h2>
<p class="part-sub">claude.ai にログインしているアカウントで行います。</p>
<ol class="steps">
${step('s5', '5. 解析ルーチンに Google Drive を接続して有効にする', '約3分', `
  <ol>
    <li><a href="https://claude.ai/customize/connectors" target="_blank" rel="noopener">claude.ai のコネクタ設定</a>で、Google Drive が手順4と同じ Google アカウントで接続されていることを確認します。</li>
    <li><a href="https://claude.ai/code" target="_blank" rel="noopener">claude.ai/code</a> のルーチン一覧で「秘書AI 解析ルーチン」を開き、コネクタに <b>Google Drive</b> を追加して、ルーチンを<b>有効</b>にします。</li>
  </ol>
  <div class="note">既存のルーチンにコネクタを追加できない場合は、下の内容で新しく作成してください（作成後に「古いルーチンを削除して」と Claude に伝えてください）。</div>
  <dl class="kv"><dt>名前</dt><dd>秘書AI 解析ルーチン</dd><dt>実行間隔</dt><dd>毎日 7時〜18時の1時間おき（日本時間）</dd><dt>実行方法</dt><dd>毎回新しいセッション</dd><dt>モデル</dt><dd>Claude Sonnet 5</dd><dt>コネクタ</dt><dd>Google Drive</dd></dl>
  ${copy('ルーチンのプロンプト', routinePrompt)}
`)}
</ol>

<h2 class="part">Microsoft 側（Power Automate）</h2>
<p class="part-sub">会社の Microsoft 365 アカウントで <a href="https://make.powerautomate.com" target="_blank" rel="noopener">make.powerautomate.com</a> を開きます。式は各入力欄の「式」（fx）に貼ります。アクションの名前は「…」→「名前の変更」で指定のとおりに変えてください（式が名前で参照するため）。</p>
<ol class="steps">
${step('s6', '6. フロー A「秘書AI 受信メール」を作る', '約15分', `
  <ol>
    <li>「作成」→「自動化したクラウド フロー」→ 名前「秘書AI 受信メール」、トリガー「新しいメールが届いたとき (V3)」（Office 365 Outlook）→「作成」。</li>
    <li>トリガーの詳細設定: フォルダー =「受信トレイ」、添付ファイルを含める =「はい」。</li>
    <li>＋「変数を初期化する」: 名前 <code>key</code>、種類「文字列」、値に次の式。</li>
  </ol>
  ${copy('式: key', PA.key)}
  <ol start="4">
    <li>＋「HTML からテキスト」（コンテンツ変換）: コンテンツに次の式。名前を <code>html2text</code> に変更。</li>
  </ol>
  ${copy('式: HTML からテキスト のコンテンツ', PA.body)}
  <ol start="5">
    <li>＋「Apply to each（それぞれに適用する）」: 対象に次の式。</li>
  </ol>
  ${copy('式: Apply to each の対象', PA.attachments)}
  <ol start="6">
    <li>その中に＋「条件」: 左に式 <code>${esc(PA.isInline)}</code>、演算子「次の値に等しい」、右に式 <code>false</code>。</li>
    <li>「True の場合」に＋ Google Drive「ファイルの作成」（初回は個人の Google アカウントでサインイン）: フォルダーのパス <code>/秘書AI/00_inbox/attachments</code>、ファイル名とファイル コンテンツに次の式。</li>
  </ol>
  ${copy('式: ファイル名（添付）', PA.attachName)}
  ${copy('式: ファイル コンテンツ（添付）', PA.attachContent)}
  <ol start="8">
    <li>Apply to each の外（下）に＋「選択」（データ操作）: 開始に <code>${esc(PA.attachments)}</code> の式。マップの右上で「テキスト モード」に切り替えて下を貼ります。名前を <code>attachments_select</code> に変更。</li>
  </ol>
  ${copy('選択のマップ（テキスト モード）', PA.selectMap)}
  <ol start="9">
    <li>＋「作成」（データ操作）: 入力に下の JSON を貼ります。名前を <code>mail_json</code> に変更。</li>
  </ol>
  ${copy('作成の入力（メール JSON）', PA.mailJson)}
  <ol start="10">
    <li>＋ Google Drive「ファイルの作成」: フォルダーのパス <code>/秘書AI/00_inbox/mail</code>、ファイル名とファイル コンテンツに次の式。→ 保存。</li>
  </ol>
  ${copy('式: ファイル名（メール）', PA.mailName)}
  ${copy('式: ファイル コンテンツ（メール）', PA.mailContent)}
  <div class="note">メルマガの除外は Claude が行うので、ここでは設定しません。解析の手間を減らしたくなったら、Outlook の仕分けルールで配信メールを別フォルダへ移すのが簡単です（受信トレイ以外はフローが反応しません）。</div>
`)}
${step('s7', '7. フロー B「秘書AI 送信メール」を作る', '約5分', `
  <ol>
    <li>フロー A の「…」→「名前を付けて保存」→ 名前「秘書AI 送信メール」。</li>
    <li>コピーしたフローを開き、トリガーのフォルダーを「送信済みアイテム」に変えます。</li>
    <li><code>mail_json</code> の入力で <code>"direction": "in"</code> を <code>"direction": "out"</code> に変えて保存し、フローをオンにします。</li>
  </ol>
  <p>送信メールから「自分が約束したこと」「相手に頼んで返事待ちのこと」「回答済みで完了したこと」を読み取ります。</p>
`)}
</ol>

<h2 class="part">確認と初期分析</h2>
<ol class="steps">
${step('s8', '8. テストメールで動作を確認する', '待ち時間 最大1時間', `
  <ol>
    <li>自分の業務アドレス宛に、案件名と依頼（例:「〇〇工事の施工図を金曜までに確認してください」）を書き、PDF を1つ添付したメールを送ります。</li>
    <li>約10分で Drive の <code>秘書AI/01_解析キュー/jobs</code> に「秘書AI_JOB_待機_…」ができます。</li>
    <li>次の毎時49分にルーチンが動きます（ルーチン画面の「今すぐ実行」でも可）。その後10分以内に、ダッシュボードの「提案」にタスクが出れば完了です。</li>
  </ol>
  <div class="note">動かないときは、ダッシュボードの「稼働状況」の処理ログと、ルーチンの実行履歴をこのチャットに貼ってください。</div>
`)}
${step('s9', '9. 過去6か月の初期分析（後日でも可）', '約20分＋待ち時間', `
  <ol>
    <li>Power Automate で「インスタント クラウド フロー」→ 名前「秘書AI 過去メール書き出し」、トリガー「手動でフローをトリガーします」→ 入力「テキスト」を追加し、名前を「開始日」にします（例 2026-03-25）。</li>
    <li>＋「変数を初期化する」<code>i</code>（整数・0）と <code>day</code>（文字列・空）。</li>
    <li>＋「Do until」: 条件 <code>i</code> が 180 以上。「制限の変更」で回数 400・タイムアウト <code>PT6H</code>。</li>
    <li>Do until の中: 「変数の設定」<code>day</code> に次の式。</li>
  </ol>
  ${copy('式: day', PA.bootDay)}
  <ol start="5">
    <li>「メールの取得 (V3)」を2つ: フォルダー「受信トレイ」と「送信済みアイテム」、上位 25、検索クエリに次の式、添付を含める「いいえ」。</li>
  </ol>
  ${copy('式: 検索クエリ', PA.bootQuery)}
  <ol start="6">
    <li>それぞれに「選択」を置き、名前を <code>select_in</code> / <code>select_out</code> に。開始はそれぞれのメール取得の本文（value）、マップはテキスト モードで下を貼ります（送信側は direction を <code>out</code> に）。</li>
  </ol>
  ${copy('選択のマップ（過去メール）', PA.bootMap)}
  <ol start="7">
    <li>Google Drive「ファイルの作成」: フォルダーのパス <code>/秘書AI/00_inbox/bootstrap</code>、ファイル名とファイル コンテンツに次の式。最後に「変数の値を増やす」で <code>i</code> を 1 増やします。</li>
  </ol>
  ${copy('式: ファイル名（過去メール）', PA.bootName)}
  ${copy('式: ファイル コンテンツ（過去メール）', PA.bootContent)}
  <ol start="8">
    <li>フローを手動で実行し、終わったらダッシュボードの「稼働状況」→「過去メールの初期分析を始める」を押します。数時間で <code>_system/分類提案.md</code> と「提案」画面に案件の候補が出ます。</li>
  </ol>
`)}
</ol>
<footer>このページは <code>node secretary/tools/build-setup.mjs</code> で生成しています。コードの更新時は作り直してください。</footer>
</main>
<script>
(function () {
  var KEY = 'secretary-setup-steps';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { state = {}; }
  var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-step]'));
  function update() {
    var n = 0;
    boxes.forEach(function (b) { var on = !!state[b.dataset.step]; b.checked = on; b.closest('.step').classList.toggle('is-done', on); if (on) n++; });
    document.getElementById('count').textContent = n + ' / ' + boxes.length;
    document.getElementById('bar').style.width = (n / boxes.length * 100) + '%';
  }
  boxes.forEach(function (b) {
    b.addEventListener('change', function () {
      state[b.dataset.step] = b.checked;
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 保存できない環境 */ }
      update();
    });
  });
  update();
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var ta = document.getElementById(btn.dataset.copy);
    function ok() { btn.textContent = 'コピーしました'; btn.classList.add('ok'); setTimeout(function () { btn.textContent = 'コピー'; btn.classList.remove('ok'); }, 1800); }
    function fallback() { ta.focus(); ta.select(); btn.textContent = '選択しました（Ctrl+C）'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(ok, fallback);
    else fallback();
  });
})();
</script>
</body>
</html>
`;
writeFileSync(join(root, 'setup.html'), html);
console.log('setup.html を作成しました（' + Math.round(html.length / 1024) + 'KB）');
