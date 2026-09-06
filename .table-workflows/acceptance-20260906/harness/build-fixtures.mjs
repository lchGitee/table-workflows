import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';
const root = path.resolve(import.meta.dirname, '..');
const oracleBytes = await fs.readFile(path.join(root,'private/oracle.json'));
const oracle = JSON.parse(oracleBytes);
const frozenHash = '412c882d1b3b386e5018a534c8794b97aa2b926f715c11a8d408605fbdaa6e22';
if(crypto.createHash('sha256').update(oracleBytes).digest('hex')!==frozenHash) throw Error('冻结答案已变化');
const hashes = {oracleSha256:frozenHash,files:{},createdAt:new Date().toISOString()};
const inspections=[];
function basicSheet(wb,name,rows){
  const sh=wb.worksheets.add(name);
  sh.getRange('A1').write(rows);
  const end=String.fromCharCode(64+rows[0].length);
  sh.getRange(`A1:${end}${rows.length}`).format.font={name:'Arial',size:11,color:'#202020'};
  sh.getRange(`A1:${end}1`).format={fill:'#E8EDF2',font:{bold:true,color:'#202020'}};
  sh.getRange(`A1:${end}${rows.length}`).format.columnWidth=20;
  sh.getRange(`A1:${end}${rows.length}`).format.rowHeight=25;
  return sh;
}
function target(q){
 const wb=Workbook.create(),s=wb.worksheets.add('计划表');
 s.getRange('A1:E9').format.font={name:'Arial',size:11,color:'#202020'};
 s.getRange('A1:E9').format.columnWidth=21;s.getRange('A1:E9').format.rowHeight=26;
 s.mergeCells('A1:E1');s.getRange('A1').values=[['服务计划']];
 s.getRange('A2').values=[['计量单位：次']];
 s.getRange('A3:E3').values=[['项目编码','项目名称','数量','参考单价','金额']];
 s.getRange('A3:E3').format={fill:'#E8EDF2',font:{bold:true}};
 s.getRange('A4:E6').values=oracle.T.template.keys.map((k,i)=>[k,oracle.T.template.names[i],q?.[i]??null,oracle.T.template.rates[i],null]);
 s.getRange('C4:C6').format.fill='#FFF2CC';
 s.getRange('D4:E8').setNumberFormat('0.00');
 s.getRange('C4:C8').setNumberFormat('0');
 for(const [a,f] of Object.entries(oracle.T.template.formulas))s.getRange(a).formulas=[[f]];
 s.getRange('A8').values=[['合计']];s.getRange('A9').values=[['复核人：待签字']];
 return wb;
}
async function save(wb,rel){
 const dest=path.join(root,rel);await fs.mkdir(path.dirname(dest),{recursive:true});
 const check=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:20}});
 inspections.push({file:rel,errors:check.ndjson});
 for(let i=0;i<wb.worksheets.items.length;i++){
  const sh=wb.worksheets.getItemAt(i);
  const preview=await wb.render({sheetName:sh.name,autoCrop:'all',scale:1,format:'png'});
  const pn=path.join(root,'observer/previews',rel.replaceAll('/','__').replace('.xlsx',`__${i}.png`));
  await fs.mkdir(path.dirname(pn),{recursive:true});await fs.writeFile(pn,new Uint8Array(await preview.arrayBuffer()));
 }
 await (await SpreadsheetFile.exportXlsx(wb)).save(dest);
 hashes.files[rel]=crypto.createHash('sha256').update(await fs.readFile(dest)).digest('hex');
}
const prompts={};
for(const id of ['J','A','T']){
 const c=oracle[id];
 for(const phase of ['discovery','holdout',...c.anomalies.map(x=>'anomaly-'+x.id)]){
  const d=phase.startsWith('anomaly')?c.anomalies.find(x=>'anomaly-'+x.id===phase):c[phase];
  const base=phase==='discovery'?`fixtures/${id}/${phase}`:`private/${id}/${phase}`;
  const wb=Workbook.create();
  if(id==='J'){
   basicSheet(wb,'订单',[['订单号','客户编号','客户名称','金额'],...d.orders]);
   basicSheet(wb,'客户',[['客户编号','客户名称','负责人'],...d.customers]);
  }else basicSheet(wb,id==='A'?'工时明细':'需求',[id==='A'?['记录编号','部门编号','工时','状态']:['项目编码','项目名称','数量'],...d.rows]);
  await save(wb,`${base}/source.xlsx`);
  if(!phase.startsWith('anomaly')){
   let result;
   if(id==='T')result=target(d.quantities);
   else {result=Workbook.create();basicSheet(result,id==='J'?'归属清单':'部门汇总',[id==='J'?['订单号','客户编号','客户名称','负责人','金额']:['部门编号','有效记录数','净工时'],...d.expected]);}
   await save(result,`${base}/expected.xlsx`);
  }
 }
 if(id==='T')await save(target(null),'fixtures/T/discovery/template.xlsx');
 const roles={ 'source.xlsx':id==='J'?'源表，包含同一批订单与客户主表':id==='A'?'源表，当批工时明细':'源表，当批需求','expected.xlsx':'与源表同一批、人工核对正确的结果'};
 if(id==='T')roles['template.xlsx']='今后需要填写的空白结果模板';
 prompts[id]={message:`我想把这项每批都要做的表格工作保存下来，以后换一批源表也能再跑。任务叫“${c.name}”。附件 source.xlsx 是${roles['source.xlsx']}，expected.xlsx 是${roles['expected.xlsx']}。${id==='T'?'template.xlsx 是今后要填的空白表。':''}请先看看材料，再帮我建任务模板。可以把这些合成文件复制到本案例目录用于回放。`,roles};
 const inbox=path.join(root,`case-${id}/inbox`);await fs.mkdir(inbox,{recursive:true});
 for(const f of Object.keys(roles))await fs.copyFile(path.join(root,`fixtures/${id}/discovery/${f}`),path.join(inbox,f));
}
await fs.writeFile(path.join(root,'observer/prompts.json'),JSON.stringify(prompts,null,2));
await fs.writeFile(path.join(root,'observer/fixture-hashes.json'),JSON.stringify(hashes,null,2));
await fs.writeFile(path.join(root,'observer/artifact-inspection.json'),JSON.stringify(inspections,null,2));
console.log(JSON.stringify({files:Object.keys(hashes.files).length,oracleSha256:frozenHash}));
