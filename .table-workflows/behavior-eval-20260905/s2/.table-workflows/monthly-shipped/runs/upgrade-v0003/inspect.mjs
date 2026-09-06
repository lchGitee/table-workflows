import fs from 'node:fs/promises';
import {FileBlob, SpreadsheetFile} from '@oai/artifact-tool';
const dir = new URL('.',import.meta.url).pathname;
for (const [file, name] of [['historical-result.xlsx','historical'], ['../本月仓库发货汇总-v0003.xlsx','current-month']]) {
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(dir + file));
  console.log((await wb.inspect({kind:'table',range:'汇总!A1:B4',include:'values,formulas',tableMaxRows:4,tableMaxCols:2})).ndjson);
  console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:20}})).ndjson);
  const blob = await wb.render({sheetName:'汇总',range:'A1:B4',scale:2,format:'png'});
  await fs.writeFile(dir + name + '-verified.png',new Uint8Array(await blob.arrayBuffer()));
}
