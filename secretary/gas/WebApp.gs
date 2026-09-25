/**
 * ダッシュボード（Web アプリ）とその API
 *
 * デプロイ: 「デプロイ > 新しいデプロイ > 種類: ウェブアプリ」
 *   次のユーザーとして実行: 自分 / アクセスできるユーザー: 自分のみ
 * → 発行された URL をスマートフォンのホーム画面にも追加しておく
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('秘書AI')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/** db 全体（ログは除く）を JSON 文字列で返す */
function apiGetDb() {
  const db = loadDb_();
  const copy = Object.assign({}, db, { log: db.log.slice(-30) });
  copy.owner = owner_();
  copy.config = { model: CONFIG.MODEL, categories: CONFIG.CATEGORIES, recordTypes: CONFIG.RECORD_TYPES, phases: CONFIG.PHASES };
  return JSON.stringify(copy);
}

/** db に登録済みの .md だけ読めるようにする */
function apiGetMarkdown(fileId) {
  const db = loadDb_();
  const known = new Set();
  db.mails.forEach(m => known.add(m.fileId));
  db.records.forEach(r => known.add(r.fileId));
  db.projects.forEach(p => { known.add(p.overviewFileId); known.add(p.decisionsFileId); });
  if (db.brief) known.add(db.brief.fileId);
  if (!known.has(fileId)) throw new Error('このファイルは読み込めません');
  return readText_(DriveApp.getFileById(fileId));
}

/** 案件フォルダ内の定型 .md（_案件カルテ / _決定事項 / _タスク / 添付台帳）を読む */
function apiGetProjectDoc(projectId, kind) {
  const p = loadProjects_().find(x => x.id === projectId);
  if (!p) throw new Error('案件が見つかりません');
  const name = { overview: '_案件カルテ.md', decisions: '_決定事項.md', tasks: '_タスク.md', attachments: '_添付台帳.md' }[kind];
  if (!name) throw new Error('不明な種類です');
  const folder = folder_(projectFolderPath_(p) + (kind === 'attachments' ? '/添付' : ''));
  const f = findFile_(folder, name);
  return f ? readText_(f) : '';
}

function apiUpdateTask(id, patch) {
  return JSON.stringify(withDb_(db => {
    const t = db.tasks.find(x => x.id === id);
    if (!t) throw new Error('タスクが見つかりません: ' + id);
    const before = t.projectId || 'GENERAL';
    applyTaskPatch_(t, patch || {});
    const ids = {}; ids[before] = true; ids[t.projectId || 'GENERAL'] = true;
    writeTasksMd_(db, ids);
    syncProjectsToDb_(db);
    return t;
  }));
}

function apiCreateTask(input) {
  return JSON.stringify(withDb_(db => {
    const t = {
      id: newId_('t'), title: input.title, why: input.why || '', projectId: input.projectId || 'GENERAL', owner: input.owner || 'me',
      who: input.who || '', status: input.status || 'todo', priority: input.priority || 'mid', due: input.due || '', dueBasis: '手動登録',
      estimateMin: input.estimateMin || 0, confidence: 'high', subtasks: [], source: { kind: 'manual', id: '', title: '' },
      createdAt: new Date().toISOString(),
    };
    db.tasks.push(t);
    const ids = {}; ids[t.projectId] = true;
    writeTasksMd_(db, ids);
    syncProjectsToDb_(db);
    return t;
  }));
}

/** 提案タスクを一括で採用（todo）または却下（dismissed） */
function apiBulkTasks(ids, status) {
  return JSON.stringify(withDb_(db => {
    const touched = {};
    ids.forEach(id => {
      const t = db.tasks.find(x => x.id === id);
      if (!t) return;
      applyTaskPatch_(t, { status: status });
      touched[t.projectId || 'GENERAL'] = true;
    });
    writeTasksMd_(db, touched);
    syncProjectsToDb_(db);
    return ids.length;
  }));
}

/** テキストのメモを記録として投稿し、その場で構造化する */
function apiSubmitMemo(input) {
  const name = recordFileName_(input) + '.md';
  const body = '# ' + (input.title || 'メモ') + '\n\n' + (input.date ? '実施日: ' + input.date + '\n\n' : '') + input.text;
  const file = folder_(PATHS.INBOX_RECORDS).createFile(name, body, 'text/markdown');
  const touched = {};
  processOneRecord_(file, touched);
  withDb_(db => { writeTasksMd_(db, touched); syncProjectsToDb_(db); });
  return apiGetDb();
}

/** 音声・写真・PDF などを記録の投入口に保存（処理は次回の定期実行で行う） */
function apiUploadRecord(input) {
  const ext = (input.name.match(/\.[^.]+$/) || [''])[0];
  const blob = Utilities.newBlob(Utilities.base64Decode(input.base64), input.mimeType || 'application/octet-stream', recordFileName_(input) + ext);
  folder_(PATHS.INBOX_RECORDS).createFile(blob);
  return '受け付けました。10分以内に議事録化されます。';
}

function recordFileName_(input) {
  return (input.projectId && input.projectId !== 'GENERAL' ? '[' + input.projectId + ']' : '') +
    (input.type ? '[' + input.type + ']' : '') +
    (input.date || today_()) + '_' + safeName_(input.title || input.name || 'メモ', 40);
}

/** 案件の追加・編集（案件マスタ.md を更新） */
function apiUpsertProject(input) {
  const projects = loadProjects_();
  let p = projects.find(x => x.id === input.id);
  if (!p) {
    p = { id: nextProjectId_(projects), aliases: [], domains: [] };
    projects.push(p);
  }
  ['name', 'status', 'phase', 'client', 'location'].forEach(k => { if (input[k] !== undefined) p[k] = input[k]; });
  if (input.aliases !== undefined) p.aliases = [].concat(input.aliases).filter(Boolean);
  if (input.domains !== undefined) p.domains = [].concat(input.domains).filter(Boolean);
  if (!p.status) p.status = '進行中';
  saveProjects_(projects);
  withDb_(db => syncProjectsToDb_(db));
  return apiGetDb();
}

/** 手動で今すぐ処理を回す */
function apiRunNow() {
  tick();
  return apiGetDb();
}
