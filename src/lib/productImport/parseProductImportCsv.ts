import {
  detectCsvImportTemplate,
  mapCsvImportHeaderRow,
  type CsvImportField,
  type CsvImportTemplateKind,
} from "./csvColumns";
import { analyzeHeaderMappings, type HeaderMappingDecision } from "./headerMappingConfidence";
import { CSV_IMPORT_MAX_BYTES, CSV_IMPORT_MAX_ROWS } from "./csvLimits";
import { newImportClientId } from "./createNormalizedRow";
import { isCsvRecordBlank, parseCsvText } from "./parseCsvText";
import {
  sellUnitsFromOpeningPacks,
  unitCostFromImportPackCost,
} from "./packImportSemantics";
import type { NormalizedProductImportRow, ProductImportSource, WorkbookSheetCandidate } from "./types";

export type ProductImportCsvIssueKind =
  | "missing_column"
  | "malformed_csv"
  | "empty_file"
  | "no_data_rows"
  | "too_many_rows"
  | "file_too_large"
  | "invalid_number"
  | "excel_not_supported"
  | "legacy_template"
  | "unrecognized_template"
  /** Phase 1: no worksheet in the workbook scored as product data. */
  | "no_product_sheet"
  /** Phase 1: more than one worksheet scored as product data — caller must choose. */
  | "multiple_sheets_found";

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
  templateKind?: CsvImportTemplateKind;
  /** Per-column mapping confidence for this sheet's header row (Phase 4). */
  headerMappings?: readonly HeaderMappingDecision[];
  /**
   * Set only when the source workbook has more than one worksheet that looks
   * like product data. The caller must re-invoke with `{ sheetName }` set to
   * one of these before rows are produced. `ok` is false in this state.
   */
  sheetChoices?: readonly WorkbookSheetCandidate[];
};

export type ParsedImportNumber =
  | { status: "empty" }
  | { status: "ok"; value: number }
  | { status: "invalid" };

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
  let s = trimmed.replace(/^ugx\s*/i, "").replace(/\s+/g, "");
  if (!s) return { status: "empty" };
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { status: "invalid" };
  const value = Number(s);
  if (!Number.isFinite(value)) return { status: "invalid" };
  return { status: "ok", value };
}

function cell(record: readonly string[], index: Partial<Record<CsvImportField, number>>, field: CsvImportField): string {
  const i = index[field];
  if (i == null) return "";
  return record[i] ?? "";
}

function mapNoPackRecord(
  record: readonly string[],
  index: Partial<Record<CsvImportField, number>>,
  sourceRowNumber: number,
  source: ProductImportSource,
): { row: NormalizedProductImportRow; issues: ProductImportCsvIssue[] } {
  const issues: ProductImportCsvIssue[] = [];
  const name = cell(record, index, "name").trim();
  const section = cell(record, index, "section").trim();
  const unitRaw = cell(record, index, "unit").trim();

  const priceParsed = parseImportNumber(cell(record, index, "sellingPrice"));
  const qtyParsed = parseImportNumber(cell(record, index, "openingQty"));
  const costParsed = parseImportNumber(cell(record, index, "costPrice"));

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

  let sellingPriceUgx = 0;
  if (priceParsed.status === "ok") sellingPriceUgx = Math.floor(priceParsed.value);

  let stockQty = 0;
  if (qtyParsed.status === "ok") stockQty = qtyParsed.value;
  else if (qtyParsed.status === "invalid") stockQty = Number.NaN;

  let costPricePerUnitUgx: number | null | undefined;
  if (costParsed.status === "empty") costPricePerUnitUgx = null;
  else if (costParsed.status === "ok") costPricePerUnitUgx = Math.floor(costParsed.value);
  else costPricePerUnitUgx = Number.NaN;

  const row: NormalizedProductImportRow = {
    clientId: newImportClientId(),
    source,
    enabled: true,
    name,
    categoryInput: section,
    category: "",
    baseUnit: unitRaw || "piece",
    packMode: "none",
    buyingUnit: undefined,
    conversionRate: null,
    openingPacks: null,
    stockQty,
    sellingPriceUgx,
    costPricePerUnitUgx,
    buyingPackCostUgx: null,
    sourceRowNumber,
  };

  return { row, issues };
}

function mapWithPackRecord(
  record: readonly string[],
  index: Partial<Record<CsvImportField, number>>,
  sourceRowNumber: number,
  source: ProductImportSource,
): { row: NormalizedProductImportRow; issues: ProductImportCsvIssue[] } {
  const issues: ProductImportCsvIssue[] = [];
  const name = cell(record, index, "name").trim();
  const section = cell(record, index, "section").trim();
  const unitRaw = cell(record, index, "unit").trim();
  const packLabel = cell(record, index, "packLabel").trim();

  const priceParsed = parseImportNumber(cell(record, index, "sellingPrice"));
  const packsParsed = parseImportNumber(cell(record, index, "openingPacks"));
  const packSizeParsed = parseImportNumber(cell(record, index, "packSize"));
  const costPerPackParsed = parseImportNumber(cell(record, index, "costPerPack"));

  if (priceParsed.status === "invalid") {
    issues.push(
      issue("invalid_number", "csvImportInvalidPrice", {
        rowNumber: sourceRowNumber,
        column: "Selling price",
        params: { row: String(sourceRowNumber) },
      }),
    );
  }
  if (packsParsed.status === "invalid") {
    issues.push(
      issue("invalid_number", "csvImportInvalidOpeningPacks", {
        rowNumber: sourceRowNumber,
        column: "Opening packs",
        params: { row: String(sourceRowNumber) },
      }),
    );
  }
  if (packSizeParsed.status === "invalid") {
    issues.push(
      issue("invalid_number", "csvImportInvalidPack", {
        rowNumber: sourceRowNumber,
        column: "Pack size",
        params: { row: String(sourceRowNumber) },
      }),
    );
  }
  if (costPerPackParsed.status === "invalid") {
    issues.push(
      issue("invalid_number", "csvImportInvalidCostPerPack", {
        rowNumber: sourceRowNumber,
        column: "Cost per pack",
        params: { row: String(sourceRowNumber) },
      }),
    );
  }

  let sellingPriceUgx = 0;
  if (priceParsed.status === "ok") sellingPriceUgx = Math.floor(priceParsed.value);

  let openingPacks = 0;
  if (packsParsed.status === "ok") openingPacks = packsParsed.value;
  else if (packsParsed.status === "invalid") openingPacks = Number.NaN;

  let conversionRate: number | null | undefined;
  if (packSizeParsed.status === "empty") conversionRate = null;
  else if (packSizeParsed.status === "ok") conversionRate = packSizeParsed.value;
  else conversionRate = Number.NaN;

  let stockQty = 0;
  if (
    Number.isFinite(openingPacks) &&
    conversionRate != null &&
    Number.isFinite(Number(conversionRate)) &&
    Number(conversionRate) > 0
  ) {
    stockQty = sellUnitsFromOpeningPacks(openingPacks, Number(conversionRate));
  } else if (!Number.isFinite(openingPacks) || (conversionRate != null && !Number.isFinite(Number(conversionRate)))) {
    stockQty = Number.NaN;
  }

  let buyingPackCostUgx: number | null | undefined;
  let costPricePerUnitUgx: number | null | undefined;
  if (costPerPackParsed.status === "empty") {
    buyingPackCostUgx = null;
    costPricePerUnitUgx = null;
  } else if (costPerPackParsed.status === "ok") {
    const packCost = Math.floor(costPerPackParsed.value);
    if (packCost > 0 && conversionRate != null && Number(conversionRate) > 0) {
      buyingPackCostUgx = packCost;
      costPricePerUnitUgx = unitCostFromImportPackCost(packCost, Number(conversionRate));
    } else if (packCost > 0) {
      buyingPackCostUgx = packCost;
      costPricePerUnitUgx = null;
    } else {
      buyingPackCostUgx = null;
      costPricePerUnitUgx = null;
    }
  } else {
    buyingPackCostUgx = Number.NaN;
    costPricePerUnitUgx = Number.NaN;
  }

  const row: NormalizedProductImportRow = {
    clientId: newImportClientId(),
    source,
    enabled: true,
    name,
    categoryInput: section,
    category: "",
    baseUnit: unitRaw || "piece",
    packMode: "packed",
    buyingUnit: packLabel ? packLabel.toLowerCase() : "",
    conversionRate,
    openingPacks,
    stockQty,
    sellingPriceUgx,
    costPricePerUnitUgx,
    buyingPackCostUgx,
    sourceRowNumber,
  };

  return { row, issues };
}

export type ParseProductImportCsvOptions = {
  /** Provenance for the produced rows. Excel rows get stricter cost rules. */
  source?: ProductImportSource;
};

export function parseProductImportCsv(
  text: string,
  options: ParseProductImportCsvOptions = {},
): ParseProductImportCsvResult {
  const source: ProductImportSource = options.source ?? "csv";
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

  const index = mapCsvImportHeaderRow(header);
  const detected = detectCsvImportTemplate(index);

  if (detected.status === "legacy") {
    return fail([issue("legacy_template", "csvImportLegacyTemplateRejected")]);
  }
  if (detected.status === "unknown") {
    return fail([
      issue("unrecognized_template", detected.messageKey, {
        column: detected.params?.columns,
        params: detected.params,
      }),
    ]);
  }

  const templateKind = detected.kind;
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
    const mapped =
      templateKind === "with_packs"
        ? mapWithPackRecord(record, index, sourceRowNumber, source)
        : mapNoPackRecord(record, index, sourceRowNumber, source);
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

  // Phase 4 — smart header mapping: analyze the SAME header row for
  // confidence, without changing which column `mapCsvImportHeaderRow`
  // actually used. Presentational + validation input only.
  const headerMappings = analyzeHeaderMappings(header);

  return { ok: true, rows, issues, blankRowCount, templateKind, headerMappings };
}

export type ParseProductImportCsvFileOptions = {
  /**
   * A worksheet name the caller already chose (from a previous `sheetChoices`
   * result). Only meaningful for Excel workbooks; ignored for CSV.
   */
  sheetName?: string;
};

export async function parseProductImportCsvFile(
  file: File,
  options: ParseProductImportCsvFileOptions = {},
): Promise<ParseProductImportCsvResult> {
  const { isExcelImportFilename, parseProductImportWorkbook } = await import("./parseProductImportExcel");
  if (isExcelImportFilename(file.name)) {
    const buffer = await file.arrayBuffer();
    return parseProductImportWorkbook(new Uint8Array(buffer), { sheetName: options.sheetName });
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
