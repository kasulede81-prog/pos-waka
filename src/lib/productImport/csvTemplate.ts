import {
  officialCsvImportHeadersNoPack,
  officialCsvImportHeadersWithPack,
} from "./csvColumns";

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Official blank Template A — products without packs. */
export function buildWakaProductImportNoPackTemplateCsv(): string {
  return `\uFEFF${officialCsvImportHeadersNoPack().map(csvCell).join(",")}\n`;
}

/** Official blank Template B — products with packs. */
export function buildWakaProductImportWithPackTemplateCsv(): string {
  return `\uFEFF${officialCsvImportHeadersWithPack().map(csvCell).join(",")}\n`;
}

/** @deprecated Use buildWakaProductImportNoPackTemplateCsv. */
export function buildWakaProductImportTemplateCsv(): string {
  return buildWakaProductImportNoPackTemplateCsv();
}

/** Documented Template A example. */
export function buildWakaProductImportNoPackExampleCsv(): string {
  const header = officialCsvImportHeadersNoPack().map(csvCell).join(",");
  const rows = [
    ["Sugar 1kg", "Groceries", "kg", "10", "2800", "3500"],
    ["Soap", "Household", "piece", "1", "", "2000"],
    ['Cooking oil, 1L', "Groceries", "bottle", "6", "4200", "5500"],
  ];
  return `\uFEFF${[header, ...rows.map((r) => r.map(csvCell).join(","))].join("\n")}\n`;
}

/** Documented Template B example (Coca Cola wizard-parity row included). */
export function buildWakaProductImportWithPackExampleCsv(): string {
  const header = officialCsvImportHeadersWithPack().map(csvCell).join(",");
  const rows = [
    ["Coca Cola 500ml", "Drinks", "Piece", "Crate", "24", "48", "18000", "2000"],
    ["Soda", "Drinks", "bottle", "crate", "24", "2", "", "1500"],
  ];
  return `\uFEFF${[header, ...rows.map((r) => r.map(csvCell).join(","))].join("\n")}\n`;
}

/** @deprecated Prefer the no-pack / with-pack example builders. */
export function buildWakaProductImportExampleCsv(): string {
  return buildWakaProductImportNoPackExampleCsv();
}
