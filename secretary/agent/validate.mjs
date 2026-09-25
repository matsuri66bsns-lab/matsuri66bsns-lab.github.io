// 結果 JSON を schemas.json で検証する（外部ライブラリ不要）
// 使い方: node secretary/agent/validate.mjs <job_type> <result.json>
//   job_type: mail | record | daily | bootstrap_chunk | bootstrap_merge | error
// 問題がなければ「OK」と表示して終了コード 0、あれば項目ごとの指摘を表示して終了コード 1。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [type, file] = process.argv.slice(2);
const schemas = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schemas.json'), 'utf8'));
if (!schemas[type] || !file) {
  console.error('使い方: node validate.mjs <' + Object.keys(schemas).join('|') + '> <result.json>');
  process.exit(2);
}

let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error('JSON として読めません: ' + e.message);
  process.exit(1);
}
// 処理できなかったジョブは {"error": "..."} を返してよい
const schema = data && typeof data === 'object' && 'error' in data && Object.keys(data).length === 1 ? schemas.error : schemas[type];

const errors = [];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function check(s, v, path) {
  if (s.type === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return errors.push(path + ': オブジェクトが必要');
    for (const k of s.required || []) if (!(k in v)) errors.push(path + '.' + k + ': 必須項目がありません');
    for (const k of Object.keys(v)) {
      if (!s.properties[k]) errors.push(path + '.' + k + ': 定義にない項目です');
      else check(s.properties[k], v[k], path + '.' + k);
    }
  } else if (s.type === 'array') {
    if (!Array.isArray(v)) return errors.push(path + ': 配列が必要（なければ []）');
    v.forEach((x, i) => check(s.items, x, path + '[' + i + ']'));
  } else if (s.type === 'string') {
    if (typeof v !== 'string') return errors.push(path + ': 文字列が必要（なければ ""）');
    if (s.enum && !s.enum.includes(v)) errors.push(path + ': 次のいずれか → ' + s.enum.join(' / '));
    if (s.format === 'date-or-empty' && v !== '' && !DATE.test(v)) errors.push(path + ': YYYY-MM-DD か "" にしてください');
  } else if (s.type === 'integer') {
    if (!Number.isInteger(v)) errors.push(path + ': 整数が必要');
  } else if (s.type === 'boolean') {
    if (typeof v !== 'boolean') errors.push(path + ': true / false が必要');
  }
}
check(schema, data, '$');
if (errors.length) {
  console.error(errors.length + ' 件の問題があります:\n' + errors.slice(0, 50).join('\n'));
  process.exit(1);
}
console.log('OK');
