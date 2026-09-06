import hashlib
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
names={'J':'order-ownership','A':'department-hours','T':'service-plan'}
reports=[]
for case,name in names.items():
    bundle=ROOT/f'case-{case}'/name
    manifest=json.loads((bundle/'manifest.json').read_text())
    for kind in ('duplicate','unknown'):
        src=ROOT/'private'/case/f'anomaly-{kind}'/'source.xlsx'
        run=ROOT/'anomaly-runs'/case/kind
        run.mkdir(parents=True)
        output=run/'result.xlsx';request=run/'request.json'
        payload={'schemaVersion':'0.1','workflowId':manifest['workflowId'],'workflowVersion':manifest['version'],'inputs':{manifest['inputSlots'][0]['slotId']:[str(src)]},'outputPath':str(output),'parameters':{}}
        if manifest['target']['mode']=='SAVED_TEMPLATE':payload['targetTemplatePath']=str(bundle/manifest['target']['templatePath'])
        request.write_text(json.dumps(payload,ensure_ascii=False,indent=2))
        cmd=[str(request) if x=='{request}' else x for x in manifest['implementation']['command']]
        result=subprocess.run(cmd,cwd=bundle,capture_output=True,text=True)
        (run/'execution.log').write_text(result.stdout+result.stderr)
        reports.append({'case':case,'kind':kind,'expected':'BLOCK_NO_OUTPUT','exitCode':result.returncode,'outputExists':output.exists(),'passed':result.returncode!=0 and not output.exists(),'sourceSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'stdout':result.stdout,'stderr':result.stderr,'evidenceDirectory':str(run.relative_to(ROOT))})
        print(case,kind,result.returncode,output.exists(),flush=True)
(ROOT/'anomaly-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
