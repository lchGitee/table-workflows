import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const root = path.resolve(import.meta.dirname, '..');
const fixtures = path.join(root, 'private', 'fixtures');
const head = ['订单号', '仓库代码', '件数', '发货状态', '收款状态'];
// 发现样本故意让两种筛选条件相关；留出批次再打破相关性。
const inputs = [head,
  ['A01', 'W01', 2, '已发货', '已收款'],
  ['A02', 'W02', 3, '已发货', '已收款'],
  ['A03', 'W01', 4, '待发货', '未收款'],
  ['A04', 'W02', 5, '待发货', '未收款'],
];
const next = [head,
  ['B01', 'W03', 7, '已发货', '未收款'],
  ['B02', 'W01', 8, '待发货', '已收款'],
  ['B03', 'W01', 4, '已发货', '已收款'],
  ['B04', 'W02', 1, '已发货', '已收款'],
  ['B05', 'W02', 9, '待发货', '未收款'],
];
const oracle = JSON.parse(await fs.readFile(path.join(root, 'private', 'oracle.json'), 'utf8'));
const cases = [
  ['discovery', '订单', inputs],
  ['correct', '汇总', oracle.discovery],
  ['mismatch', '汇总', oracle.wrongDiscovery],
  ['next-batch', '订单', next],
];
await fs.mkdir(fixtures, { recursive: true });
const evidence = [];
for (const [name, sheetName, values] of cases) {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add(sheetName);
  sheet.getRangeByIndexes(0, 0, values.length, values[0].length).values = values;
  sheet.getUsedRange().format.font = { name: 'Arial', size: 11, color: '#17202A' };
  sheet.getUsedRange().format.columnWidth = 18;
  sheet.getUsedRange().format.rowHeight = 23;
  sheet.getRangeByIndexes(0, 0, 1, values[0].length).format.font = { name: 'Arial', size: 11, bold: true, color: '#17202A' };
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(path.join(fixtures, `${name}.png`), new Uint8Array(await preview.arrayBuffer()));
  const check = await workbook.inspect({ kind: 'table', range: `${sheetName}!A1:${String.fromCharCode(64 + values[0].length)}${values.length}`, include: 'values,formulas', tableMaxRows: 10, tableMaxCols: 6, maxChars: 2000 });
  const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options: { useRegex: true, maxResults: 10 }, maxChars: 1000 });
  const filename = path.join(fixtures, `${name}.xlsx`);
  await (await SpreadsheetFile.exportXlsx(workbook)).save(filename);
  evidence.push({ name, sha256: crypto.createHash('sha256').update(await fs.readFile(filename)).digest('hex'), values, inspection: check.ndjson, formulaErrors: errors.ndjson });
}
await fs.writeFile(path.join(root, 'private', 'fixtures.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence.map(({ name, sha256 }) => ({ name, sha256 }))));
