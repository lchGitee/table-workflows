import fs from 'node:fs/promises';
import {FileBlob, SpreadsheetFile} from '@oai/artifact-tool';
const dir = new URL('.', import.meta.url).pathname;
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(dir + '../fixtures/data-variance.xlsx'));
const sheet = wb.worksheets.getItemAt(0);
const rows = [
  ['订单号','仓库代码','件数','发货状态','收款状态'],
  ['NEW01','SYN-W1',2,'已发货','已收款'],
  ['NEW02','SYN-W1',3,'已发货','未收款'],
  ['NEW03','SYN-W1',5,'待发货','已收款'],
  ['NEW04','SYN-W2',7,'待发货','未收款'],
  ['NEW05','SYN-W2',11,'已取消','已收款'],
  ['NEW06','SYN-W2',17,'已发货',null],
];
sheet.getRange('A1:E7').values = rows;
const output = dir + 'policy-truth-table.xlsx';
await fs.access(output).then(() => {throw new Error('Synthetic fixture exists');}, () => {});
console.log((await wb.inspect({kind:'table', range:`'${sheet.name}'!A1:E7`,tableMaxRows:7,tableMaxCols:5})).ndjson);
await (await SpreadsheetFile.exportXlsx(wb)).save(output);
