/**
 * Phase 26.1 — unified BI export / print delivery layer.
 * All file saves route through saveExportedFile; all prints through printDocumentNativeFallback.
 */

import { saveExportedFile } from "./fileDownload";
import { printDocumentNativeFallback, type NativePrintFallbackOptions } from "./nativePrintFallback";
import {
  logReportExport,
  timedReportExport,
  timedReportPrint,
  type ReportExportKind,
} from "./reportExportDiagnostics";
import { rowsToCsv, rowsToXlsxBlob } from "./reportSpreadsheetExport";

export type ExportFileResult = { ok: boolean; cancelled?: boolean };

export async function exportCsvFile(
  kind: ReportExportKind,
  filename: string,
  rows: Array<Array<string | number>>,
  options?: { shareDialogTitle?: string },
): Promise<ExportFileResult> {
  const body = rowsToCsv(rows);
  const ok = await timedReportExport(
    kind,
    "csv",
    () => saveExportedFile(filename, body, "text/csv;charset=utf-8", options),
    { rowCount: rows.length, fileSizeBytes: body.length },
  );
  return { ok };
}

export async function exportXlsxFile(
  kind: ReportExportKind,
  filename: string,
  rows: Array<Array<string | number>>,
  options?: { shareDialogTitle?: string; sheetName?: string },
): Promise<ExportFileResult> {
  const blob = await rowsToXlsxBlob(rows, options?.sheetName);
  const ok = await timedReportExport(
    kind,
    "xlsx",
    () => saveExportedFile(filename, blob, blob.type, options),
    { rowCount: rows.length, fileSizeBytes: blob.size },
  );
  return { ok };
}

export async function exportPdfFile(
  kind: ReportExportKind,
  filename: string,
  blob: Blob,
  options?: { shareDialogTitle?: string },
): Promise<ExportFileResult> {
  const ok = await timedReportExport(
    kind,
    "pdf",
    () => saveExportedFile(filename, blob, "application/pdf", options),
    { fileSizeBytes: blob.size },
  );
  return { ok };
}

export async function exportJsonFile(
  kind: ReportExportKind,
  filename: string,
  body: string,
  options?: { shareDialogTitle?: string },
): Promise<ExportFileResult> {
  const ok = await timedReportExport(
    kind,
    "json",
    () => saveExportedFile(filename, body, "application/json;charset=utf-8", options),
    { fileSizeBytes: body.length },
  );
  return { ok };
}

export async function exportTextFile(
  kind: ReportExportKind,
  filename: string,
  body: string,
  mime = "text/plain;charset=utf-8",
  options?: { shareDialogTitle?: string },
): Promise<ExportFileResult> {
  const ok = await timedReportExport(
    kind,
    "text",
    () => saveExportedFile(filename, body, mime, options),
    { fileSizeBytes: body.length },
  );
  return { ok };
}

export async function printReportDocument(
  kind: ReportExportKind,
  options: NativePrintFallbackOptions,
): Promise<boolean> {
  return timedReportPrint(kind, () => printDocumentNativeFallback(options));
}

export function logShareOutcome(kind: ReportExportKind, ok: boolean, reason?: string): void {
  logReportExport(ok ? "export_done" : "export_fail", {
    kind,
    format: "share",
    ok,
    reason,
  });
}
