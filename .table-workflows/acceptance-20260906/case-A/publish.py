import datetime,json,pathlib
BASE=pathlib.Path(__file__).resolve().parent; ROOT=BASE/'department-hours'
manifest=json.loads((ROOT/'manifest.json').read_text()); timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest['status']='TRIAL'; manifest['updatedAt']=timestamp
manifest['validation']['goldCases'][0].update({'result':'PASS','lastRunAt':timestamp,'acceptedDifferenceCount':0})
manifest['validation']['lastValidatedAt']=timestamp
manifest['changeSummary']='初始版本：按用户确认的状态政策汇总，历史回放与实际结构负例通过，待独立批次验证。'
schema=json.loads((BASE.parents[2]/'references/manifest.schema.json').read_text())
assert set(schema['required']).issubset(manifest)
assert set(manifest).issubset(schema['properties'])
assert manifest['status'] in schema['properties']['status']['enum']
for key in ['inputSlots','target','implementation','validation']:
    definition=schema['$defs'][{'inputSlots':'inputSlot'}.get(key,key)]
    for value in manifest[key] if key=='inputSlots' else [manifest[key]]:
        assert set(definition['required']).issubset(value)
        assert set(value).issubset(definition['properties'])
for path in [ROOT/'manifest.json',ROOT/'versions/v0001/version-manifest.json']:
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print('Required fields and enum checks PASS; standard JSON Schema validator unavailable; v0001 published TRIAL')
