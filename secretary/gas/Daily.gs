/**
 * 日次処理：案件カルテと「今日の段取り」
 *   prepareDailyJob   … 毎朝5時半のトリガーで、材料をまとめた解析ジョブを作る
 *   applyDailyResult_ … Claude Code の結果から _案件カルテ.md と日次ブリーフを書く
 */

function prepareDailyJob() {
  const db = loadDb_();
  const date = today_();
  const jobId = 'daily-' + date;
  if (db.jobs[jobId]) return; // 同じ日のジョブが残っている

  const since2 = fmt_(addDays_(new Date(), -2));
  const since120 = fmt_(addDays_(new Date(), -120));
  const pname = id => (db.projects.find(p => p.id === id) || { name: '案件外' }).name;
  const active = db.projects.filter(p => p.status === '進行中' && (p.lastActivity || '') >= since2).slice(0, 10);

  const projectBlocks = active.map(p => {
    let prev = '';
    const f = findFile_(folder_(projectFolderPath_(p)), '_案件カルテ.md');
    if (f) prev = readText_(f);
    const mails = db.mails.filter(m => m.projectId === p.id && String(m.date).slice(0, 10) >= since120).slice(-40);
    const recs = db.records.filter(r => r.projectId === p.id).slice(-10);
    const decs = db.decisions.filter(d => d.projectId === p.id).slice(-30);
    const tasks = db.tasks.filter(t => t.projectId === p.id && ['todo', 'doing', 'waiting', 'proposed'].indexOf(t.status) >= 0);
    const events = db.events.filter(e => e.projectId === p.id && e.start >= date).slice(0, 15);
    return [
      '### 案件 ' + p.id + ' ' + p.name,
      '発注者: ' + (p.client || '-') + ' / 工事場所: ' + (p.location || '-') + ' / フェーズ: ' + (p.phase || '-'),
      '#### 前回のカルテ', clip_(prev) || '（なし）',
      '#### メール（古い順）', mails.map(m => '- ' + String(m.date).slice(0, 10) + ' [' + m.category + '] ' + m.title + ': ' + m.summary).join('\n') || '（なし）',
      '#### 協議・打合せ記録', recs.map(r => '- ' + r.date + ' [' + r.type + '] ' + r.title + '（' + r.counterpart + '）: ' + r.summary).join('\n') || '（なし）',
      '#### 決定事項', decs.map(d => '- ' + d.date + ' ' + d.text).join('\n') || '（なし）',
      '#### 未完了タスク・相手待ち', tasks.map(t => '- [' + t.status + '] ' + t.title + '（期日 ' + (t.due || '-') + '）').join('\n') || '（なし）',
      '#### 今後の予定', events.map(e => '- ' + e.start + ' ' + e.title).join('\n') || '（なし）',
    ].join('\n');
  });

  const weekEnd = fmt_(addDays_(new Date(), 7));
  const since = isoJst_(new Date(Date.now() - 26 * 3600 * 1000).toISOString());
  const mine = db.tasks.filter(t => t.owner === 'me' && ['todo', 'doing'].indexOf(t.status) >= 0);
  const briefData = [
    '### 期限切れ', mine.filter(t => t.due && t.due < date).map(t => '- ' + t.due + ' ' + t.title + '［' + pname(t.projectId) + '］').join('\n') || 'なし',
    '### 今日〜1週間の期限', mine.filter(t => t.due >= date && t.due <= weekEnd).sort((a, b) => a.due < b.due ? -1 : 1)
      .map(t => '- ' + t.due + ' [' + t.priority + '] ' + t.title + '［' + pname(t.projectId) + '］').join('\n') || 'なし',
    '### 採用待ちの提案タスク', db.tasks.filter(t => t.status === 'proposed').length + '件',
    '### 今日〜1週間の予定', db.events.filter(e => e.start.slice(0, 10) >= date && e.start.slice(0, 10) <= weekEnd)
      .map(e => '- ' + e.start + ' ' + e.title + '［' + pname(e.projectId) + '］').join('\n') || 'なし',
    '### 新着メール（直近26時間）', db.mails.filter(m => m.date >= since).map(m => '- [' + pname(m.projectId) + '/' + m.category + '] ' + m.title + ': ' + m.summary).join('\n') || 'なし',
    '### 新着記録', db.records.filter(r => r.date >= fmt_(addDays_(new Date(), -1))).map(r => '- [' + pname(r.projectId) + '] ' + r.type + ' ' + r.title + ': ' + r.summary).join('\n') || 'なし',
    '### 相手待ち', db.tasks.filter(t => t.status === 'waiting').map(t => '- ' + t.title + '（期限 ' + (t.due || '-') + '、登録 ' + String(t.createdAt).slice(0, 10) + '）［' + pname(t.projectId) + '］').join('\n') || 'なし',
  ].join('\n');

  const text = [
    commonJobContext_(loadProjects_()),
    '## カルテを更新する案件（' + active.length + '件）',
    projectBlocks.join('\n\n') || '（なし。overviews は空配列にする）',
    '',
    '## 今日の段取りの材料',
    briefData,
  ].join('\n');

  const docId = createJob_('daily', jobId, text);
  withDb_(db2 => {
    db2.jobs[jobId] = { type: 'daily', docId: docId, createdAt: new Date().toISOString(), src: { date: date, projectIds: active.map(p => p.id) } };
  });
}

function applyDailyResult_(job, result) {
  const projects = loadProjects_();
  const written = {};
  result.overviews.forEach(o => {
    const p = projects.find(x => x.id === o.project_id);
    if (!p || !o.markdown) return;
    written[p.id] = writeText_(folder_(projectFolderPath_(p)), '_案件カルテ.md', o.markdown).getId();
  });
  const date = job.src.date;
  const d = parseYmd_(date) || new Date();
  const f = writeText_(folder_(PATHS.BRIEFS + '/' + date.slice(0, 7)), date + '.md', '# 日次ブリーフ ' + ymdJa_(d) + '\n\n' + result.brief_markdown + '\n');
  withDb_(db => {
    db.projects.forEach(p => { if (written[p.id]) p.overviewFileId = written[p.id]; });
    db.brief = { date: date, md: result.brief_markdown, fileId: f.getId() };
    syncProjectsToDb_(db);
  });
}
