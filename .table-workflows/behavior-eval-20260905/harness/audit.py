import hashlib
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
SKILL_FILES = [REPO / 'SKILL.md', REPO / 'agents/openai.yaml', *sorted((REPO / 'references').glob('*'))]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot():
    return {str(path.relative_to(REPO)): digest(path) for path in SKILL_FILES if path.is_file()}


def read_values(filename):
    # 独立读取保存后的 OOXML，避免复用被测脚本的业务计算或硬编码输出范围。
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(filename) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            strings = [''.join(node.itertext()) for node in shared.findall('s:si', ns)]
        sheet_paths = sorted(name for name in archive.namelist() if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'))
        sheets = []
        for sheet_path in sheet_paths:
            document = ET.fromstring(archive.read(sheet_path))
            rows = []
            for row in document.findall('s:sheetData/s:row', ns):
                cells = []
                for cell in row.findall('s:c', ns):
                    coordinate = cell.attrib['r']
                    column = 0
                    for letter in coordinate:
                        if letter.isalpha():
                            column = column * 26 + ord(letter.upper()) - 64
                    while len(cells) < column:
                        cells.append(None)
                    value = cell.find('s:v', ns)
                    kind = cell.attrib.get('t')
                    if kind == 'inlineStr':
                        inline = cell.find('s:is', ns)
                        parsed = ''.join(inline.itertext()) if inline is not None else ''
                    elif value is None:
                        parsed = None
                    elif kind == 's':
                        parsed = strings[int(value.text)]
                    elif kind in ('str', 'e'):
                        parsed = value.text
                    elif kind == 'b':
                        parsed = value.text == '1'
                    else:
                        parsed = float(value.text)
                    cells[column - 1] = parsed
                while cells and cells[-1] is None:
                    cells.pop()
                if cells:
                    rows.append(cells)
            sheets.append(rows)
        return sheets


if sys.argv[1] == 'freeze':
    target = ROOT / 'private' / 'skill-snapshot.json'
    if target.exists():
        raise SystemExit('拒绝覆盖已冻结的 Skill 快照')
    target.write_text(json.dumps(snapshot(), ensure_ascii=False, indent=2))
    print(json.dumps({'frozen': len(snapshot())}))
elif sys.argv[1] == 'check':
    previous = json.loads((ROOT / 'private' / 'skill-snapshot.json').read_text())
    current = snapshot()
    print(json.dumps({'skillUnchanged': previous == current, 'files': len(current)}))
    if previous != current:
        raise SystemExit(1)
elif sys.argv[1] == 'compare':
    path = Path(sys.argv[2]).resolve()
    key = sys.argv[3]
    actual = read_values(path)
    expected = json.loads((ROOT / 'private/oracle.json').read_text())[key]
    passed = len(actual) == 1 and actual[0] == expected
    report = {'file': str(path), 'oracleKey': key, 'actual': actual, 'expected': expected, 'exactMatch': passed, 'sha256': digest(path)}
    (ROOT / 'private' / f'compare-{key}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))
    if not passed:
        raise SystemExit(1)
elif sys.argv[1] == 'final':
    frozen = json.loads((ROOT / 'private/skill-snapshot.json').read_text())
    sources = {
        's1/inbox/原表.xlsx': 'discovery.xlsx',
        's2/inbox/原表.xlsx': 'discovery.xlsx',
        's2/inbox/我做好的.xlsx': 'correct.xlsx',
        's2/inbox/本月原表.xlsx': 'next-batch.xlsx',
        's3/inbox/原表.xlsx': 'discovery.xlsx',
        's3/inbox/我做好的.xlsx': 'mismatch.xlsx',
    }
    input_checks = {name: digest(ROOT / name) == digest(ROOT / 'private/fixtures' / fixture) for name, fixture in sources.items()}
    bundle = ROOT / 's2/.table-workflows/monthly-shipped'
    manifest = json.loads((bundle / 'manifest.json').read_text())
    artifact_checks = {item['path']: digest(bundle / item['path']) == item['sha256'] for item in manifest['implementation']['artifacts']}
    original = json.loads((ROOT / 'private/bundle-created.json').read_text())
    old_checks = {name: digest(bundle / name) == value for name, value in original.items() if name.startswith('versions/')}
    recovered = json.loads((ROOT / 'private/bundle-recovered.json').read_text())
    recovered_checks = {name: digest(bundle / name) == value for name, value in recovered.items() if name.startswith('versions/')}
    comparison_checks = {}
    for key in ('discovery', 'heldout', 'oneoff', 'heldoutV2'):
        comparison = ROOT / 'private' / f'compare-{key}.json'
        if comparison.exists():
            saved = json.loads(comparison.read_text())
            comparison_checks[key] = saved['exactMatch'] and digest(Path(saved['file'])) == saved['sha256']
        else:
            comparison_checks[key] = None
    report = {'skillUnchanged': frozen == snapshot(), 'sourceFilesUnchanged': input_checks,
              'currentVersion': manifest['version'], 'currentStatus': manifest['status'],
              'currentArtifactsIntact': artifact_checks, 'v0001Preserved': old_checks, 'v0001AndV0002Preserved': recovered_checks,
              'businessComparisons': comparison_checks,
              'firstReuseAttempt': json.loads((ROOT / 'private/s4-first-attempt.json').read_text())}
    (ROOT / 'audit-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))
elif sys.argv[1] in ('snapshot-bundle', 'check-bundle', 'check-preserved'):
    folder = Path(sys.argv[2]).resolve()
    label = sys.argv[3]
    paths = [folder / 'manifest.json', *sorted((folder / 'versions').rglob('*'))]
    current = {str(p.relative_to(folder)): digest(p) for p in paths if p.is_file() and '__pycache__' not in p.parts}
    target = ROOT / 'private' / f'bundle-{label}.json'
    if sys.argv[1] == 'snapshot-bundle':
        if target.exists():
            raise SystemExit('拒绝覆盖已有版本快照')
        target.write_text(json.dumps(current, ensure_ascii=False, indent=2))
        print(json.dumps({'snapshot': label, 'files': len(current)}))
    elif sys.argv[1] == 'check-bundle':
        previous = json.loads(target.read_text())
        print(json.dumps({'snapshot': label, 'unchanged': previous == current, 'files': len(current)}))
        if previous != current:
            raise SystemExit(1)
    else:
        previous = json.loads(target.read_text())
        unchanged = all(current.get(name) == sha for name, sha in previous.items() if name.startswith('versions/'))
        print(json.dumps({'snapshot': label, 'oldVersionsUnchanged': unchanged}))
        if not unchanged:
            raise SystemExit(1)
