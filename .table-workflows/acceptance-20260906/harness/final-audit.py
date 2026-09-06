import hashlib
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if len(sys.argv)>1 and sys.argv[1]=='freeze':
    state={str(p.relative_to(ROOT)):sha(p) for case in sys.argv[2] for p in (ROOT/f'case-{case}').rglob('*') if p.is_file() and ('versions' in p.parts or p.name=='manifest.json') and 'node_modules' not in p.parts and '__pycache__' not in p.parts}
    dest=ROOT/f"versions-before-{sys.argv[2]}.json"
    if dest.exists():raise RuntimeError('拒绝覆盖快照')
    dest.write_text(json.dumps(state,ensure_ascii=False,indent=2));print('snapshot',len(state));raise SystemExit(0)
schema=json.loads((REPO/'references/manifest.schema.json').read_text())
validator=Draft202012Validator(schema,format_checker=FormatChecker())
rows=[]
for case in 'JAT':
    for p in sorted((ROOT/f'case-{case}').rglob('manifest.json')):
        if 'node_modules' in p.parts:continue
        m=json.loads(p.read_text());errors=[e.message for e in validator.iter_errors(m)]
        artifacts={a['path']:(p.parent/a['path']).is_file() and sha(p.parent/a['path'])==a['sha256'] for a in m['implementation']['artifacts']}
        version=p.parent/f"versions/v{m['version']:04d}/version-manifest.json"
        vm=json.loads(version.read_text()) if version.exists() else {}
        snapshots={k:m.get(k)==vm.get(k) for k in ('workflowId','version','implementation','inputSlots','target','parameters')}
        rows.append({'case':case,'manifest':str(p.relative_to(ROOT)),'schemaErrors':errors,'artifactHashes':artifacts,'versionSnapshotMatches':snapshots,'status':m['status'],'defaultDirectory':'.table-workflows' in p.relative_to(ROOT/f'case-{case}').parts})
hashes=json.loads((ROOT/'observer/fixture-hashes.json').read_text())
source_checks={p:sha(ROOT/p)==h for p,h in hashes['files'].items()}
before=json.loads((ROOT/'reuse/before.json').read_text())
original_checks={p:Path(p).is_file() and sha(Path(p))==h for p,h in before.items()}
report={'manifests':rows,'fixtureHashesUnchanged':source_checks,'originalSkillAndPriorBundleUnchanged':all(original_checks.values()),'changedOriginals':[p for p,v in original_checks.items() if not v]}
# JA 快照曾顺带捕获未发布 T 草稿；只按快照名称的已发布场景验收，原快照保留。
report['publishedFilesUnchanged']={f.name:all((ROOT/p).is_file() and sha(ROOT/p)==h for p,h in json.loads(f.read_text()).items() if p.split('/')[0].removeprefix('case-') in f.stem.removeprefix('versions-before-')) for f in ROOT.glob('versions-before-*.json')}
(ROOT/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'manifests':len(rows),'schemaPass':all(not r['schemaErrors'] for r in rows),'artifactsPass':all(all(r['artifactHashes'].values()) for r in rows),'fixturesIntact':all(source_checks.values()),'originalsIntact':all(original_checks.values())}))
