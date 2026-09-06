import json,sys,pathlib,datetime,subprocess,math
from structure import sha,extract,digest,read
ROOT=pathlib.Path(__file__).resolve().parents[2]
def main(reqpath):
    request=json.loads(pathlib.Path(reqpath).read_text()); m=json.loads((ROOT/'manifest.json').read_text())
    receipt={'workflowId':m['workflowId'],'version':m['version'],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'observedStructures':[],'warnings':[],'exceptionCount':0,'manualEdits':[]}
    out=pathlib.Path(request['outputPath']); receiptpath=pathlib.Path(str(reqpath)+'.receipt.json')
    try:
        assert request['workflowId']==m['workflowId'] and request['workflowVersion']==m['version'],'请求版本不匹配'
        assert request['parameters']=={} and set(request['inputs'])=={'source'} and len(request['inputs']['source'])==1,'请求角色或参数不匹配'
        for a in m['implementation']['artifacts']: assert sha(ROOT/a['path'])==a['sha256'],'实现或契约发生变化：'+a['path']
        receipt['implementationHashes']=m['implementation']['artifacts']
        lock=json.loads((ROOT/'versions/v0001/dependencies.lock.json').read_text())
        for p,h in lock['files'].items(): assert sha(p)==h,'依赖发生变化：'+p
        source=pathlib.Path(request['inputs']['source'][0]); template=pathlib.Path(request['targetTemplatePath'])
        assert all(p.is_absolute() for p in (source,template,out)),'路径必须绝对路径'
        assert out.resolve() not in (source.resolve(),template.resolve()) and not out.exists(),'不得覆盖输入或已有结果'
        receipt['fileHashes']={'source':sha(source),'template':sha(template)}
        for role,path,expected in [('source',source,m['inputSlots'][0]['structureFingerprint']),('template',template,m['target']['structureFingerprint'])]:
            actual=extract(path,role); observed=digest(actual); ok=observed==expected['value']
            receipt['observedStructures'].append({'role':role,'path':str(path),'fingerprint':observed,'expected':expected['value'],'match':ok})
            assert ok,'结构变化，请进入优化模式：'+role
            assert not actual['objects'],'存在未支持工作簿对象，请进入优化模式'
        # 结构检查通过后才读取业务数量；重复与未知编码按用户政策阻断。
        cells=read(source)[2][0][2]; targetcells=read(template)[2][0][2]; quantities={}
        targetkeys=[targetcells[f'A{r}']['value'] for r in range(4,7)]
        assert len(set(targetkeys))==len(targetkeys),'模板存在重复编码'
        for row in sorted(set(int(''.join(filter(str.isdigit,a))) for a,c in cells.items() if c['value'] is not None)-{1}):
            key=cells.get(f'A{row}',{}).get('value'); q=cells.get(f'C{row}',{}).get('value')
            assert key and key not in quantities,'编码缺失或重复，请确认'
            assert key in targetkeys,'需求出现计划表没有的项目，请确认'
            assert isinstance(q,(float,int)) and math.isfinite(q),'数量为空或非数字，请确认'
            quantities[key]=q
        result=[quantities.get(k,0) for k in targetkeys]
        out.parent.mkdir(parents=True,exist_ok=True)
        payload=pathlib.Path(str(reqpath)+'.values.json');payload.write_text(json.dumps(result))
        proc=subprocess.run([lock['node'],str(ROOT/'versions/v0001/write.mjs'),str(template),str(out),str(payload)],capture_output=True,text=True)
        assert proc.returncode==0,proc.stderr[-2000:]
        receipt.update({'exitStatus':0,'outputPath':str(out),'outputHash':sha(out),'sourceRecordCount':len(quantities),'outputRecordCount':3,'unmatchedRecordCount':0,'missingFilledZeroCount':len(set(targetkeys)-set(quantities)),'quantitySum':sum(result),'amountSum':sum(result[i]*targetcells[f'D{i+4}']['value'] for i in range(3))})
    except Exception as e:
        receipt.update({'exitStatus':1,'exceptionCount':1,'blockingReason':str(e),'outputProduced':out.exists()})
    receipt['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();receiptpath.write_text(json.dumps(receipt,ensure_ascii=False,indent=2));print(json.dumps(receipt,ensure_ascii=False));return receipt['exitStatus']
if __name__=='__main__':sys.exit(main(sys.argv[sys.argv.index('--request')+1]))
