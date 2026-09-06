import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const data = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(data.template));
const sh = wb.worksheets.getItem('部门汇总');
// 只清空历史结果数据，保留标题和原结果样式；新部门沿用样本数据行格式。
const n = Math.max(3, data.rows.length + 1);
for (let i = 3; i <= n; i++) sh.getRange(`A${i}:C${i}`).copyFrom(sh.getRange('A2:C2'), 'all');
sh.getRange(`A2:C${n}`).clear({applyTo:'contents'});
if (data.rows.length) sh.getRange(`A2:C${data.rows.length + 1}`).values = data.rows;
const check = await wb.inspect({kind:'table', range:`部门汇总!A1:C${n}`, include:'values,formulas', tableMaxRows:20, tableMaxCols:3});
const errors = await wb.inspect({kind:'match', searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options:{useRegex:true,maxResults:100}});
await fs.writeFile(data.audit, JSON.stringify({table:check.ndjson, errors:errors.ndjson},null,2));
const preview = await wb.render({sheetName:'部门汇总', range:`A1:C${Math.min(n,25)}`, scale:1.5, format:'png'});
await fs.writeFile(data.preview, new Uint8Array(await preview.arrayBuffer()));
await (await SpreadsheetFile.exportXlsx(wb)).save(data.output);
