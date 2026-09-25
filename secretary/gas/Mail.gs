/**
 * メール：00_inbox/mail の JSON（Power Automate が投入）
 *   prepareMailJobs_  … 1通ごとに解析ジョブを作る（添付は fileId を渡す）
 *   applyMailResult_  … Claude Code の結果から .md と db を更新する
 *
 * 投入 JSON（mail.v1）の形式は設計書「Power Automate フロー」節を参照。
 */

function prepareMailJobs_(deadline) {
  const files = listFiles_(folder_(PATHS.INBOX_MAIL)).filter(f => /\.json$/i.test(f.getName()));
  let count = 0;
  for (const file of files) {
    if (Date.now() > deadline || count >= CONFIG.MAX_ITEMS_PER_RUN) break;
    // Power Automate が添付を書き終える前に拾わないよう、作成から2分未満は次回に回す
    if (Date.now() - file.getDateCreated().getTime() < 2 * 60 * 1000) continue;
    try {
      if (prepareOneMail_(file)) count++;
    } catch (err) {
      withDb_(() => recordFailure_(file, err));
    }
  }
  return count;
}

function readMailJson_(file) {
  const mail = JSON.parse(readText_(file));
  mail.receivedAt = isoJst_(mail.receivedAt);
  if (typeof mail.attachments === 'string') {
    try { mail.attachments = JSON.parse(mail.attachments); } catch (e) { mail.attachments = []; }
  }
  if (typeof mail.from === 'string') mail.from = { name: '', address: mail.from };
  return mail;
}

/** @return {boolean} ジョブを作ったら true（添付の到着待ちなら false） */
function prepareOneMail_(file) {
  const key = file.getName().replace(/\.json$/i, '');
  const mail = readMailJson_(file);
  const attachFolder = folder_(PATHS.INBOX_ATTACH);
  let attachFiles = [];
  const it = attachFolder.searchFiles("title contains '" + key.replace(/'/g, "\\'") + "__'");
  while (it.hasNext()) attachFiles.push(it.next());
  attachFiles.sort((a, b) => a.getName() < b.getName() ? -1 : 1);

  const expected = (mail.attachments || []).filter(a => String(a.isInline).toLowerCase() !== 'true').length;
  if (attachFiles.length < expected && Date.now() - file.getDateCreated().getTime() < 15 * 60 * 1000) return false;
  attachFiles = expandZips_(attachFiles, key, attachFolder);

  const projects = loadProjects_();
  const db = loadDb_();
  const thread = db.threads[mail.conversationId] || null;
  const openTasks = db.tasks.filter(t =>
    ['proposed', 'todo', 'doing', 'waiting'].indexOf(t.status) >= 0 &&
    ((thread && t.projectId === thread.projectId) || (t.source && t.source.conversationId === mail.conversationId))
  ).slice(0, 40);
  const att = describeAttachments_(attachFiles, key);
  const links = transferLinks_(mail.bodyText);

  const text = [
    commonJobContext_(projects),
    '## このスレッドの既存情報',
    thread ? '案件: ' + thread.projectId + ' / これまでの記録タイトル: ' + thread.title : '（新しいスレッド）',
    '',
    '## 進行中タスク（同じ案件・スレッド）',
    openTasks.length ? openTasks.map(t => '- ' + t.id + ': ' + t.title + '（期日 ' + (t.due || '-') + ', 状態 ' + t.status + '）').join('\n') : '（なし）',
    '',
    '## メール',
    '方向: ' + (mail.direction === 'out' ? '送信（本人が送ったメール）' : '受信'),
    '日時: ' + mail.receivedAt,
    '差出人: ' + fromText_(mail.from),
    '宛先(To): ' + (mail.to || ''),
    'CC: ' + (mail.cc || ''),
    '件名: ' + (mail.subject || ''),
    '重要度: ' + (mail.importance || 'normal'),
    '外部サービス・大容量転送のリンク: ' + (links.join(' ') || 'なし'),
    '',
    '本文:',
    clip_(stripQuoted_(mail.bodyText || mail.bodyPreview || '')),
    '',
    '## 添付ファイル',
    att.text,
  ].join('\n');

  const jobId = 'mail-' + key;
  const docId = createJob_('mail', jobId, text);
  const queued = folder_(PATHS.QUEUED + '/mail');
  file.moveTo(queued);
  withDb_(db2 => {
    db2.jobs[jobId] = {
      type: 'mail', docId: docId, createdAt: new Date().toISOString(),
      src: { mailFileId: file.getId(), key: key, attachIds: attachFiles.map(f => f.getId()), attachItems: att.items },
    };
  });
  return true;
}

function applyMailResult_(job, result, touched) {
  const file = DriveApp.getFileById(job.src.mailFileId);
  const mail = readMailJson_(file);
  const key = job.src.key;
  const attachFiles = (job.src.attachIds || []).map(id => { try { return DriveApp.getFileById(id); } catch (e) { return null; } }).filter(Boolean);

  if (result.is_noise) {
    withDb_(db2 => {
      const addr = (mail.from && mail.from.address || '').toLowerCase();
      db2.noise[addr] = (db2.noise[addr] || 0) + 1;
      attachFiles.forEach(f => archive_(f, 'noise'));
      archive_(file, 'noise');
    });
    return;
  }

  const projects = loadProjects_();
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
    const item = (job.src.attachItems || []).find(x => x.fileId === f.getId()) || { name: f.getName().slice(key.length + 2), kind: kindOf_(f.getName()) };
    const info = (result.attachments || []).find(a => a.name === item.name) || {};
    if (/スキップ/.test(item.note || '')) { archive_(f, 'mail'); return null; } // 署名ロゴなど
    f.setName(date + '_' + item.name.replace(/ > /g, '_'));
    f.moveTo(folder_(dest + '/添付'));
    return {
      name: item.name, fileId: f.getId(), url: driveUrl_(f.getId()), kind: item.kind,
      docType: info.doc_type || '', summary: info.summary || item.note || '', drawingNo: info.drawing_no || '',
      revision: info.revision || '', keyValues: info.key_values || [],
    };
  }).filter(Boolean);
  if (attachOut.length) appendAttachmentLedger_(dest, date, attachOut, mail.subject);

  const source = { kind: 'mail', id: mailId, conversationId: mail.conversationId, title: result.title };
  const tasks = normalizeTasks_(result.my_tasks, projectId, source);
  const waits = waitsFromResult_(result.waiting_on_others, projectId, source);

  // スレッド md に追記（同じ会話・同じ案件なら同じファイル）
  const db = loadDb_();
  const thread = db.threads[mail.conversationId] || null;
  const section = renderMailSection_(mail, result, date, time, attachOut, tasks, waits);
  let threadFile = null;
  if (thread && thread.fileId && thread.projectId === projectId) {
    try { threadFile = DriveApp.getFileById(thread.fileId); } catch (e) { threadFile = null; }
  }
  if (threadFile) {
    threadFile.setContent(readText_(threadFile) + section);
  } else {
    const fm = frontmatter_({
      type: 'mail-thread', project: projectId, category: result.category, phase: result.phase,
      conversation_id: mail.conversationId, subject: mail.subject, started: date,
    });
    const head = fm + '# ' + result.title + '\n\n> 案件: ' + projectLabel_(projectId, allProjects) + ' ｜ 種別: ' + result.category + ' ｜ 件名: ' + (mail.subject || '') + '\n';
    threadFile = folder_(dest + '/メール/' + date.slice(0, 7)).createFile(date + '_' + safeName_(result.title, 50) + '.md', head + section, 'text/markdown');
  }
  if (result.decisions.length) appendDecisions_(dest, date, result.decisions, result.title, threadFile.getId());

  withDb_(db2 => {
    db2.threads[mail.conversationId] = { projectId: projectId, fileId: threadFile.getId(), title: result.title };
    db2.mails.push({
      id: mailId, conversationId: mail.conversationId, date: mail.receivedAt, direction: mail.direction || 'in',
      from: fromText_(mail.from), to: mail.to || '', subject: mail.subject || '', projectId: projectId,
      category: result.category, phase: result.phase, title: result.title, summary: result.summary,
      keyPoints: result.key_points, openIssues: result.open_issues, replyNeeded: !!result.reply_needed,
      attachments: attachOut.map(a => ({ name: a.name, url: a.url, docType: a.docType, summary: a.summary, drawingNo: a.drawingNo, revision: a.revision })),
      fileId: threadFile.getId(), webLink: mail.webLink || '',
    });
    tasks.forEach(t => db2.tasks.push(t));
    waits.forEach(w => db2.tasks.push(w));
    result.completed_task_ids.forEach(id => {
      const t = db2.tasks.find(x => x.id === id);
      if (t && t.status !== 'done') t.suggestDone = { mailId: mailId, title: result.title };
    });
    result.decisions.forEach(d => db2.decisions.push({ id: newId_('d'), date: date, projectId: projectId, text: d, source: source }));
    addEvents_(db2, result.events, projectId, source);
    archive_(file, 'mail');
  });
  touched[projectId] = true;
}

function waitsFromResult_(list, projectId, source) {
  return (list || []).map(w => ({
    id: newId_('w'), title: w.who + 'から: ' + w.what, projectId: projectId, owner: 'other', who: w.who,
    status: 'waiting', priority: 'mid', due: /^\d{4}-\d{2}-\d{2}$/.test(w.due) ? w.due : '', dueBasis: '', estimateMin: 0, subtasks: [],
    source: source, createdAt: new Date().toISOString(),
  }));
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

/** 結果のタスクを db 形式にし、期日を営業日に補正する */
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
