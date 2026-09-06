import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const WORKFLOW_ID = "synthetic-region-sales";
const WORKFLOW_VERSION = 2;
const versionDir = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.resolve(versionDir, "..", "..");
const inspectStructurePath = path.join(versionDir, "inspect_structure.py");
const dependencyLockPath = path.join(versionDir, "dependency-lock.json");
const execFileAsync = promisify(execFile);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const requestIndex = argv.indexOf("--request");
  requireCondition(requestIndex >= 0 && requestIndex + 1 < argv.length, "缺少 --request 参数");
  requireCondition(argv.filter((arg) => arg === "--request").length === 1, "--request 参数只能出现一次");
  return path.resolve(argv[requestIndex + 1]);
}

function normalizeRows(values) {
  return values.map((row) => row.map((value) => value ?? null));
}

function validateHeaders(values, expectedHeaders, label) {
  requireCondition(values.length >= 1, `${label}没有表头`);
  const actual = values[0].slice(0, expectedHeaders.length);
  requireCondition(JSON.stringify(actual) === JSON.stringify(expectedHeaders), `${label}表头或顺序不兼容`);
  requireCondition(values[0].length === expectedHeaders.length, `${label}存在未声明列`);
}

function assertNoFormulas(sheet, rowCount, colCount, label) {
  const formulas = sheet.getRangeByIndexes(0, 0, rowCount, colCount).formulas;
  const found = formulas.some((row) => row.some((formula) => typeof formula === "string" && formula.startsWith("=")));
  requireCondition(!found, `${label}包含未声明公式`);
}

async function importSingleSheet(filePath, sheetName, label) {
  requireCondition(path.extname(filePath).toLowerCase() === ".xlsx", `${label}必须是 .xlsx 文件`);
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
  const sheets = workbook.worksheets.items;
  requireCondition(Array.isArray(sheets) && sheets.length === 1, `${label}必须且只能包含一个工作表`);
  requireCondition(sheets[0].name === sheetName, `${label}缺少工作表“${sheetName}”`);
  return { workbook, sheet: sheets[0] };
}

async function verifyArtifacts(manifest) {
  const hashes = {};
  for (const artifact of manifest.implementation.artifacts) {
    const artifactPath = path.resolve(workflowDir, artifact.path);
    requireCondition(artifactPath.startsWith(`${workflowDir}${path.sep}`), `实现产物路径越界：${artifact.path}`);
    const actual = await fileSha256(artifactPath);
    requireCondition(actual === artifact.sha256, `实现产物校验失败：${artifact.path}`);
    hashes[artifact.path] = actual;
  }
  return hashes;
}

async function findArtifactToolPackageJson() {
  const require = createRequire(import.meta.url);
  let current = path.dirname(require.resolve("@oai/artifact-tool"));
  while (current !== path.dirname(current)) {
    const candidate = path.join(current, "package.json");
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      current = path.dirname(current);
    }
  }
  throw new Error("无法定位 @oai/artifact-tool 的 package.json");
}

async function verifyDependencyLock() {
  const lock = JSON.parse(await fs.readFile(dependencyLockPath, "utf8"));
  requireCondition(process.version === lock.node.version, `Node.js 版本漂移：${process.version}`);
  requireCondition(await fileSha256(process.execPath) === lock.node.executableSha256, "Node.js 可执行文件完整性不匹配");

  const artifactToolPackageJson = await findArtifactToolPackageJson();
  const artifactToolPackage = JSON.parse(await fs.readFile(artifactToolPackageJson, "utf8"));
  requireCondition(artifactToolPackage.version === lock.artifactTool.version, "@oai/artifact-tool 版本漂移");
  requireCondition(await fileSha256(artifactToolPackageJson) === lock.artifactTool.packageJsonSha256, "@oai/artifact-tool 完整性不匹配");

  requireCondition(await fileSha256(lock.python.executable) === lock.python.executableSha256, "Python 可执行文件完整性不匹配");
  const { stdout } = await execFileAsync(lock.python.executable, [inspectStructurePath, "--versions"]);
  const versions = JSON.parse(stdout.trim());
  requireCondition(versions.python === lock.python.version, "Python 版本漂移");
  requireCondition(versions.openpyxl === lock.openpyxl.version, "openpyxl 版本漂移");
  requireCondition(await fileSha256(lock.openpyxl.moduleFile) === lock.openpyxl.moduleFileSha256, "openpyxl 完整性不匹配");
  return {
    node: process.version,
    artifactTool: artifactToolPackage.version,
    python: versions.python,
    openpyxl: versions.openpyxl,
  };
}

async function verifyObservedStructure(filePath, fingerprint) {
  const contractPath = path.join(workflowDir, fingerprint.basis);
  const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
  const expected = structureSha256(contract);
  requireCondition(expected === fingerprint.value, `结构依据与期望指纹不一致：${fingerprint.basis}`);

  const lock = JSON.parse(await fs.readFile(dependencyLockPath, "utf8"));
  const { stdout } = await execFileAsync(lock.python.executable, [
    inspectStructurePath,
    "--file",
    filePath,
    "--contract",
    contractPath,
  ], { maxBuffer: 1024 * 1024 });
  const observedDescription = JSON.parse(stdout.trim());
  const observed = structureSha256(observedDescription);
  return { algorithm: "sha256", expected, observed, matches: observed === expected, basis: fingerprint.basis };
}

function buildSummary(orderRows, customerRows) {
  const customers = new Map();
  const customerIds = new Set();
  for (const [rowIndex, row] of customerRows.entries()) {
    const [customerId, , region] = row;
    requireCondition(typeof customerId === "string" && customerId.trim() !== "", `客户第 ${rowIndex + 2} 行客户编号缺失`);
    requireCondition(!customerIds.has(customerId), `客户编号重复：${customerId}`);
    requireCondition(typeof region === "string" && region.trim() !== "", `客户 ${customerId} 的区域缺失`);
    customerIds.add(customerId);
    customers.set(customerId, region);
  }

  const orderIds = new Set();
  const unmatched = [];
  const summary = new Map();
  let completedOrderCount = 0;
  let completedQuantity = 0;
  let completedSales = 0;

  for (const [rowIndex, row] of orderRows.entries()) {
    const [orderId, customerId, quantity, unitPrice, status] = row;
    requireCondition(typeof orderId === "string" && orderId.trim() !== "", `订单第 ${rowIndex + 2} 行订单号缺失`);
    requireCondition(!orderIds.has(orderId), `订单号重复：${orderId}`);
    requireCondition(typeof customerId === "string" && customerId.trim() !== "", `订单 ${orderId} 的客户编号缺失`);
    requireCondition(typeof quantity === "number" && Number.isFinite(quantity) && quantity >= 0, `订单 ${orderId} 的数量无效`);
    requireCondition(typeof unitPrice === "number" && Number.isFinite(unitPrice) && unitPrice >= 0, `订单 ${orderId} 的单价无效`);
    orderIds.add(orderId);

    const region = customers.get(customerId);
    if (!region) unmatched.push({ orderId, customerId });
    if (status !== "已完成") continue;
    requireCondition(Boolean(region), `已完成订单 ${orderId} 无法匹配客户 ${customerId}`);

    const current = summary.get(region) ?? { region, orderCount: 0, quantity: 0, sales: 0 };
    current.orderCount += 1;
    current.quantity += quantity;
    current.sales += quantity * unitPrice;
    summary.set(region, current);
    completedOrderCount += 1;
    completedQuantity += quantity;
    completedSales += quantity * unitPrice;
  }

  // 仅输出有完成订单的区域，并按已确认的双键顺序固定结果。
  const rows = [...summary.values()]
    .map((item) => ({ ...item, sales: Math.round((item.sales + Number.EPSILON) * 100) / 100 }))
    .sort((a, b) => b.sales - a.sales || a.region.localeCompare(b.region, "zh-CN"));

  return {
    rows,
    unmatched,
    totals: {
      sourceOrders: orderRows.length,
      sourceCustomers: customerRows.length,
      completedOrderCount,
      completedQuantity,
      completedSales: Math.round((completedSales + Number.EPSILON) * 100) / 100,
      outputRows: rows.length,
    },
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const requestPath = parseArgs(process.argv.slice(2));
  const requestBase = path.basename(requestPath, ".json");
  const receiptPath = path.join(path.dirname(requestPath), requestBase === "request" ? "receipt.json" : `${requestBase}-receipt.json`);
  let request;
  let partialOutputPath;
  let receipt = {
    schemaVersion: "0.1",
    workflowId: WORKFLOW_ID,
    workflowVersion: WORKFLOW_VERSION,
    startedAt,
    completedAt: null,
    exitStatus: "FAIL",
    exitCode: 2,
    implementationArtifacts: {},
    dependencyVersions: {},
    inputFiles: {},
    targetTemplate: null,
    targetStructure: null,
    output: null,
    checks: { blocking: [], warnings: [], exceptions: 0 },
    oneTimeManualEdits: [],
  };

  try {
    request = JSON.parse(await fs.readFile(requestPath, "utf8"));
    requireCondition(request.schemaVersion === "0.1", "运行请求 schemaVersion 必须为 0.1");
    requireCondition(request.workflowId === WORKFLOW_ID, "运行请求 workflowId 不匹配");
    requireCondition(request.workflowVersion === WORKFLOW_VERSION, "运行请求 workflowVersion 不匹配");
    requireCondition(request.targetTemplatePath === undefined, "GENERATED 模式不得提供结果模板");
    requireCondition(request.parameters && Object.keys(request.parameters).length === 0, "本版本不接受可变参数");
    requireCondition(path.isAbsolute(request.outputPath), "outputPath 必须是绝对路径");
    requireCondition(path.extname(request.outputPath).toLowerCase() === ".xlsx", "输出文件必须是 .xlsx");

    const expectedSlots = ["orders-source", "customers-source"];
    requireCondition(JSON.stringify(Object.keys(request.inputs).sort()) === JSON.stringify(expectedSlots.sort()), "输入角色必须精确匹配清单");
    for (const slotId of expectedSlots) {
      requireCondition(Array.isArray(request.inputs[slotId]) && request.inputs[slotId].length === 1, `${slotId} 必须提供且只能提供一个文件`);
      requireCondition(path.isAbsolute(request.inputs[slotId][0]), `${slotId} 必须使用绝对路径`);
    }
    const inputPaths = expectedSlots.map((slotId) => request.inputs[slotId][0]);
    requireCondition(!inputPaths.includes(request.outputPath), "输出路径不得覆盖输入文件");
    try {
      await fs.access(request.outputPath);
      throw new Error("输出文件已存在，拒绝覆盖");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const manifest = JSON.parse(await fs.readFile(path.join(versionDir, "version-manifest.json"), "utf8"));
    receipt.implementationArtifacts = await verifyArtifacts(manifest);
    receipt.dependencyVersions = await verifyDependencyLock();

    for (const [slotId, inputPath] of expectedSlots.map((slotId) => [slotId, request.inputs[slotId][0]])) {
      receipt.inputFiles[slotId] = { path: inputPath, sha256Before: await fileSha256(inputPath), sha256After: null };
    }

    for (const slotId of expectedSlots) {
      const slot = manifest.inputSlots.find((item) => item.slotId === slotId);
      receipt.inputFiles[slotId].structureFingerprint = await verifyObservedStructure(
        request.inputs[slotId][0],
        slot.structureFingerprint,
      );
      requireCondition(
        receipt.inputFiles[slotId].structureFingerprint.matches,
        `实际文件结构与已保存指纹不匹配：${path.basename(request.inputs[slotId][0])}`,
      );
    }

    const ordersImported = await importSingleSheet(request.inputs["orders-source"][0], "订单", "订单源表");
    const customersImported = await importSingleSheet(request.inputs["customers-source"][0], "客户", "客户源表");
    const orderValues = normalizeRows(ordersImported.sheet.getUsedRange(true).values);
    const customerValues = normalizeRows(customersImported.sheet.getUsedRange(true).values);
    validateHeaders(orderValues, ["订单号", "客户编号", "数量", "单价", "状态"], "订单源表");
    validateHeaders(customerValues, ["客户编号", "客户名称", "区域"], "客户源表");
    assertNoFormulas(ordersImported.sheet, orderValues.length, 5, "订单源表");
    assertNoFormulas(customersImported.sheet, customerValues.length, 3, "客户源表");

    const result = buildSummary(orderValues.slice(1), customerValues.slice(1));
    const outputWorkbook = Workbook.create();
    const outputSheet = outputWorkbook.worksheets.add("区域汇总");
    const outputValues = [
      ["区域", "完成订单数", "完成件数", "销售额"],
      ...result.rows.map((item) => [item.region, item.orderCount, item.quantity, item.sales]),
    ];
    outputSheet.getRangeByIndexes(0, 0, outputValues.length, 4).values = outputValues;
    outputSheet.getRange(`A1:D${outputValues.length}`).format.font = { name: "Arial", size: 11, color: "#1F2937" };
    outputSheet.getRange("A1:D1").format = {
      fill: "#1F4E78",
      font: { name: "Arial", size: 11, bold: true, color: "#FFFFFF" },
      horizontalAlignment: "center",
      verticalAlignment: "center",
      borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
    };
    if (outputValues.length > 1) {
      outputSheet.getRange(`B2:C${outputValues.length}`).format.numberFormat = "#,##0";
      outputSheet.getRange(`D2:D${outputValues.length}`).format.numberFormat = "#,##0.00";
    }
    outputSheet.getRange(`A1:A${outputValues.length}`).format.columnWidth = 12;
    outputSheet.getRange(`B1:C${outputValues.length}`).format.columnWidth = 15;
    outputSheet.getRange(`D1:D${outputValues.length}`).format.columnWidth = 14;

    await fs.mkdir(path.dirname(request.outputPath), { recursive: true });
    partialOutputPath = request.outputPath.replace(/\.xlsx$/i, `.partial-${process.pid}.xlsx`);
    const outputBlob = await SpreadsheetFile.exportXlsx(outputWorkbook);
    await outputBlob.save(partialOutputPath);
    receipt.targetStructure = await verifyObservedStructure(partialOutputPath, manifest.target.structureFingerprint);
    requireCondition(receipt.targetStructure.matches, "生成结果结构与已保存指纹不匹配");
    await fs.rename(partialOutputPath, request.outputPath);
    partialOutputPath = null;

    // 导出后重新计算输入哈希，证明运行过程没有改写源表。
    for (const slotId of expectedSlots) {
      const entry = receipt.inputFiles[slotId];
      entry.sha256After = await fileSha256(entry.path);
      requireCondition(entry.sha256After === entry.sha256Before, `运行期间输入文件被修改：${slotId}`);
    }

    receipt.output = { path: request.outputPath, sha256: await fileSha256(request.outputPath) };
    receipt.metrics = result.totals;
    receipt.unmatchedRecords = result.unmatched;
    receipt.checks.blocking = [];
    receipt.checks.warnings = result.unmatched.length === 0 ? [] : [`存在 ${result.unmatched.length} 条非完成订单客户未匹配记录`];
    receipt.exitStatus = "PASS";
    receipt.exitCode = 0;
  } catch (error) {
    receipt.checks.blocking.push(error.message);
    if (partialOutputPath) {
      try {
        await fs.unlink(partialOutputPath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") receipt.checks.blocking.push(`临时输出清理失败：${cleanupError.message}`);
      }
    }
  }

  receipt.completedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ receiptPath, status: receipt.exitStatus, output: receipt.output?.path ?? null }));
  if (receipt.exitCode !== 0) process.exitCode = receipt.exitCode;
}

await main();
