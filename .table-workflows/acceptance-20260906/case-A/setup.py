import datetime, hashlib, json, pathlib, shutil, subprocess, sys
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE/'department-hours'; V = ROOT/'versions/v0001'
sys.path.insert(0,str(V))
from structure import structure,digest,filehash
NODE = pathlib.Path('/Users/lch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
MODULES = NODE.parent.parent/'node_modules'
def write(path, value):
    path.parent.mkdir(parents=True,exist_ok=True); path.write_text(json.dumps(value,ensure_ascii=False,indent=2))
files={}; packages={}
def visit(path):
    path=path.resolve()
    if str(path) in packages: return
    metadata=json.loads((path/'package.json').read_text())
    packages[str(path)]={'name':metadata['name'],'version':metadata['version']}
    # 锁定每个直接与传递依赖的实际文件内容，不把符号链接当作锁。
    for file in sorted(path.rglob('*')):
        if file.is_file() and 'node_modules' not in file.relative_to(path).parts:
            files[str(file)] = filehash(file)
    for name in metadata.get('dependencies',{}):
        candidates=[path/'node_modules'/name]+[parent/'node_modules'/name for parent in path.parents]
        match=next((p for p in candidates if (p/'package.json').exists()),None)
        if match is None: raise RuntimeError('缺少依赖 '+name)
        visit(match)
visit(MODULES/'@oai/artifact-tool')
files[str(NODE)]=filehash(NODE)
lock={'node':str(NODE),'nodeVersion':subprocess.check_output([str(NODE),'--version'],text=True).strip(),'python':sys.executable,'pythonVersion':sys.version,'packages':packages,'files':[{'path':k,'sha256':v} for k,v in sorted(files.items())]}
write(V/'dependencies.lock.json',lock)
link=ROOT/'node_modules'
if not link.exists(): link.symlink_to(MODULES,target_is_directory=True)
(ROOT/'templates').mkdir(exist_ok=True)
shutil.copyfile(BASE/'inbox/expected.xlsx',ROOT/'templates/result.xlsx')
source_structure=structure(BASE/'inbox/source.xlsx'); target_structure=structure(ROOT/'templates/result.xlsx')
write(V/'structure/source.json',source_structure); write(V/'structure/target.json',target_structure)
timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest={'schemaVersion':'0.1','workflowId':'department-hours','name':'部门工时汇总','version':1,'status':'DRAFT','createdAt':timestamp,'updatedAt':timestamp,
'inputSlots':[{'slotId':'source','label':'当批工时明细','required':True,'multiple':False,'acceptedExtensions':['.xlsx'],'structureFingerprint':{'algorithm':'sha256','value':digest(source_structure),'basis':'versions/v0001/structure/source.json'}}],
'target':{'mode':'SAVED_TEMPLATE','templatePath':'templates/result.xlsx','structureFingerprint':{'algorithm':'sha256','value':digest(target_structure),'basis':'versions/v0001/structure/target.json'},'outputExtension':'.xlsx','writeScopes':['部门汇总!A2:C1048576'],'protectedScopes':['部门汇总!A1:C1'],'preserveUnlistedCells':True},
'implementation':{'kind':'SCRIPT','entrypoint':'versions/v0001/run.py','command':[sys.executable,'versions/v0001/run.py','--request','{request}'],'runtime':'Python 标准库读取与校验；bundled Node.js + @oai/artifact-tool 生成工作簿','artifacts':[]},
'parameters':[], 'validation':{'goldCases':[{'caseId':'initial','storage':'REPLAYABLE','requestPath':'cases/initial/request.json','expectedResultPath':str(BASE/'inbox/expected.xlsx'),'result':'NOT_RUN','usedForDiscovery':True}],'invariants':[{'id':'status-policy','description':'只统计已确认，保留负数和零；未知状态阻断','severity':'BLOCK'},{'id':'balance','description':'净工时等于全部已确认记录工时之和；有效记录数逐行计数','severity':'BLOCK'}]}}
for name,kind in [('run.py','SCRIPT'),('structure.py','SCRIPT'),('author.mjs','SCRIPT'),('dependencies.lock.json','DEPENDENCY_LOCK'),('structure/source.json','STRUCTURE_CONTRACT'),('structure/target.json','STRUCTURE_CONTRACT')]:
    p=V/name; manifest['implementation']['artifacts'].append({'path':str(p.relative_to(ROOT)),'kind':kind,'sha256':filehash(p)})
write(ROOT/'manifest.json',manifest); write(V/'version-manifest.json',manifest)
request={'schemaVersion':'0.1','workflowId':'department-hours','workflowVersion':1,'inputs':{'source':[str(BASE/'inbox/source.xlsx')]},'targetTemplatePath':str(ROOT/'templates/result.xlsx'),'outputPath':str(ROOT/'runs/initial/result.xlsx'),'parameters':{}}
write(ROOT/'cases/initial/request.json',request)
print(json.dumps({'packages':len(packages),'lockedFiles':len(files),'sourceStructure':source_structure,'targetStructure':target_structure},ensure_ascii=False))
