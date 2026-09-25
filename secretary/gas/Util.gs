/**
 * 共通ユーティリティ（日付・営業日・Drive 操作・ID）
 */

const TZ = 'Asia/Tokyo';

function fmt_(date, pattern) {
  return Utilities.formatDate(date, TZ, pattern || 'yyyy-MM-dd');
}

function today_() {
  return fmt_(new Date());
}

/** 2026-09-25(金) 形式 */
function ymdJa_(date) {
  return fmt_(date) + '(' + '日月火水木金土'.charAt(date.getDay()) + ')';
}

/** 任意の ISO 日時を日本時間の 'yyyy-MM-ddTHH:mm:ss+09:00' にそろえる */
function isoJst_(s) {
  const d = s ? new Date(s) : new Date();
  if (isNaN(d.getTime())) return String(s || '');
  return fmt_(d, "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
}

function parseYmd_(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const p = s.slice(0, 10).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
}

function addDays_(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function newId_(prefix) {
  return prefix + '-' + fmt_(new Date(), 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 6);
}

/** ファイル名に使えない文字を除去して短くする */
function safeName_(s, max) {
  const t = String(s || '無題')
    .replace(/^(re|fw|fwd|返信|転送)\s*[:：]\s*/ig, '')
    .replace(/[\\/:*?"<>|#\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (t || '無題').slice(0, max || 60);
}

/* ---------------- 営業日（土日・祝日） ---------------- */

/** 今日から先90日の祝日を { 'yyyy-MM-dd': '祝日名' } で返す（1日キャッシュ） */
function holidays_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('holidays');
  if (hit) return JSON.parse(hit);
  const map = {};
  try {
    const cal = CalendarApp.getCalendarById(CONFIG.HOLIDAY_CALENDAR_ID);
    const from = addDays_(new Date(), -7);
    const to = addDays_(new Date(), 120);
    cal.getEvents(from, to).forEach(e => { map[fmt_(e.getStartTime())] = e.getTitle(); });
  } catch (err) {
    console.warn('祝日カレンダーを取得できませんでした: ' + err);
  }
  cache.put('holidays', JSON.stringify(map), 21600);
  return map;
}

function isBusinessDay_(date) {
  const w = date.getDay();
  if (w === 0 || w === 6) return false;
  return !holidays_()[fmt_(date)];
}

/** 期日が休日なら直前の営業日へ前倒し */
function toBusinessDayBefore_(ymd) {
  let d = parseYmd_(ymd);
  if (!d) return ymd;
  for (let i = 0; i < 10 && !isBusinessDay_(d); i++) d = addDays_(d, -1);
  return fmt_(d);
}

/** プロンプトに渡す「今日から3週間の営業日カレンダー」 */
function calendarContext_() {
  const hol = holidays_();
  const lines = [];
  const w = ['日', '月', '火', '水', '木', '金', '土'];
  for (let i = 0; i < 21; i++) {
    const d = addDays_(new Date(), i);
    const ymd = fmt_(d);
    const tag = hol[ymd] ? '祝:' + hol[ymd] : (d.getDay() === 0 || d.getDay() === 6 ? '休' : '営業日');
    lines.push(ymd + '(' + w[d.getDay()] + ') ' + tag);
  }
  return lines.join('\n');
}

/* ---------------- Drive ---------------- */

function root_() {
  const id = prop_('ROOT_FOLDER_ID', '');
  if (!id) throw new Error('ROOT_FOLDER_ID が未設定です。setup() を先に実行してください。');
  return DriveApp.getFolderById(id);
}

/** '10_案件/P-001_xxx/メール' のようなパスのフォルダを取得（なければ作成） */
function folder_(path) {
  let f = root_();
  String(path).split('/').filter(Boolean).forEach(name => {
    const it = f.getFoldersByName(name);
    f = it.hasNext() ? it.next() : f.createFolder(name);
  });
  return f;
}

function findFile_(folder, name) {
  const it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function readText_(file) {
  return file.getBlob().getDataAsString('UTF-8');
}

/** 同名ファイルがあれば上書き、なければ作成。File を返す */
function writeText_(folder, name, text, mime) {
  const f = findFile_(folder, name);
  if (f) {
    f.setContent(text);
    return f;
  }
  return folder.createFile(name, text, mime || 'text/markdown');
}

function appendText_(folder, name, text, header) {
  const f = findFile_(folder, name);
  if (f) {
    f.setContent(readText_(f) + text);
    return f;
  }
  return folder.createFile(name, (header || '') + text, 'text/markdown');
}

/** フォルダ内のファイルを名前順で返す */
function listFiles_(folder) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) out.push(it.next());
  return out.sort((a, b) => a.getName() < b.getName() ? -1 : 1);
}

/** 処理済みフォルダへ月別に移動 */
function archive_(file, sub) {
  file.moveTo(folder_(PATHS.PROCESSED + '/' + sub + '/' + fmt_(new Date(), 'yyyy-MM')));
}

function driveUrl_(fileId) {
  return 'https://drive.google.com/file/d/' + fileId + '/view';
}

/** 再試行回数を数え、上限を超えたら _error へ退避 */
function recordFailure_(file, err) {
  const key = 'retry_' + file.getId();
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty(key) || 0) + 1;
  console.error(file.getName() + ' の処理に失敗 (' + n + '回目): ' + (err && err.stack || err));
  if (n >= CONFIG.MAX_RETRY) {
    file.moveTo(folder_(PATHS.ERROR));
    props.deleteProperty(key);
    logEvent_('error', file.getName() + ' を _error に移動: ' + err);
  } else {
    props.setProperty(key, String(n));
  }
}

/** YAML フロントマター（値は1行文字列 or 配列） */
function frontmatter_(obj) {
  const lines = ['---'];
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) lines.push(k + ': [' + v.map(x => JSON.stringify(String(x))).join(', ') + ']');
    else lines.push(k + ': ' + JSON.stringify(String(v)));
  });
  lines.push('---', '');
  return lines.join('\n');
}
