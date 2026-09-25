/**
 * 初期分析：過去メールから「案件の切り方」と分類を提案する
 *
 * 1. Power Automate の「過去メール書き出し」フローで 00_inbox/bootstrap に日別 JSON を作る
 *    （1ファイル = JSON 配列。要素は {receivedAt, direction, from, to, subject, preview, conversationId}）
 * 2. bootstrapPrepare() を手動で実行 → 700通ずつの解析ジョブ（bootstrap_chunk）ができる
 * 3. Claude Code が各ジョブを処理 → 全部そろうと統合ジョブ（bootstrap_merge）が自動で作られる
 * 4. 統合結果が _system/分類提案.md と、ダッシュボードの「新しい案件の候補」に出る
 */

const BOOT_CHUNK_LINES = 700;
const BOOT_PARTIAL_FILE = '_bootstrap_partial.json';

function bootstrapPrepare() {
  const lines = [];
  listFiles_(folder_(PATHS.INBOX_BOOTSTRAP)).filter(f => /\.json$/i.test(f.getName())).forEach(f => {
    let arr = JSON.parse(readText_(f));
    if (!Array.isArray(arr)) arr = arr.value || arr.body || [];
    arr.forEach(m => lines.push([
      String(isoJst_(m.receivedAt)).slice(0, 10), m.direction === 'out' ? '送' : '受',
      fromText_(m.from).slice(0, 50), String(m.to || '').slice(0, 60), String(m.subject || '').slice(0, 70),
      String(m.preview || '').replace(/\s+/g, ' ').slice(0, 60),
    ].join(' | ')));
  });
  lines.sort();
  if (!lines.length) throw new Error('00_inbox/bootstrap に過去メールの JSON がありません');

  const runId = fmt_(new Date(), 'yyyyMMdd-HHmm');
  const chunks = [];
  for (let i = 0; i < lines.length; i += BOOT_CHUNK_LINES) chunks.push(lines.slice(i, i + BOOT_CHUNK_LINES));
  writeText_(folder_(PATHS.SYSTEM), BOOT_PARTIAL_FILE, JSON.stringify({
    runId: runId, total: chunks.length, period: lines[0].slice(0, 10) + '〜' + lines[lines.length - 1].slice(0, 10), mails: lines.length, partials: {},
  }), 'application/json');

  const jobs = chunks.map((chunk, i) => {
    const jobId = 'bootstrap-' + runId + '-' + ('0' + (i + 1)).slice(-2);
    const text = [
      commonJobContext_(loadProjects_()),
      '## 既定の種別', CONFIG.CATEGORIES.join(' / '), '',
      '## 過去メールの一覧（' + (i + 1) + '/' + chunks.length + '区間。日付 | 受/送 | 差出人 | 宛先 | 件名 | 冒頭）',
      chunk.join('\n'),
    ].join('\n');
    return { jobId: jobId, docId: createJob_('bootstrap_chunk', jobId, text), index: i };
  });
  withDb_(db => {
    jobs.forEach(j => {
      db.jobs[j.jobId] = { type: 'bootstrap_chunk', docId: j.docId, createdAt: new Date().toISOString(), src: { runId: runId, index: j.index } };
    });
  });
  console.log(chunks.length + ' 件の解析ジョブを作りました（' + lines.length + ' 通）');
}

function applyBootstrapChunk_(job, result) {
  const sys = folder_(PATHS.SYSTEM);
  const f = findFile_(sys, BOOT_PARTIAL_FILE);
  if (!f) throw new Error(BOOT_PARTIAL_FILE + ' がありません');
  const state = JSON.parse(readText_(f));
  if (state.runId !== job.src.runId) return; // 古い実行の結果は無視
  state.partials[job.src.index] = result;
  f.setContent(JSON.stringify(state));
  if (Object.keys(state.partials).length < state.total) return;

  // 全区間がそろったら統合ジョブを作る
  const jobId = 'bootstrap-' + state.runId + '-merge';
  const text = [
    commonJobContext_(loadProjects_()),
    '## 既定の種別', CONFIG.CATEGORIES.join(' / '), '',
    '## 対象期間・件数', state.period + ' / ' + state.mails + '通', '',
    '## 区間ごとの分析結果（JSON）',
    JSON.stringify(Object.keys(state.partials).sort().map(k => state.partials[k])),
  ].join('\n');
  const docId = createJob_('bootstrap_merge', jobId, text);
  withDb_(db => {
    db.jobs[jobId] = { type: 'bootstrap_merge', docId: docId, createdAt: new Date().toISOString(), src: { runId: state.runId } };
  });
}

function applyBootstrapMerge_(job, merged) {
  const sys = folder_(PATHS.SYSTEM);
  const date = today_();
  writeText_(sys, '分類提案.md', '# 分類提案（' + date + '）\n\n' + merged.report_md + '\n\n## 種別の見直し\n\n' +
    (merged.category_suggestions.map(c => '- ' + c.category + '：' + { keep: '維持', add: '追加', remove: '削除', rename: '名称変更' }[c.action] + '（' + c.reason + '）').join('\n') || '- なし') + '\n');
  writeText_(sys, '除外候補.md', '# 除外候補（Power Automate の除外リストに追加を検討）\n\n' +
    (merged.noise_senders.map(n => '- ' + n.sender + '（' + n.count + '件）' + n.reason).join('\n') || '- なし') + '\n');
  merged.projects.forEach(p => proposeProject_(p.name, { client: p.client, location: p.location, phase: p.phase_guess, aliases: p.aliases, domains: p.domains }));
  const pf = findFile_(sys, BOOT_PARTIAL_FILE);
  if (pf) pf.setTrashed(true);
  withDb_(db => syncProjectsToDb_(db));
}
