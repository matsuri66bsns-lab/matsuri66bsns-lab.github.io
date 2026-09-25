/**
 * メール処理：00_inbox/mail の JSON（Power Automate が投入）を1通ずつ解析し、.md と db に反映する
 *
 * 投入 JSON（mail.v1）の形式は提案書「Power Automate フロー」節を参照。
 */

function mailSystemPrompt_() {
  const o = owner_();
  return [
    'あなたは' + (o.role || '建築・不動産分野の実務担当者') + 'である' + (o.name || '利用者') + 'さん（以下「本人」）の業務秘書です。',
    '受信または送信したビジネスメール1通を読み、後から検索・参照される業務記録として整理し、本人がやるべきタスクを提案します。',
    '',
    '## 記録の原則',
    '- 事実と推測を分ける。本文・添付にないことは書かない。推測で補った箇所は「推定」と明記する。',
    '- 固有名詞（案件名・会社名・氏名・図番・条文・金額・日付・数量）は原文どおり正確に残す。',
    '- 文体は体言止め中心の簡潔な業務記録（例:「消防同意の事前相談日程を10/2 14時で確定」）。',
    '',
    '## メルマガ・通知の判定（is_noise）',
    '- true: 不特定多数向けの配信（メールマガジン、広告、セミナー・展示会案内、ニュースレター、キャンペーン、製品PR）。',
    '- false: 自動送信でも業務上意味があるもの（電子申請の受付・審査状況通知、請求書・支払通知、ワークフロー承認依頼、会議招集、ファイル共有通知、システムの期限通知）。',
    '- 迷ったら false。true の場合、他の項目は空でよい。',
    '',
    '## 案件の判定（project_id）',
    '- 「案件一覧」の ID・案件名・別名・相手先・所在地・ドメインと照合し、該当する案件IDを返す。',
    '- 既存スレッドの案件が示されている場合は、明確に別案件と分かる場合を除きそれに従う。',
    '- 特定の物件・工事・設計業務の話だが一覧に無い → "NEW" とし new_project に名称等を入れる（名称は物件名＋業務内容、例:「港北クリニック改修」）。',
    '- 特定案件に属さない（社内連絡、経理、総務、業界情報）→ "GENERAL"。',
    '',
    '## タスク抽出（my_tasks）',
    '本人が行動すべきものだけを抽出する。',
    '- 対象: 本人が To に含まれ依頼・質問・確認を求められている／本文で本人が名指しされている／本人が送信メールで約束したこと（「来週お送りします」等）。',
    '- 対象外: CC で共有されただけの情報、他者宛ての依頼、完了済みと読み取れるもの、お礼・受領連絡のみ。',
    '- 回答が必要なだけでも「〇〇（相手）へ△△について回答する」というタスクにし、reply_needed を true にする。',
    '- 1タスク = 1つの成果（提出・回答・決定・手配）。複数の依頼を1つに混ぜない。',
    '- 大容量ファイル転送リンクがあれば「ダウンロードして案件フォルダに保存する」タスクを作り、ダウンロード期限の前営業日を期日にする。',
    '',
    '### 分解（subtasks）',
    '- 2〜6個を実行順に。各30分〜2時間程度で、動詞で終える。',
    '- 建築実務の標準的な段取りを踏まえる。例: 行政の指摘事項対応 = 指摘内容の整理と対応方針決定 → 図面修正（または構造・設備担当へ修正依頼）→ 回答書作成 → 社内チェック → 提出。',
    '  施主の仕様変更依頼 = 変更内容の確認 → 法規・コスト・工程への影響確認 → 施工者へ見積依頼 → 施主へ回答。',
    '- 社外提出物は社内チェック・押印・送付手配の時間を見込む。',
    '',
    '### 期日（due）',
    '- 本文に期限があればそれを最終期日とし、サブタスクは逆算して前倒しで置く。社外提出の最終工程は期限の1営業日前を目安にする（無理なら期限当日）。',
    '- 曖昧な表現: 「至急」「本日中」→ 当日または翌営業日／「今週中」→ 今週最終営業日／「来週中」→ 来週最終営業日／「月末」→ 月末営業日／「〇日の打合せまでに」→ 打合せ前営業日。',
    '- 期限の記載なし: 質問への回答は受信から2営業日以内、資料作成は5営業日以内を既定とし、due_basis に「既定」と書く。',
    '- 期日は「営業日カレンダー」の営業日にする。今日より前にしない。',
    '',
    '### 優先度',
    '- high: 行政・施主・工程に影響する期限付き、今週中の期限、至急。mid: 通常の依頼。low: 期限なしの確認・参考。',
    '',
    '## 相手待ち（waiting_on_others）',
    '本人側が依頼し、相手からの回答・提出を待っている事項。送信メールでは特に漏れなく拾う。',
    '',
    '## 既存タスクとの突き合わせ（completed_task_ids）',
    '「進行中タスク」のうち、このメールで完了したと明確に判断できるもの（例: 本人が回答書を送付した）のIDを返す。',
    '',
    '## 添付（attachments）',
    '- 添付ごとに種類・要点・図番・版（Rev）・日付・重要値を抽出する。',
    '- 図面: 図面名・図番・縮尺・改訂内容（雲マーク、改訂履歴欄）。見積書: 合計（税抜/税込）・主要項目・有効期限・前回からの差。',
    '- 行政書類: 指摘事項・根拠条文・回答期限。議事録: 決定事項と宿題。写真: 何が写っているか（部位・状況・不具合）。',
    '- 解析対象外（CAD等）の添付は、ファイル名から読み取れる図番・版だけを記す。',
  ].join('\n');
}

function mailSchema_() {
  return S_obj({
    is_noise: S_bool('メルマガ・広告等の一斉配信なら true'),
    noise_reason: S_str('is_noise の判断理由（短く）'),
    project_id: S_str('案件ID、または "NEW" / "GENERAL"'),
    project_confidence: S_enum(['high', 'mid', 'low'], '案件判定の確からしさ'),
    new_project: S_obj({
      name: S_str('新規案件名（NEW 以外は ""）'),
      client: S_str('施主・発注者'),
      location: S_str('所在地'),
      phase: S_str('フェーズ'),
      aliases: S_arr(S_str(''), '表記ゆれ・略称'),
    }),
    category: S_enum(CONFIG.CATEGORIES, '主な種別'),
    phase: S_enum(CONFIG.PHASES, 'このメールが属する業務フェーズ'),
    title: S_str('記録用タイトル（40字以内。件名より内容が分かる表現に）'),
    summary: S_str('要約（2〜5文）'),
    key_points: S_arr(S_str(''), '要点（数値・日付・条件を含む箇条書き）'),
    decisions: S_arr(S_str(''), 'このメールで決定・合意・確定した事項'),
    open_issues: S_arr(S_str(''), '未解決の懸案・論点'),
    reply_needed: S_bool('本人が返信すべきか'),
    my_tasks: S_arr(taskSchema_(), '本人がやるべきタスク'),
    waiting_on_others: waitingSchema_(),
    completed_task_ids: S_arr(S_str(''), '完了したと判断できる進行中タスクのID'),
    events: eventSchema_(),
    attachments: S_arr(S_obj({
      name: S_str('ファイル名'),
      doc_type: S_enum(['図面', '申請書類', '行政文書', '見積書', '契約書', '請求書', '議事録', '工程表', '仕様書・資料', '写真', 'その他'], '種類'),
      summary: S_str('内容の要約（1〜3文）'),
      drawing_no: S_str('図番（なければ ""）'),
      revision: S_str('版・改訂記号・日付（なければ ""）'),
      key_values: S_arr(S_obj({ label: S_str('項目'), value: S_str('値') }), '金額・面積・期限などの重要値'),
    }), '添付ごとの解析結果'),
    people: S_arr(S_obj({
      name: S_str('氏名'), org: S_str('所属'), role: S_str('役割・立場'), email: S_str('メール'),
    }), '登場した関係者'),
  });
}

/** 00_inbox/mail を処理（tick から呼ばれる） */
function processMailInbox_(deadline, touched) {
  const inbox = folder_(PATHS.INBOX_MAIL);
  const files = listFiles_(inbox).filter(f => /\.json$/i.test(f.getName()));
  let count = 0;
  for (const file of files) {
    if (Date.now() > deadline || count >= CONFIG.MAX_ITEMS_PER_RUN) break;
    // Power Automate が添付を書き終える前に拾わないよう、作成から2分未満は次回に回す
    if (Date.now() - file.getDateCreated().getTime() < 2 * 60 * 1000) continue;
    try {
      processOneMail_(file, touched);
      count++;
    } catch (err) {
      withDb_(() => recordFailure_(file, err));
    }
  }
  return count;
}

function processOneMail_(file, touched) {
  const key = file.getName().replace(/\.json$/i, '');
  const mail = JSON.parse(readText_(file));
  mail.receivedAt = isoJst_(mail.receivedAt);
  if (typeof mail.attachments === 'string') {
    try { mail.attachments = JSON.parse(mail.attachments); } catch (e) { mail.attachments = []; }
  }
  if (typeof mail.from === 'string') mail.from = { name: '', address: mail.from };
  const attachFolder = folder_(PATHS.INBOX_ATTACH);
  const attachFiles = [];
  const it = attachFolder.searchFiles("title contains '" + key.replace(/'/g, "\\'") + "__'");
  while (it.hasNext()) attachFiles.push(it.next());

  const expected = (mail.attachments || []).filter(a => !a.isInline).length;
  if (attachFiles.length < expected && Date.now() - file.getDateCreated().getTime() < 15 * 60 * 1000) {
    return; // 添付の到着待ち
  }

  const projects = loadProjects_();
  const db = loadDb_();
  const thread = db.threads[mail.conversationId] || null;
  const openTasks = db.tasks.filter(t =>
    ['proposed', 'todo', 'doing', 'waiting'].indexOf(t.status) >= 0 &&
    ((thread && t.projectId === thread.projectId) || (t.source && t.source.conversationId === mail.conversationId))
  ).slice(0, 40);

  const parts = attachmentParts_(attachFiles.map(f => ({ name: f.getName().slice(key.length + 2), blob: f.getBlob() })));
  const body = stripQuoted_(mail.bodyText || mail.bodyPreview || '');
  const links = transferLinks_(mail.bodyText);
  const isOut = mail.direction === 'out';

  const text = [
    '## 今日', ymdJa_(new Date()),
    '', '## 営業日カレンダー（今日から3週間）', calendarContext_(),
    '', '## このスレッドの既存情報',
    thread ? '案件: ' + thread.projectId + ' / これまでの記録タイトル: ' + thread.title : '（新しいスレッド）',
    '', '## 進行中タスク（同じ案件・スレッド）',
    openTasks.length ? openTasks.map(t => '- ' + t.id + ': ' + t.title + '（期日 ' + (t.due || '-') + ', 状態 ' + t.status + '）').join('\n') : '（なし）',
    '', '## メール',
    '方向: ' + (isOut ? '送信（本人が送ったメール）' : '受信'),
    '日時: ' + mail.receivedAt,
    '差出人: ' + fromText_(mail.from),
    '宛先(To): ' + (mail.to || ''),
    'CC: ' + (mail.cc || ''),
    '件名: ' + (mail.subject || ''),
    '重要度: ' + (mail.importance || 'normal'),
    '添付: ' + (parts.meta.map(m => m.name).join(', ') || 'なし'),
    '大容量転送リンク: ' + (links.join(' ') || 'なし'),
    '', '本文:', clip_(body),
  ].join('\n');

  const result = callClaude_({
    system: mailSystemPrompt_(),
    context: '## 案件一覧\n' + projectsContext_(projects),
    content: parts.blocks.concat([{ type: 'text', text: text }]),
    schema: mailSchema_(),
    effort: CONFIG.EFFORT_MAIL,
  });

  if (result.is_noise) {
    withDb_(db2 => {
      const addr = (mail.from && mail.from.address || '').toLowerCase();
      db2.noise[addr] = (db2.noise[addr] || 0) + 1;
      attachFiles.forEach(f => archive_(f, 'noise'));
      archive_(file, 'noise');
    });
    return;
  }

  // 案件の確定
  let projectId = result.project_id;
  if (projectId === 'NEW' && result.new_project.name) {
    projectId = proposeProject_(result.new_project.name, result.new_project).id;
  } else if (!projects.find(p => p.id === projectId)) {
    projectId = 'GENERAL';
  }
  const allProjects = loadProjects_();
  const dest = destPath_(projectId, result.category, allProjects);
  const date = String(mail.receivedAt || '').slice(0, 10) || today_();
  const time = String(mail.receivedAt || '').slice(11, 16);
  const mailId = 'm-' + key;

  // 添付を案件フォルダへ移し、台帳に記録
  const attachOut = attachFiles.map(f => {
    const orig = f.getName().slice(key.length + 2);
    const info = (result.attachments || []).find(a => a.name === orig) || {};
    const meta = parts.meta.find(m => m.name === orig) || {};
    f.setName(date + '_' + orig);
    f.moveTo(folder_(dest + '/添付'));
    return {
      name: orig, fileId: f.getId(), url: driveUrl_(f.getId()), kind: meta.kind || kindOf_(orig),
      docType: info.doc_type || '', summary: info.summary || meta.note || '', drawingNo: info.drawing_no || '',
      revision: info.revision || '', keyValues: info.key_values || [],
    };
  });
  if (attachOut.length) appendAttachmentLedger_(dest, date, attachOut, mail.subject);

  // スレッド md に追記
  const tasks = normalizeTasks_(result.my_tasks, projectId, { kind: 'mail', id: mailId, conversationId: mail.conversationId, title: result.title });
  const waits = (result.waiting_on_others || []).map(w => ({
    id: newId_('w'), title: w.who + 'から: ' + w.what, projectId: projectId, owner: 'other', who: w.who,
    status: 'waiting', priority: 'mid', due: w.due || '', dueBasis: '', estimateMin: 0, subtasks: [],
    source: { kind: 'mail', id: mailId, conversationId: mail.conversationId, title: result.title }, createdAt: new Date().toISOString(),
  }));
  const section = renderMailSection_(mail, result, date, time, attachOut, tasks, waits);
  let threadFileId = thread && thread.fileId;
  let threadFile = null;
  if (threadFileId && thread.projectId === projectId) {
    try { threadFile = DriveApp.getFileById(threadFileId); } catch (e) { threadFile = null; }
  }
  if (threadFile) {
    threadFile.setContent(readText_(threadFile) + section);
  } else {
    const fm = frontmatter_({
      type: 'mail-thread', project: projectId, category: result.category, phase: result.phase,
      conversation_id: mail.conversationId, subject: mail.subject, started: date,
    });
    const head = fm + '# ' + result.title + '\n\n> 案件: ' + projectLabel_(projectId, allProjects) + ' ｜ 種別: ' + result.category + ' ｜ 件名: ' + (mail.subject || '') + '\n';
    const folder = folder_(dest + '/メール/' + date.slice(0, 7));
    threadFile = folder.createFile(date + '_' + safeName_(result.title, 50) + '.md', head + section, 'text/markdown');
  }

  if (result.decisions && result.decisions.length) {
    appendDecisions_(dest, date, result.decisions, result.title, threadFile.getId());
  }

  withDb_(db2 => {
    db2.threads[mail.conversationId] = { projectId: projectId, fileId: threadFile.getId(), title: result.title };
    db2.mails.push({
      id: mailId, conversationId: mail.conversationId, date: mail.receivedAt, direction: mail.direction || 'in',
      from: fromText_(mail.from), to: mail.to || '', subject: mail.subject || '', projectId: projectId,
      category: result.category, phase: result.phase, title: result.title, summary: result.summary,
      keyPoints: result.key_points || [], openIssues: result.open_issues || [], replyNeeded: !!result.reply_needed,
      attachments: attachOut.map(a => ({ name: a.name, url: a.url, docType: a.docType, summary: a.summary, drawingNo: a.drawingNo, revision: a.revision })),
      fileId: threadFile.getId(), webLink: mail.webLink || '',
    });
    tasks.forEach(t => db2.tasks.push(t));
    waits.forEach(w => db2.tasks.push(w));
    (result.completed_task_ids || []).forEach(id => {
      const t = db2.tasks.find(x => x.id === id);
      if (t && t.status !== 'done') t.suggestDone = { mailId: mailId, title: result.title };
    });
    (result.decisions || []).forEach(d => db2.decisions.push({ id: newId_('d'), date: date, projectId: projectId, text: d, source: { kind: 'mail', id: mailId, title: result.title } }));
    addEvents_(db2, result.events, projectId, { kind: 'mail', id: mailId, title: result.title });
    archive_(file, 'mail');
  });
  touched[projectId] = true;
}

function fromText_(from) {
  if (!from) return '';
  if (typeof from === 'string') return from;
  return (from.name ? from.name + ' ' : '') + '<' + (from.address || '') + '>';
}

function projectLabel_(projectId, projects) {
  const p = projects.find(x => x.id === projectId);
  return p ? p.id + ' ' + p.name : '案件外';
}

/** 引用された過去メール部分を除去（スレッド md では過去分が既に記録済みのため） */
function stripQuoted_(body) {
  const lines = String(body).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (i > 3 && (/^-{2,}\s*(Original Message|元のメッセージ|Forwarded message|転送されたメッセージ)/i.test(l.trim()) ||
      (/^(差出人|From)\s*[:：]/.test(l.trim()) && /^(送信日時|Sent|日時|Date)\s*[:：]/.test((lines[i + 1] || '').trim())) ||
      /^On .+ wrote:$/.test(l.trim()) || /^\d{4}年\d{1,2}月\d{1,2}日.+(書きました|wrote)[:：]?$/.test(l.trim()))) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Claude のタスク出力を db 形式にし、期日を営業日に補正する */
function normalizeTasks_(list, projectId, source) {
  const today = today_();
  const fixDue = d => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '';
    const b = toBusinessDayBefore_(d);
    return b < today ? today : b;
  };
  return (list || []).map(t => ({
    id: newId_('t'), title: t.title, why: t.why, projectId: projectId, owner: 'me',
    status: CONFIG.AUTO_ACCEPT_HIGH_CONFIDENCE && t.confidence === 'high' ? 'todo' : 'proposed', priority: t.priority, due: fixDue(t.due), dueBasis: t.due_basis,
    estimateMin: t.estimate_min, confidence: t.confidence,
    subtasks: (t.subtasks || []).map((s, i) => ({ id: 's' + (i + 1), title: s.title, due: fixDue(s.due), estimateMin: s.estimate_min, done: false })),
    source: source, createdAt: new Date().toISOString(),
  }));
}

function addEvents_(db, events, projectId, source) {
  (events || []).forEach(e => {
    if (!e.start) return;
    if (db.events.some(x => x.title === e.title && x.start === e.start)) return;
    db.events.push({ id: newId_('e'), title: e.title, start: e.start, end: e.end, place: e.place, projectId: projectId, source: source });
  });
}

function obsidianTaskLine_(t, indent) {
  const pri = { high: ' ⏫', mid: ' 🔼', low: ' 🔽' }[t.priority] || '';
  return (indent || '') + '- [' + (t.done || t.status === 'done' ? 'x' : ' ') + '] ' + t.title +
    (t.due ? ' 📅 ' + t.due : '') + (indent ? '' : pri) + (t.id && !indent ? ' 🆔 ' + t.id : '');
}

function renderMailSection_(mail, r, date, time, attachOut, tasks, waits) {
  const L = [];
  L.push('', '## ' + date + ' ' + time + ' ' + (mail.direction === 'out' ? '送信' : '受信') + ' ｜ ' + fromText_(mail.from).replace(/<.*>/, '').trim(), '');
  L.push(r.summary, '');
  if (r.key_points.length) L.push('**要点**', ...r.key_points.map(x => '- ' + x), '');
  if (r.decisions.length) L.push('**決定事項**', ...r.decisions.map(x => '- ' + x), '');
  if (r.open_issues.length) L.push('**懸案**', ...r.open_issues.map(x => '- ' + x), '');
  if (tasks.length) {
    L.push('**本人のタスク（提案）**');
    tasks.forEach(t => {
      L.push(obsidianTaskLine_(t));
      t.subtasks.forEach(s => L.push(obsidianTaskLine_(s, '    ')));
    });
    L.push('');
  }
  if (waits.length) L.push('**相手待ち**', ...waits.map(w => '- ' + w.title + (w.due ? '（期限 ' + w.due + '）' : '')), '');
  if (attachOut.length) {
    L.push('**添付**');
    attachOut.forEach(a => L.push('- [' + a.name + '](' + a.url + ')' + (a.docType ? ' 〔' + a.docType + '〕' : '') +
      (a.drawingNo ? ' 図番 ' + a.drawingNo : '') + (a.revision ? ' / ' + a.revision : '') + (a.summary ? ' — ' + a.summary : '')));
    L.push('');
  }
  L.push('<details><summary>本文（原文）</summary>', '', '~~~text', clip_(stripQuoted_(mail.bodyText || '')).replace(/~~~/g, '～～～'), '~~~', '', '</details>', '');
  if (mail.webLink) L.push('[Outlook で開く](' + mail.webLink + ')', '');
  return L.join('\n');
}

function appendAttachmentLedger_(dest, date, attachOut, subject) {
  const esc = s => String(s || '').replace(/\|/g, '／').replace(/\n/g, ' ');
  const rows = attachOut.map(a => '| ' + [date, '[' + esc(a.name) + '](' + a.url + ')', a.docType, a.drawingNo, a.revision, a.summary, subject].map((x, i) => i === 1 ? x : esc(x)).join(' | ') + ' |');
  appendText_(folder_(dest + '/添付'), '_添付台帳.md', rows.join('\n') + '\n',
    '# 添付台帳\n\n受領・送付した添付ファイルの一覧です。図面は図番・版で追えるようにしています。\n\n| 日付 | ファイル | 種類 | 図番 | 版 | 要約 | 件名 |\n|---|---|---|---|---|---|---|\n');
}

function appendDecisions_(dest, date, decisions, title, fileId) {
  const lines = decisions.map(d => '- ' + date + ' ｜ ' + d + '（出典: [' + title + '](' + driveUrl_(fileId) + ')）');
  appendText_(folder_(dest), '_決定事項.md', lines.join('\n') + '\n', '# 決定事項ログ\n\n打合せ・メールで決定・合意した事項を時系列で記録します（追記のみ）。\n\n');
}
