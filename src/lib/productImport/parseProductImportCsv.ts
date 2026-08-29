import { csvImportFieldFromHeader, isIgnoredInternalCsvHeader, type CsvImportField } from "./csvColumns";
import { CSV_IMPORT_MAX_BYTES, CSV_IMPORT_MAX_ROWS } from "./csvLimits";
import { newImportClientId } from "./createNormalizedRow";
import { isCsvRecordBlank, parseCsvText } from "./parseCsvText";
import type { NormalizedProductImportRow } from "./types";

export type ProductImportCsvIssueKind =
  | "missing_column"
  | "malformed_csv"
  | "empty_file"
  | "no_data_rows"
  | "too_many_rows"
  | "file_too_large"
  | "invalid_number"
  | "excel_not_supported";

export type ProductImportCsvIssue = {
  kind: ProductImportCsvIssueKind;
  messageKey: string;
  rowNumber?: number;
  column?: string;
  params?: Record<string, string>;
};

export type ParseProductImportCsvResult = {
  ok: boolean;
  rows: NormalizedProductImportRow[];
  issues: ProductImportCsvIssue[];
  blankRowCount: number;
};

export type ParsedImportNumber =
  | { status: "empty" }
  | { status: "ok"; value: number }
  | { status: "invalid" };

const REQUIRED: CsvImportField[] = ["name", "sellingPrice"];

function issue(
  kind: ProductImportCsvIssueKind,
  messageKey: string,
  extra: Partial<ProductImportCsvIssue> = {},
): ProductImportCsvIssue {
  return { kind, messageKey, ...extra };
}

function fail(issues: ProductImportCsvIssue[]): ParseProductImportCsvResult {
  return { ok: false, rows: [], issues, blankRowCount: 0 };
}

/**
 * Parse a numeric CSV cell. Empty stays empty (cost missing, qty 0).
 * Does not invent a cost. Thousands separators and a leading UGX label are allowed.
 */
export function parseImportNumber(raw: string): ParsedImportNumber {
  const trimmed = raw.trim();
  if (!trimmed) return { status: "empty" };
  let s = trimmed.replace(/^ugx\s*/i, "").replace(/\s/g, "");
  if (!s) return { status: "empty" };
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { status: "invalid" };
  const value = Number(s);
  if (!Number.isFinite(value)) return { status: "invalid" };
  return { status: "ok", value };
}

function mapHeader(record: readonly string[]): {
  index: Partial<Record<CsvImportField, number>>;
  missing: CsvImportField[];
} {
  const index: Partial<Record<CsvImportField, number>> = {};
  for (let i = 0; i < record.length; i += 1) {
    const header = record[i] ?? "";
    if (isIgnoredInternalCsvHeader(header)) continue;
    const field = csvImportFieldFromHeader(header);
    if (!field) continue;
    if (index[field] == null) index[field] = i;
  }
  const missing = REQUIRED.filter((f) => index[f] == null);
  return { index, missing };
}

function cell(record: readonly string[], index: Partial<Record<CsvImportField, number>>, field: CsvImportField): string {
  const i = index[field];
  if (i == null) return "";
  return record[i] ?? "";
}

function mapRecord(
  record: readonly string[],
  index: Partial<Record<CsvImportField, number>>,
  sourceRowNumber: number,
): { row: NormalizedProductImportRow; issues: ProductImportCsvIssue[] } {
  const issues: ProductImportCsvIssue[] = [];
  const name = cell(record, index, "name").trim();
  const section = cell(record, index, "section").trim();
  const unitRaw = cell(record, index, "unit").trim();
  const packLabel = cell(record, index, "packLabel").trim();

  const priceParsed = parseImportNumber(cell(record, index, "sellingPrice"));
  const qtyParsed = parseImportNumber(cell(record, index, "openingQty"));
  const costParsed = parseImportNumber(cell(record, index, "costPrice"));
  const packParsed = parseImportNumber(cell(record, index, "packSize"));

  if (priceParsed.status === "invalid") {
    issues.push(
      issue("invalid_number", "csvImportInvalidPrice", {
        rowNumber: sourceRowNumber,
        column: "Selling price",
        params: { row: String(sourceRowNumber) },
      }),
    );
  }
  if (qtyParsed.status === "invalid") {
    issues.push(
      issue("invalid_number", "csvImportInvalidQuantity", {
        rowNumber: sourceRowNumber,
        column: "Opening quantity",
        params: { row: String(sourceRowNumber) },
      }),
    );
  }
  if (costParsed.status === "invalid") {
    issues.push(
      issue("invalid_number", "csvImportInvalidCost", {
        rowNumber: sourceRowNumber,
        column: "Cost price",
        params: { row: String(sourceRowNumber) },
      }),
    );
  }
  if (packParsed.status === "invalid") {
    issues.push(
      issue("invalid_number", "csvImportInvalidPack", {
        rowNumber: sourceRowNumber,
        column: "Pack size",
        params: { row: String(sourceRowNumber) },
      }),
    );
  }

  let sellingPriceUgx = 0;
  if (priceParsed.status === "ok") sellingPriceUgx = Math.floor(priceParsed.value);

  let stockQty = 0;
  if (qtyParsed.status === "ok") stockQty = qtyParsed.value;
  else if (qtyParsed.status === "invalid") stockQty = Number.NaN;

  let costPricePerUnitUgx: number | null | undefined;
  if (costParsed.status === "empty") costPricePerUnitUgx = null;
  else if (costParsed.status === "ok") costPricePerUnitUgx = Math.floor(costParsed.value);
  else costPricePerUnitUgx = Number.NaN;

  let conversionRate: number | null | undefined;
  if (packParsed.status === "empty") conversionRate = null;
  else if (packParsed.status === "ok") conversionRate = packParsed.value;
  else conversionRate = Number.NaN;

  const row: NormalizedProductImportRow = {
    clientId: newImportClientId(),
    source: "csv",
    enabled: true,
    name,
    categoryInput: section,
    category: "",
    baseUnit: unitRaw || "piece",
    buyingUnit: packLabel ? packLabel : undefined,
    conversionRate,
    stockQty,
    sellingPriceUgx,
    costPricePerUnitUgx,
    sourceRowNumber,
  };

  return { row, issues };
}

export function parseProductImportCsv(text: string): ParseProductImportCsvResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > CSV_IMPORT_MAX_BYTES) {
    return fail([
      issue("file_too_large", "csvImportFileTooLarge", {
        params: { maxKb: String(Math.floor(CSV_IMPORT_MAX_BYTES / 1024)) },
      }),
    ]);
  }

  const parsed = parseCsvText(text);
  if (!parsed.ok) {
    return fail([
      issue("malformed_csv", "csvImportUnclosedQuote", {
        rowNumber: parsed.rowNumber,
        params: { row: String(parsed.rowNumber) },
      }),
    ]);
  }

  if (parsed.records.length === 0) {
    return fail([issue("empty_file", "csvImportEmpty")]);
  }

  const header = parsed.records[0] ?? [];
  if (isCsvRecordBlank(header)) {
    return fail([issue("empty_file", "csvImportEmpty")]);
  }

  const { index, missing } = mapHeader(header);
  if (missing.length) {
    const labels = missing.map((f) => (f === "name" ? "Product name" : "Selling price"));
    return fail([
      issue("missing_column", "csvImportMissingColumn", {
        column: labels.join(", "),
        params: { columns: labels.join(", ") },
      }),
    ]);
  }

  const rows: NormalizedProductImportRow[] = [];
  const issues: ProductImportCsvIssue[] = [];
  let blankRowCount = 0;

  for (let r = 1; r < parsed.records.length; r += 1) {
    const record = parsed.records[r]!;
    const sourceRowNumber = r + 1;
    if (isCsvRecordBlank(record)) {
      blankRowCount += 1;
      continue;
    }
    const mapped = mapRecord(record, index, sourceRowNumber);
    rows.push(mapped.row);
    issues.push(...mapped.issues);
  }

  if (rows.length === 0) {
    return fail([issue("no_data_rows", "csvImportNoRows")]);
  }

  if (rows.length > CSV_IMPORT_MAX_ROWS) {
    return fail([
      issue("too_many_rows", "csvImportTooManyRows", {
        params: { max: String(CSV_IMPORT_MAX_ROWS), count: String(rows.length) },
      }),
    ]);
  }

  return { ok: true, rows, issues, blankRowCount };
}

export async function parseProductImportCsvFile(file: File): Promise<ParseProductImportCsvResult> {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xls|ods)$/.test(name)) {
    return fail([issue("excel_not_supported", "csvImportExcelNotSupported")]);
  }
  if (file.size > CSV_IMPORT_MAX_BYTES) {
    return fail([
      issue("file_too_large", "csvImportFileTooLarge", {
        params: { maxKb: String(Math.floor(CSV_IMPORT_MAX_BYTES / 1024)) },
      }),
    ]);
  }
  const text = await file.text();
  return parseProductImportCsv(text);
}
