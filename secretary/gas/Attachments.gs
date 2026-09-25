/**
 * 添付ファイルの解釈
 *
 *   PDF（図面・申請書・見積書・議事録・スキャン）… Claude に PDF のまま渡す（文字＋画像を両方読む）
 *   画像 JPG/PNG/GIF/WebP                      … Claude に画像として渡す（現場写真・手書きメモ・図面の写真）
 *   Word / Excel / PowerPoint                  … Google 形式に一時変換してテキスト化（Excel は全シートを CSV 化）
 *   テキスト / CSV / ICS / EML                  … そのまま文字として渡す（Shift_JIS も判定）
 *   ZIP                                         … 展開して中身を同じルールで処理（1階層まで）
 *   CAD / BIM（DWG, JWW, DXF, SFC, RVT, IFC…）  … 解析しない。ファイル名から図番・版を記録（同送PDFを解析）
 *   HEIC / 動画 / 音声 / その他                 … メタ情報のみ記録
 */

const KIND_BY_EXT = {
  pdf: 'pdf',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  heic: 'heic', heif: 'heic',
  doc: 'word', docx: 'word', rtf: 'word',
  xls: 'excel', xlsx: 'excel', xlsm: 'excel',
  ppt: 'ppt', pptx: 'ppt',
  txt: 'text', md: 'text', csv: 'csv', tsv: 'csv', ics: 'text', eml: 'text', json: 'text', xml: 'text', html: 'text', htm: 'text',
  zip: 'zip',
  dwg: 'cad', dxf: 'cad', jww: 'cad', jwc: 'cad', sfc: 'cad', p21: 'cad',
  rvt: 'bim', ifc: 'bim', skp: 'bim', '3dm': 'bim', vwx: 'bim', pln: 'bim',
  m4a: 'audio', mp3: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio', webm: 'audio',
  mp4: 'video', mov: 'video',
  msg: 'other',
};

const IMAGE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function ext_(name) {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function kindOf_(name) {
  return KIND_BY_EXT[ext_(name)] || 'other';
}

/**
 * 添付 Blob 群を Claude の content ブロックに変換する
 * @param {Array<{name:string, blob:Blob}>} items
 * @return {{blocks:Array, meta:Array<{name, kind, size, note}>}}
 */
function attachmentParts_(items) {
  const state = { blocks: [], meta: [], binaryBytes: 0, index: 0 };
  items.forEach(it => addAttachment_(state, it.name, it.blob, 0));
  return { blocks: state.blocks, meta: state.meta };
}

function addAttachment_(state, name, blob, depth) {
  const kind = kindOf_(name);
  const size = blob.getBytes().length;
  const meta = { name: name, kind: kind, size: size, note: '' };
  state.meta.push(meta);
  const label = n => ({ type: 'text', text: '【添付' + (++state.index) + '】' + name + '（' + kind + ', ' + Math.round(size / 1024) + 'KB）' + (n ? ' ※' + n : '') });

  try {
    if (kind === 'pdf') {
      if (size > CONFIG.MAX_PDF_BYTES || state.binaryBytes + size > CONFIG.MAX_TOTAL_BINARY_BYTES) {
        meta.note = 'サイズ超過のため未解析';
        state.blocks.push(label(meta.note));
        return;
      }
      state.binaryBytes += size;
      state.blocks.push(label());
      state.blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Utilities.base64Encode(blob.getBytes()) } });
      return;
    }
    if (kind === 'image') {
      if (size < CONFIG.MIN_IMAGE_BYTES) { meta.note = '小さい画像（署名ロゴ等）のためスキップ'; return; }
      if (size > CONFIG.MAX_IMAGE_BYTES || state.binaryBytes + size > CONFIG.MAX_TOTAL_BINARY_BYTES) {
        meta.note = 'サイズ超過のため未解析';
        state.blocks.push(label(meta.note));
        return;
      }
      state.binaryBytes += size;
      state.blocks.push(label());
      state.blocks.push({ type: 'image', source: { type: 'base64', media_type: IMAGE_MIME[ext_(name)], data: Utilities.base64Encode(blob.getBytes()) } });
      return;
    }
    if (kind === 'word' || kind === 'excel' || kind === 'ppt') {
      state.blocks.push(label());
      state.blocks.push({ type: 'text', text: clip_(officeToText_(blob, kind)) });
      return;
    }
    if (kind === 'text' || kind === 'csv') {
      state.blocks.push(label());
      state.blocks.push({ type: 'text', text: clip_(decodeText_(blob)) });
      return;
    }
    if (kind === 'zip' && depth === 0) {
      const entries = Utilities.unzip(blob.setContentType('application/zip'));
      state.blocks.push(label('ZIP内 ' + entries.length + ' ファイル: ' + entries.map(e => e.getName()).join(', ').slice(0, 1000)));
      entries.filter(e => !/\/$/.test(e.getName())).slice(0, 15).forEach(e => addAttachment_(state, name + ' > ' + e.getName(), e, 1));
      return;
    }
    if (kind === 'cad' || kind === 'bim') {
      meta.note = 'CAD/BIMデータは解析対象外。ファイル名から図番・版のみ推定';
    } else if (kind === 'heic') {
      meta.note = 'HEICは未対応（iPhoneの設定 > カメラ > フォーマット「互換性優先」を推奨）';
    } else {
      meta.note = 'メタ情報のみ記録';
    }
    state.blocks.push(label(meta.note));
  } catch (err) {
    meta.note = '解析エラー: ' + err;
    state.blocks.push(label(meta.note));
  }
}

function clip_(text) {
  const t = String(text || '');
  return t.length > CONFIG.MAX_TEXT_CHARS ? t.slice(0, CONFIG.MAX_TEXT_CHARS) + '\n…（以下省略: 全' + t.length + '文字）' : t;
}

/** UTF-8 で読んで文字化けしていれば Shift_JIS で読み直す */
function decodeText_(blob) {
  const utf8 = blob.getDataAsString('UTF-8');
  if (utf8.indexOf('�') < 0) return utf8;
  return blob.getDataAsString('Shift_JIS');
}

/** Office ファイルを Google 形式に一時変換してテキスト化し、一時ファイルは削除する */
function officeToText_(blob, kind) {
  const target = {
    word: 'application/vnd.google-apps.document',
    excel: 'application/vnd.google-apps.spreadsheet',
    ppt: 'application/vnd.google-apps.presentation',
  }[kind];
  const tmp = Drive.Files.create({ name: '_tmp_' + blob.getName(), mimeType: target, parents: [folder_(PATHS.SYSTEM + '/_tmp').getId()] }, blob);
  try {
    if (kind === 'excel') {
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
  const re = /https?:\/\/[^\s<>"）)]*(gigafile\.nu|xgf\.nu|firestorage\.jp|xfile|filesend|wetransfer\.com|we\.tl|box\.com|dropbox\.com|sharepoint\.com|1drv\.ms|onedrive\.live\.com|drive\.google\.com|cybozu|direct-cloud|filebank|biz-file)[^\s<>"）)]*/ig;
  const out = [];
  let m;
  while ((m = re.exec(String(text || ''))) && out.length < 10) out.push(m[0]);
  return out;
}
