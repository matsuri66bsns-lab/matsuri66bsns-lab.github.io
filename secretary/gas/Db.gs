/**
 * ダッシュボード用インデックス（_system/db.json）
 *
 * 知識の正本は各 .md。db.json は一覧表示・検索・タスク状態管理のためのインデックス。
 * タスクの状態（採用・完了など）だけは db.json が正本で、変更のたびに各案件の _タスク.md に書き出す。
 */

const DB_FILE = 'db.json';
let DB_CACHE_ = null;

function emptyDb_() {
  return {
    version: 1,
    updatedAt: '',
    projects: [],   // 案件マスタ.md の写し + 集計値
    threads: {},    // conversationId -> { projectId, fileId, title }
    mails: [],      // { id, conversationId, date, direction, from, subject, projectId, category, title, summary, keyPoints, attachments, fileId, webLink }
    records: [],    // { id, date, type, title, projectId, counterpart, summary, fileId, sourceFileId }
    tasks: [],      // { id, title, why, projectId, owner, status, priority, due, dueBasis, estimateMin, subtasks, source, createdAt, doneAt, confidence, suggestDone }
    decisions: [],  // { id, date, projectId, text, source }
    events: [],     // { id, title, start, end, place, projectId, source }
    noise: {},      // 送信者アドレス -> 件数（メルマガ判定されたもの）
    brief: null,    // { date, md, fileId }
    jobs: {},       // jobId -> { type, docId, createdAt, src }（解析キューに出しているジョブ）
    queue: { lastResultAt: '', applied: 0 },
    log: [],
  };
}

function loadDb_() {
  if (DB_CACHE_) return DB_CACHE_;
  const f = findFile_(folder_(PATHS.SYSTEM), DB_FILE);
  DB_CACHE_ = f ? Object.assign(emptyDb_(), JSON.parse(readText_(f))) : emptyDb_();
  return DB_CACHE_;
}

function saveDb_(db) {
  db.updatedAt = new Date().toISOString();
  if (db.log.length > 200) db.log = db.log.slice(-200);
  writeText_(folder_(PATHS.SYSTEM), DB_FILE, JSON.stringify(db), 'application/json');
  DB_CACHE_ = db;
}

/**
 * ロックを取って最新の db を読み直し、fn(db) で更新して保存する。
 * Drive の読み書きなど時間のかかる処理はロックの外で済ませ、反映だけをここで行う。
 */
function withDb_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    DB_CACHE_ = null;
    const db = loadDb_();
    const r = fn(db);
    flushPending_(db);
    saveDb_(db);
    return r;
  } finally {
    lock.releaseLock();
  }
}

/* ログはロック外で発生するため、いったん溜めて withDb_ 内で反映する */
const PENDING_ = { log: [] };

function logEvent_(level, msg) {
  PENDING_.log.push({ at: new Date().toISOString(), level: level, msg: String(msg).slice(0, 500) });
}

function flushPending_(db) {
  PENDING_.log.forEach(l => db.log.push(l));
  PENDING_.log = [];
}
