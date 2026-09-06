import fs from 'node:fs/promises';
import {FileBlob, SpreadsheetFile} from '@oai/artifact-tool';
for (const name of ['source','expected','template']) {
 const w=await SpreadsheetFile.importXlsx(await FileBlob.load(`inbox/${name}.xlsx`));
 console.log(name,(await w.inspect({kind:'workbook,sheet,table',maxChars:12000,tableMaxRows:30,tableMaxCols:12})).ndjson);
 if(name==='template') {const p=await w.render({sheetName:'计划表',range:'A1:E9',scale:1});await fs.writeFile('template.png',new Uint8Array(await p.arrayBuffer()));}
}
