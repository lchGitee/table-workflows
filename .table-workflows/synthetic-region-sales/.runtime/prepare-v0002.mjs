import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const workflowDir = path.resolve(import.meta.dirname, "..");
const versionDir = path.join(workflowDir, "versions", "v0002");
const runDir = path.join(workflowDir, "runs", "fix-regression");
const outputDir = path.join(workflowDir, "outputs", "fix-regression");
const finalize = process.argv.includes("--finalize");

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

async function structureFingerprint(relativePath) {
  const parsed = JSON.parse(await fs.readFile(path.join(workflowDir, relativePath), "utf8"));
  return sha256(JSON.stringify(canonicalize(parsed)));
}

async function artifact(relativePath, kind) {
  return { path: relativePath, kind, sha256: await fileSha256(path.join(workflowDir, relativePath)) };
}

const baseManifest = JSON.parse(await fs.readFile(path.join(workflowDir, "manifest.json"), "utf8"));
const now = new Date().toISOString();
const structurePaths = {
  "orders-source": "versions/v0002/structure/orders-input.json",
  "customers-source": "versions/v0002/structure/customers-input.json",
  target: "versions/v0002/structure/target-output.json",
};

const manifest = structuredClone(baseManifest);
manifest.version = 2;
manifest.previousVersion = 1;
manifest.status = finalize ? "TRIAL" : "NEEDS_REVIEW";
manifest.updatedAt = now;
manifest.inputSlots = await Promise.all(manifest.inputSlots.map(async (slot) => ({
  ...slot,
  structureFingerprint: {
    algorithm: "sha256",
    value: await structureFingerprint(structurePaths[slot.slotId]),
    basis: structurePaths[slot.slotId],
  },
})));
manifest.target = {
  ...manifest.target,
  structureFingerprint: {
    algorithm: "sha256",
    value: await structureFingerprint(structurePaths.target),
    basis: structurePaths.target,
  },
};
manifest.implementation = {
  kind: "SCRIPT",
  entrypoint: "versions/v0002/run.mjs",
  command: [
    "/Users/lch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node",
    "versions/v0002/run.mjs",
    "--request",
    "{request}",
  ],
  runtime: "Node.js 24.19.0 + @oai/artifact-tool 2.8.59 + Python 3.12.14 + openpyxl 3.1.5；精确版本和完整性见 dependency-lock.json。",
  artifacts: await Promise.all([
    artifact("versions/v0002/run.mjs", "SCRIPT"),
    artifact("versions/v0002/inspect_structure.py", "SCRIPT"),
    artifact("versions/v0002/dependency-lock.json", "DEPENDENCY_LOCK"),
    artifact(structurePaths["orders-source"], "STRUCTURE_CONTRACT"),
    artifact(structurePaths["customers-source"], "STRUCTURE_CONTRACT"),
    artifact(structurePaths.target, "STRUCTURE_CONTRACT"),
  ]),
};

const primaryReceiptPath = path.join(runDir, "receipt.json");
let completedAt;
if (finalize) {
  const receipt = JSON.parse(await fs.readFile(primaryReceiptPath, "utf8"));
  if (receipt.exitStatus !== "PASS") throw new Error("主回放未通过，不能发布 v0002");
  completedAt = receipt.completedAt;
}
manifest.validation.goldCases = manifest.validation.goldCases.map((item) => ({
  ...item,
  requestPath: "runs/fix-regression/request.json",
  result: finalize ? "PASS" : "NOT_RUN",
  ...(finalize ? { lastRunAt: completedAt } : {}),
}));
manifest.validation.invariants = manifest.validation.invariants.map((item) => ({
  ...item,
  checker: item.id === "balanced-summary"
    ? "runs/fix-regression/regression-report.json:businessReplay"
    : "versions/v0002/run.mjs",
}));
if (finalize) manifest.validation.lastValidatedAt = now;
manifest.changeSummary = finalize
  ? "v0002 从实际工作簿计算结构指纹并校验依赖锁；历史回放、数据稳定性和非表头结构漂移负例均通过，状态保持 TRIAL。"
  : "v0002 候选修复实际结构指纹与依赖锁校验，等待回放和结构负例验证。";

await fs.mkdir(runDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(versionDir, "version-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const requests = {
  "request.json": {
    schemaVersion: "0.1",
    workflowId: "synthetic-region-sales",
    workflowVersion: 2,
    inputs: {
      "orders-source": [path.join(workflowDir, "cases", "discovery-001", "inputs", "orders.xlsx")],
      "customers-source": [path.join(workflowDir, "cases", "discovery-001", "inputs", "customers.xlsx")],
    },
    outputPath: path.join(outputDir, "result-v2.xlsx"),
    parameters: {},
  },
  "data-only-request.json": {
    schemaVersion: "0.1",
    workflowId: "synthetic-region-sales",
    workflowVersion: 2,
    inputs: {
      "orders-source": [path.join(workflowDir, "cases", "structure-regression", "orders-data-only.xlsx")],
      "customers-source": [path.join(workflowDir, "cases", "discovery-001", "inputs", "customers.xlsx")],
    },
    outputPath: path.join(outputDir, "data-only-result-v2.xlsx"),
    parameters: {},
  },
  "structure-drift-request.json": {
    schemaVersion: "0.1",
    workflowId: "synthetic-region-sales",
    workflowVersion: 2,
    inputs: {
      "orders-source": [path.join(workflowDir, "cases", "structure-regression", "orders-with-chart.xlsx")],
      "customers-source": [path.join(workflowDir, "cases", "discovery-001", "inputs", "customers.xlsx")],
    },
    outputPath: path.join(outputDir, "structure-drift-result-v2.xlsx"),
    parameters: {},
  },
};

if (!finalize) {
  for (const [name, request] of Object.entries(requests)) {
    await fs.writeFile(path.join(runDir, name), `${JSON.stringify(request, null, 2)}\n`, "utf8");
  }
} else {
  await fs.writeFile(path.join(workflowDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ mode: finalize ? "finalize" : "prepare", status: manifest.status, version: manifest.version }));
