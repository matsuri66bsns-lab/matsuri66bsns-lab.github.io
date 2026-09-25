/**
 * 秘書AI — 設定
 *
 * 解析はクラウドの Claude Code（定期実行ルーチン）が行う。Apps Script の役割は
 *   1. 投入口のメール・記録から「解析ジョブ」（Google ドキュメント）を作る
 *   2. Claude Code が書いた「結果 JSON」を読み、.md・db.json に反映する
 *   3. 音声の文字起こし（Gemini）とダッシュボード
 *
 * 秘密情報はコードに書かず「プロジェクトの設定 > スクリプト プロパティ」に登録する。
 *   OWNER_NAME     : 必須。あなたの氏名（宛名判定に使う）
 *   OWNER_EMAILS   : 必須。あなたのアドレス（カンマ区切り。エイリアスも含める）
 *   OWNER_ROLE     : 任意。立場（既定: ゼネコン・工務店の施工管理担当）
 *   GEMINI_API_KEY : 任意。音声の自動文字起こしに使う（未設定なら音声は文字起こし待ちになる）
 *   ROOT_FOLDER_ID : setup() が自動で書き込む
 */
const CONFIG = {
  ROOT_FOLDER_NAME: '秘書AI',
  DEFAULT_ROLE: 'ゼネコン・工務店の施工管理担当',

  // true にすると「確度: 高」のタスクは提案を経ずに未着手タスクとして登録する
  AUTO_ACCEPT_HIGH_CONFIDENCE: false,

  // 実行制御（Apps Script は1回6分まで）
  TIME_BUDGET_MS: 4.5 * 60 * 1000,
  MAX_ITEMS_PER_RUN: 15,
  MAX_RETRY: 3,
  // 結果が返ってこないジョブを作り直すまでの時間
  JOB_STALE_HOURS: 24,

  // 添付
  MIN_IMAGE_BYTES: 15 * 1024,   // これ未満の画像は署名ロゴ等とみなしスキップ
  MAX_SHEET_ROWS: 400,
  MAX_TEXT_CHARS: 40000,        // ジョブに直接書き込む本文・テキストの上限

  // 音声文字起こし（Gemini API）。モデル名は利用時点の最新 Flash 系に更新すること
  GEMINI_MODEL: 'gemini-2.5-flash',

  // 日本の祝日カレンダー（Google 公開カレンダー）
  HOLIDAY_CALENDAR_ID: 'ja.japanese#holiday@group.v.calendar.google.com',

  // 分類（施工管理向け）
  CATEGORIES: ['発注者対応', '設計・監理者対応', '行政・官公庁', '協力会社・発注', '工程・現場調整', '安全・品質', '近隣対応', '見積・契約・出来高', '社内', '情報共有', 'その他'],
  PHASES: ['見積・受注', '着工準備', '仮設・土工事', '躯体工事', '仕上・設備工事', '外構工事', '検査・竣工', '引渡し・アフター', '該当なし'],
  RECORD_TYPES: ['発注者打合せ', '設計定例', '行政協議・検査', '工程会議・職長会', '現場確認・検査', '近隣説明', '社内会議', '電話メモ', 'その他'],
  GENERAL_FOLDERS: { '社内': '社内', '見積・契約・出来高': '見積・契約', '情報共有': '情報共有', 'その他': 'その他' },
};

const PATHS = {
  INBOX_MAIL: '00_inbox/mail',
  INBOX_ATTACH: '00_inbox/attachments',
  INBOX_RECORDS: '00_inbox/records',
  INBOX_BOOTSTRAP: '00_inbox/bootstrap',
  QUEUED: '00_inbox/_queued',
  PROCESSED: '00_inbox/_processed',
  ERROR: '00_inbox/_error',
  JOBS: '01_解析キュー/jobs',
  RESULTS: '01_解析キュー/results',
  QUEUE_DONE: '01_解析キュー/_done',
  PROJECTS: '10_案件',
  GENERAL: '20_一般',
  BRIEFS: '30_日次ブリーフ',
  SYSTEM: '_system',
};

function prop_(key, def) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? def : v;
}

function owner_() {
  return {
    name: prop_('OWNER_NAME', ''),
    emails: prop_('OWNER_EMAILS', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    role: prop_('OWNER_ROLE', CONFIG.DEFAULT_ROLE),
  };
}
