import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workflowDir = path.resolve(import.meta.dirname, "..");
const runDir = path.join(workflowDir, "runs", "operator");
const inspectionDir = path.join(runDir, "inspections");
const previewDir = path.join(runDir, "previews");
const paths = {
  orders: path.join(workflowDir, "cases", "discovery-001", "inputs", "orders.xlsx"),
  customers: path.join(workflowDir, "cases", "discovery-001", "inputs", "customers.xlsx"),
  expected: path.join(workflowDir, "cases", "discovery-001", "expected", "expected.xlsx"),
  actual: path.join(workflowDir, "outputs", "operator", "result.xlsx"),
};

function parseNdjson(ndjson) {
  return ndjson
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function normalizedStyles(ndjson) {
  return parseNdjson(ndjson)
    .filter((record) => record.kind === "computedStyle")
    .map((record) => {
      const style = structuredClone(record.style);
      delete style.styleId;
      return { cell: record.for, style };
    });
}

function matrixEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formulaCount(matrix) {
  return matrix.flat().filter((value) => typeof value === "string" && value.startsWith("=")).length;
}

function formulaErrorCount(values, formulas) {
  const pattern = /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A|#NUM!|#NULL!|#SPILL!|#CALC!/;
  return [...values.flat(), ...formulas.flat()].filter((value) => typeof value === "string" && pattern.test(value)).length;
}

function collectionLength(collection) {
  return Array.isArray(collection?.items) ? collection.items.length : 0;
}

async function loadWorkbook(filePath) {
  return SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
}

async function inspectWorkbook(key, workbook, sheetName, range) {
  const table = await workbook.inspect({
    kind: "workbook,sheet,table",
    sheetId: sheetName,
    range,
    maxChars: 6000,
    tableMaxRows: 20,
    tableMaxCols: 12,
  });
  const formulas = await workbook.inspect({
    kind: "formula",
    sheetId: sheetName,
    range,
    maxChars: 3000,
    options: { maxResults: 100 },
  });
  const styles = await workbook.inspect({
    kind: "computedStyle",
    sheetId: sheetName,
    range,
    maxChars: 12000,
  });
  const objects = await workbook.inspect({
    kind: "drawing,definedName",
    sheetId: sheetName,
    range,
    maxChars: 3000,
    options: { maxResults: 100 },
  });
  const formulaErrors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
    options: { useRegex: true, maxResults: 300 },
    summary: `${key} final formula error scan`,
  });

  await Promise.all([
    fs.writeFile(path.join(inspectionDir, `${key}-table.ndjson`), table.ndjson, "utf8"),
    fs.writeFile(path.join(inspectionDir, `${key}-formulas.ndjson`), formulas.ndjson, "utf8"),
    fs.writeFile(path.join(inspectionDir, `${key}-styles.ndjson`), styles.ndjson, "utf8"),
    fs.writeFile(path.join(inspectionDir, `${key}-objects.ndjson`), objects.ndjson, "utf8"),
    fs.writeFile(path.join(inspectionDir, `${key}-formula-errors.ndjson`), formulaErrors.ndjson, "utf8"),
  ]);

  const preview = await workbook.render({ sheetName, range, scale: 2, format: "png" });
  await fs.writeFile(path.join(previewDir, `${key}.png`), new Uint8Array(await preview.arrayBuffer()));
  return { table, formulas, styles, objects, formulaErrors };
}

await fs.mkdir(inspectionDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const [ordersWb, customersWb, expectedWb, actualWb] = await Promise.all([
  loadWorkbook(paths.orders),
  loadWorkbook(paths.customers),
  loadWorkbook(paths.expected),
  loadWorkbook(paths.actual),
]);

const [ordersInspect, customersInspect, expectedInspect, actualInspect] = await Promise.all([
  inspectWorkbook("orders", ordersWb, "订单", "A1:E7"),
  inspectWorkbook("customers", customersWb, "客户", "A1:C6"),
  inspectWorkbook("expected", expectedWb, "区域汇总", "A1:D3"),
  inspectWorkbook("actual", actualWb, "区域汇总", "A1:D3"),
]);

const ordersSheet = ordersWb.worksheets.items[0];
const customersSheet = customersWb.worksheets.items[0];
const expectedSheet = expectedWb.worksheets.items[0];
const actualSheet = actualWb.worksheets.items[0];
const orderValues = ordersSheet.getRange("A1:E7").values;
const customerValues = customersSheet.getRange("A1:C6").values;
const expectedValues = expectedSheet.getRange("A1:D3").values;
const actualValues = actualSheet.getRange("A1:D3").values;
const expectedFormulas = expectedSheet.getRange("A1:D3").formulas;
const actualFormulas = actualSheet.getRange("A1:D3").formulas;
const receipt = JSON.parse(await fs.readFile(path.join(runDir, "receipt.json"), "utf8"));

const completedOrders = orderValues.slice(1).filter((row) => row[4] === "已完成");
const customerMap = new Map(customerValues.slice(1).map((row) => [row[0], row[2]]));
const unmatched = orderValues.slice(1)
  .filter((row) => !customerMap.has(row[1]))
  .map((row) => ({ orderId: row[0], customerId: row[1] }));
const detailTotals = {
  orderCount: completedOrders.length,
  quantity: completedOrders.reduce((sum, row) => sum + row[2], 0),
  sales: completedOrders.reduce((sum, row) => sum + row[2] * row[3], 0),
};
const outputTotals = {
  orderCount: actualValues.slice(1).reduce((sum, row) => sum + row[1], 0),
  quantity: actualValues.slice(1).reduce((sum, row) => sum + row[2], 0),
  sales: actualValues.slice(1).reduce((sum, row) => sum + row[3], 0),
};
const uniqueOrderCount = new Set(orderValues.slice(1).map((row) => row[0])).size;
const uniqueCustomerCount = new Set(customerValues.slice(1).map((row) => row[0])).size;
const sorted = actualValues.slice(1).every((row, index, rows) => {
  if (index === 0) return true;
  const previous = rows[index - 1];
  return previous[3] > row[3] || (previous[3] === row[3] && previous[0].localeCompare(row[0], "zh-CN") <= 0);
});

const expectedStyle = normalizedStyles(expectedInspect.styles.ndjson);
const actualStyle = normalizedStyles(actualInspect.styles.ndjson);
const actualObjectInventory = {
  tables: collectionLength(actualSheet.tables),
  charts: collectionLength(actualSheet.charts),
  shapes: collectionLength(actualSheet.shapes),
  images: collectionLength(actualSheet.images),
  drawingOrDefinedNameRecords: parseNdjson(actualInspect.objects.ndjson)
    .filter((record) => record.kind === "drawing" || record.kind === "definedName").length,
};

const checks = {
  cellValuesExact: matrixEquals(actualValues, expectedValues),
  formulasExact: matrixEquals(actualFormulas, expectedFormulas),
  formulasAbsentAsExpected: formulaCount(actualFormulas) === 0,
  stylesExactIgnoringInternalStyleIds: matrixEquals(actualStyle, expectedStyle),
  objectsAbsentAsExpected: Object.values(actualObjectInventory).every((count) => count === 0),
  declaredRangeOnly: actualWb.worksheets.items.length === 1
    && parseNdjson(actualInspect.table.ndjson).find((record) => record.kind === "sheet")?.address === "A1:D3",
  recordCounts: orderValues.length - 1 === 6 && customerValues.length - 1 === 5 && actualValues.length - 1 === 2,
  uniqueKeys: uniqueOrderCount === 6 && uniqueCustomerCount === 5,
  totalsBalanced: matrixEquals(detailTotals, outputTotals) && matrixEquals(outputTotals, { orderCount: 4, quantity: 9, sales: 571 }),
  regionValues: matrixEquals(actualValues.slice(1), [["华东", 2, 6, 341], ["华南", 2, 3, 230]]),
  sortedByPolicy: sorted,
  noZeroOrderRegions: actualValues.slice(1).every((row) => row[1] > 0),
  unmatchedRecordsEmpty: unmatched.length === 0 && receipt.unmatchedRecords.length === 0,
  exceptionCountZero: receipt.checks.exceptions === 0,
  inputHashesUnchanged: Object.values(receipt.inputFiles).every((entry) => entry.sha256Before === entry.sha256After),
  reopenedSuccessfully: actualWb.worksheets.items.length === 1 && actualSheet.name === "区域汇总",
  formulaErrorScanEmpty: formulaErrorCount(actualValues, actualFormulas) === 0,
};

const report = {
  schemaVersion: "0.1",
  workflowId: "synthetic-region-sales",
  workflowVersion: 1,
  caseId: "discovery-001",
  generatedAt: new Date().toISOString(),
  validationStatus: Object.values(checks).every(Boolean) ? "PENDING_VISUAL_REVIEW" : "FAIL",
  acceptedDifferenceCount: 0,
  checks,
  cellComparison: {
    range: "区域汇总!A1:D3",
    expected: expectedValues,
    actual: actualValues,
    differenceCount: matrixEquals(actualValues, expectedValues) ? 0 : 1,
  },
  formulasAndStyles: {
    formulaCount: formulaCount(actualFormulas),
    formulaDifferenceCount: matrixEquals(actualFormulas, expectedFormulas) ? 0 : 1,
    styleDifferenceCount: matrixEquals(actualStyle, expectedStyle) ? 0 : 1,
    formulaErrorCount: formulaErrorCount(actualValues, actualFormulas),
    scans: {
      actual: "inspections/actual-formula-errors.ndjson",
      expected: "inspections/expected-formula-errors.ndjson"
    }
  },
  workbookObjects: actualObjectInventory,
  declaredScope: {
    writeScope: "区域汇总!A1:D*",
    observedSheets: actualWb.worksheets.items.map((sheet) => sheet.name),
    observedUsedRange: "区域汇总!A1:D3",
    outsideScopeChangeCount: checks.declaredRangeOnly ? 0 : 1,
  },
  businessInvariants: {
    sourceRecordCounts: { orders: 6, customers: 5 },
    uniqueKeyCounts: { orders: uniqueOrderCount, customers: uniqueCustomerCount },
    completedDetailTotals: detailTotals,
    outputTotals,
    outputRecordCount: actualValues.length - 1,
    sortPolicySatisfied: sorted,
  },
  unmatchedRecords: unmatched,
  exceptions: [],
  inputPreservation: Object.fromEntries(
    Object.entries(receipt.inputFiles).map(([slotId, entry]) => [slotId, {
      sha256Before: entry.sha256Before,
      sha256After: entry.sha256After,
      unchanged: entry.sha256Before === entry.sha256After,
    }]),
  ),
  reopen: { status: checks.reopenedSuccessfully ? "PASS" : "FAIL", engine: "@oai/artifact-tool importXlsx" },
  visualReview: {
    status: "PENDING",
    previews: ["previews/orders.png", "previews/customers.png", "previews/expected.png", "previews/actual.png"]
  },
};

await fs.writeFile(path.join(runDir, "diff-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ validationStatus: report.validationStatus, checks, reportPath: path.join(runDir, "diff-report.json") }));
if (report.validationStatus === "FAIL") process.exitCode = 1;
