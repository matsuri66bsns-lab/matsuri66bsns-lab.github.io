/**
 * 添付ファイルの読み方（ジョブに書き込む指示）
 *
 *   PDF / Word(docx,doc) / Excel(xlsx) / PowerPoint(pptx) / PNG / JPEG
 *       … Claude Code が Google Drive コネクタの read_file_content で直接読む（fileId をジョブに記載）
 *   テキスト / CSV / ICS / EML、旧形式の xls・ppt
 *       … Apps Script がテキスト化してジョブに直接書き込む（xls は全シートを CSV 化）
 *   ZIP … Apps Script が展開して Drive に置き、中身を同じ規則で扱う
 *   CAD / BIM（DWG, JWW, DXF, SFC, RVT, IFC…）… 解析しない。ファイル名から図番・版だけ推定
 *   HEIC / 動画 / 音声 / その他 … メタ情報のみ
 */

const KIND_BY_EXT = {
  pdf: 'pdf',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image-other', webp: 'image-other',
  heic: 'heic', heif: 'heic',
  docx: 'word', doc: 'word', rtf: 'text-convert',
  xlsx: 'excel', xls: 'excel-old', xlsm: 'excel-old',
  pptx: 'ppt', ppt: 'ppt-old',
  txt: 'text', md: 'text', csv: 'text', tsv: 'text', ics: 'text', eml: 'text', json: 'text', xml: 'text', html: 'text', htm: 'text',
  zip: 'zip',
  dwg: 'cad', dxf: 'cad', jww: 'cad', jwc: 'cad', sfc: 'cad', p21: 'cad',
  rvt: 'bim', ifc: 'bim', skp: 'bim', '3dm': 'bim', vwx: 'bim', pln: 'bim',
  m4a: 'audio', mp3: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio', webm: 'audio',
  mp4: 'video', mov: 'video',
};

// read_file_content が扱える形式と、その正しい MIME
const READABLE_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};

function ext_(name) {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function kindOf_(name) {
  return KIND_BY_EXT[ext_(name)] || 'other';
}

/** ZIP を展開し、中身を「<key>__<zip名>__<中身>」として同じフォルダに置く。元の ZIP も残す */
function expandZips_(files, key, folder) {
  const out = [];
  files.forEach(f => {
    out.push(f);
    if (kindOf_(f.getName()) !== 'zip') return;
    try {
      Utilities.unzip(f.getBlob().setContentType('application/zip'))
        .filter(e => !/\/$/.test(e.getName()))
        .slice(0, 15)
        .forEach(e => {
          const base = e.getName().split('/').pop();
          out.push(folder.createFile(e.setName(key + '__' + f.getName().slice(key.length + 2).replace(/\.zip$/i, '') + '__' + base)));
        });
    } catch (err) {
      console.warn('ZIP を展開できません: ' + f.getName() + ' ' + err);
    }
  });
  return out;
}

/**
 * 添付の一覧をジョブ用の文章にする
 * @param {Array<File>} files  PA が保存した添付（名前は <key>__<元の名前>）
 * @return {{text:string, items:Array<{name, kind, fileId, size, note}>}}
 */
function describeAttachments_(files, key) {
  const items = [];
  const lines = [];
  files.forEach((f, i) => {
    const name = f.getName().slice(key.length + 2).replace(/__/g, ' > ');
    const kind = kindOf_(name);
    const size = f.getSize();
    const item = { name: name, kind: kind, fileId: f.getId(), size: size, note: '' };
    items.push(item);
    const head = (i + 1) + '. ' + name + '（' + Math.round(size / 1024) + 'KB）';
    try {
      if (kind === 'image' && size < CONFIG.MIN_IMAGE_BYTES) {
        item.note = '小さい画像（署名ロゴ等）のためスキップ';
        lines.push(head + ' ｜ 読み方: 不要（' + item.note + '）');
      } else if (READABLE_MIME[ext_(name)]) {
        fixMime_(f, READABLE_MIME[ext_(name)]);
        lines.push(head + ' ｜ 読み方: read_file_content（fileId: ' + f.getId() + '）');
      } else if (kind === 'text') {
        lines.push(head + ' ｜ 読み方: 下のテキスト', '~~~', clip_(decodeText_(f.getBlob())), '~~~');
      } else if (kind === 'excel-old' || kind === 'ppt-old' || kind === 'text-convert') {
        lines.push(head + ' ｜ 読み方: 下のテキスト（Apps Script で変換）', '~~~', clip_(officeToText_(f.getBlob(), kind)), '~~~');
      } else if (kind === 'zip') {
        lines.push(head + ' ｜ ZIP（中身は後続の項目として展開済み）');
      } else {
        item.note = {
          cad: 'CAD データは解析対象外。ファイル名から図番・版のみ推定する',
          bim: 'BIM データは解析対象外。ファイル名から情報のみ推定する',
          heic: 'HEIC は読めない（iPhone の カメラ > フォーマット を「互換性優先」にすると JPEG になる）',
        }[kind] || '中身は読めない。ファイル名と種類だけ記録する';
        lines.push(head + ' ｜ 読み方: 不可（' + item.note + '）');
      }
    } catch (err) {
      item.note = '変換エラー: ' + err;
      lines.push(head + ' ｜ 読み方: 不可（' + item.note + '）');
    }
  });
  return { text: lines.join('\n') || 'なし', items: items };
}

/** Power Automate が汎用 MIME で保存した場合に、read_file_content が読めるよう MIME を直す */
function fixMime_(file, mime) {
  if (file.getMimeType() === mime) return;
  try { Drive.Files.update({ mimeType: mime }, file.getId()); } catch (e) { console.warn('MIME を修正できません: ' + file.getName()); }
}

function clip_(text) {
  const t = String(text || '');
  return t.length > CONFIG.MAX_TEXT_CHARS ? t.slice(0, CONFIG.MAX_TEXT_CHARS) + '\n…（以下省略: 全' + t.length + '文字）' : t;
}

/** UTF-8 で読んで文字化けしていれば Shift_JIS で読み直す */
function decodeText_(blob) {
  const utf8 = blob.getDataAsString('UTF-8');
  if (utf8.indexOf('\uFFFD') < 0) return utf8;
  return blob.getDataAsString('Shift_JIS');
}

/** 旧形式の Office ファイルを Google 形式に一時変換してテキスト化し、一時ファイルは削除する */
function officeToText_(blob, kind) {
  const target = kind === 'excel-old' ? 'application/vnd.google-apps.spreadsheet'
    : kind === 'ppt-old' ? 'application/vnd.google-apps.presentation'
      : 'application/vnd.google-apps.document';
  const tmp = Drive.Files.create({ name: '_tmp_' + blob.getName(), mimeType: target, parents: [folder_(PATHS.SYSTEM + '/_tmp').getId()] }, blob);
  try {
    if (kind === 'excel-old') {
      const ss = SpreadsheetApp.openById(tmp.id);
      return ss.getSheets().map(sh => {
        const values = sh.getDataRange().getDisplayValues().slice(0, CONFIG.MAX_SHEET_ROWS);
        const csv = values
          .filter(r => r.some(c => c !== ''))
          .map(r => r.map(c => /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(','))
          .join('\n');
        return '### シート: ' + sh.getName() + '\n' + csv;
      }).join('\n\n');
    }
    const url = 'https://www.googleapis.com/drive/v3/files/' + tmp.id + '/export?mimeType=text/plain';
    return UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getContentText('UTF-8');
  } finally {
    DriveApp.getFileById(tmp.id).setTrashed(true);
  }
}

/** 本文中の大容量ファイル転送サービスのリンクを抽出（ダウンロード期限タスクの材料） */
function transferLinks_(text) {
  const re = /https?:\/\/[^\s<>"）)]*(gigafile\.nu|xgf\.nu|firestorage\.jp|xfile|filesend|wetransfer\.com|we\.tl|box\.com|dropbox\.com|sharepoint\.com|1drv\.ms|onedrive\.live\.com|drive\.google\.com|cybozu|direct-cloud|filebank|biz-file|kizuku|photoruction|andpad|spider-plus)[^\s<>"）)]*/ig;
  const out = [];
  let m;
  while ((m = re.exec(String(text || ''))) && out.length < 10) out.push(m[0]);
  return out;
}
