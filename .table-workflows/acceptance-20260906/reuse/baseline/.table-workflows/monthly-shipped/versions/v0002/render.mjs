import fs from 'node:fs/promises';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const data = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const workbook = Workbook.create();
const sheet = workbook.worksheets.add('汇总');
const rows = [['仓库代码', '发货件数'], ...data.rows];
sheet.getRange(`A1:B${rows.length}`).values = rows;
sheet.getRange(`A1:B${rows.length}`).format.font = {name: 'Arial', size: 11, color: '#17202A'};
sheet.getRange('A1:B1').format.font.bold = true;
sheet.getRange(`A1:B${rows.length}`).format.rowHeight = 23;
sheet.getRange('A:B').format.columnWidth = 18;
console.log((await workbook.inspect({kind: 'table', range: `汇总!A1:B${Math.min(rows.length,10)}`, include: 'values,formulas', tableMaxRows: 10, tableMaxCols: 2})).ndjson);
console.log((await workbook.inspect({kind:'match', searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options:{useRegex:true,maxResults:20}})).ndjson);
if (data.previewPath) {
  const blob = await workbook.render({sheetName:'汇总', range:`A1:B${Math.min(rows.length,20)}`,scale:2,format:'png'});
  await fs.writeFile(data.previewPath,new Uint8Array(await blob.arrayBuffer()));
}
const result = await SpreadsheetFile.exportXlsx(workbook);
await result.save(data.outputPath);
