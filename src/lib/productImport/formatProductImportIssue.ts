import type { Language } from "../../types";
import { tTemplate } from "../i18n";
import { CSV_IMPORT_MAX_BYTES, CSV_IMPORT_MAX_ROWS, EXCEL_IMPORT_MAX_BYTES } from "./csvLimits";
import type { ProductImportCsvIssue } from "./parseProductImportCsv";

/** Shared operator-facing text for parse issues (CSV + Excel). */
export function formatProductImportCsvIssue(lang: Language, issue: ProductImportCsvIssue): string {
  return tTemplate(lang, issue.messageKey, {
    row: issue.rowNumber != null ? String(issue.rowNumber) : "",
    columns: issue.column ?? issue.params?.columns ?? "",
    max: issue.params?.max ?? String(CSV_IMPORT_MAX_ROWS),
    count: issue.params?.count ?? "",
    maxKb: issue.params?.maxKb ?? String(Math.floor(CSV_IMPORT_MAX_BYTES / 1024)),
    maxMb: issue.params?.maxMb ?? String(Math.floor(EXCEL_IMPORT_MAX_BYTES / (1024 * 1024))),
  });
}
