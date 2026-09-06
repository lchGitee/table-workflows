import hashlib
import importlib.util
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('independent',ROOT/'harness/independent-check.py')
checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
paths={'J':('order-ownership','history','next'),'A':('department-hours','initial','next-batch'),'T':('service-plan','history','new-batch')}
cross=[]
for case,(bundle,history,heldout) in paths.items():
    for phase,run in [('discovery',history),('holdout',heldout)]:
        output=ROOT/f'case-{case}'/bundle/'runs'/run/'result.xlsx'
        row=checker.check(case,phase,output)
        row['sha256']=hashlib.sha256(output.read_bytes()).hexdigest()
        cross.append(row)
reuse=json.loads((ROOT/'reuse/results.json').read_text())['cases']
anomalies=json.loads((ROOT/'anomaly-results.json').read_text())
links=[]
for p in [ROOT/'plan.md',ROOT/'report.md',ROOT/'real-user-trial.md',ROOT/'reuse/summary.md']:
    for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
        if '://' not in target:links.append({'file':str(p.relative_to(ROOT)),'target':target,'exists':(p.parent/target.split('#')[0]).exists()})
report={'coreCaseCount':len(cross)+len(reuse)+len(anomalies),'allCoreCasesPass':all(r['pass'] for r in cross) and all(r['passed'] for r in reuse+anomalies),'crossBusiness':cross,'checkedCrossBusinessCells':sum(r['checkedCells'] for r in cross),'negativeOutputStillAbsent':all(not (ROOT/r['evidenceDirectory']/'result.xlsx').exists() for r in anomalies),'reportLinks':links,'scope':'synthetic tests on one host; real user, cross exporter, clean machine NOT_RUN'}
(ROOT/'acceptance-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in report.items() if k!='crossBusiness'},ensure_ascii=False))
