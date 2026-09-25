/**
 * 秘書AI — 設定
 *
 * 秘密情報（APIキー等）はコードに書かず「プロジェクトの設定 > スクリプト プロパティ」に登録する。
 *   ANTHROPIC_API_KEY : 必須。Claude API のキー
 *   OWNER_NAME        : 必須。あなたの氏名（例: 山田 太郎）。宛名判定に使う
 *   OWNER_EMAILS      : 必須。あなたのアドレス（カンマ区切り。エイリアスも含める）
 *   OWNER_ROLE        : 任意。職種・立場（例: 設計事務所の意匠設計担当・PM）
 *   GEMINI_API_KEY    : 任意。音声の自動文字起こしに使う（未設定なら音声は「文字起こし待ち」になる）
 *   ROOT_FOLDER_ID    : setup() が自動で書き込む
 */
const CONFIG = {
  ROOT_FOLDER_NAME: '秘書AI',

  // Claude API
  MODEL: 'claude-opus-5',          // コスト重視なら 'claude-sonnet-5' に変更可（提案書のコスト試算参照）
  EFFORT_MAIL: 'medium',           // メール1通の解析。精度を上げたい場合は 'high'
  EFFORT_RECORD: 'high',           // 打合せ記録の構造化（情報量が多いので高め）
  EFFORT_DAILY: 'medium',          // 案件カルテ・日次ブリーフ
  EFFORT_BOOTSTRAP: 'high',        // 過去メールからの分類提案
  MAX_TOKENS: 16000,

  // true にすると「確度: 高」のタスクは提案を経ずに未着手タスクとして登録する
  AUTO_ACCEPT_HIGH_CONFIDENCE: false,

  // 実行制御（Apps Script は1回6分まで）
  TIME_BUDGET_MS: 4.5 * 60 * 1000,
  MAX_ITEMS_PER_RUN: 8,
  MAX_RETRY: 3,

  // 添付
  MAX_PDF_BYTES: 15 * 1024 * 1024,         // 1ファイル上限（超えるとメタ情報のみ）
  MAX_TOTAL_BINARY_BYTES: 22 * 1024 * 1024, // 1リクエストの合計上限（API上限32MBに対しbase64膨張を考慮）
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
  MIN_IMAGE_BYTES: 15 * 1024,               // これ未満の画像は署名ロゴ等とみなしスキップ
  MAX_SHEET_ROWS: 400,
  MAX_TEXT_CHARS: 60000,

  // 音声文字起こし（Gemini API）。モデル名は執筆時点で使える最新の Flash 系に更新すること
  GEMINI_MODEL: 'gemini-2.5-flash',
  MAX_AUDIO_BYTES: 19 * 1024 * 1024,

  // 日本の祝日カレンダー（Google 公開カレンダー）
  HOLIDAY_CALENDAR_ID: 'ja.japanese#holiday@group.v.calendar.google.com',

  // コスト表示用の単価（USD / 100万トークン）。料金改定時は更新する
  PRICING: {
    'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
    'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2 },
  },

  // 分類
  CATEGORIES: ['行政協議', '施主対応', '設計調整', '工事・現場', '見積・契約', '工程調整', '社内', '経理・請求', '情報共有', 'その他'],
  PHASES: ['企画', '基本設計', '実施設計', '確認申請', '施工', '竣工・引渡', 'アフター', '該当なし'],
  RECORD_TYPES: ['行政協議', '施主打合せ', '設計定例', '現場確認', '社内会議', '電話メモ', 'その他'],
  GENERAL_FOLDERS: { '社内': '社内', '経理・請求': '経理', '情報共有': '情報共有', 'その他': 'その他' },
};

const PATHS = {
  INBOX_MAIL: '00_inbox/mail',
  INBOX_ATTACH: '00_inbox/attachments',
  INBOX_RECORDS: '00_inbox/records',
  INBOX_BOOTSTRAP: '00_inbox/bootstrap',
  PROCESSED: '00_inbox/_processed',
  ERROR: '00_inbox/_error',
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
    role: prop_('OWNER_ROLE', ''),
  };
}
