import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workflowDir = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(workflowDir, "cases", "discovery-001", "inputs", "orders.xlsx");
const caseDir = path.join(workflowDir, "cases", "structure-regression");
const dataVariantPath = path.join(caseDir, "orders-data-only.xlsx");
const driftVariantPath = path.join(caseDir, "orders-with-chart.xlsx");
const previewDir = path.join(workflowDir, "runs", "fix-regression", "previews");

await fs.mkdir(caseDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const dataWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const dataSheet = dataWorkbook.worksheets.getItem("订单");
dataSheet.getRange("C6").values = [[2]];
const dataOutput = await SpreadsheetFile.exportXlsx(dataWorkbook);
await dataOutput.save(dataVariantPath);

const driftWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const driftSheet = driftWorkbook.worksheets.getItem("订单");
const chart = driftSheet.charts.add("bar", driftSheet.getRange("A1:C4"));
chart.title = "结构漂移测试";
chart.setPosition("G1", "N12");
const driftOutput = await SpreadsheetFile.exportXlsx(driftWorkbook);
await driftOutput.save(driftVariantPath);

for (const [name, workbook] of [["data-only", dataWorkbook], ["with-chart", driftWorkbook]]) {
  const preview = await workbook.render({ sheetName: "订单", autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDir, `${name}.png`), new Uint8Array(await preview.arrayBuffer()));
}

console.log(JSON.stringify({ dataVariantPath, driftVariantPath }));
