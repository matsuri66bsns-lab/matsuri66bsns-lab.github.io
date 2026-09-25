/**
 * 案件マスタ（_system/案件マスタ.md）の読み書き
 *
 * 人が直接編集できるよう Markdown の表で保持する。1行 = 1案件。
 * 状態: 進行中 / 提案（AIが新規案件として提案。ダッシュボードで承認） / 保留 / 完了
 */

const MASTER_FILE = '案件マスタ.md';
const MASTER_COLS = ['ID', '案件名', '状態', 'フェーズ', '施主・相手先', '所在地', '別名・キーワード', '関係ドメイン'];
const MASTER_KEYS = ['id', 'name', 'status', 'phase', 'client', 'location', 'aliases', 'domains'];

function loadProjects_() {
  const f = findFile_(folder_(PATHS.SYSTEM), MASTER_FILE);
  if (!f) return [];
  const rows = [];
  readText_(f).split('\n').forEach(line => {
    if (!/^\|/.test(line.trim()) || /^\|\s*-/.test(line.trim())) return;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    if (cells[0] === 'ID' || !cells[0]) return;
    const p = {};
    MASTER_KEYS.forEach((k, i) => { p[k] = cells[i] || ''; });
    p.aliases = p.aliases ? p.aliases.split(/[,、]/).map(s => s.trim()).filter(Boolean) : [];
    p.domains = p.domains ? p.domains.split(/[,、\s]/).map(s => s.trim()).filter(Boolean) : [];
    rows.push(p);
  });
  return rows;
}

function saveProjects_(projects) {
  const esc = s => String(s || '').replace(/\|/g, '／').replace(/\n/g, ' ');
  const lines = [
    '# 案件マスタ',
    '',
    'このファイルの表を編集すると、以後のメール・記録の振り分けに反映されます。',
    '「別名・キーワード」には略称・工事名・物件名・施主名の表記ゆれを、「関係ドメイン」には施主や協力会社のメールドメインを入れると精度が上がります。',
    '状態が「提案」の行は AI が新規案件として追加したものです。ダッシュボードで承認するか、この表で「進行中」に書き換えてください。',
    '',
    '| ' + MASTER_COLS.join(' | ') + ' |',
    '|' + MASTER_COLS.map(() => '---').join('|') + '|',
  ];
  projects.forEach(p => {
    lines.push('| ' + [p.id, p.name, p.status, p.phase, p.client, p.location, (p.aliases || []).join(', '), (p.domains || []).join(', ')].map(esc).join(' | ') + ' |');
  });
  writeText_(folder_(PATHS.SYSTEM), MASTER_FILE, lines.join('\n') + '\n');
}

function projectFolderPath_(p) {
  return PATHS.PROJECTS + '/' + p.id + '_' + safeName_(p.name, 40);
}

/** 案件ID から保存先フォルダパスを返す。案件外なら 20_一般/<カテゴリ> */
function destPath_(projectId, category, projects) {
  const p = projects.find(x => x.id === projectId);
  if (p) return projectFolderPath_(p);
  return PATHS.GENERAL + '/' + (CONFIG.GENERAL_FOLDERS[category] || 'その他');
}

function nextProjectId_(projects) {
  const y = fmt_(new Date(), 'yyyy');
  const nums = projects.map(p => (p.id.match(new RegExp('^P-' + y + '-(\\d+)$')) || [])[1]).filter(Boolean).map(Number);
  const n = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  return 'P-' + y + '-' + ('00' + n).slice(-3);
}

/** AI が新規案件と判断したものを「提案」状態で追加 */
function proposeProject_(name, hint) {
  const projects = loadProjects_();
  const dup = projects.find(p => p.name === name || (p.aliases || []).indexOf(name) >= 0);
  if (dup) return dup;
  const p = {
    id: nextProjectId_(projects), name: name, status: '提案', phase: hint.phase || '',
    client: hint.client || '', location: hint.location || '', aliases: hint.aliases || [], domains: hint.domains || [],
  };
  projects.push(p);
  saveProjects_(projects);
  logEvent_('info', '新規案件を提案: ' + p.id + ' ' + name);
  return p;
}

/** プロンプトに渡す案件一覧 */
function projectsContext_(projects) {
  if (!projects.length) return '（まだ登録された案件はありません）';
  return projects.filter(p => p.status !== '完了').map(p =>
    '- ' + p.id + ' | ' + p.name + ' | 状態:' + p.status + ' | フェーズ:' + (p.phase || '-') +
    ' | 相手先:' + (p.client || '-') + ' | 所在地:' + (p.location || '-') +
    ' | 別名:' + ((p.aliases || []).join('・') || '-') + ' | ドメイン:' + ((p.domains || []).join(' ') || '-')
  ).join('\n');
}

/** db.projects をマスタと同期し、集計値を付ける */
function syncProjectsToDb_(db) {
  const projects = loadProjects_();
  const today = today_();
  db.projects = projects.map(p => {
    const tasks = db.tasks.filter(t => t.projectId === p.id);
    const open = tasks.filter(t => ['todo', 'doing'].indexOf(t.status) >= 0);
    const lastMail = db.mails.filter(m => m.projectId === p.id).map(m => m.date).sort().pop() || '';
    const lastRec = db.records.filter(r => r.projectId === p.id).map(r => r.date).sort().pop() || '';
    const prev = (db.projects || []).find(x => x.id === p.id) || {};
    return Object.assign({}, p, {
      overviewFileId: prev.overviewFileId || '',
      decisionsFileId: prev.decisionsFileId || '',
      folderPath: projectFolderPath_(p),
      openTasks: open.length,
      overdue: open.filter(t => t.due && t.due < today).length,
      proposed: tasks.filter(t => t.status === 'proposed').length,
      waiting: tasks.filter(t => t.status === 'waiting').length,
      lastActivity: [lastMail, lastRec].sort().pop() || '',
    });
  });
}
