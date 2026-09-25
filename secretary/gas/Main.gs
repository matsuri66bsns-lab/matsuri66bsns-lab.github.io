/**
 * 秘書AI — エントリポイント
 *
 * 初回: スクリプトプロパティを登録 → setup() を実行（フォルダ作成・トリガー登録）
 * 以後: tick() が10分おき（結果の反映とジョブ作成）、prepareDailyJob() が毎朝5時半に動く
 * 解析そのものは、クラウドの Claude Code ルーチンが 01_解析キュー を処理して行う
 */

function setup() {
  const props = PropertiesService.getScriptProperties();
  let root;
  if (props.getProperty('ROOT_FOLDER_ID')) {
    root = DriveApp.getFolderById(props.getProperty('ROOT_FOLDER_ID'));
  } else {
    const it = DriveApp.getRootFolder().getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
    root = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(CONFIG.ROOT_FOLDER_NAME);
    props.setProperty('ROOT_FOLDER_ID', root.getId());
  }

  [PATHS.INBOX_MAIL, PATHS.INBOX_ATTACH, PATHS.INBOX_RECORDS, PATHS.INBOX_BOOTSTRAP, PATHS.QUEUED, PATHS.PROCESSED, PATHS.ERROR,
    PATHS.JOBS, PATHS.RESULTS, PATHS.QUEUE_DONE, PATHS.PROJECTS, PATHS.GENERAL, PATHS.BRIEFS, PATHS.SYSTEM].forEach(folder_);
  Object.keys(CONFIG.GENERAL_FOLDERS).forEach(k => folder_(PATHS.GENERAL + '/' + CONFIG.GENERAL_FOLDERS[k]));

  if (!findFile_(folder_(PATHS.SYSTEM), MASTER_FILE)) saveProjects_([]);
  if (!findFile_(folder_(PATHS.SYSTEM), DB_FILE)) saveDb_(emptyDb_());
  writeText_(root, 'README.md', rootReadme_());

  ScriptApp.getProjectTriggers()
    .filter(t => ['tick', 'dailyJob', 'prepareDailyJob', 'bootstrapTaxonomy'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('prepareDailyJob').timeBased().atHour(5).nearMinute(30).everyDays(1).inTimezone(TZ).create();

  console.log('セットアップ完了。ルートフォルダ: ' + root.getUrl());
  console.log('結果フォルダ ID（Claude Code が結果を書く場所）: ' + folder_(PATHS.RESULTS).getId());
}

/** 10分おき：Claude Code の結果を反映し、新しいメール・記録から解析ジョブを作る */
function tick() {
  const cache = CacheService.getScriptCache();
  if (cache.get('tick_running')) return; // 前回の実行がまだ終わっていない
  cache.put('tick_running', '1', 6 * 60);
  try {
    const deadline = Date.now() + CONFIG.TIME_BUDGET_MS;
    const touched = {};
    const applied = applyResults_(deadline, touched);
    const n1 = prepareMailJobs_(deadline);
    const n2 = prepareRecordJobs_(deadline);
    recoverStaleJobs_();
    if (applied + n1 + n2 > 0 || PENDING_.log.length) {
      withDb_(db => {
        writeTasksMd_(db, touched);
        syncProjectsToDb_(db);
      });
    }
  } finally {
    cache.remove('tick_running');
  }
}

function rootReadme_() {
  return [
    '# 秘書AI',
    '',
    'Outlook のメールと打合せ記録から、業務情報を自動で整理・蓄積するフォルダです。',
    '',
    '| フォルダ | 中身 |',
    '|---|---|',
    '| 00_inbox/mail | Power Automate が受信・送信メールを JSON で投入（処理後は _processed へ） |',
    '| 00_inbox/attachments | 同じく添付ファイル（処理後は各案件の「添付」へ移動） |',
    '| 00_inbox/records | 打合せの音声・メモ・写真の投入口（ファイル名先頭に [案件ID][種別] を付けると確実） |',
    '| 00_inbox/bootstrap | 初期分析用の過去メール |',
    '| 00_inbox/_queued | 解析待ちのメール・記録の原本 |',
    '| 01_解析キュー | Apps Script が作る解析ジョブ（jobs）と、Claude Code が書く結果（results） |',
    '| 10_案件/<ID>_<案件名> | _案件カルテ.md / _決定事項.md / _タスク.md / メール/ / 記録/ / 添付/ |',
    '| 20_一般 | 案件に属さない社内・経理・情報共有など |',
    '| 30_日次ブリーフ | 毎朝の段取りメモ |',
    '| _system | 案件マスタ.md（編集可）/ db.json（ダッシュボード用。編集しない） |',
    '',
  ].join('\n');
}
