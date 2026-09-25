/**
 * 日次処理：案件カルテの更新と、朝の日次ブリーフ生成
 */

function overviewSystemPrompt_() {
  const o = owner_();
  return [
    'あなたは' + (o.role || '建築・不動産分野の実務担当者') + 'である' + (o.name || '利用者') + 'さんの業務秘書です。',
    '案件の記録（メール要約・議事録・決定事項・タスク）から「案件カルテ」を Markdown で書きます。',
    'カルテは本人や同僚が1分で現況をつかむための文書です。記録にないことは書かず、日付と出典の種類（メール/協議記録）を添えます。',
    '',
    '出力は Markdown 本文のみ。次の見出し構成を守る:',
    '# {案件ID} {案件名}',
    '> 最終更新: {今日}',
    '## 基本情報（表: 施主・発注者／所在地／用途・規模（分かれば）／フェーズ／主な関係者）',
    '## 現在の状況（3〜5行）',
    '## 直近のマイルストーン（日付順の箇条書き。確定/予定を明記）',
    '## 懸案・未決事項（誰のボールか付記）',
    '## 行政協議の状況（協議先ごとに論点と最新の結論。該当なければ省略）',
    '## 施主の要望と決定の要点（該当なければ省略）',
    '## 主な関係者（表: 氏名／所属／役割）',
  ].join('\n');
}

function refreshOverview_(project, db) {
  const since = fmt_(addDays_(new Date(), -120));
  const mails = db.mails.filter(m => m.projectId === project.id && String(m.date).slice(0, 10) >= since).slice(-60);
  const recs = db.records.filter(r => r.projectId === project.id).slice(-15);
  const decs = db.decisions.filter(d => d.projectId === project.id).slice(-40);
  const tasks = db.tasks.filter(t => t.projectId === project.id && ['todo', 'doing', 'waiting', 'proposed'].indexOf(t.status) >= 0);
  const events = db.events.filter(e => e.projectId === project.id && e.start >= today_()).slice(0, 15);

  let prev = '';
  if (project.overviewFileId) {
    try { prev = readText_(DriveApp.getFileById(project.overviewFileId)); } catch (e) { prev = ''; }
  }
  const text = [
    '## 今日', ymdJa_(new Date()),
    '## 案件マスタ', JSON.stringify({ id: project.id, name: project.name, phase: project.phase, client: project.client, location: project.location }),
    '## 前回のカルテ', prev || '（なし）',
    '## メール（古い順）', mails.map(m => '- ' + String(m.date).slice(0, 10) + ' [' + m.category + '] ' + m.title + ': ' + m.summary).join('\n') || '（なし）',
    '## 協議・打合せ記録', recs.map(r => '- ' + r.date + ' [' + r.type + '] ' + r.title + '（' + r.counterpart + '）: ' + r.summary).join('\n') || '（なし）',
    '## 決定事項', decs.map(d => '- ' + d.date + ' ' + d.text).join('\n') || '（なし）',
    '## 未完了タスク・相手待ち', tasks.map(t => '- [' + t.status + '] ' + t.title + '（期日 ' + (t.due || '-') + '）').join('\n') || '（なし）',
    '## 今後の予定', events.map(e => '- ' + e.start + ' ' + e.title).join('\n') || '（なし）',
  ].join('\n\n');

  const md = callClaude_({ system: overviewSystemPrompt_(), content: [{ type: 'text', text: text }], effort: CONFIG.EFFORT_DAILY });
  const f = writeText_(folder_(projectFolderPath_(project)), '_案件カルテ.md', md);
  return f.getId();
}

function briefSystemPrompt_() {
  const o = owner_();
  return [
    'あなたは' + (o.name || '利用者') + 'さんの業務秘書です。毎朝、今日一日の段取りを Markdown で短く伝えます。',
    '読むのは出勤前のスマートフォン。全体で400〜700字程度。挨拶や前置きは書かない。',
    '見出し構成:',
    '## 今日の最優先（最大3件。理由を一言。期日・案件名を添える）',
    '## 今日の予定',
    '## 期限切れ・要注意',
    '## 新着の要点（前回以降のメールと記録から、判断や対応が要るものだけ）',
    '## 催促を検討（相手待ちで期限を過ぎた、または1週間以上動きがないもの）',
    '該当がない見出しは「なし」と書く。',
  ].join('\n');
}

function dailyBrief_(db) {
  const today = today_();
  const weekEnd = fmt_(addDays_(new Date(), 7));
  const since = isoJst_(new Date(Date.now() - 26 * 3600 * 1000).toISOString());
  const pname = id => (db.projects.find(p => p.id === id) || { name: '案件外' }).name;
  const mine = db.tasks.filter(t => t.owner === 'me' && ['todo', 'doing'].indexOf(t.status) >= 0);
  const text = [
    '## 今日', ymdJa_(new Date()),
    '## 期限切れ', mine.filter(t => t.due && t.due < today).map(t => '- ' + t.due + ' ' + t.title + '［' + pname(t.projectId) + '］').join('\n') || 'なし',
    '## 今日〜1週間の期限', mine.filter(t => t.due >= today && t.due <= weekEnd).sort((a, b) => a.due < b.due ? -1 : 1)
      .map(t => '- ' + t.due + ' [' + t.priority + '] ' + t.title + '［' + pname(t.projectId) + '］').join('\n') || 'なし',
    '## 採用待ちの提案タスク', String(db.tasks.filter(t => t.status === 'proposed').length) + '件',
    '## 今日〜1週間の予定', db.events.filter(e => e.start.slice(0, 10) >= today && e.start.slice(0, 10) <= weekEnd)
      .map(e => '- ' + e.start + ' ' + e.title + '［' + pname(e.projectId) + '］').join('\n') || 'なし',
    '## 新着メール', db.mails.filter(m => m.date >= since).map(m => '- [' + pname(m.projectId) + '/' + m.category + '] ' + m.title + ': ' + m.summary).join('\n') || 'なし',
    '## 新着記録', db.records.filter(r => r.date >= fmt_(addDays_(new Date(), -1))).map(r => '- [' + pname(r.projectId) + '] ' + r.type + ' ' + r.title + ': ' + r.summary).join('\n') || 'なし',
    '## 相手待ち', db.tasks.filter(t => t.status === 'waiting').map(t => '- ' + t.title + '（期限 ' + (t.due || '-') + '、登録 ' + t.createdAt.slice(0, 10) + '）［' + pname(t.projectId) + '］').join('\n') || 'なし',
  ].join('\n\n');
  return callClaude_({ system: briefSystemPrompt_(), content: [{ type: 'text', text: text }], effort: CONFIG.EFFORT_DAILY });
}

/** 毎朝のトリガーから呼ばれる */
function dailyJob() {
  const db = loadDb_();
  const since = fmt_(addDays_(new Date(), -2));
  const active = db.projects.filter(p => p.status !== '完了' && p.status !== '提案' && (p.lastActivity || '') >= since);
  const updated = {};
  const deadline = Date.now() + CONFIG.TIME_BUDGET_MS;
  active.forEach(p => {
    if (Date.now() > deadline - 90 * 1000) return;
    try { updated[p.id] = refreshOverview_(p, db); } catch (e) { logEvent_('error', 'カルテ更新失敗 ' + p.id + ': ' + e); }
  });

  const md = dailyBrief_(db);
  const date = today_();
  const f = writeText_(folder_(PATHS.BRIEFS + '/' + date.slice(0, 7)), date + '.md', '# 日次ブリーフ ' + ymdJa_(new Date()) + '\n\n' + md);
  withDb_(db2 => {
    db2.projects.forEach(p => { if (updated[p.id]) p.overviewFileId = updated[p.id]; });
    db2.brief = { date: date, md: md, fileId: f.getId() };
    syncProjectsToDb_(db2);
  });
}
