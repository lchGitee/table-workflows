import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
OLD=REPO/'.table-workflows/behavior-eval-20260905/s2/.table-workflows/monthly-shipped'
SOURCE=REPO/'.table-workflows/behavior-eval-20260905/private/fixtures/next-batch.xlsx'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def snapshot():
    files=[REPO/'SKILL.md',REPO/'agents/openai.yaml',*sorted((REPO/'references').glob('*')),*sorted(OLD.rglob('*')),SOURCE]
    return {str(p):sha(p) for p in files if p.is_file() and 'node_modules' not in p.parts}
def values(p):
    ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(p) as z:
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
        result=[]
        for name in sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')):
            cells={}
            for c in ET.fromstring(z.read(name)).findall('.//s:sheetData/s:row/s:c',ns):
                t=c.get('t');v=c.find('s:v',ns)
                if t=='inlineStr': val=''.join(c.find('s:is',ns).itertext())
                elif v is None: continue
                elif t=='s': val=strings[int(v.text)]
                elif t in ('str','e'): val=v.text
                else: val=float(v.text)
                cells[c.get('r')]=val
            result.append(cells)
        return result
def expected_cells(rows): return [{f'{chr(65+c)}{r+1}':v for r,row in enumerate(rows) for c,v in enumerate(row)}]

if sys.argv[1]=='freeze':
    p=ROOT/'before.json'
    if p.exists(): raise RuntimeError('快照已存在')
    p.write_text(json.dumps(snapshot(),ensure_ascii=False,indent=2))
    print('frozen',len(snapshot()))
elif sys.argv[1]=='run':
    oracle=json.loads((ROOT/'oracle.json').read_text())
    results=[]
    for name,expected in oracle.items():
        bundle=ROOT/('moved workspace' if name=='moved' else name)/'.table-workflows/monthly-shipped'
        if name!='tampered':
            bundle.mkdir(parents=True)
            shutil.copy2(OLD/'manifest.json',bundle/'manifest.json')
            shutil.copytree(OLD/'versions',bundle/'versions',symlinks=True)
        source=SOURCE if name in ('baseline','moved','tampered') else ROOT/'inputs'/f'{name}.xlsx'
        output=bundle/'result.xlsx';request=bundle/'test.json'
        request.write_text(json.dumps({'schemaVersion':'0.1','workflowId':'monthly-shipped','workflowVersion':3,'inputs':{'orders':[str(source)]},'outputPath':str(output),'parameters':{}}))
        manifest=json.loads((bundle/'manifest.json').read_text())
        command=[str(request) if a=='{request}' else a for a in manifest['implementation']['command']]
        process=subprocess.run(command,cwd=bundle,capture_output=True,text=True)
        (bundle/'execution.log').write_text(process.stdout+process.stderr)
        receipt=json.loads(request.with_suffix('.receipt.json').read_text()) if request.with_suffix('.receipt.json').exists() else None
        actual=values(output) if output.exists() else None
        passed=(process.returncode!=0 and not output.exists()) if expected=='BLOCK' else (process.returncode==0 and actual==expected_cells(expected))
        results.append({'case':name,'expected':expected,'exitCode':process.returncode,'outputExists':output.exists(),'actual':actual,'passed':passed,'receipt':receipt,'inputHash':sha(source)})
        print(name,passed,process.returncode,flush=True)
    before=json.loads((ROOT/'before.json').read_text())
    report={'cases':results,'originalFilesUnchanged':before==snapshot(),'crossExporter':'NOT_RUN: no LibreOffice or Microsoft Excel found','scope':'same-host directory relocation; not clean-machine portability'}
    (ROOT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
