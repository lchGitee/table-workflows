import sys,pathlib,json,shutil,datetime,subprocess
BASE=pathlib.Path(__file__).resolve().parent; ROOT=BASE/'service-plan'; V=ROOT/'versions/v0001'
sys.path.insert(0,str(V))
from structure import sha,extract,digest
node='/Users/lch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
mods=pathlib.Path('/Users/lch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
for folder in ['structure','../../templates','../../cases/historical','../../runs/history']:(V/folder).mkdir(parents=True,exist_ok=True)
for f in ['source','expected']:shutil.copyfile(BASE/f'inbox/{f}.xlsx',ROOT/f'cases/historical/{f}.xlsx')
shutil.copyfile(BASE/'inbox/template.xlsx',ROOT/'templates/template.xlsx')
lock={'node':node,'nodeVersion':subprocess.check_output([node,'--version'],text=True).strip(),'packages':{},'files':{node:sha(node)}}
for p in (mods/'@oai/artifact-tool').rglob('*'):
    if p.is_file():lock['files'][str(p)]=sha(p)
for p in mods.glob('*/package.json'):
    d=json.loads(p.read_text());lock['packages'][d.get('name',str(p))]=d.get('version');lock['files'][str(p)]=sha(p)
for p in mods.glob('@*/*/package.json'):
    d=json.loads(p.read_text());lock['packages'][d.get('name',str(p))]=d.get('version');lock['files'][str(p)]=sha(p)
(V/'dependencies.lock.json').write_text(json.dumps(lock,ensure_ascii=False,indent=2))
fps={}
for role in ['source','template']:
    obj=extract(BASE/f'inbox/{role}.xlsx',role); rel=f'versions/v0001/structure/{role}.json';(ROOT/rel).write_text(json.dumps(obj,ensure_ascii=False,indent=2));fps[role]={'algorithm':'sha256','value':digest(obj),'basis':rel}
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
m={'schemaVersion':'0.1','workflowId':'service-plan','name':'服务计划回填','version':1,'status':'DRAFT','createdAt':now,'updatedAt':now,'parameters':[], 'inputSlots':[{'slotId':'source','label':'当批需求','required':True,'multiple':False,'acceptedExtensions':['.xlsx'],'structureFingerprint':fps['source']}], 'target':{'mode':'SAVED_TEMPLATE','templatePath':'templates/template.xlsx','outputExtension':'.xlsx','structureFingerprint':fps['template'],'writeScopes':['计划表!C4:C6'],'protectedScopes':['计划表!A1:B9','计划表!D1:E9','计划表!C1:C3','计划表!C7:C9'],'preserveUnlistedCells':True},'implementation':{'kind':'SCRIPT','entrypoint':'versions/v0001/run.py','command':[sys.executable,'versions/v0001/run.py','--request','{request}'],'runtime':'Python 标准库 + 锁定的 Node.js / @oai/artifact-tool','artifacts':[]},'validation':{'goldCases':[{'caseId':'historical','storage':'REPLAYABLE','requestPath':'runs/history/request.json','expectedResultPath':'cases/historical/expected.xlsx','result':'NOT_RUN','usedForDiscovery':True}],'invariants':[{'id':'unique-known-code','description':'重复编码或未知项目阻断','severity':'BLOCK'},{'id':'quantity-sum','description':'输出数量合计等于当批源表数量合计，缺失需求填零','severity':'BLOCK'}]}}
for p in sorted(V.rglob('*')):
    if p.is_file() and '__pycache__' not in str(p):m['implementation']['artifacts'].append({'path':str(p.relative_to(ROOT)),'kind':'DEPENDENCY_LOCK' if p.name=='dependencies.lock.json' else 'STRUCTURE_CONTRACT' if p.parent.name=='structure' else 'SCRIPT','sha256':sha(p)})
(ROOT/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2))
req={'schemaVersion':'0.1','workflowId':'service-plan','workflowVersion':1,'inputs':{'source':[str(ROOT/'cases/historical/source.xlsx')]},'targetTemplatePath':str(ROOT/'templates/template.xlsx'),'outputPath':str(ROOT/'runs/history/result.xlsx'),'parameters':{}}
(ROOT/'runs/history/request.json').write_text(json.dumps(req,ensure_ascii=False,indent=2))
