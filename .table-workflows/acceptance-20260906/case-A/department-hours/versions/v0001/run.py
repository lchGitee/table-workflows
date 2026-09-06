import argparse, datetime, json, math, pathlib, subprocess, sys
from decimal import Decimal
from structure import structure, rows, digest, filehash

ROOT = pathlib.Path(__file__).resolve().parents[2]
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def run(request_path):
    request = json.loads(request_path.read_text())
    receipt_path = request_path.with_suffix('.receipt.json')
    receipt = {'workflowId':'department-hours','version':1,'startedAt':now(),'observedStructures':[], 'warnings':[], 'exceptionCount':0, 'manualChanges':[]}
    try:
        manifest = json.loads((ROOT/'versions/v0001/version-manifest.json').read_text())
        receipt['implementationHashes'] = {a['path']:filehash(ROOT/a['path']) for a in manifest['implementation']['artifacts']}
        for a in manifest['implementation']['artifacts']:
            if receipt['implementationHashes'][a['path']] != a['sha256']: raise ValueError('实现产物已变化：'+a['path'])
        lock = json.loads((ROOT/'versions/v0001/dependencies.lock.json').read_text())
        for x in lock['files']:
            if filehash(pathlib.Path(x['path'])) != x['sha256']: raise ValueError('运行依赖完整性变化：'+x['path'])
        receipt['dependencyLock'] = 'MATCH'
        if request.get('schemaVersion') != '0.1' or request.get('workflowId') != 'department-hours' or request.get('workflowVersion') != 1: raise ValueError('请求版本不匹配')
        if request.get('parameters',{}) or set(request['inputs']) != {'source'} or len(request['inputs']['source']) != 1: raise ValueError('请求参数或输入角色不匹配')
        source = pathlib.Path(request['inputs']['source'][0]); template = pathlib.Path(request['targetTemplatePath']); output = pathlib.Path(request['outputPath'])
        if not all(x.is_absolute() for x in (source,template,output)): raise ValueError('请求必须使用绝对路径')
        if output.exists() or output.resolve() in (source.resolve(),template.resolve()): raise ValueError('拒绝覆盖已有文件或输入')
        receipt['inputHash'] = filehash(source); receipt['templateHash'] = filehash(template); receipt['outputPath'] = str(output)
        # 从本次真实文件重新观察结构；保存的 basis 仅用于解释预期契约。
        for path, expected in [(source,manifest['inputSlots'][0]['structureFingerprint']), (template,manifest['target']['structureFingerprint'])]:
            observed = structure(path); actual = digest(observed)
            matched = actual == expected['value']
            receipt['observedStructures'].append({'path':str(path),'sha256':actual,'result':'MATCH' if matched else 'DRIFT'})
            if not matched: raise ValueError('结构发生变化，请进入优化模式：'+path.name)
        source_rows = rows(source)[1:]; groups = {}; seen = set(); excluded = 0
        for index, r in enumerate(source_rows,2):
            if set(r) != {'A','B','C','D'} or not isinstance(r['A'],str) or not r['A'] or not isinstance(r['B'],str) or not r['B']: raise ValueError(f'第 {index} 行缺少记录编号或部门，需确认')
            if r['A'] in seen: raise ValueError(f'第 {index} 行记录编号重复，需确认')
            seen.add(r['A'])
            if r['D'] not in ('已确认','撤回'): raise ValueError(f'第 {index} 行状态未确认，请用户确认')
            if not isinstance(r['C'],(int,float)) or not math.isfinite(r['C']): raise ValueError(f'第 {index} 行工时不是有效数值')
            if r['D'] == '撤回': excluded += 1; continue
            group = groups.setdefault(r['B'],[0,Decimal('0')]); group[0] += 1; group[1] += Decimal(str(r['C']))
        result = [[k,v[0],float(v[1])] for k,v in sorted(groups.items())]
        output.parent.mkdir(parents=True,exist_ok=True)
        payload_path = request_path.with_suffix('.payload.json')
        payload = {'template':str(template),'output':str(output),'rows':result,'audit':str(request_path.with_suffix('.audit.json')),'preview':str(request_path.with_suffix('.preview.png'))}
        payload_path.write_text(json.dumps(payload,ensure_ascii=False,indent=2))
        subprocess.run([lock['node'],str(ROOT/'versions/v0001/author.mjs'),str(payload_path)],check=True,cwd=ROOT)
        actual_rows = rows(output)
        expected_rows = [rows(template)[0]] + [dict(zip('ABC',r)) for r in result]
        nonempty = [r for r in actual_rows if any(v is not None and v != '' for v in r.values())]
        if nonempty != expected_rows: raise ValueError('导出后逐单元格校验失败')
        receipt.update({'status':'PASS','exitStatus':0,'outputHash':filehash(output),'inputRecordCount':len(source_rows),'includedRecordCount':sum(v[0] for v in groups.values()),'excludedWithdrawnCount':excluded,'departmentCount':len(groups),'netHours':str(sum((v[1] for v in groups.values()),Decimal(0))),'unmatchedCount':0,'duplicateCount':0})
    except Exception as e:
        receipt.update({'status':'BLOCKED','exitStatus':1,'exceptionCount':1,'blockingCheck':str(e)})
    receipt['finishedAt'] = now(); receipt_path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
    print(json.dumps(receipt,ensure_ascii=False)); return receipt['exitStatus']
if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--request',required=True)
    sys.exit(run(pathlib.Path(parser.parse_args().request)))
