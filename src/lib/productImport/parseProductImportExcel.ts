/**
 * Excel (.xlsx / .xlsm / .xls / .ods) adapter for the existing product import pipeline.
 *
 * This is an ADAPTER, not a second importer. The chosen worksheet is projected
 * to CSV text and handed to `parseProductImportCsv`, so template detection,
 * header aliasing, pack semantics, normalization and validation all stay in
 * exactly one place. Everything after this file is shared with CSV.
 *
 * SheetJS is imported dynamically so it code-splits out of the main POS bundle.
 *
 * Phase 1 — multi-sheet handling:
 *   A workbook may contain a README/instructions/notes sheet alongside one or
 *   more sheets that actually hold product rows. `scanWorkbookForProductSheets`
 *   scores every sheet's first non-blank row against the SAME header mapping
 *   used by the CSV path (`mapCsvImportHeaderRow` + `detectCsvImportTemplate`),
 *   using a row-capped read (`sheetRows`) so scoring a workbook with a huge
 *   sheet stays cheap. Single-sheet workbooks skip scoring entirely and behave
 *   exactly as before this phase.
 */

import { CSV_IMPORT_MAX_BYTES } from "./csvLimits";
import { detectCsvImportTemplate, mapCsvImportHeaderRow } from "./csvColumns";
import type { ParseProductImportCsvResult, ProductImportCsvIssue } from "./parseProductImportCsv";
import { parseProductImportCsv } from "./parseProductImportCsv";
import type { WorkbookSheetCandidate } from "./types";

/** Workbook bytes are compressed; the CSV projection is capped separately. */
export const EXCEL_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** How many leading rows to read per sheet while scoring — cheap even on huge sheets. */
const SHEET_SCAN_ROWS = 25;

const EXCEL_EXTENSIONS = /\.(xlsx|xlsm|xls|ods)$/i;

export function isExcelImportFilename(filename: string): boolean {
  return EXCEL_EXTENSIONS.test(filename.trim());
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

function cellToString(cell: unknown): string {
  return String(cell ?? "").trim();
}

function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

/** First non-blank row within the rows actually read (respects any `sheetRows` cap). */
function firstMeaningfulRow(XLSX: typeof import("xlsx"), sheet: import("xlsx").WorkSheet): string[] | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  for (const row of rows) {
    const asStrings = row.map(cellToString);
    if (!isBlankRow(asStrings)) return asStrings;
  }
  return null;
}

/**
 * Score every worksheet's header row against the existing template detector.
 * Lightweight: reads at most `SHEET_SCAN_ROWS` rows per sheet.
 */
async function scanWorkbookForProductSheets(
  bytes: Uint8Array,
): Promise<
  | { ok: true; sheetNames: string[]; candidates: WorkbookSheetCandidate[] }
  | { ok: false; issues: ProductImportCsvIssue[] }
> {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    return { ok: false, issues: [issue("malformed_csv", "excelImportUnreadable")] };
  }

  let wb: import("xlsx").WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "array", sheetRows: SHEET_SCAN_ROWS });
  } catch {
    return { ok: false, issues: [issue("malformed_csv", "excelImportUnreadable")] };
  }

  if (wb.SheetNames.length === 0) {
    return { ok: false, issues: [issue("empty_file", "csvImportEmpty")] };
  }

  const candidates: WorkbookSheetCandidate[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const headerRow = firstMeaningfulRow(XLSX, sheet);
    if (!headerRow) continue; // empty / purely blank sheet — not a candidate
    const index = mapCsvImportHeaderRow(headerRow);
    const detected = detectCsvImportTemplate(index);
    if (detected.status === "ok") {
      candidates.push({ sheetName, headerPreview: headerRow });
    }
  }

  return { ok: true, sheetNames: wb.SheetNames, candidates };
}

/**
 * Project one worksheet to CSV text.
 * `rawNumbers` keeps 22000 as `22000` rather than a locale-formatted string.
 */
export async function workbookBytesToCsvText(
  bytes: Uint8Array,
  opts: { sheetName?: string } = {},
): Promise<{ ok: true; csv: string } | { ok: false; issues: ProductImportCsvIssue[] }> {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    return { ok: false, issues: [issue("malformed_csv", "excelImportUnreadable")] };
  }

  let csv: string;
  try {
    const wb = XLSX.read(bytes, { type: "array" });
    const sheetName = opts.sheetName ?? wb.SheetNames[0];
    if (!sheetName) return { ok: false, issues: [issue("empty_file", "csvImportEmpty")] };
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return { ok: false, issues: [issue("empty_file", "csvImportEmpty")] };
    csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, rawNumbers: true });
  } catch {
    return { ok: false, issues: [issue("malformed_csv", "excelImportUnreadable")] };
  }

  if (!csv.trim()) return { ok: false, issues: [issue("empty_file", "csvImportEmpty")] };
  return { ok: true, csv };
}

export type ParseProductImportWorkbookOptions = {
  /** A sheet the caller already chose from a previous `sheetChoices` result. */
  sheetName?: string;
};

/**
 * Parse workbook bytes through the shared CSV pipeline.
 * Rows are tagged `source: "excel"` so Excel-only safety rules (blocking on a
 * missing buying price) can apply without changing CSV behaviour.
 *
 * Sheet selection:
 *   - `opts.sheetName` given → project exactly that sheet, no scoring.
 *   - Single-sheet workbook → that sheet, unchanged from pre-Phase-1 behaviour.
 *   - Multi-sheet workbook, exactly one product-shaped sheet → auto-selected.
 *   - Multi-sheet workbook, zero product-shaped sheets → `no_product_sheet`.
 *   - Multi-sheet workbook, 2+ product-shaped sheets → `sheetChoices` returned;
 *     the caller must re-invoke with `{ sheetName }`.
 */
export async function parseProductImportWorkbook(
  bytes: Uint8Array,
  opts: ParseProductImportWorkbookOptions = {},
): Promise<ParseProductImportCsvResult> {
  if (bytes.byteLength > EXCEL_IMPORT_MAX_BYTES) {
    return fail([
      issue("file_too_large", "excelImportFileTooLarge", {
        params: { maxMb: String(Math.floor(EXCEL_IMPORT_MAX_BYTES / (1024 * 1024))) },
      }),
    ]);
  }

  let sheetName = opts.sheetName;

  if (!sheetName) {
    const scan = await scanWorkbookForProductSheets(bytes);
    if (!scan.ok) return fail(scan.issues);

    if (scan.sheetNames.length === 1) {
      // Single-sheet workbook: no ambiguity possible, preserve prior behaviour.
      sheetName = scan.sheetNames[0];
    } else if (scan.candidates.length === 0) {
      return fail([issue("no_product_sheet", "excelImportNoProductSheet")]);
    } else if (scan.candidates.length === 1) {
      sheetName = scan.candidates[0]!.sheetName;
    } else {
      return {
        ok: false,
        rows: [],
        issues: [issue("multiple_sheets_found", "excelImportMultipleSheets")],
        blankRowCount: 0,
        sheetChoices: scan.candidates,
      };
    }
  }

  const projected = await workbookBytesToCsvText(bytes, { sheetName });
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
