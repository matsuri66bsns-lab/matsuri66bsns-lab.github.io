// secretary/gas/Schemas.gs から schemas.json を作る（Apps Script と Claude Code で同じ形式を使うため）
// 使い方: node secretary/agent/build-schemas.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const gas = join(here, '..', 'gas');
const ctx = vm.createContext({});
vm.runInContext(readFileSync(join(gas, 'Config.gs'), 'utf8') + '\n' + readFileSync(join(gas, 'Schemas.gs'), 'utf8') + '\nthis.__schemas = allSchemas_();', ctx);
writeFileSync(join(here, 'schemas.json'), JSON.stringify(ctx.__schemas, null, 2) + '\n');
console.log('schemas.json を更新しました: ' + Object.keys(ctx.__schemas).join(', '));
