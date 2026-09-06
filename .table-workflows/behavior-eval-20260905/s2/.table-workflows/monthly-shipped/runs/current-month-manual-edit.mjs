import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const dir = path.dirname(new URL(import.meta.url).pathname);
const source = path.join(dir, '本月仓库发货汇总-v0002.xlsx');
const output = path.join(dir, '本月仓库发货汇总-v0002-本次修正.xlsx');
const startedAt = new Date().toISOString();
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const sourceHash = await hash(source);
const originalReceipt = JSON.parse(await fs.readFile(path.join(dir, 'current-month-v0002.receipt.json'), 'utf8'));
assert.equal(sourceHash, originalReceipt.outputHash);
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const sheet = wb.worksheets.getItem('汇总');
assert.deepEqual(sheet.getRange('A1:B4').values, [['仓库代码', '发货件数'], ['W01', 4], ['W02', 1], ['W03', 7]]);
console.log((await wb.inspect({ kind: 'workbook,sheet,table', maxChars: 3000, tableMaxRows: 6, tableMaxCols: 3 })).ndjson);
if (process.argv[2] === 'preview') {
  const preview = await wb.render({ sheetName: '汇总', range: 'A1:B4', scale: 2, format: 'png' });
  await fs.writeFile(path.join(dir, 'current-month-manual-before.png'), new Uint8Array(await preview.arrayBuffer()));
} else if (process.argv[2] === 'edit') {
  await assert.rejects(fs.access(output));
  // 仅修正本次输出；业务版本及其规则保持原样。
  sheet.getRange('B2').values = [[6]];
  assert.deepEqual(sheet.getRange('A1:B4').values, [['仓库代码', '发货件数'], ['W01', 6], ['W02', 1], ['W03', 7]]);
  console.log((await wb.inspect({ kind: 'table', range: '汇总!A1:B4', include: 'values,formulas', tableMaxRows: 4, tableMaxCols: 2 })).ndjson);
  console.log((await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 20 } })).ndjson);
  const preview = await wb.render({ sheetName: '汇总', range: 'A1:B4', scale: 2, format: 'png' });
  await fs.writeFile(path.join(dir, 'current-month-manual-after.png'), new Uint8Array(await preview.arrayBuffer()));
  const result = await SpreadsheetFile.exportXlsx(wb);
  await result.save(output);
  assert.equal(await hash(source), sourceHash);
  const receipt = {
    workflowId: originalReceipt.workflowId,
    workflowVersion: originalReceipt.workflowVersion,
    operation: 'ONE_TIME_MANUAL_CORRECTION',
    startedAt, finishedAt: new Date().toISOString(), exitStatus: 0,
    parentReceiptPath: path.join(dir, 'current-month-v0002.receipt.json'),
    sourceOutputPath: source, sourceOutputHash: sourceHash,
    outputPath: output, outputHash: await hash(output),
    artifacts: originalReceipt.artifacts,
    inputHashes: originalReceipt.inputHashes,
    observedStructures: originalReceipt.observedStructures,
    structureEvidenceSource: 'Original run receipt; original inputs were not rerun for this manual output correction.',
    manualChanges: [{ sheet: '汇总', cell: 'B2', warehouse: 'W01', before: 4, after: 6, scope: 'THIS_RUN_ONLY', userConfirmation: '这次汇总里 W01 帮我改成 6 件吧。', confirmed: true }],
    totals: { original: 12, corrected: 14, adjustment: 2 },
    checks: { targetValue: 'PASS', sourceUnchanged: 'PASS', workbookPreservation: 'PENDING', balancedTotal: 'MANUAL_EXCEPTION: original source total 12; corrected result total 14' },
    warnings: ['本次人工修正使结果比原运行已发货件数合计增加 2 件；该差额仅适用于本次输出。'],
    exceptionCount: 1,
    ruleVersionChanged: false,
  };
  await fs.writeFile(path.join(dir, 'current-month-manual-correction.receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ outputPath: output, total: 14 }));
} else {
  throw new Error('Expected preview or edit mode');
}
