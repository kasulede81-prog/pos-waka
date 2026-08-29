import { officialCsvImportHeaders } from "./csvColumns";

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Official blank template (UTF-8 BOM so spreadsheet apps keep the headers). */
export function buildWakaProductImportTemplateCsv(): string {
  return `\uFEFF${officialCsvImportHeaders().map(csvCell).join(",")}\n`;
}

/** Documented example — not the file operators download. */
export function buildWakaProductImportExampleCsv(): string {
  const header = officialCsvImportHeaders().map(csvCell).join(",");
  const rows = [
    ["Sugar 1kg", "Groceries", "kg", "", "10", "2800", "3500"],
    ["Soda", "Drinks", "bottle", "24", "48", "", "1500"],
    ['Cooking oil, 1L', "Groceries", "bottle", "", "6", "4200", "5500"],
  ];
  return `\uFEFF${[header, ...rows.map((r) => r.map(csvCell).join(","))].join("\n")}\n`;
}
