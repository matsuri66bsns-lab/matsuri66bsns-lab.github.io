/**
 * 結果 JSON の形式（Claude Code が書き、Apps Script が読む）
 *
 * secretary/agent/schemas.json はこのファイルから生成する（node secretary/agent/build-schemas.mjs）。
 * Claude Code 側は結果をアップロードする前に secretary/agent/validate.mjs で検証する。
 * 「値なし」は空文字 "" / 空配列で表す（null は使わない）。
 */

function S_str(desc) { return { type: 'string', description: desc }; }
function S_date(desc) { return { type: 'string', format: 'date-or-empty', description: desc }; }
function S_bool(desc) { return { type: 'boolean', description: desc }; }
function S_int(desc) { return { type: 'integer', description: desc }; }
function S_enum(values, desc) { return { type: 'string', enum: values, description: desc }; }
function S_arr(items, desc) { return { type: 'array', items: items, description: desc }; }
function S_obj(props, desc) {
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false, description: desc };
}

function taskSchema_() {
  return S_obj({
    title: S_str('動詞で終わる具体的なタスク名（例: 3階スラブ配筋検査の是正3件を是正し、写真を添えて監理者へ報告する）'),
    why: S_str('必要な理由・依頼元・根拠となる本文の要約（1〜2文）'),
    priority: S_enum(['high', 'mid', 'low'], '優先度'),
    due: S_date('期日 YYYY-MM-DD'),
    due_basis: S_str('期日の根拠。例:「本文に10/3(金)までと明記」「至急→翌営業日」「既定: 回答は2営業日以内」'),
    estimate_min: S_int('全体の想定作業時間（分）'),
    confidence: S_enum(['high', 'mid', 'low'], '本人がやるべきタスクだという確からしさ'),
    subtasks: S_arr(S_obj({
      title: S_str('サブタスク（1つ30分〜2時間程度）'),
      due: S_date('YYYY-MM-DD。最終期日から逆算'),
      estimate_min: S_int('想定作業時間（分）'),
    }), '2〜6個に分解。実行順'),
  });
}

function waitingSchema_() {
  return S_arr(S_obj({
    who: S_str('ボールを持っている相手（会社名・氏名）'),
    what: S_str('相手から返ってくるべきもの'),
    due: S_date('回答期限 YYYY-MM-DD（不明なら ""）'),
  }), '相手待ち（本人側が依頼し、返答・提出を待っている事項）');
}

function eventSchema_() {
  return S_arr(S_obj({
    title: S_str('予定名（検査・打合せ・搬入・作業など）'),
    start: S_str('開始 YYYY-MM-DDTHH:mm（時刻不明なら YYYY-MM-DD）'),
    end: S_str('終了（不明なら ""）'),
    place: S_str('場所・会議URL（不明なら ""）'),
  }), '日程が確定または提案されている予定');
}

function newProjectSchema_() {
  return S_obj({
    name: S_str('新規案件名（project_id が NEW 以外は ""）。工事名の形で（例: (仮称)桜台三丁目共同住宅新築工事）'),
    client: S_str('発注者'),
    location: S_str('工事場所'),
    phase: S_str('フェーズ'),
    aliases: S_arr(S_str(''), '略称・工事番号・表記ゆれ'),
  });
}

function mailSchema_() {
  return S_obj({
    is_noise: S_bool('メルマガ・広告等の一斉配信なら true'),
    noise_reason: S_str('is_noise の判断理由（短く）'),
    project_id: S_str('案件ID、または "NEW" / "GENERAL"'),
    project_confidence: S_enum(['high', 'mid', 'low'], '案件判定の確からしさ'),
    new_project: newProjectSchema_(),
    category: S_enum(CONFIG.CATEGORIES, '主な種別'),
    phase: S_enum(CONFIG.PHASES, 'このメールが属する工事フェーズ'),
    title: S_str('記録用タイトル（40字以内。件名より内容が分かる表現に）'),
    summary: S_str('要約（2〜5文）'),
    key_points: S_arr(S_str(''), '要点（数値・日付・条件・数量を含む）'),
    decisions: S_arr(S_str(''), 'このメールで決定・合意・承認された事項'),
    open_issues: S_arr(S_str(''), '未解決の懸案・論点'),
    reply_needed: S_bool('本人が返信すべきか'),
    my_tasks: S_arr(taskSchema_(), '本人がやるべきタスク'),
    waiting_on_others: waitingSchema_(),
    completed_task_ids: S_arr(S_str(''), '完了したと判断できる進行中タスクのID'),
    events: eventSchema_(),
    attachments: S_arr(S_obj({
      name: S_str('ファイル名（ジョブに記載されたとおり）'),
      doc_type: S_enum(['図面・施工図', '質疑・回答書', '行政文書', '見積書', '注文書・契約書', '請求・出来高', '議事録', '工程表', '安全書類', '検査・品質記録', '仕様書・資料', '写真', 'その他'], '種類'),
      summary: S_str('内容の要約（1〜3文）'),
      drawing_no: S_str('図番（なければ ""）'),
      revision: S_str('版・改訂記号・日付（なければ ""）'),
      key_values: S_arr(S_obj({ label: S_str('項目'), value: S_str('値') }), '金額・数量・期限などの重要値'),
    }), '添付ごとの解析結果'),
    people: S_arr(S_obj({
      name: S_str('氏名'), org: S_str('所属'), role: S_str('役割・立場'), email: S_str('メール'),
    }), '登場した関係者'),
  });
}

function recordSchema_() {
  return S_obj({
    project_id: S_str('案件ID、または "NEW" / "GENERAL"'),
    new_project: newProjectSchema_(),
    record_type: S_enum(CONFIG.RECORD_TYPES, '記録の種別'),
    title: S_str('議事録タイトル（例: 消防署 中間検査前協議（避難器具・誘導灯））'),
    date: S_date('実施日 YYYY-MM-DD（不明なら ""）'),
    time: S_str('時刻 HH:mm〜HH:mm（不明なら ""）'),
    place: S_str('場所'),
    counterpart: S_str('相手先（機関・部署、発注者、監理者、協力会社など）'),
    attendees: S_arr(S_obj({ name: S_str('氏名'), org: S_str('所属') }), '出席者'),
    purpose: S_str('目的'),
    summary: S_str('概要（3〜6文）'),
    qa: S_arr(S_obj({
      topic: S_str('論点'),
      point: S_str('相手の指摘・質問・要望'),
      response: S_str('こちらの回答・協議結果'),
      basis: S_str('根拠（法令・条例・仕様書・図面・基準）や温度感'),
      status: S_enum(['解決', '要対応', '継続協議', '参考'], '状態'),
    }), '協議事項・指摘事項'),
    decisions: S_arr(S_str(''), '決定・合意事項'),
    open_issues: S_arr(S_str(''), '未解決・継続協議の事項'),
    my_tasks: S_arr(taskSchema_(), '本人のタスク'),
    waiting_on_others: waitingSchema_(),
    next_meeting: S_obj({ date: S_str('次回日時（不明なら ""）'), agenda: S_str('次回の議題') }),
    events: eventSchema_(),
    notes: S_str('聞き取れなかった点・要確認事項'),
  });
}

function dailySchema_() {
  return S_obj({
    overviews: S_arr(S_obj({
      project_id: S_str('案件ID'),
      markdown: S_str('案件カルテ本文（Markdown）'),
    }), 'ジョブに含まれる案件ごとのカルテ'),
    brief_markdown: S_str('今日の段取り（Markdown）'),
  });
}

function bootstrapProjectSchema_() {
  return S_arr(S_obj({
    name: S_str('案件名（工事名）'),
    aliases: S_arr(S_str(''), '件名に現れる略称・工事番号・表記ゆれ'),
    client: S_str('発注者（推定可）'),
    location: S_str('工事場所（分かれば）'),
    domains: S_arr(S_str(''), '関係者のメールドメイン'),
    mail_count: S_int('該当メール数'),
    first_date: S_str('最初の日付'),
    last_date: S_str('最後の日付'),
    main_categories: S_arr(S_enum(CONFIG.CATEGORIES, ''), '主な種別'),
    phase_guess: S_str('現在のフェーズの推定'),
  }), '案件（特定の工事）ごとのまとまり');
}

function bootstrapChunkSchema_() {
  return S_obj({
    projects: bootstrapProjectSchema_(),
    general_topics: S_arr(S_obj({ topic: S_str('話題'), mail_count: S_int('件数'), examples: S_arr(S_str(''), '件名の例') }), '案件に属さない話題'),
    noise_senders: S_arr(S_obj({ sender: S_str('アドレスまたはドメイン'), reason: S_str('理由'), count: S_int('件数') }), 'メルマガ・広告と思われる送信者'),
  });
}

function bootstrapMergeSchema_() {
  return S_obj({
    projects: bootstrapProjectSchema_(),
    category_suggestions: S_arr(S_obj({
      category: S_str('種別名'), action: S_enum(['keep', 'add', 'remove', 'rename'], '提案'), reason: S_str('理由'),
    }), '既定の種別に対する見直し提案'),
    noise_senders: bootstrapChunkSchema_().properties.noise_senders,
    report_md: S_str('分類提案レポート（Markdown）'),
  });
}

/** 処理できなかったジョブの結果 */
function errorSchema_() {
  return S_obj({ error: S_str('処理できなかった理由') });
}

function allSchemas_() {
  return {
    mail: mailSchema_(),
    record: recordSchema_(),
    daily: dailySchema_(),
    bootstrap_chunk: bootstrapChunkSchema_(),
    bootstrap_merge: bootstrapMergeSchema_(),
    error: errorSchema_(),
  };
}
