/**
 * Claude API 呼び出し（Apps Script には公式 SDK がないため HTTP で直接呼ぶ）
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * @param {Object} opt
 *   system   : string  固定の指示（プロンプトキャッシュ対象）
 *   context  : string  案件マスタなど、たまに変わる前提情報（キャッシュ対象）
 *   content  : Array   user メッセージの content ブロック
 *   schema   : Object  JSON Schema（指定時は構造化出力で JSON を返す）
 *   effort   : 'low'|'medium'|'high'
 * @return {Object|string} schema 指定時はパース済みオブジェクト、未指定時はテキスト
 */
function callClaude_(opt) {
  const key = prop_('ANTHROPIC_API_KEY', '');
  if (!key) throw new Error('スクリプトプロパティ ANTHROPIC_API_KEY が未設定です');
  const model = CONFIG.MODEL;

  const system = [{ type: 'text', text: opt.system }];
  if (opt.context) system.push({ type: 'text', text: opt.context });
  system[system.length - 1].cache_control = { type: 'ephemeral' };

  const body = {
    model: model,
    max_tokens: opt.maxTokens || CONFIG.MAX_TOKENS,
    system: system,
    messages: [{ role: 'user', content: opt.content }],
    output_config: { effort: opt.effort || 'medium' },
  };
  if (opt.schema) body.output_config.format = { type: 'json_schema', schema: opt.schema };

  const headers = {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  };
  // 安全分類器による辞退時に推奨モデルでサーバー側再実行（Opus / Fable 系のみ）
  if (/^claude-(opus|fable)/.test(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }

  const payload = JSON.stringify(body);
  let res, code, lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = UrlFetchApp.fetch(ANTHROPIC_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: headers,
        payload: payload,
        muteHttpExceptions: true,
      });
      code = res.getResponseCode();
      if (code === 200) break;
      lastErr = 'HTTP ' + code + ': ' + res.getContentText().slice(0, 500);
      // 429 / 5xx / 529 のみ再試行。400 系は入力の問題なので即失敗
      if (code !== 429 && code < 500) throw new Error(lastErr);
    } catch (e) {
      lastErr = e;
      if (String(e).indexOf('HTTP 4') >= 0) throw e;
    }
    Utilities.sleep(Math.pow(2, attempt + 1) * 1000);
  }
  if (code !== 200) throw new Error('Claude API 呼び出し失敗: ' + lastErr);

  const json = JSON.parse(res.getContentText());
  addUsage_(json.model || model, json.usage);

  if (json.stop_reason === 'refusal') {
    throw new Error('Claude が処理を辞退しました: ' + JSON.stringify(json.stop_details || {}));
  }
  if (json.stop_reason === 'max_tokens') {
    throw new Error('出力が max_tokens に達しました。CONFIG.MAX_TOKENS を増やしてください');
  }
  const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return opt.schema ? JSON.parse(text) : text;
}

/* ---------------- JSON Schema ヘルパー ----------------
 * 構造化出力では全オブジェクトに additionalProperties:false が必要。
 * 「値なし」は空文字 "" / 空配列で表現する（null を使わない）。 */

function S_str(desc) { return { type: 'string', description: desc }; }
function S_bool(desc) { return { type: 'boolean', description: desc }; }
function S_int(desc) { return { type: 'integer', description: desc }; }
function S_enum(values, desc) { return { type: 'string', enum: values, description: desc }; }
function S_arr(items, desc) { return { type: 'array', items: items, description: desc }; }
function S_obj(props, desc) {
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false, description: desc };
}

/** メール・記録で共通のタスク定義 */
function taskSchema_() {
  return S_obj({
    title: S_str('動詞で終わる具体的なタスク名（例: 確認申請の指摘事項3件への回答書を作成し提出する）'),
    why: S_str('このタスクが必要な理由・依頼元・根拠となる本文の要約（1〜2文）'),
    priority: S_enum(['high', 'mid', 'low'], '優先度'),
    due: S_str('期日 YYYY-MM-DD。不明なら推定して入れる'),
    due_basis: S_str('期日の根拠。例: 「本文に10/3(金)までと明記」「至急の依頼→翌営業日」「既定: 返信は2営業日以内」'),
    estimate_min: S_int('全体の想定作業時間（分）'),
    confidence: S_enum(['high', 'mid', 'low'], 'あなたがやるべきタスクだという確からしさ'),
    subtasks: S_arr(S_obj({
      title: S_str('サブタスク（1つ30分〜2時間程度の粒度）'),
      due: S_str('YYYY-MM-DD。最終期日から逆算'),
      estimate_min: S_int('想定作業時間（分）'),
    }), '2〜6個に分解。順番どおりに並べる'),
  });
}

function waitingSchema_() {
  return S_arr(S_obj({
    who: S_str('ボールを持っている相手（会社名・氏名）'),
    what: S_str('相手から返ってくるべきもの'),
    due: S_str('回答期限 YYYY-MM-DD（不明なら ""）'),
  }), '相手待ち（こちらが依頼して返答を待っている事項）');
}

function eventSchema_() {
  return S_arr(S_obj({
    title: S_str('予定名'),
    start: S_str('開始 YYYY-MM-DDTHH:mm（時刻不明なら YYYY-MM-DD）'),
    end: S_str('終了（不明なら ""）'),
    place: S_str('場所・会議URL（不明なら ""）'),
  }), '日程が確定または提案されている予定・会議・検査・締切イベント');
}
