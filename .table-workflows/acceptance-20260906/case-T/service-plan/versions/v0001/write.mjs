import fs from 'node:fs/promises';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const [template,output,payload]=process.argv.slice(2);
const w=await SpreadsheetFile.importXlsx(await FileBlob.load(template));
w.worksheets.getItem('计划表').getRange('C4:C6').values=JSON.parse(await fs.readFile(payload,'utf8')).map(v=>[v]);
console.log((await w.inspect({kind:'table',range:'计划表!A1:E9',include:'values,formulas',tableMaxRows:12,tableMaxCols:5})).ndjson);
console.log((await w.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:30}})).ndjson);
const x=await SpreadsheetFile.exportXlsx(w);await x.save(output);
const p=await w.render({sheetName:'计划表',range:'A1:E9',scale:1});await fs.writeFile(output+'.png',new Uint8Array(await p.arrayBuffer()));
