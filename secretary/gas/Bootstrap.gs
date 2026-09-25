/**
 * 初期分析：過去メールから「案件の切り方」と分類を提案する
 *
 * 1. Power Automate の「過去メール書き出し」フローで 00_inbox/bootstrap に日別 JSON を作る
 *    （1ファイル = JSON 配列。要素は {receivedAt, direction, from, to, subject, preview, conversationId}）
 * 2. bootstrapTaxonomy() を実行。時間切れになると1分後に自動で続きから再開する
 * 3. _system/分類提案.md を読み、ダッシュボードで「提案」状態の案件を承認・修正する
 */

const BOOT_CHUNK_LINES = 700;

function bootstrapChunkSchema_() {
  return S_obj({
    projects: S_arr(S_obj({
      name: S_str('案件名（物件名＋業務内容）'),
      aliases: S_arr(S_str(''), '件名に現れる表記ゆれ・略称・工事番号'),
      client: S_str('施主・発注者（推定可）'),
      location: S_str('所在地（分かれば）'),
      domains: S_arr(S_str(''), '関係者のメールドメイン'),
      mail_count: S_int('該当メール数'),
      first_date: S_str('最初の日付'),
      last_date: S_str('最後の日付'),
      main_categories: S_arr(S_enum(CONFIG.CATEGORIES, ''), '主な種別'),
      phase_guess: S_str('現在のフェーズの推定'),
    }), '案件（特定の物件・工事・設計業務）ごとのまとまり'),
    general_topics: S_arr(S_obj({ topic: S_str('話題'), mail_count: S_int('件数'), examples: S_arr(S_str(''), '件名の例') }), '案件に属さない話題'),
    noise_senders: S_arr(S_obj({ sender: S_str('アドレスまたはドメイン'), reason: S_str('理由'), count: S_int('件数') }), 'メルマガ・広告と思われる送信者'),
  });
}

function bootstrapMergeSchema_() {
  return S_obj({
    projects: bootstrapChunkSchema_().properties.projects,
    category_suggestions: S_arr(S_obj({
      category: S_str('種別名'), action: S_enum(['keep', 'add', 'remove', 'rename'], '提案'), reason: S_str('理由'),
    }), '既定の種別に対する見直し提案'),
    noise_senders: bootstrapChunkSchema_().properties.noise_senders,
    report_md: S_str('分類提案レポート（Markdown）'),
  });
}

function bootstrapTaxonomy() {
  const props = PropertiesService.getScriptProperties();
  const deadline = Date.now() + CONFIG.TIME_BUDGET_MS;
  const sys = folder_(PATHS.SYSTEM);
  // 自動再開用の一回限りトリガーが残っていれば消す
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'bootstrapTaxonomy').forEach(t => ScriptApp.deleteTrigger(t));

  // 過去メールを1行ずつの要約に
  const lines = [];
  listFiles_(folder_(PATHS.INBOX_BOOTSTRAP)).filter(f => /\.json$/i.test(f.getName())).forEach(f => {
    let arr = JSON.parse(readText_(f));
    if (!Array.isArray(arr)) arr = arr.value || arr.body || [];
    arr.forEach(m => lines.push([
      String(isoJst_(m.receivedAt)).slice(0, 10), m.direction === 'out' ? '送' : '受',
      fromText_(m.from).slice(0, 60), String(m.to || '').slice(0, 80), String(m.subject || '').slice(0, 80),
      String(m.preview || '').replace(/\s+/g, ' ').slice(0, 100),
    ].join(' | ')));
  });
  lines.sort();
  if (!lines.length) throw new Error('00_inbox/bootstrap に過去メールの JSON がありません');

  const chunks = [];
  for (let i = 0; i < lines.length; i += BOOT_CHUNK_LINES) chunks.push(lines.slice(i, i + BOOT_CHUNK_LINES));
  const partialFile = findFile_(sys, '_bootstrap_partial.json');
  const partials = partialFile ? JSON.parse(readText_(partialFile)) : [];
  const o = owner_();
  const system = [
    'あなたは' + (o.role || '建築・不動産分野の実務担当者') + 'である' + (o.name || '利用者') + 'さんの業務秘書です。',
    '過去メールの一覧（日付 | 受/送 | 差出人 | 宛先 | 件名 | 冒頭）から、業務の「案件」のまとまりを見つけます。',
    '案件 = 特定の物件・工事・設計業務など、始まりと終わりがある仕事の単位。同じ物件でも業務が別契約（例: 新築設計と別棟の改修）なら分ける。',
    '件名の表記ゆれ（略称・工事番号・施主名だけの件名）を aliases にまとめ、振り分けの手がかりにする。',
    '一斉配信（メルマガ・広告・セミナー案内）は noise_senders に挙げる。',
  ].join('\n');

  for (let i = partials.length; i < chunks.length; i++) {
    if (Date.now() > deadline - 120 * 1000) {
      writeText_(sys, '_bootstrap_partial.json', JSON.stringify(partials), 'application/json');
      ScriptApp.newTrigger('bootstrapTaxonomy').timeBased().after(60 * 1000).create();
      console.log('時間切れのため ' + i + '/' + chunks.length + ' で中断。1分後に自動再開します');
      return;
    }
    partials.push(callClaude_({
      system: system, effort: CONFIG.EFFORT_BOOTSTRAP, schema: bootstrapChunkSchema_(),
      content: [{ type: 'text', text: '## 過去メール（' + (i + 1) + '/' + chunks.length + '）\n' + chunks[i].join('\n') }],
    }));
    writeText_(sys, '_bootstrap_partial.json', JSON.stringify(partials), 'application/json');
  }

  const merged = callClaude_({
    system: system + '\n\n複数の区間ごとの分析結果を統合し、最終的な案件一覧・種別の見直し・レポートを作ります。',
    effort: CONFIG.EFFORT_BOOTSTRAP, schema: bootstrapMergeSchema_(),
    content: [{
      type: 'text', text: [
        '## 既定の種別', CONFIG.CATEGORIES.join(' / '),
        '## 区間ごとの分析結果', JSON.stringify(partials),
        '## 対象期間・件数', lines[0].slice(0, 10) + '〜' + lines[lines.length - 1].slice(0, 10) + ' / ' + lines.length + '通',
        '',
        '同じ案件を統合し（最終日付の新しい順）、report_md には次を書いてください:',
        '1. 期間・件数の概況と、案件メール/案件外メール/配信メールのおおよその比率',
        '2. 案件一覧（表: 案件名 / 件数 / 期間 / 主な種別 / 推定フェーズ）',
        '3. 種別（カテゴリ）の見直し提案と理由',
        '4. 記録の粒度についての所見（スレッドの長さ、1案件あたりの月間通数などから、スレッド単位の記録で十分か、案件を工区・業務で分けるべきか）',
        '5. 除外すべき配信元',
      ].join('\n'),
    }],
  });

  const date = today_();
  writeText_(sys, '分類提案.md', '# 分類提案（' + date + '）\n\n' + merged.report_md + '\n');
  writeText_(sys, '除外候補.md', '# 除外候補（Power Automate の除外リストに追加を検討）\n\n' +
    merged.noise_senders.map(n => '- ' + n.sender + '（' + n.count + '件）' + n.reason).join('\n') + '\n');
  merged.projects.forEach(p => proposeProject_(p.name, { client: p.client, location: p.location, phase: p.phase_guess, aliases: p.aliases, domains: p.domains }));
  const pf = findFile_(sys, '_bootstrap_partial.json');
  if (pf) pf.setTrashed(true);
  withDb_(db => syncProjectsToDb_(db));
  console.log('分類提案を _system/分類提案.md に書き出しました');
}
