/**
 * タスクの .md 書き出し（Obsidian Tasks 互換の書式）
 *   - [ ] タスク名 📅 2026-10-01 ⏫ 🆔 t-260925-ab12cd
 */

const TASK_STATUS_LABEL = { proposed: '提案中（未採用）', todo: '未着手', doing: '進行中', waiting: '相手待ち', done: '完了', dismissed: '却下' };

function renderTasksMd_(db, projectId, title) {
  const tasks = db.tasks.filter(t => (t.projectId || 'GENERAL') === projectId);
  const recent = fmt_(addDays_(new Date(), -30));
  const L = ['# タスク — ' + title, '', '> ダッシュボードで更新すると自動で書き換わります（最終更新 ' + fmt_(new Date(), 'yyyy-MM-dd HH:mm') + '）', ''];
  ['doing', 'todo', 'proposed', 'waiting', 'done'].forEach(st => {
    let list = tasks.filter(t => t.status === st);
    if (st === 'done') list = list.filter(t => (t.doneAt || '').slice(0, 10) >= recent);
    if (!list.length) return;
    list.sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1);
    L.push('## ' + TASK_STATUS_LABEL[st], '');
    list.forEach(t => {
      L.push(obsidianTaskLine_(t) + (t.owner === 'other' && t.who ? ' 👤 ' + t.who : ''));
      (t.subtasks || []).forEach(s => L.push(obsidianTaskLine_(s, '    ')));
      if (t.why) L.push('    - 根拠: ' + t.why + (t.dueBasis ? '／期日: ' + t.dueBasis : ''));
      if (t.source && t.source.title) L.push('    - 出典: ' + (t.source.kind === 'mail' ? 'メール' : '記録') + '「' + t.source.title + '」');
    });
    L.push('');
  });
  return L.join('\n');
}

function writeTasksMd_(db, projectIds) {
  const projects = loadProjects_();
  Object.keys(projectIds).forEach(pid => {
    const p = projects.find(x => x.id === pid);
    const path = p ? projectFolderPath_(p) : PATHS.GENERAL;
    writeText_(folder_(path), '_タスク.md', renderTasksMd_(db, p ? pid : 'GENERAL', p ? p.id + ' ' + p.name : '案件外'));
  });
}

/** ダッシュボードからのタスク更新。更新してよい項目だけを反映する */
function applyTaskPatch_(task, patch) {
  ['title', 'due', 'priority', 'status', 'note', 'projectId', 'estimateMin', 'who'].forEach(k => {
    if (patch[k] !== undefined) task[k] = patch[k];
  });
  if (patch.subtasks) task.subtasks = patch.subtasks.map((s, i) => ({ id: s.id || 's' + (i + 1), title: s.title, due: s.due || '', estimateMin: s.estimateMin || 0, done: !!s.done }));
  if (patch.status === 'done') { task.doneAt = new Date().toISOString(); delete task.suggestDone; }
  if (patch.status && patch.status !== 'done') delete task.doneAt;
  if (patch.clearSuggestDone) delete task.suggestDone;
  task.updatedAt = new Date().toISOString();
}
