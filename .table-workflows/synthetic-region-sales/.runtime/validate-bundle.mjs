import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const repoDir = path.resolve(import.meta.dirname, "..", "..", "..");
const workflowDir = path.resolve(import.meta.dirname, "..");
const schema = JSON.parse(await fs.readFile(path.join(repoDir, "references", "manifest.schema.json"), "utf8"));

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function fileSha256(filePath) {
  return sha256(await fs.readFile(filePath));
}

function resolveRef(ref) {
  let current = schema;
  for (const part of ref.replace(/^#\//, "").split("/")) {
    current = current[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return current;
}

function matchesType(value, type) {
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  return true;
}

function validateNode(rule, value, pointer = "$") {
  const errors = [];
  if (rule.$ref) return validateNode(resolveRef(rule.$ref), value, pointer);

  for (const branch of rule.allOf ?? []) errors.push(...validateNode(branch, value, pointer));
  if (rule.if && validateNode(rule.if, value, pointer).length === 0 && rule.then) {
    errors.push(...validateNode(rule.then, value, pointer));
  }
  if (Object.hasOwn(rule, "const") && value !== rule.const) errors.push(`${pointer}: const 不匹配`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${pointer}: 不在 enum 中`);
  if (rule.type && !matchesType(value, rule.type)) {
    errors.push(`${pointer}: 类型应为 ${rule.type}`);
    return errors;
  }

  if (typeof value === "string") {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${pointer}: 字符串过短`);
    if (rule.maxLength !== undefined && value.length > rule.maxLength) errors.push(`${pointer}: 字符串过长`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${pointer}: pattern 不匹配`);
    if (rule.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${pointer}: 不是有效 date-time`);
  }
  if (typeof value === "number" && rule.minimum !== undefined && value < rule.minimum) errors.push(`${pointer}: 小于 minimum`);

  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${pointer}: 数组项目不足`);
    if (rule.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${pointer}: 数组项目不唯一`);
    if (rule.items) value.forEach((item, index) => errors.push(...validateNode(rule.items, item, `${pointer}[${index}]`)));
    if (rule.contains) {
      const matches = value.filter((item) => validateNode(rule.contains, item, pointer).length === 0).length;
      if (matches < (rule.minContains ?? 1)) errors.push(`${pointer}: contains 命中不足`);
      if (rule.maxContains !== undefined && matches > rule.maxContains) errors.push(`${pointer}: contains 命中过多`);
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of rule.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${pointer}.${key}: 缺少必填字段`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (rule.properties?.[key]) errors.push(...validateNode(rule.properties[key], child, `${pointer}.${key}`));
      else if (rule.additionalProperties === false) errors.push(`${pointer}.${key}: 不允许的字段`);
    }
  }
  return errors;
}

function requireCheck(condition, label, details = null) {
  checks.push({ label, status: condition ? "PASS" : "FAIL", details });
}

function safeRelative(relativePath) {
  const resolved = path.resolve(workflowDir, relativePath);
  return !path.isAbsolute(relativePath) && resolved.startsWith(`${workflowDir}${path.sep}`);
}

async function listFiles(dir) {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result;
}

const rootManifest = JSON.parse(await fs.readFile(path.join(workflowDir, "manifest.json"), "utf8"));
const versionManifest = JSON.parse(await fs.readFile(path.join(workflowDir, "versions", "v0001", "version-manifest.json"), "utf8"));
const request = JSON.parse(await fs.readFile(path.join(workflowDir, "runs", "operator", "request.json"), "utf8"));
const receipt = JSON.parse(await fs.readFile(path.join(workflowDir, "runs", "operator", "receipt.json"), "utf8"));
const diffReport = JSON.parse(await fs.readFile(path.join(workflowDir, "runs", "operator", "diff-report.json"), "utf8"));
const overwriteReceipt = JSON.parse(await fs.readFile(path.join(workflowDir, "runs", "operator", "failure-overwrite-input-receipt.json"), "utf8"));
const existingReceipt = JSON.parse(await fs.readFile(path.join(workflowDir, "runs", "operator", "failure-existing-output-receipt.json"), "utf8"));
const checks = [];

const rootSchemaErrors = validateNode(schema, rootManifest);
const versionSchemaErrors = validateNode(schema, versionManifest);
requireCheck(rootSchemaErrors.length === 0, "根 manifest 通过 schema", rootSchemaErrors);
requireCheck(versionSchemaErrors.length === 0, "version-manifest 通过 schema", versionSchemaErrors);

for (const key of ["workflowId", "version", "inputSlots", "target", "implementation"]) {
  requireCheck(JSON.stringify(rootManifest[key]) === JSON.stringify(versionManifest[key]), `根清单与版本快照的 ${key} 一致`);
}
requireCheck(path.basename(workflowDir) === rootManifest.workflowId, "workflowId 与目录名一致");
requireCheck(new Set(rootManifest.inputSlots.map((slot) => slot.slotId)).size === rootManifest.inputSlots.length, "inputSlots 唯一");
requireCheck(new Set((rootManifest.parameters ?? []).map((item) => item.name)).size === (rootManifest.parameters ?? []).length, "parameters 唯一");
requireCheck(rootManifest.status === "TRIAL", "单一发现案例仅标记 TRIAL");
requireCheck(rootManifest.validation.goldCases.some((item) => item.storage === "REPLAYABLE" && item.result === "PASS"), "TRIAL 含 REPLAYABLE PASS 案例");
requireCheck(!rootManifest.validation.goldCases.some((item) => item.usedForDiscovery === false && item.result === "PASS"), "没有伪造独立验证案例");
requireCheck(rootManifest.implementation.command.filter((item) => item === "{request}").length === 1, "implementation.command 中 {request} 恰好一次");

for (const artifact of rootManifest.implementation.artifacts) {
  requireCheck(safeRelative(artifact.path), `实现产物路径受限：${artifact.path}`);
  requireCheck(await fileSha256(path.join(workflowDir, artifact.path)) === artifact.sha256, `实现产物哈希匹配：${artifact.path}`);
}
for (const slot of rootManifest.inputSlots) {
  const fingerprint = slot.structureFingerprint;
  requireCheck(safeRelative(fingerprint.basis), `结构依据路径受限：${slot.slotId}`);
  requireCheck(await fileSha256(path.join(workflowDir, fingerprint.basis)) === fingerprint.value, `结构指纹匹配：${slot.slotId}`);
}
requireCheck(await fileSha256(path.join(workflowDir, rootManifest.target.structureFingerprint.basis)) === rootManifest.target.structureFingerprint.value, "目标结构指纹匹配");

const requestInputs = Object.values(request.inputs).flat();
requireCheck(requestInputs.every(path.isAbsolute) && path.isAbsolute(request.outputPath), "运行请求全部使用绝对路径");
requireCheck(!requestInputs.includes(request.outputPath), "主运行输出路径不覆盖输入");
requireCheck(receipt.exitStatus === "PASS" && receipt.exitCode === 0, "主运行回执 PASS");
requireCheck(diffReport.validationStatus === "PASS" && Object.values(diffReport.checks).every(Boolean), "差异报告全部检查 PASS");
requireCheck(overwriteReceipt.exitStatus === "FAIL" && overwriteReceipt.exitCode === 2 && overwriteReceipt.checks.blocking.includes("输出路径不得覆盖输入文件"), "覆盖输入失败关闭");
requireCheck(existingReceipt.exitStatus === "FAIL" && existingReceipt.exitCode === 2 && existingReceipt.checks.blocking.includes("输出文件已存在，拒绝覆盖"), "覆盖已有输出失败关闭");
requireCheck(await fileSha256(receipt.output.path) === receipt.output.sha256, "输出文件哈希匹配运行回执");
requireCheck(Object.values(receipt.inputFiles).every((item) => item.sha256Before === item.sha256After), "全部输入运行前后哈希不变");

const xlsxFiles = (await listFiles(workflowDir)).filter((filePath) => filePath.endsWith(".xlsx"));
requireCheck(xlsxFiles.length === 4, "本测试恰好创建 4 个 xlsx", xlsxFiles.map((filePath) => path.relative(workflowDir, filePath)));
requireCheck(rootManifest.validation.goldCases[0].usedForDiscovery === true, "唯一 PASS 案例明确用于规则发现");

const report = {
  schemaVersion: "0.1",
  workflowId: rootManifest.workflowId,
  checkedAt: new Date().toISOString(),
  status: checks.every((item) => item.status === "PASS") ? "PASS" : "FAIL",
  checks,
};
await fs.writeFile(path.join(workflowDir, "runs", "operator", "bundle-validation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: report.status, passed: checks.filter((item) => item.status === "PASS").length, total: checks.length }));
if (report.status !== "PASS") process.exitCode = 1;
