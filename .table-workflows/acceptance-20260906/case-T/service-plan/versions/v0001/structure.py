import json, hashlib, zipfile, xml.etree.ElementTree as E
N={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def sha(path):
    return hashlib.sha256(open(path,'rb').read()).hexdigest()
def canonical(obj):
    return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def digest(obj):
    return hashlib.sha256(canonical(obj).encode()).hexdigest()
def tree(e):
    return [e.tag,sorted(e.attrib.items()),e.text or '',[tree(c) for c in e]]
def read(path):
    with zipfile.ZipFile(path) as z:
        ss=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            ss=[''.join(e.itertext()) for e in E.fromstring(z.read('xl/sharedStrings.xml'))]
        wb=E.fromstring(z.read('xl/workbook.xml'))
        sheets=[]
        rel=E.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        targets={r.get('Id'):r.get('Target') for r in rel}
        for s in wb.find('x:sheets',N):
            target=targets[s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
            root=E.fromstring(z.read(target)); cells={}
            for c in root.findall('.//x:sheetData/x:row/x:c',N):
                v=c.find('x:v',N); f=c.find('x:f',N); value=v.text if v is not None else None
                if c.get('t')=='s': value=ss[int(value)]
                elif c.get('t')=='inlineStr': value=''.join(c.find('x:is',N).itertext())
                elif value is not None and c.get('t') not in ('str','e'): value=float(value)
                cells[c.get('r')]={'value':value,'formula':None if f is None else f.text,'style':c.get('s','0')}
            sheets.append((s,root,cells))
        return z.namelist(),wb,sheets
def extract(path,role):
    parts,wb,sheets=read(path)
    desc={'format':'xlsx','role':role,'sheets':[],'names':[tree(e) for e in wb.findall('x:definedNames',N)],'objects':[p for p in parts if any(t in p for t in ('drawings/','charts/','tables/','externalLinks/','pivot','vba','comments','vml'))], 'allowedVariance':['source ordinary row values and row count']}
    for s,root,cells in sheets:
        header=1 if role=='source' else 3
        entry={'name':s.get('name'),'visibility':s.get('state','visible'),'headers':{a:c['value'] for a,c in cells.items() if int(''.join(filter(str.isdigit,a)))==header},'formula':{a:c['formula'] for a,c in cells.items() if c['formula']},'metadata':[tree(e) for e in root if e.tag.split('}')[-1] not in ('sheetData','dimension')],'hiddenRows':[r.get('r') for r in root.findall('x:sheetData/x:row',N) if r.get('hidden','0') not in ('0','false')], 'extraColumns': sorted(set(''.join(filter(str.isalpha,a)) for a,c in cells.items() if c['value'] is not None)-set('ABC' if role=='source' else 'ABCDE'))}
        if role=='template': entry['protectedCells']={a:c for a,c in cells.items() if a not in ('C4','C5','C6')};entry['writeCells']=['C4','C5','C6']
        desc['sheets'].append(entry)
    return desc
