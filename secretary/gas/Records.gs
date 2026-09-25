/**
 * 打合せ・協議記録の取り込み（00_inbox/records）
 *
 * 投入できるもの:
 *   音声（m4a/mp3/wav/aac/ogg/flac）… GEMINI_API_KEY があれば自動文字起こし → 構造化
 *   テキスト・Markdown・Word・PDF     … そのまま構造化（手書きメモのスキャンPDFも可）
 *   写真（手書きメモ・ホワイトボード） … 画像として読み取り → 構造化
 *
 * ファイル名の先頭に [案件ID][種別] を付けると判定のヒントになる（ダッシュボードからの投稿は自動で付く）
 *   例: [P-2026-001][行政協議]2026-09-24_建築指導課 事前相談.m4a
 */

function recordSystemPrompt_() {
  const o = owner_();
  return [
    'あなたは' + (o.role || '建築・不動産分野の実務担当者') + 'である' + (o.name || '利用者') + 'さん（以下「本人」）の業務秘書です。',
    '打合せ・協議の記録（音声の文字起こし、手書きメモ、議事メモ）を読み、正式な議事録として構造化し、本人のタスクを提案します。',
    '',
    '## 原則',
    '- 記録にないことは書かない。聞き取れない・曖昧な箇所は notes に「要確認」として残す。',
    '- 数値・寸法・条文・日付・固有名詞は原文どおり。',
    '- 行政協議では、相手の指摘・要望と、その根拠（条例・条文・要綱・運用基準）、こちらの回答、対応の要否を必ず対応づける。',
    '  「指導」「お願い」レベルか「法的に必須」かの温度感が読み取れれば basis に書く。',
    '- 施主打合せでは、要望・決定事項・保留事項・コストや工程への影響を明確にする。',
    '- 相手側の宿題は waiting_on_others、本人側の宿題は my_tasks に入れる。',
    '',
    '## タスク・期日の考え方',
    '- 本人が行動すべきものだけを my_tasks にし、2〜6個のサブタスクに分解する（実行順・各30分〜2時間）。',
    '- 次回打合せ日がある場合、その宿題は次回の前営業日を最終期日にする。',
    '- 期限の定めがないものは5営業日以内を既定とし、due_basis に「既定」と書く。',
    '- 期日は営業日カレンダーの営業日にし、今日より前にしない。',
    '',
    '## 案件の判定',
    '- 案件一覧と照合して project_id を返す。一覧に無い物件の話なら "NEW"、案件に属さなければ "GENERAL"。',
  ].join('\n');
}

function recordSchema_() {
  return S_obj({
    project_id: S_str('案件ID、または "NEW" / "GENERAL"'),
    new_project: S_obj({
      name: S_str('新規案件名（NEW 以外は ""）'), client: S_str('施主'), location: S_str('所在地'),
      phase: S_str('フェーズ'), aliases: S_arr(S_str(''), '別名'),
    }),
    record_type: S_enum(CONFIG.RECORD_TYPES, '記録の種別'),
    title: S_str('議事録タイトル（例: 建築指導課 事前相談（日影・壁面後退））'),
    date: S_str('実施日 YYYY-MM-DD（不明なら ""）'),
    time: S_str('時刻 HH:mm〜HH:mm（不明なら ""）'),
    place: S_str('場所'),
    counterpart: S_str('相手先（機関・部署、または施主名）'),
    attendees: S_arr(S_obj({ name: S_str('氏名'), org: S_str('所属') }), '出席者'),
    purpose: S_str('目的'),
    summary: S_str('概要（3〜6文）'),
    qa: S_arr(S_obj({
      topic: S_str('論点'),
      point: S_str('相手の指摘・質問・要望'),
      response: S_str('こちらの回答・協議結果'),
      basis: S_str('根拠（条文・要綱・基準・資料）や温度感'),
      status: S_enum(['解決', '要対応', '継続協議', '参考'], '状態'),
    }), '協議事項'),
    decisions: S_arr(S_str(''), '決定・合意事項'),
    open_issues: S_arr(S_str(''), '未解決・継続協議の事項'),
    my_tasks: S_arr(taskSchema_(), '本人のタスク'),
    waiting_on_others: waitingSchema_(),
    next_meeting: S_obj({ date: S_str('次回日時（不明なら ""）'), agenda: S_str('次回の議題') }),
    events: eventSchema_(),
    notes: S_str('聞き取れなかった点・要確認事項'),
  });
}

function processRecordsInbox_(deadline, touched) {
  const inbox = folder_(PATHS.INBOX_RECORDS);
  const files = listFiles_(inbox).filter(f => !/\.transcript\.txt$/.test(f.getName()));
  let count = 0;
  for (const file of files) {
    if (Date.now() > deadline || count >= CONFIG.MAX_ITEMS_PER_RUN) break;
    if (Date.now() - file.getDateCreated().getTime() < 60 * 1000) continue; // アップロード途中の可能性
    try {
      if (processOneRecord_(file, touched)) count++;
    } catch (err) {
      withDb_(() => recordFailure_(file, err));
    }
  }
  return count;
}

/** @return {boolean} 処理したら true（文字起こし待ちなら false） */
function processOneRecord_(file, touched) {
  const name = file.getName();
  const hint = parseRecordHint_(name);
  const kind = kindOf_(name);
  const blocks = [];
  let transcriptFile = null;

  if (kind === 'audio') {
    if (!prop_('GEMINI_API_KEY', '')) return false; // 手動の文字起こし投入を待つ
    const text = transcribeAudio_(file);
    transcriptFile = folder_(PATHS.INBOX_RECORDS).createFile(name.replace(/\.[^.]+$/, '') + '.transcript.txt', text, 'text/plain');
    blocks.push({ type: 'text', text: '【音声の文字起こし】\n' + clip_(text) });
  } else {
    const parts = attachmentParts_([{ name: name, blob: file.getBlob() }]);
    parts.blocks.forEach(b => blocks.push(b));
  }

  const projects = loadProjects_();
  const text = [
    '## 今日', ymdJa_(new Date()),
    '', '## 営業日カレンダー（今日から3週間）', calendarContext_(),
    '', '## 投入情報',
    'ファイル名: ' + name,
    '指定された案件: ' + (hint.projectId || 'なし'),
    '指定された種別: ' + (hint.type || 'なし'),
    'ファイル作成日: ' + fmt_(file.getDateCreated()),
    '', '上の記録を議事録として構造化してください。',
  ].join('\n');

  const r = callClaude_({
    system: recordSystemPrompt_(),
    context: '## 案件一覧\n' + projectsContext_(projects),
    content: blocks.concat([{ type: 'text', text: text }]),
    schema: recordSchema_(),
    effort: CONFIG.EFFORT_RECORD,
  });

  let projectId = hint.projectId && projects.find(p => p.id === hint.projectId) ? hint.projectId : r.project_id;
  if (projectId === 'NEW' && r.new_project.name) projectId = proposeProject_(r.new_project.name, r.new_project).id;
  else if (!projects.find(p => p.id === projectId)) projectId = 'GENERAL';
  const allProjects = loadProjects_();
  const dest = destPath_(projectId, '社内', allProjects);
  const date = r.date || hint.date || fmt_(file.getDateCreated());
  const recId = newId_('r');
  const type = hint.type || r.record_type;

  // 原本を案件フォルダへ。手動で文字起こしを投入した場合、同じ名前の音声も一緒に移す
  const origFolder = folder_(dest + '/記録/原本');
  const baseName = name.replace(/\.[^.]+$/, '');
  const siblings = kind === 'audio' ? [] : listFiles_(folder_(PATHS.INBOX_RECORDS))
    .filter(f => f.getId() !== file.getId() && f.getName().replace(/\.[^.]+$/, '') === baseName && kindOf_(f.getName()) === 'audio');
  file.moveTo(origFolder);
  if (transcriptFile) transcriptFile.moveTo(origFolder);
  siblings.forEach(f => f.moveTo(origFolder));

  const source = { kind: 'record', id: recId, title: r.title };
  const tasks = normalizeTasks_(r.my_tasks, projectId, source);
  const waits = (r.waiting_on_others || []).map(w => ({
    id: newId_('w'), title: w.who + 'から: ' + w.what, projectId: projectId, owner: 'other', who: w.who,
    status: 'waiting', priority: 'mid', due: w.due || '', dueBasis: '', estimateMin: 0, subtasks: [], source: source,
    createdAt: new Date().toISOString(),
  }));

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
  return true;
}

/** "[P-2026-001][行政協議]2026-09-24_タイトル.m4a" から手がかりを取り出す */
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
