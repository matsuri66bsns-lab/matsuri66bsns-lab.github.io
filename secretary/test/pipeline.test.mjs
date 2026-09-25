// Apps Script のコードを、Drive などをメモリ上で模したモックで動かす結合テスト
// 使い方: node secretary/test/pipeline.test.mjs
// メール JSON の投入 → ジョブ作成 → （Claude Code の代わりに）結果 JSON を置く → 反映、までを確認する
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const gasDir = join(here, '..', 'gas');

/* ---------- モック ---------- */
let seq = 0;
const files = new Map();   // id -> File
const folders = new Map(); // id -> Folder
const props = new Map();
const cache = new Map();

class Blob {
  constructor(data, mime, name) { this.data = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data || []); this.mime = mime; this.name = name; }
  getDataAsString() { return this.data.toString('utf8'); }
  getBytes() { return [...this.data]; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  setContentType(m) { this.mime = m; return this; }
}
class It { constructor(a) { this.a = a; this.i = 0; } hasNext() { return this.i < this.a.length; } next() { return this.a[this.i++]; } }
class File {
  constructor(name, data, mime, parent) { this.id = 'f' + (++seq); this.name = name; this.blob = new Blob(data, mime, name); this.mime = mime; this.parent = parent; this.created = new Date(Date.now() - 3600e3); this.updated = new Date(); files.set(this.id, this); }
  getId() { return this.id; } getName() { return this.name; } setName(n) { this.name = n; this.updated = new Date(); return this; }
  getBlob() { return new Blob(this.blob.data, this.mime, this.name); }
  setContent(t) { this.blob = new Blob(t, this.mime, this.name); this.updated = new Date(); return this; }
  moveTo(f) { this.parent = f; return this; }
  getDateCreated() { return this.created; } getLastUpdated() { return this.updated; }
  getSize() { return this.blob.data.length; } getMimeType() { return this.mime; }
  setTrashed() { files.delete(this.id); }
}
class Folder {
  constructor(name, parent) { this.id = 'd' + (++seq); this.name = name; this.parent = parent; folders.set(this.id, this); }
  getId() { return this.id; } getName() { return this.name; } getUrl() { return 'https://drive/' + this.id; }
  getFoldersByName(n) { return new It([...folders.values()].filter(f => f.parent === this && f.name === n)); }
  createFolder(n) { return new Folder(n, this); }
  getFilesByName(n) { return new It([...files.values()].filter(f => f.parent === this && f.name === n)); }
  getFiles() { return new It([...files.values()].filter(f => f.parent === this)); }
  searchFiles(q) { const m = q.match(/title contains '(.*)'/); const s = m[1].replace(/\\'/g, "'"); return new It([...files.values()].filter(f => f.parent === this && f.name.includes(s))); }
  createFile(a, b, c) { return a instanceof Blob ? new File(a.name, a.data, a.mime, this) : new File(a, b, c, this); }
}
const root = new Folder('My Drive', null);
const pad = n => String(n).padStart(2, '0');
function jst(d) { const x = new Date(d.getTime() + 9 * 3600e3); return { y: x.getUTCFullYear(), M: x.getUTCMonth() + 1, d: x.getUTCDate(), H: x.getUTCHours(), m: x.getUTCMinutes(), s: x.getUTCSeconds() }; }
const sandbox = {
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k, v) => props.set(k, v), deleteProperty: k => props.delete(k) }) },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CalendarApp: { getCalendarById: () => ({ getEvents: () => [] }) },
  DriveApp: {
    getRootFolder: () => root,
    getFolderById: id => folders.get(id),
    getFileById: id => { if (!files.has(id)) throw new Error('no file ' + id); return files.get(id); },
  },
  Drive: { Files: {
    create: (res, blob) => { const f = new File(res.name, blob.data, res.mimeType, folders.get(res.parents[0])); return { id: f.id }; },
    update: (res, id) => { files.get(id).mime = res.mimeType; },
  } },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { const b = { timeBased: () => b, everyMinutes: () => b, atHour: () => b, nearMinute: () => b, everyDays: () => b, inTimezone: () => b, after: () => b, create: () => b }; return b; }, getOAuthToken: () => 'x', deleteTrigger() {} },
  Utilities: {
    formatDate: (d, tz, p) => { const t = jst(d); return p.replace("'T'", 'T').replace('yyyy', t.y).replace('yy', String(t.y).slice(2)).replace('MM', pad(t.M)).replace('dd', pad(t.d)).replace('HH', pad(t.H)).replace('mm', pad(t.m)).replace('ss', pad(t.s)); },
    getUuid: () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
    newBlob: (data, mime, name) => new Blob(data, mime, name),
    base64Decode: s => [...Buffer.from(s, 'base64')],
    unzip: () => [],
    sleep() {},
  },
};
const ctx = vm.createContext(sandbox);
const code = readdirSync(gasDir).filter(f => f.endsWith('.gs')).map(f => readFileSync(join(gasDir, f), 'utf8')).join('\n');
vm.runInContext(code + '\nthis.__api = { setup, apiSaveSettings, apiGetSetupState, tick, prepareDailyJob, apiGetDb, apiUpdateTask, apiSubmitMemo, loadDb_, PATHS, folder_, listFiles_, readText_, JOB_PREFIX, saveProjects_ };', ctx);
const G = ctx.__api;

/* ---------- シナリオ ---------- */
assert.equal(JSON.parse(G.apiGetSetupState()).ready, false, '初回は未設定');
const st = JSON.parse(G.apiSaveSettings({ name: '山田 太郎', emails: 'yamada@example.co.jp, t-yamada@example.co.jp', role: '', geminiKey: '' }));
assert.equal(st.ready, true, '保存で初期設定が完了する');
assert.equal(props.get('OWNER_EMAILS'), 'yamada@example.co.jp,t-yamada@example.co.jp');
assert.equal(props.get('OWNER_ROLE'), 'ゼネコン・工務店の施工管理担当');
G.saveProjects_([{ id: 'P-2026-001', name: '(仮称)桜台三丁目共同住宅新築工事', status: '進行中', phase: '躯体工事', client: '桜台ハウジング', location: '横浜市青葉区', aliases: ['桜台'], domains: ['sakuradai.example.jp'] }]);

const key = '20260925-091200_ab12cd34';
const attachDir = G.folder_(G.PATHS.INBOX_ATTACH);
attachDir.createFile(key + '__配筋検査指摘事項_3F.pdf', '%PDF-1.4 dummy', 'application/octet-stream');
attachDir.createFile(key + '__S-301.dwg', 'dwg', 'application/octet-stream');
attachDir.createFile(key + '__logo.png', 'x', 'image/png');
G.folder_(G.PATHS.INBOX_MAIL).createFile(key + '.json', JSON.stringify({
  schema: 'mail.v1', direction: 'in', id: 'AAMk1', conversationId: 'conv-1', receivedAt: '2026-09-25T00:12:00+00:00',
  from: 'yamaguchi@design.example.jp', to: 'yamada@example.co.jp', cc: '', subject: 'Re: 3F配筋検査の件', importance: 'high',
  bodyText: '山田様\n\n3F配筋検査の指摘を送ります。10/2までに是正報告をお願いします。\n\n差出人: 山田\n送信日時: 2026年9月24日\n\n> 前の本文',
  attachments: '[{"name":"配筋検査指摘事項_3F.pdf","isInline":false},{"name":"S-301.dwg","isInline":false},{"name":"logo.png","isInline":false}]', webLink: '',
}), 'application/json');

// 1回目の tick: ジョブが作られる
G.tick();
const jobs = G.listFiles_(G.folder_(G.PATHS.JOBS));
assert.equal(jobs.length, 1, 'ジョブが1件できる');
const jobText = jobs[0].getBlob().getDataAsString();
assert.match(jobs[0].getName(), /^秘書AI_JOB_待機_mail-/);
assert.match(jobText, /result_folder_id: d\d+/);
assert.match(jobText, /配筋検査指摘事項_3F\.pdf.*read_file_content（fileId: f\d+）/);
assert.match(jobText, /S-301\.dwg.*読み方: 不可（CAD/);
assert.match(jobText, /logo\.png.*不要/);
assert.doesNotMatch(jobText, /前の本文/, '引用部分は除かれる');
assert.equal(G.listFiles_(G.folder_(G.PATHS.INBOX_MAIL)).length, 0, 'メール JSON は _queued へ移る');
const pdf = [...files.values()].find(f => f.name.endsWith('配筋検査指摘事項_3F.pdf'));
assert.equal(pdf.mime, 'application/pdf', 'PDF の MIME が直る');

// Claude Code の代わり: 名前を処理済にし、結果 JSON を置く
const jobId = jobs[0].getName().replace(G.JOB_PREFIX.waiting, '');
jobs[0].setName(G.JOB_PREFIX.done + jobId);
const example = JSON.parse(readFileSync(join(here, '..', 'agent', 'examples', 'mail.json'), 'utf8'));
G.folder_(G.PATHS.RESULTS).createFile(jobId + '.result.json', JSON.stringify(example), 'application/json');

// 2回目の tick: 結果が反映される
G.tick();
const db = JSON.parse(G.apiGetDb());
assert.equal(db.mails.length, 1);
assert.equal(db.mails[0].projectId, 'P-2026-001');
assert.equal(db.mails[0].date.slice(0, 16), '2026-09-25T09:12', '受信日時が日本時間になる');
assert.equal(db.tasks.filter(t => t.status === 'proposed').length, 1, '提案タスク1件');
assert.equal(db.tasks.filter(t => t.status === 'waiting').length, 1, '相手待ち1件');
assert.equal(db.queue.pending, 0, 'キューが空になる');
const projDir = [...folders.values()].find(f => f.name.startsWith('P-2026-001_'));
const allNames = [...files.values()].filter(f => { let p = f.parent; while (p) { if (p === projDir) return true; p = p.parent; } return false; }).map(f => f.name).sort();
console.log('案件フォルダのファイル:', allNames);
assert.ok(allNames.includes('_タスク.md') && allNames.includes('_添付台帳.md'));
assert.ok(allNames.some(n => /^2026-09-25_3階スラブ配筋検査.*\.md$/.test(n)), 'スレッド md');
assert.ok(allNames.includes('2026-09-25_配筋検査指摘事項_3F.pdf'), '添付が案件フォルダへ');
assert.ok(!allNames.some(n => n.includes('logo.png')), '署名ロゴは案件フォルダに入れない');
const thread = [...files.values()].find(f => /^2026-09-25_3階スラブ配筋検査.*\.md$/.test(f.name)).getBlob().getDataAsString();
assert.match(thread, /- \[ \] 3階スラブ配筋検査の指摘3件を是正し.*📅 2026-10-01 ⏫ 🆔 t-/);

// タスク採用 → _タスク.md が書き換わる
const t = db.tasks.find(x => x.status === 'proposed');
G.apiUpdateTask(t.id, { status: 'todo' });
const tasksMd = [...files.values()].find(f => f.name === '_タスク.md' && f.parent === projDir).getBlob().getDataAsString();
assert.match(tasksMd, /## 未着手/);

// 日次ジョブ
G.prepareDailyJob();
const daily = G.listFiles_(G.folder_(G.PATHS.JOBS)).find(f => f.name.includes('daily-'));
assert.ok(daily, '日次ジョブができる');
assert.match(daily.getBlob().getDataAsString(), /### 案件 P-2026-001/);

// メモ投稿 → 記録ジョブがすぐできる
G.apiSubmitMemo({ type: '行政協議・検査', date: '2026-09-24', projectId: 'P-2026-001', title: '消防 事前協議', text: '誘導灯の位置について指摘あり' });
assert.ok(G.listFiles_(G.folder_(G.PATHS.JOBS)).some(f => f.name.includes('record-')), '記録ジョブができる');

console.log('ALL PIPELINE TESTS PASSED');
