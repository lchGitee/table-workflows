"""从实际 XLSX 观察契约，标准库读取，不修改工作簿。"""
import hashlib, json, posixpath, zipfile
from xml.etree import ElementTree as E

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()
def filehash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def cellvalue(cell, strings):
    raw = cell.findtext('s:v', default='', namespaces=NS)
    t = cell.get('t', 'n')
    if t == 's': return strings[int(raw)]
    if t == 'inlineStr': return ''.join(cell.itertext())
    if t in ('str', 'e', 'b'): return raw
    return float(raw) if raw else None
def load(path):
    with zipfile.ZipFile(path) as z:
        book = E.fromstring(z.read('xl/workbook.xml'))
        rels = E.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        targets = {x.get('Id'): posixpath.normpath(posixpath.join('xl', x.get('Target').lstrip('/'))) if not x.get('Target').startswith('/') else x.get('Target').lstrip('/') for x in rels}
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(x.itertext()) for x in E.fromstring(z.read('xl/sharedStrings.xml'))]
        sheets = [(s, E.fromstring(z.read(targets[s.get(RID)]))) for s in book.find('s:sheets', NS)]
        objects = sorted(n for n in z.namelist() if any(k in n for k in ('drawings/', 'charts/', 'tables/', 'pivot', 'vbaProject', 'externalLinks/', 'comments', 'threadedComments')))
        return book, sheets, strings, objects
def structure(path):
    book, sheets, strings, objects = load(path)
    result = {'fileType': 'xlsx', 'sheets': [], 'definedNames': [], 'objects': objects,
              'allowedVariance': ['ordinary data values', 'data row count', 'file name', 'visible row heights', 'column widths', 'styles']}
    names = book.find('s:definedNames', NS)
    if names is not None: result['definedNames'] = [{'attrs': dict(x.attrib), 'text': x.text} for x in names]
    for sheet, xml in sheets:
        cells = xml.findall('s:sheetData/s:row/s:c', NS)
        headers = {c.get('r'): cellvalue(c, strings) for c in cells if c.get('r').rstrip('0123456789')+'1' == c.get('r')}
        cols = sorted(set(c.get('r').rstrip('0123456789') for c in cells))
        result['sheets'].append({'name': sheet.get('name'), 'visibility': sheet.get('state', 'visible'), 'headers': headers,
            'columns': cols, 'dataDirection': 'rows-below-row-1',
            'formulas': [{'cell': c.get('r'), 'text': c.find('s:f', NS).text, 'attrs': dict(c.find('s:f', NS).attrib)} for c in cells if c.find('s:f', NS) is not None],
            'merges': [x.get('ref') for x in xml.findall('s:mergeCells/s:mergeCell', NS)],
            'hiddenRows': [x.get('r') for x in xml.findall('s:sheetData/s:row', NS) if x.get('hidden') in ('1','true')],
            'hiddenColumns': [dict(x.attrib) for x in xml.findall('s:cols/s:col', NS) if x.get('hidden') in ('1','true')],
            'otherFeatures': [E.tostring(x, encoding='unicode') for x in xml if x.tag.split('}')[-1] not in ('dimension','sheetFormatPr','cols','sheetData','pageMargins','mergeCells','sheetViews')]})
    return result
def rows(path):
    _, sheets, strings, _ = load(path)
    result = []
    for r in sheets[0][1].findall('s:sheetData/s:row', NS):
        result.append({c.get('r').rstrip('0123456789'): cellvalue(c, strings) for c in r})
    return result
