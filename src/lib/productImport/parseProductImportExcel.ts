/**
 * Excel (.xlsx / .xls / .ods) adapter for the existing product import pipeline.
 *
 * This is an ADAPTER, not a second importer. The workbook's first sheet is
 * projected to CSV text and handed to `parseProductImportCsv`, so template
 * detection, header aliasing, pack semantics, normalization and validation all
 * stay in exactly one place. Everything after this file is shared with CSV.
 *
 * SheetJS is imported dynamically so it code-splits out of the main POS bundle.
 */

import { CSV_IMPORT_MAX_BYTES, EXCEL_IMPORT_MAX_BYTES } from "./csvLimits";
import type { ParseProductImportCsvResult, ProductImportCsvIssue } from "./parseProductImportCsv";
import { parseProductImportCsv } from "./parseProductImportCsv";

export { EXCEL_IMPORT_MAX_BYTES };

const EXCEL_EXTENSIONS = /\.(xlsx|xlsm|xls|ods)$/i;

const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

export function isExcelImportFilename(filename: string): boolean {
  return EXCEL_EXTENSIONS.test(filename.trim());
}

/** Filename first; MIME covers Android/Drive picks that drop the extension. */
export function isExcelImportFile(file: { name: string; type?: string }): boolean {
  if (isExcelImportFilename(file.name)) return true;
  return EXCEL_MIME_TYPES.has((file.type ?? "").trim().toLowerCase());
}

function fail(issues: ProductImportCsvIssue[]): ParseProductImportCsvResult {
  return { ok: false, rows: [], issues, blankRowCount: 0 };
}

function issue(
  kind: ProductImportCsvIssue["kind"],
  messageKey: string,
  extra: Partial<ProductImportCsvIssue> = {},
): ProductImportCsvIssue {
  return { kind, messageKey, ...extra };
}

/**
 * Project the first worksheet to CSV text.
 * `rawNumbers` keeps 22000 as `22000` rather than a locale-formatted string.
 */
export async function workbookBytesToCsvText(bytes: Uint8Array): Promise<
  { ok: true; csv: string } | { ok: false; issues: ProductImportCsvIssue[] }
> {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    return { ok: false, issues: [issue("malformed_csv", "excelImportUnreadable")] };
  }

  let csv: string;
  try {
    const wb = XLSX.read(bytes, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { ok: false, issues: [issue("empty_file", "csvImportEmpty")] };
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return { ok: false, issues: [issue("empty_file", "csvImportEmpty")] };
    csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: true, rawNumbers: true });
  } catch {
    return { ok: false, issues: [issue("malformed_csv", "excelImportUnreadable")] };
  }

  if (!csv.trim()) return { ok: false, issues: [issue("empty_file", "csvImportEmpty")] };
  return { ok: true, csv };
}

/**
 * Parse workbook bytes through the shared CSV pipeline.
 * Rows are tagged `source: "excel"` so Excel-only safety rules (blocking on a
 * missing buying price) can apply without changing CSV behaviour.
 */
export async function parseProductImportWorkbook(
  bytes: Uint8Array,
): Promise<ParseProductImportCsvResult> {
  if (bytes.byteLength > EXCEL_IMPORT_MAX_BYTES) {
    return fail([
      issue("file_too_large", "excelImportFileTooLarge", {
        params: { maxMb: String(Math.floor(EXCEL_IMPORT_MAX_BYTES / (1024 * 1024))) },
      }),
    ]);
  }

  const projected = await workbookBytesToCsvText(bytes);
  if (!projected.ok) return fail(projected.issues);

  const csvBytes = new TextEncoder().encode(projected.csv).length;
  if (csvBytes > CSV_IMPORT_MAX_BYTES) {
    return fail([
      issue("file_too_large", "csvImportFileTooLarge", {
        params: { maxKb: String(Math.floor(CSV_IMPORT_MAX_BYTES / 1024)) },
      }),
    ]);
  }

  return parseProductImportCsv(projected.csv, { source: "excel" });
}
