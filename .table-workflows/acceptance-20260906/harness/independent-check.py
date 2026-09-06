"""独立只读验收：答案来自冻结 JSON，不导入操作方实现。"""
import argparse, hashlib, json
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
ORACLE = json.loads((ROOT / 'private/oracle.json').read_text())

def style(cell):
    return {k: str(getattr(cell, k)) for k in ('font','fill','border','alignment','number_format','protection')}

def check(case, phase, output):
    actual = openpyxl.load_workbook(output, data_only=False)
    data = openpyxl.load_workbook(output, data_only=True)
    expected_path = ROOT / ('fixtures' if phase == 'discovery' else 'private') / case / phase / 'expected.xlsx'
    expected = openpyxl.load_workbook(expected_path, data_only=False)
    diffs=[]; checked=0; missing_cache=[]
    def diff(kind, cell, want, got):
        if want != got: diffs.append({'kind':kind,'cell':cell,'expected':want,'actual':got})
    diff('sheets','',expected.sheetnames,actual.sheetnames)
    for name in expected.sheetnames:
        if name not in actual.sheetnames: continue
        e,a=expected[name],actual[name]
        for row in range(1,max(e.max_row,a.max_row)+1):
            for col in range(1,max(e.max_column,a.max_column)+1):
                ec,ac=e.cell(row,col),a.cell(row,col)
                diff('value_or_formula',f'{name}!{ec.coordinate}',ec.value,ac.value);checked+=1
                if case == 'T':diff('style',f'{name}!{ec.coordinate}',style(ec),style(ac))
        if case == 'T':
            diff('merges',name,sorted(str(x) for x in e.merged_cells),sorted(str(x) for x in a.merged_cells))
            diff('visibility',name,e.sheet_state,a.sheet_state)
            for k in set(e.column_dimensions)|set(a.column_dimensions):
                for attr in ('width','hidden','outlineLevel'):
                    diff('column_'+attr,k,getattr(e.column_dimensions[k],attr),getattr(a.column_dimensions[k],attr))
            for k in set(e.row_dimensions)|set(a.row_dimensions):
                for attr in ('height','hidden','outlineLevel'):
                    diff('row_'+attr,str(k),getattr(e.row_dimensions[k],attr),getattr(a.row_dimensions[k],attr))
            # 公式缓存不影响公式保留判断，但明确报告 Excel 重算依赖。
            q=ORACLE['T'][phase]['quantities']; vals={'E4':q[0]*10,'E5':q[1]*20,'E6':q[2]*5,'C8':sum(q),'E8':q[0]*10+q[1]*20+q[2]*5}
            for addr,want in vals.items():
                got=data[name][addr].value
                if got is None:missing_cache.append(addr)
                else:diff('formula_cache',addr,want,got)
    sheet=data.active
    if case=='J':
        rows=list(sheet.iter_rows(min_row=2,values_only=True));totals={'rows':len(rows),'amount':sum(r[4] for r in rows if isinstance(r[4],(int,float)))}
    elif case=='A':
        rows=list(sheet.iter_rows(min_row=2,values_only=True));totals={'rows':len(rows),'count':sum(r[1] for r in rows if isinstance(r[1],(int,float))),'hours':sum(r[2] for r in rows if isinstance(r[2],(int,float)))}
    else:
        quantities=[sheet[f'C{r}'].value for r in range(4,7)]
        totals={'rows':3,'quantity':sum(v for v in quantities if isinstance(v,(int,float))),'amount':sum((v or 0)*p for v,p in zip(quantities,[10,20,5]) if isinstance(v,(int,float)))}
    return {'case':case,'phase':phase,'output':str(output),'pass':not diffs,'formulaCalculationVerified':not missing_cache,'completionStatus':'NEEDS_TARGET_RECALC' if missing_cache else ('PASS' if not diffs else 'FAIL'),'checkedCells':checked,'diffs':diffs,'missingFormulaCache':missing_cache,'expectedTotals':ORACLE[case][phase]['totals'],'actualTotals':totals}

def validate_fixtures():
    reports=[]
    hashes=json.loads((ROOT/'observer/fixture-hashes.json').read_text())
    assert hashlib.sha256((ROOT/'private/oracle.json').read_bytes()).hexdigest()==hashes['oracleSha256']
    for rel,h in hashes['files'].items():assert hashlib.sha256((ROOT/rel).read_bytes()).hexdigest()==h, rel
    for case in 'JAT':
        for phase in ('discovery','holdout'):
            base=ROOT/('fixtures' if phase=='discovery' else 'private')/case/phase
            c=ORACLE[case][phase]
            src=openpyxl.load_workbook(base/'source.xlsx',data_only=False)
            rows=lambda sh:[list(row) for row in src[sh].iter_rows(min_row=2,values_only=True)]
            if case=='J':assert rows('订单')==c['orders'] and rows('客户')==c['customers']
            else:assert rows('工时明细' if case=='A' else '需求')==c['rows']
            out=openpyxl.load_workbook(base/'expected.xlsx',data_only=True)
            if case!='T':assert [list(row) for row in out.active.iter_rows(min_row=2,values_only=True)]==c['expected']
            else:
                assert [out.active[f'C{r}'].value for r in range(4,7)]==c['quantities']
                assert out.active['E8'].value==c['totals']['amount']
            reports.append(check(case,phase,base/'expected.xlsx'))
    return {'oracleAndFileHashesPass':True,'fixtureCases':reports,'allPass':all(x['pass'] for x in reports)}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--case',choices=list('JAT'));p.add_argument('--phase',default='holdout');p.add_argument('--output');p.add_argument('--report',required=True);a=p.parse_args()
    r=check(a.case,a.phase,Path(a.output)) if a.case else validate_fixtures()
    Path(a.report).write_text(json.dumps(r,ensure_ascii=False,indent=2))
    print(json.dumps({'pass':r.get('pass',r.get('allPass')),'report':a.report},ensure_ascii=False))
