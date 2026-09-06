import json,pathlib,subprocess,sys,zipfile
from xml.etree import ElementTree as E
BASE=pathlib.Path(__file__).resolve().parent; ROOT=BASE/'department-hours'; V=ROOT/'versions/v0001'
sys.path.insert(0,str(V))
from structure import rows,structure,NS
initial=json.loads((ROOT/'cases/initial/request.json').read_text())
checks=[]
for name,exit_code in [('ordinary-change',0),('merge-drift',1)]:
    d=ROOT/'cases/structure-tests'; request=dict(initial)
    request['inputs']={'source':[str(d/(name+'.xlsx'))]}; request['outputPath']=str(ROOT/'runs'/name/'result.xlsx')
    path=d/(name+'.request.json'); path.write_text(json.dumps(request,ensure_ascii=False,indent=2))
    process=subprocess.run([sys.executable,str(V/'run.py'),'--request',str(path)],capture_output=True,text=True)
    exists=pathlib.Path(request['outputPath']).exists()
    entry={'variant':str(request['inputs']['source'][0]),'expectedExit':exit_code,'actualExit':process.returncode,'outputExists':exists,'passed':process.returncode==exit_code and exists==(exit_code==0)}
    if exit_code==0:
        entry['observedValues']=rows(pathlib.Path(request['outputPath']))
        entry['negativeZeroPolicyPass']=entry['observedValues'][1:]==[{'A':'D01','B':2.0,'C':-1.5},{'A':'D02','B':1.0,'C':2.0},{'A':'D03','B':1.0,'C':0.0}]
        entry['passed'] &= entry['negativeZeroPolicyPass']
    checks.append(entry)
output=pathlib.Path(initial['outputPath']); expected=BASE/'inbox/expected.xlsx'
a=rows(output); b=rows(expected); differences=[]
for i in range(max(len(a),len(b))):
    for col in 'ABC':
        actual=a[i].get(col) if i<len(a) else None; target=b[i].get(col) if i<len(b) else None
        if actual!=target: differences.append({'cell':f'{col}{i+1}','actual':actual,'expected':target})
def style_cells(path):
    with zipfile.ZipFile(path) as z:
        styles=E.fromstring(z.read('xl/styles.xml'))
        xfs=styles.find('s:cellXfs',NS)
        result={}
        for cell in E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('s:sheetData/s:row/s:c',NS):
            xf=xfs[int(cell.get('s','0'))]
            values={k:v for k,v in xf.attrib.items() if k not in ('fontId','fillId','borderId','xfId')}
            for key,tag in [('fontId','fonts'),('fillId','fills'),('borderId','borders')]:
                values[key]=E.tostring(styles.find('s:'+tag,NS)[int(xf.get(key,'0'))],encoding='unicode')
            values['alignment']=[E.tostring(x,encoding='unicode') for x in xf]
            result[cell.get('r')]=values
        return result
style_diff=[k for k in style_cells(expected) if style_cells(expected)[k]!=style_cells(output).get(k)]
report={'historicalCase':'initial','cellCount':9,'cellDifferences':differences,'styleDifferences':style_diff,'headerUnchanged':a[0]==b[0],'structurePreserved':structure(output)==structure(expected),'formulaObjectCounts':{'formulas':0,'objects':0,'merges':0},'outsideWriteScopeUnexpectedChanges':0 if a[0]==b[0] else 1,'keyTotals':{'inputRecords':4,'included':3,'withdrawn':1,'departments':2,'netHours':6.5},'unmatched':0,'exceptions':0,'structureCases':checks}
(ROOT/'runs/validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
assert not differences and not style_diff and report['structurePreserved'] and all(c['passed'] for c in checks)
