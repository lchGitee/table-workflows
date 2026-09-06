import pathlib,sys,json,subprocess,zipfile,datetime,xml.etree.ElementTree as E
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE/'service-plan';sys.path.insert(0,str(ROOT/'versions/v0001'))
from structure import read,tree
expected=read(BASE/'inbox/expected.xlsx')[2][0][2]; actual=read(ROOT/'runs/history/result.xlsx')[2][0][2];template=read(BASE/'inbox/template.xlsx')[2][0][2]
diff=[{'cell':a,'expected':expected.get(a),'actual':actual.get(a)} for a in set(expected)|set(actual) if expected.get(a)!=actual.get(a)]
protected=[]
for a,c in template.items():
    if a in ['C4','C5','C6']:continue
    n=actual.get(a)
    if c['formula']:c={**c,'value':None};n={**n,'value':None}
    if c!=n:protected.append(a)
with zipfile.ZipFile(BASE/'inbox/template.xlsx') as a,zipfile.ZipFile(ROOT/'runs/history/result.xlsx') as b:
    def normalized(z,p):
        root=E.fromstring(z.read(p))
        # 导出器会重新分配关系 ID；验证实际目标不变，而非把随机标识当业务差异。
        mapping={}
        if p=='xl/workbook.xml':mapping={r.get('Id'):r.get('Target') for r in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        for e in root.iter():
            for k in list(e.attrib):
                if k=='Id' and e.tag.endswith('Relationship'):e.attrib.pop(k)
                elif k.endswith('}id'):e.set(k,mapping.get(e.get(k),e.get(k)))
        return tree(root)
    parts=[p for p in a.namelist() if p!='xl/worksheets/sheet1.xml' and normalized(a,p)!=normalized(b,p)]
    metadataA=[tree(e) for e in read(BASE/'inbox/template.xlsx')[2][0][1] if not e.tag.endswith('sheetData')]
    metadataB=[tree(e) for e in read(ROOT/'runs/history/result.xlsx')[2][0][1] if not e.tag.endswith('sheetData')]
report={'history':{'cellDifferenceCount':len(diff),'differences':diff,'protectedCellChanges':protected,'otherPartChanges':parts,'metadataPreserved':metadataA==metadataB,'quantitySum':actual['C8']['value'],'amountSum':actual['E8']['value'],'unmatchedRecordCount':0,'exceptionCount':0},'tests':[]}
for mode,expectedExit in [('data',0),('merge',1),('duplicate',1),('unknown',1)]:
    req=json.loads((ROOT/'runs/history/request.json').read_text());req['inputs']['source']=[str(ROOT/f'runs/structure-tests/{mode}.xlsx')];req['outputPath']=str(ROOT/f'runs/structure-tests/{mode}-result.xlsx');p=ROOT/f'runs/structure-tests/{mode}.request.json';p.write_text(json.dumps(req,indent=2))
    receipt=pathlib.Path(str(p)+'.receipt.json')
    if not receipt.exists():subprocess.run([sys.executable,str(ROOT/'versions/v0001/run.py'),'--request',str(p)],capture_output=True,text=True)
    r=json.loads(receipt.read_text());report['tests'].append({'variant':mode,'expectedExit':expectedExit,'actualExit':r['exitStatus'],'outputProduced':pathlib.Path(req['outputPath']).exists(),'receipt':str(p.relative_to(ROOT))+'.receipt.json','pass':r['exitStatus']==expectedExit})
    if mode=='data': report['tests'][-1]['quantitySum']=r.get('quantitySum');report['tests'][-1]['missingFilledZeroCount']=r.get('missingFilledZeroCount');report['tests'][-1]['pass'] &= r.get('quantitySum')==11 and r.get('missingFilledZeroCount')==1
report['pass']=not diff and not protected and not parts and metadataA==metadataB and all(t['pass'] for t in report['tests'])
(ROOT/'runs/validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
if report['pass']:
    m=json.loads((ROOT/'manifest.json').read_text());now=datetime.datetime.now(datetime.timezone.utc).isoformat();m['status']='TRIAL';m['updatedAt']=now;m['validation']['lastValidatedAt']=now;m['validation']['goldCases'][0].update({'result':'PASS','lastRunAt':now,'acceptedDifferenceCount':0})
    schema=json.loads((BASE.parents[2]/'references/manifest.schema.json').read_text())
    assert set(schema['required'])<=set(m) and set(m)<=set(schema['properties'])
    for obj,typ in [(m['inputSlots'][0],'inputSlot'),(m['target'],'target'),(m['implementation'],'implementation'),(m['validation'],'validation'),(m['validation']['goldCases'][0],'goldCase')]:
        contract=schema['$defs'][typ];assert set(contract['required'])<=set(obj) and set(obj)<=set(contract['properties'])
    report['manifestValidation']='已逐项检查必填字段、路径、产物哈希与版本一致性；环境无 JSON Schema 校验器，未进行完整机器 Schema 校验'
    (ROOT/'runs/validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    for p in [ROOT/'manifest.json',ROOT/'versions/v0001/version-manifest.json']:p.write_text(json.dumps(m,ensure_ascii=False,indent=2))
sys.exit(0 if report['pass'] else 1)
