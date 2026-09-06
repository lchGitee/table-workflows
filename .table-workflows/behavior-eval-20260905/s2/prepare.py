import hashlib
import importlib.metadata
import importlib.util
import json
import os
import platform
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

BASE=Path(__file__).resolve().parent
ROOT=BASE/'.table-workflows/monthly-shipped'
VERSION=ROOT/'versions/v0001'
NODE=Path('/Users/lch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
MODULES=NODE.parent.parent/'node_modules'
spec=importlib.util.spec_from_file_location('runner',VERSION/'run.py')
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    runner.save(path,value)


lock={'pythonVersion':platform.python_version(),'pythonPackages':[],'nodePackages':[],
      'nodePath':str(NODE),'nodeVersion':subprocess.check_output([str(NODE),'--version'],text=True).strip(),'files':{}}
for name in ('openpyxl','et_xmlfile'):
    dist=importlib.metadata.distribution(name)
    lock['pythonPackages'].append({'name':name,'version':dist.version})
    for file in dist.files:
        path=Path(dist.locate_file(file)).resolve()
        if path.is_file() and path.suffix not in ('.pyc',):
            lock['files'][str(path)]=runner.sha(path)


def resolve_package(name,start):
    for parent in [start,*start.parents]:
        candidate=parent/'node_modules'/name
        if (candidate/'package.json').exists():
            return candidate.resolve()
    raise ValueError('缺少依赖 '+name)


visited=set()
def add_package(path):
    if path in visited:
        return
    visited.add(path)
    meta=json.loads((path/'package.json').read_text())
    lock['nodePackages'].append({'name':meta['name'],'version':meta['version'],'path':str(path)})
    # 锁定实装文件的内容，并单独解析传递依赖的精确版本。
    for folder,dirs,files in os.walk(path):
        dirs[:]=[d for d in dirs if d!='node_modules']
        for filename in files:
            p=Path(folder)/filename
            lock['files'][str(p.resolve())]=runner.sha(p)
    deps={**meta.get('dependencies',{}),**meta.get('optionalDependencies',{})}
    for name in deps:
        try:
            child=resolve_package(name,path)
        except ValueError:
            if name in meta.get('optionalDependencies',{}):
                continue
            raise
        add_package(child)


add_package((MODULES/'@oai/artifact-tool').resolve())
lock['files'][str(NODE)]=runner.sha(NODE)
write(VERSION/'dependencies.lock.json',lock)
if not (ROOT/'node_modules').exists():
    (ROOT/'node_modules').symlink_to(MODULES,target_is_directory=True)
source=BASE/'inbox/原表.xlsx'
expected=BASE/'inbox/我做好的.xlsx'
structure=runner.structure(source)
write(VERSION/'structure/orders.json',structure)
write(VERSION/'structure/expected-result.json',runner.structure(expected))
timestamp=runner.now()
manifest={
    'schemaVersion':'0.1','workflowId':'monthly-shipped','name':'月度仓库发货汇总','description':'只统计发货状态为已发货的订单，按仓库代码汇总件数；收款状态不参与判断。',
    'version':1,'status':'DRAFT','createdAt':timestamp,'updatedAt':timestamp,
    'inputSlots':[{'slotId':'orders','label':'订单原表','required':True,'multiple':False,'acceptedExtensions':['.xlsx'],
      'structureFingerprint':{'algorithm':'sha256','value':runner.digest(structure),'basis':'versions/v0001/structure/orders.json'}}],
    'target':{'mode':'GENERATED','outputExtension':'.xlsx','writeScopes':['汇总!A1:B<result-row-count+1>'],'protectedScopes':[], 'preserveUnlistedCells':True},
    'implementation':{'kind':'SCRIPT','entrypoint':'versions/v0001/run.py','command':[sys.executable,'versions/v0001/run.py','--request','{request}'],
      'runtime':'Python '+platform.python_version()+' + Node '+lock['nodeVersion']+'; dependencies.lock.json', 'artifacts':[]},
    'parameters':[],
    'validation':{'goldCases':[{'caseId':'historical','storage':'REPLAYABLE','requestPath':'runs/historical.json','expectedResultPath':str(expected),'result':'NOT_RUN','usedForDiscovery':True}],
      'invariants':[{'id':'shipment-only','description':'仅已发货行计入，收款状态不影响结果','severity':'BLOCK'},
                    {'id':'unique-order','description':'订单号缺失或重复时阻断，请人工确认业务口径','severity':'BLOCK'},
                    {'id':'balanced-total','description':'结果件数合计等于已发货行件数合计','severity':'BLOCK'}]},
    'changeSummary':'创建首个版本；用户已确认仅以发货状态筛选。'
}
for path,kind in [('run.py','SCRIPT'),('render.mjs','SCRIPT'),('dependencies.lock.json','DEPENDENCY_LOCK'),('structure/orders.json','STRUCTURE_CONTRACT'),('structure/expected-result.json','STRUCTURE_CONTRACT')]:
    manifest['implementation']['artifacts'].append({'path':'versions/v0001/'+path,'kind':kind,'sha256':runner.sha(VERSION/path)})
write(ROOT/'manifest.json',manifest)
write(VERSION/'version-manifest.json',manifest)


def request(name,sourcepath):
    data={'schemaVersion':'0.1','workflowId':'monthly-shipped','workflowVersion':1,'inputs':{'orders':[str(sourcepath)]},
          'outputPath':str(ROOT/'runs'/f'{name}-result.xlsx'),'parameters':{}}
    write(ROOT/'runs'/f'{name}.json',data)


request('historical',source)
ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
for name,hidden in [('data-variance',False),('hidden-column',True)]:
    path=ROOT/'runs/fixtures'/f'{name}.xlsx'
    path.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(source) as original,zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as target:
        for info in original.infolist():
            content=original.read(info.filename)
            if info.filename=='xl/worksheets/sheet1.xml':
                xml=ET.fromstring(content)
                data=xml.find(ns+'sheetData')
                for row in list(data):
                    if row.attrib['r']!='1':
                        data.remove(row)
                rows=[['SYN01','SYN-W1',7,'已发货','未收款'],['SYN02','SYN-W1',6,'待发货','已收款'],['SYN03','SYN-W2',11,'已发货','已收款']]
                for number,values in enumerate(rows,2):
                    row=ET.SubElement(data,ns+'row',{'r':str(number)})
                    for col,value in enumerate(values):
                        cell=ET.SubElement(row,ns+'c',{'r':chr(65+col)+str(number),'s':'1','t':'n' if isinstance(value,int) else 'str'})
                        ET.SubElement(cell,ns+'v').text=str(value)
                if hidden:
                    xml.find(ns+'cols')[1].set('hidden','1')
                content=ET.tostring(xml,encoding='utf-8',xml_declaration=True)
            if info.filename=='xl/sharedStrings.xml':
                content=b'<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>'
            target.writestr(info,content)
    request(name,path)

schema=json.loads(Path('/Users/lch/Desktop/project/table-workflows/references/manifest.schema.json').read_text())
assert set(schema['required']) <= set(manifest)
assert set(manifest) <= set(schema['properties'])
print(json.dumps({'manifestRequiredFields':'PASS','fullSchemaValidation':False,'lockedNodePackages':len(lock['nodePackages']),'lockedFiles':len(lock['files']), 'workflow':str(ROOT)},ensure_ascii=False))
