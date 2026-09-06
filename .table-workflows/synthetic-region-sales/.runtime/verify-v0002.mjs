import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workflowDir = path.resolve(import.meta.dirname, "..");
const versionDir = path.join(workflowDir, "versions", "v0002");
const runDir = path.join(workflowDir, "runs", "fix-regression");
const previewDir = path.join(runDir, "previews");
const execFileAsync = promisify(execFile);
const paths = {
  expected: path.join(workflowDir, "cases", "discovery-001", "expected", "expected.xlsx"),
  baselineInput: path.join(workflowDir, "cases", "discovery-001", "inputs", "orders.xlsx"),
  dataInput: path.join(workflowDir, "cases", "structure-regression", "orders-data-only.xlsx"),
  driftInput: path.join(workflowDir, "cases", "structure-regression", "orders-with-chart.xlsx"),
  actual: path.join(workflowDir, "outputs", "fix-regression", "result-v2.xlsx"),
  dataActual: path.join(workflowDir, "outputs", "fix-regression", "data-only-result-v2.xlsx"),
  driftActual: path.join(workflowDir, "outputs", "fix-regression", "structure-drift-result-v2.xlsx"),
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fileSha256(filePath) {
  return sha256(await fs.readFile(filePath));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function structureSha256(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function parseNdjson(ndjson) {
  return ndjson.split("\n").filter(Boolean).map((line) => JSON.parse(line));
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

async function probe(filePath, contractPath, pythonExecutable) {
  const { stdout } = await execFileAsync(pythonExecutable, [
    path.join(versionDir, "inspect_structure.py"),
    "--file",
    filePath,
    "--contract",
    contractPath,
  ]);
  return JSON.parse(stdout.trim());
}

async function inspectOutput(key, filePath) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
  const sheet = workbook.worksheets.getItem("区域汇总");
  const table = await workbook.inspect({
    kind: "workbook,sheet,table",
    sheetId: "区域汇总",
    range: "A1:D3",
    maxChars: 6000,
    tableMaxRows: 10,
    tableMaxCols: 8,
  });
  const formulas = await workbook.inspect({
    kind: "formula",
    sheetId: "区域汇总",
    range: "A1:D3",
    maxChars: 2000,
    options: { maxResults: 50 },
  });
  const styles = await workbook.inspect({
    kind: "computedStyle",
    sheetId: "区域汇总",
    range: "A1:D3",
    maxChars: 8000,
  });
  const objects = await workbook.inspect({
    kind: "drawing,definedName",
    sheetId: "区域汇总",
    range: "A1:D3",
    maxChars: 2000,
    options: { maxResults: 50 },
  });
  const formulaErrors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
    options: { useRegex: true, maxResults: 100 },
    summary: `${key} formula error scan`,
  });
  const preview = await workbook.render({ sheetName: "区域汇总", range: "A1:D3", scale: 2, format: "png" });
  await fs.writeFile(path.join(previewDir, `${key}.png`), new Uint8Array(await preview.arrayBuffer()));
  return {
    values: sheet.getRange("A1:D3").values,
    formulas: sheet.getRange("A1:D3").formulas,
    styles: normalizedStyles(styles.ndjson),
    objects: parseNdjson(objects.ndjson).filter((record) => ["drawing", "definedName"].includes(record.kind)),
    formulaErrors: parseNdjson(formulaErrors.ndjson).filter((record) => record.kind === "match"),
    table: parseNdjson(table.ndjson),
    formulasInspection: formulas.ndjson,
  };
}

await fs.mkdir(previewDir, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(versionDir, "version-manifest.json"), "utf8"));
const lock = JSON.parse(await fs.readFile(path.join(versionDir, "dependency-lock.json"), "utf8"));
const contractPath = path.join(versionDir, "structure", "orders-input.json");
const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
const expectedStructure = structureSha256(contract);
const [baselineStructure, dataStructure, driftStructure] = await Promise.all([
  probe(paths.baselineInput, contractPath, lock.python.executable),
  probe(paths.dataInput, contractPath, lock.python.executable),
  probe(paths.driftInput, contractPath, lock.python.executable),
]);

const [expected, actual, dataActual] = await Promise.all([
  inspectOutput("expected-v2", paths.expected),
  inspectOutput("actual-v2", paths.actual),
  inspectOutput("data-only-actual-v2", paths.dataActual),
]);
const [receipt, dataReceipt, driftReceipt] = await Promise.all([
  fs.readFile(path.join(runDir, "receipt.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(runDir, "data-only-request-receipt.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(runDir, "structure-drift-request-receipt.json"), "utf8").then(JSON.parse),
]);

let driftOutputExists = true;
try {
  await fs.access(paths.driftActual);
} catch (error) {
  if (error.code === "ENOENT") driftOutputExists = false;
  else throw error;
}

const expectedValues = [["区域", "完成订单数", "完成件数", "销售额"], ["华东", 2, 6, 341], ["华南", 2, 3, 230]];
const dependencyLockArtifact = manifest.implementation.artifacts.find((item) => item.kind === "DEPENDENCY_LOCK");
const checks = {
  baselineReplayPass: receipt.exitStatus === "PASS" && receipt.exitCode === 0,
  dataOnlyReplayPass: dataReceipt.exitStatus === "PASS" && dataReceipt.exitCode === 0,
  baselineStructureMatches: structureSha256(baselineStructure) === expectedStructure,
  dataOnlyStructureStable: structureSha256(dataStructure) === expectedStructure,
  nonHeaderStructureDriftDetected: structureSha256(driftStructure) !== expectedStructure && driftStructure.drawings.length > 0,
  driftFailsBeforeOutput: driftReceipt.exitStatus === "FAIL"
    && driftReceipt.exitCode === 2
    && driftReceipt.output === null
    && driftReceipt.checks.blocking.some((message) => message.includes("实际文件结构与已保存指纹不匹配"))
    && !driftOutputExists,
  receiptRecordsObservedFingerprints: [receipt, dataReceipt].every((item) => Object.values(item.inputFiles).every(
    (input) => input.structureFingerprint?.matches
      && input.structureFingerprint.observed === input.structureFingerprint.expected,
  )) && driftReceipt.inputFiles["orders-source"].structureFingerprint?.matches === false
    && driftReceipt.inputFiles["orders-source"].structureFingerprint.observed !== driftReceipt.inputFiles["orders-source"].structureFingerprint.expected,
  dependencyLockDeclared: Boolean(dependencyLockArtifact),
  dependencyLockHashMatches: Boolean(dependencyLockArtifact)
    && await fileSha256(path.join(workflowDir, dependencyLockArtifact.path)) === dependencyLockArtifact.sha256,
  dependencyVersionsVerified: [receipt, dataReceipt].every((item) => JSON.stringify(item.dependencyVersions) === JSON.stringify({
    node: lock.node.version,
    artifactTool: lock.artifactTool.version,
    python: lock.python.version,
    openpyxl: lock.openpyxl.version,
  })),
  baselineValuesExact: JSON.stringify(actual.values) === JSON.stringify(expectedValues),
  dataOnlyValuesExact: JSON.stringify(dataActual.values) === JSON.stringify(expectedValues),
  formulasExact: JSON.stringify(actual.formulas) === JSON.stringify(expected.formulas)
    && JSON.stringify(dataActual.formulas) === JSON.stringify(expected.formulas),
  stylesExact: JSON.stringify(actual.styles) === JSON.stringify(expected.styles)
    && JSON.stringify(dataActual.styles) === JSON.stringify(expected.styles),
  noObjectsOrFormulaErrors: [expected, actual, dataActual].every((item) => item.objects.length === 0 && item.formulaErrors.length === 0),
  outputsReopen: [actual, dataActual].every((item) => item.table.some((record) => record.kind === "sheet" && record.name === "区域汇总")),
  inputHashesUnchanged: [receipt, dataReceipt].every((item) => Object.values(item.inputFiles).every(
    (input) => input.sha256Before === input.sha256After,
  )),
};

const report = {
  schemaVersion: "0.1",
  workflowId: "synthetic-region-sales",
  workflowVersion: 2,
  generatedAt: new Date().toISOString(),
  validationStatus: Object.values(checks).every(Boolean) ? "PENDING_VISUAL_REVIEW" : "FAIL",
  checks,
  structureFingerprints: {
    expected: expectedStructure,
    baseline: structureSha256(baselineStructure),
    dataOnly: structureSha256(dataStructure),
    structuralDrift: structureSha256(driftStructure),
    driftInventory: driftStructure.drawings,
  },
  businessReplay: {
    expected: expectedValues,
    baseline: actual.values,
    dataOnly: dataActual.values,
  },
  dependencyVersions: receipt.dependencyVersions,
  visualReview: {
    status: "PENDING",
    previews: ["previews/actual-v2.png", "previews/data-only-actual-v2.png"],
  },
};

await fs.writeFile(path.join(runDir, "regression-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ validationStatus: report.validationStatus, passed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length }));
if (report.validationStatus === "FAIL") process.exitCode = 1;
