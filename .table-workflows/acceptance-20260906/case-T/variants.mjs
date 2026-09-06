import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
import fs from 'node:fs/promises';
await fs.mkdir('service-plan/runs/structure-tests',{recursive:true});
for(const mode of ['data','merge','duplicate','unknown']) {
 const w=await SpreadsheetFile.importXlsx(await FileBlob.load('inbox/source.xlsx'));
 const s=w.worksheets.getItem('需求');
 if(mode==='data'){s.getRange('C2').values=[[8]];s.getRange('A4:C4').clear({applyTo:'contents'});}
 if(mode==='merge')s.mergeCells('A6:B6');
 if(mode==='duplicate')s.getRange('A3').values=[['P01']];
 if(mode==='unknown')s.getRange('A3').values=[['P99']];
 await(await SpreadsheetFile.exportXlsx(w)).save(`service-plan/runs/structure-tests/${mode}.xlsx`);
}
