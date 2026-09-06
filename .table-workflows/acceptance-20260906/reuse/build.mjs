import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const root=import.meta.dirname;
const head=['订单号','仓库代码','件数','发货状态','收款状态'];
const base=[head,['B01','W03',7,'已发货','未收款'],['B02','W01',8,'待发货','已收款'],['B03','W01',4,'已发货','已收款'],['B04','W02',1,'已发货','已收款'],['B05','W02',9,'待发货','未收款']];
const changed=[head,['C04','W04',6,'已发货','未收款'],['C02','W01',3,'待发货','已收款'],['C01','W04',2,'已发货','已收款'],['C03','W01',11,'待发货','未收款'],['C05','W02',5,'已发货','已收款'],['C06','W02',7,'待发货','已收款']];
const cases=[['reexport',base],['changed',changed],['reordered',[head,...base.slice(1).reverse()]],['merged',base]];
await fs.mkdir(path.join(root,'inputs'),{recursive:true});
for(const [name,rows] of cases){
 const wb=Workbook.create(),sh=wb.worksheets.add('订单');
 sh.getRangeByIndexes(0,0,rows.length,5).values=rows;
 sh.getUsedRange().format.columnWidth=18; sh.getUsedRange().format.rowHeight=23;
 if(name==='merged')sh.mergeCells('D2:E2');
 const check=await wb.inspect({kind:'table',range:'订单!A1:E8',include:'values,formulas',maxChars:2000,tableMaxRows:8});
 const preview=await wb.render({sheetName:'订单',range:'A1:E8',scale:1,format:'png'});
 await fs.writeFile(path.join(root,'inputs',name+'.png'),new Uint8Array(await preview.arrayBuffer()));
 await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(root,'inputs',name+'.xlsx'));
 console.log(name,check.ndjson);
}
