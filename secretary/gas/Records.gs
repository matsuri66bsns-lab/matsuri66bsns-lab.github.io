/**
 * 打合せ・協議記録（00_inbox/records）
 *   prepareRecordJobs_  … 記録ごとに解析ジョブを作る（音声は先に Gemini で文字起こし）
 *   applyRecordResult_  … Claude Code の結果から議事録 .md と db を更新する
 *
 * 投入できるもの:
 *   音声（m4a/mp3/wav/aac/ogg/flac）… GEMINI_API_KEY があれば自動で文字起こし
 *     キーが無い場合は、同じファイル名の .txt（文字起こし）を一緒に入れる
 *   テキスト・Markdown … ジョブに直接書き込む
 *   PDF・Word・写真（手書きメモ・ホワイトボード）… Claude Code が read_file_content で読む
 *
 * ファイル名の先頭に [案件ID][種別] を付けると判定のヒントになる（ダッシュボードからの投稿は自動で付く）
 *   例: [P-2026-001][行政協議・検査]2026-09-24_消防署 事前協議.m4a
 */

function prepareRecordJobs_(deadline) {
  const inbox = folder_(PATHS.INBOX_RECORDS);
  const files = listFiles_(inbox).filter(f => !/\.transcript\.txt$/.test(f.getName()));
  let count = 0;
  for (const file of files) {
    if (Date.now() > deadline || count >= CONFIG.MAX_ITEMS_PER_RUN) break;
    if (Date.now() - file.getDateCreated().getTime() < 60 * 1000) continue; // アップロード途中の可能性
    try {
      if (prepareOneRecord_(file)) count++;
    } catch (err) {
      withDb_(() => recordFailure_(file, err));
    }
  }
  return count;
}

/** @return {boolean} ジョブを作ったら true（文字起こし待ちなら false） */
function prepareOneRecord_(file) {
  const name = file.getName();
  const hint = parseRecordHint_(name);
  const kind = kindOf_(name);
  const inbox = folder_(PATHS.INBOX_RECORDS);
  const baseName = name.replace(/\.[^.]+$/, '');
  let transcriptFile = null;
  let content;

  if (kind === 'audio') {
    // 同名の文字起こしテキストがあれば、そちらの処理で一緒に扱う
    const hasText = listFiles_(inbox).some(f => f.getId() !== file.getId() && f.getName().replace(/\.[^.]+$/, '') === baseName && kindOf_(f.getName()) === 'text');
    if (hasText || !prop_('GEMINI_API_KEY', '')) return false;
    const transcript = transcribeAudio_(file);
    transcriptFile = inbox.createFile(baseName + '.transcript.txt', transcript, 'text/plain');
    content = '読み方: 下のテキスト（音声を Gemini で文字起こししたもの）\n~~~\n' + clip_(transcript) + '\n~~~';
  } else if (kind === 'text') {
    content = '読み方: 下のテキスト\n~~~\n' + clip_(decodeText_(file.getBlob())) + '\n~~~';
  } else if (READABLE_MIME[ext_(name)]) {
    fixMime_(file, READABLE_MIME[ext_(name)]);
    content = '読み方: read_file_content（fileId: ' + file.getId() + '）';
  } else if (kind === 'excel-old' || kind === 'ppt-old' || kind === 'text-convert') {
    content = '読み方: 下のテキスト（Apps Script で変換）\n~~~\n' + clip_(officeToText_(file.getBlob(), kind)) + '\n~~~';
  } else {
    throw new Error('記録として読めない形式です: ' + name);
  }

  const siblings = kind === 'audio' ? [] : listFiles_(inbox)
    .filter(f => f.getId() !== file.getId() && f.getName().replace(/\.[^.]+$/, '') === baseName && kindOf_(f.getName()) === 'audio');

  const text = [
    commonJobContext_(loadProjects_()),
    '## 投入情報',
    'ファイル名: ' + name,
    '指定された案件: ' + (hint.projectId || 'なし'),
    '指定された種別: ' + (hint.type || 'なし'),
    'ファイル作成日: ' + fmt_(file.getDateCreated()),
    '',
    '## 記録の本体',
    content,
  ].join('\n');

  const jobId = 'record-' + fmt_(new Date(), 'yyyyMMdd-HHmmss') + '_' + Utilities.getUuid().slice(0, 6);
  const docId = createJob_('record', jobId, text);
  const queued = folder_(PATHS.QUEUED + '/records');
  file.moveTo(queued);
  if (transcriptFile) transcriptFile.moveTo(queued);
  siblings.forEach(f => f.moveTo(queued));
  withDb_(db => {
    db.jobs[jobId] = {
      type: 'record', docId: docId, createdAt: new Date().toISOString(),
      src: { fileId: file.getId(), transcriptId: transcriptFile ? transcriptFile.getId() : '', siblingIds: siblings.map(f => f.getId()), hint: hint },
    };
  });
  return true;
}

function applyRecordResult_(job, r, touched) {
  const file = DriveApp.getFileById(job.src.fileId);
  const transcriptFile = job.src.transcriptId ? DriveApp.getFileById(job.src.transcriptId) : null;
  const siblings = (job.src.siblingIds || []).map(id => DriveApp.getFileById(id));
  const hint = job.src.hint || {};
  const projects = loadProjects_();

  let projectId = hint.projectId && projects.find(p => p.id === hint.projectId) ? hint.projectId : r.project_id;
  if (projectId === 'NEW' && r.new_project.name) projectId = proposeProject_(r.new_project.name, r.new_project).id;
  else if (!projects.find(p => p.id === projectId)) projectId = 'GENERAL';
  const allProjects = loadProjects_();
  const dest = destPath_(projectId, '社内', allProjects);
  const date = r.date || hint.date || fmt_(file.getDateCreated());
  const recId = newId_('r');
  const type = hint.type || r.record_type;

  const origFolder = folder_(dest + '/記録/原本');
  file.moveTo(origFolder);
  if (transcriptFile) transcriptFile.moveTo(origFolder);
  siblings.forEach(f => f.moveTo(origFolder));

  const source = { kind: 'record', id: recId, title: r.title };
  const tasks = normalizeTasks_(r.my_tasks, projectId, source);
  const waits = waitsFromResult_(r.waiting_on_others, projectId, source);

  const md = renderRecordMd_(r, { projectId, type, date, file, transcriptFile, siblings, tasks, waits, projectLabel: projectLabel_(projectId, allProjects) });
  const out = folder_(dest + '/記録').createFile(date + '_' + type + '_' + safeName_(r.title, 40) + '.md', md, 'text/markdown');
  if (r.decisions.length) appendDecisions_(dest, date, r.decisions, r.title, out.getId());

  withDb_(db => {
    db.records.push({
      id: recId, date: date, time: r.time, type: type, title: r.title, projectId: projectId, counterpart: r.counterpart,
      summary: r.summary, fileId: out.getId(), sourceFileId: file.getId(), qaOpen: r.qa.filter(q => q.status === '要対応' || q.status === '継続協議').length,
    });
    tasks.forEach(t => db.tasks.push(t));
    waits.forEach(w => db.tasks.push(w));
    r.decisions.forEach(d => db.decisions.push({ id: newId_('d'), date: date, projectId: projectId, text: d, source: source }));
    addEvents_(db, r.events, projectId, source);
    if (r.next_meeting.date) addEvents_(db, [{ title: '次回: ' + r.title, start: r.next_meeting.date, end: '', place: '' }], projectId, source);
  });
  touched[projectId] = true;
}

/** "[P-2026-001][行政協議・検査]2026-09-24_タイトル.m4a" から手がかりを取り出す */
function parseRecordHint_(name) {
  const h = { projectId: '', type: '', date: '' };
  const tags = name.match(/\[([^\]]+)\]/g) || [];
  tags.forEach(t => {
    const v = t.slice(1, -1);
    if (/^P-\d{4}-\d+$/.test(v)) h.projectId = v;
    else if (CONFIG.RECORD_TYPES.indexOf(v) >= 0) h.type = v;
  });
  const d = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (d) h.date = d[1] + '-' + d[2] + '-' + d[3];
  return h;
}

function renderRecordMd_(r, o) {
  const esc = s => String(s || '').replace(/\|/g, '／').replace(/\n/g, ' ');
  const L = [];
  L.push(frontmatter_({ type: 'record', record_type: o.type, project: o.projectId, date: o.date, counterpart: r.counterpart, source: driveUrl_(o.file.getId()) }));
  L.push('# ' + o.date + ' ' + o.type + '｜' + r.title, '');
  L.push('| 項目 | 内容 |', '|---|---|');
  L.push('| 案件 | ' + esc(o.projectLabel) + ' |');
  L.push('| 日時 | ' + esc(o.date + ' ' + (r.time || '')) + ' |');
  L.push('| 場所 | ' + esc(r.place) + ' |');
  L.push('| 相手先 | ' + esc(r.counterpart) + ' |');
  L.push('| 出席者 | ' + esc(r.attendees.map(a => a.name + (a.org ? '（' + a.org + '）' : '')).join('、')) + ' |');
  L.push('| 目的 | ' + esc(r.purpose) + ' |', '');
  L.push('## 概要', '', r.summary, '');
  if (r.qa.length) {
    L.push('## 協議事項', '', '| # | 論点 | 相手の指摘・要望 | 回答・協議結果 | 根拠 | 状態 |', '|---|---|---|---|---|---|');
    r.qa.forEach((q, i) => L.push('| ' + (i + 1) + ' | ' + [q.topic, q.point, q.response, q.basis, q.status].map(esc).join(' | ') + ' |'));
    L.push('');
  }
  if (r.decisions.length) L.push('## 決定事項', '', ...r.decisions.map(x => '- ' + x), '');
  if (o.tasks.length) {
    L.push('## 本人のタスク（提案）', '');
    o.tasks.forEach(t => { L.push(obsidianTaskLine_(t)); t.subtasks.forEach(s => L.push(obsidianTaskLine_(s, '    '))); });
    L.push('');
  }
  if (o.waits.length) L.push('## 相手側の宿題（相手待ち）', '', ...o.waits.map(w => '- ' + w.title + (w.due ? '（期限 ' + w.due + '）' : '')), '');
  if (r.open_issues.length) L.push('## 未解決・継続協議', '', ...r.open_issues.map(x => '- ' + x), '');
  if (r.next_meeting.date || r.next_meeting.agenda) L.push('## 次回', '', '- 日時: ' + (r.next_meeting.date || '未定'), '- 議題: ' + (r.next_meeting.agenda || '-'), '');
  if (r.notes) L.push('## 要確認', '', r.notes, '');
  L.push('## 原本', '', '- [' + o.file.getName() + '](' + driveUrl_(o.file.getId()) + ')');
  if (o.transcriptFile) L.push('- [文字起こし](' + driveUrl_(o.transcriptFile.getId()) + ')');
  (o.siblings || []).forEach(f => L.push('- [' + f.getName() + '](' + driveUrl_(f.getId()) + ')'));
  L.push('');
  return L.join('\n');
}

/* ---------------- 音声の文字起こし（Gemini API / File API） ---------------- */

const AUDIO_MIME = { m4a: 'audio/mp4', mp3: 'audio/mp3', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm' };

function transcribeAudio_(file) {
  const key = prop_('GEMINI_API_KEY', '');
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > 45 * 1024 * 1024) throw new Error('音声が45MBを超えています。分割するか、文字起こし済みテキストを投入してください');
  const mime = AUDIO_MIME[ext_(file.getName())] || 'audio/mp4';
  const base = 'https://generativelanguage.googleapis.com';

  // 1) File API へ resumable アップロード
  const start = UrlFetchApp.fetch(base + '/upload/v1beta/files?key=' + key, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: {
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length), 'X-Goog-Upload-Header-Content-Type': mime,
    },
    payload: JSON.stringify({ file: { display_name: file.getName() } }),
  });
  const h = start.getAllHeaders();
  const uploadUrl = h['x-goog-upload-url'] || h['X-Goog-Upload-URL'];
  if (!uploadUrl) throw new Error('Gemini アップロード開始に失敗: ' + start.getContentText().slice(0, 300));
  const up = JSON.parse(UrlFetchApp.fetch(uploadUrl, {
    method: 'post', contentType: mime, payload: bytes,
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
  }).getContentText());

  // 2) 処理完了（ACTIVE）を待つ
  let info = up.file;
  for (let i = 0; i < 20 && info.state === 'PROCESSING'; i++) {
    Utilities.sleep(3000);
    info = JSON.parse(UrlFetchApp.fetch(base + '/v1beta/' + info.name + '?key=' + key).getContentText());
  }
  if (info.state !== 'ACTIVE') throw new Error('Gemini 側で音声の処理が完了しません: ' + info.state);

  // 3) 文字起こし
  const res = UrlFetchApp.fetch(base + '/v1beta/models/' + CONFIG.GEMINI_MODEL + ':generateContent?key=' + key, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{
        parts: [
          { file_data: { mime_type: mime, file_uri: info.uri } },
          { text: '日本語の打合せ音声を、発言内容を省略せずに文字起こししてください。話者が変わるごとに改行し「話者A:」「話者B:」のように付けてください（名乗りがあれば氏名や所属で）。「えー」「あの」などのフィラーは除き、聞き取れない箇所は［不明瞭］と書いてください。数値・寸法・日付・条文番号は正確に。' },
        ],
      }],
    }),
  });
  if (res.getResponseCode() !== 200) throw new Error('Gemini 文字起こし失敗: ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  // アップロードした音声は Gemini 側から削除（48時間で自動削除されるが明示的に消す）
  UrlFetchApp.fetch(base + '/v1beta/' + info.name + '?key=' + key, { method: 'delete', muteHttpExceptions: true });
  return ((json.candidates || [])[0] || { content: { parts: [] } }).content.parts.map(p => p.text || '').join('');
}
