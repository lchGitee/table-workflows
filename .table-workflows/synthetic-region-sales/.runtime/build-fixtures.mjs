import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workflowDir = path.resolve(import.meta.dirname, "..");
const caseDir = path.join(workflowDir, "cases", "discovery-001");

async function saveWorkbook(workbook, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const blob = await SpreadsheetFile.exportXlsx(workbook);
  await blob.save(outputPath);
}

function styleGrid(sheet, rangeAddress, headerAddress, numericFormats = []) {
  const grid = sheet.getRange(rangeAddress);
  grid.format.font = { name: "Arial", size: 11, color: "#1F2937" };
  grid.format.verticalAlignment = "center";
  const header = sheet.getRange(headerAddress);
  header.format = {
    fill: "#1F4E78",
    font: { name: "Arial", size: 11, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
  };
  for (const [address, format] of numericFormats) {
    sheet.getRange(address).format.numberFormat = format;
  }
}

const orders = Workbook.create();
const ordersSheet = orders.worksheets.add("订单");
ordersSheet.getRange("A1:E7").values = [
  ["订单号", "客户编号", "数量", "单价", "状态"],
  ["O1001", "C001", 2, 120.5, "已完成"],
  ["O1002", "C002", 1, 80, "已完成"],
  ["O1003", "C001", 3, 50, "已取消"],
  ["O1004", "C003", 4, 25, "已完成"],
  ["O1005", "C004", 1, 200, "待处理"],
  ["O1006", "C005", 2, 75, "已完成"],
];
styleGrid(ordersSheet, "A1:E7", "A1:E1", [["C2:C7", "#,##0"], ["D2:D7", "#,##0.00"]]);
ordersSheet.getRange("A1:A7").format.columnWidth = 13;
ordersSheet.getRange("B1:B7").format.columnWidth = 13;
ordersSheet.getRange("C1:C7").format.columnWidth = 10;
ordersSheet.getRange("D1:D7").format.columnWidth = 12;
ordersSheet.getRange("E1:E7").format.columnWidth = 12;

const customers = Workbook.create();
const customersSheet = customers.worksheets.add("客户");
customersSheet.getRange("A1:C6").values = [
  ["客户编号", "客户名称", "区域"],
  ["C001", "甲公司", "华东"],
  ["C002", "乙公司", "华南"],
  ["C003", "丙公司", "华东"],
  ["C004", "丁公司", "华北"],
  ["C005", "戊公司", "华南"],
];
styleGrid(customersSheet, "A1:C6", "A1:C1");
customersSheet.getRange("A1:A6").format.columnWidth = 13;
customersSheet.getRange("B1:B6").format.columnWidth = 16;
customersSheet.getRange("C1:C6").format.columnWidth = 12;

const expected = Workbook.create();
const expectedSheet = expected.worksheets.add("区域汇总");
expectedSheet.getRange("A1:D3").values = [
  ["区域", "完成订单数", "完成件数", "销售额"],
  ["华东", 2, 6, 341],
  ["华南", 2, 3, 230],
];
styleGrid(expectedSheet, "A1:D3", "A1:D1", [["B2:C3", "#,##0"], ["D2:D3", "#,##0.00"]]);
expectedSheet.getRange("A1:A3").format.columnWidth = 12;
expectedSheet.getRange("B1:C3").format.columnWidth = 15;
expectedSheet.getRange("D1:D3").format.columnWidth = 14;

await saveWorkbook(orders, path.join(caseDir, "inputs", "orders.xlsx"));
await saveWorkbook(customers, path.join(caseDir, "inputs", "customers.xlsx"));
await saveWorkbook(expected, path.join(caseDir, "expected", "expected.xlsx"));

console.log(JSON.stringify({ created: 3, caseDir }));
