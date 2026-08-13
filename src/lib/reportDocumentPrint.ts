import { downloadPdfBlob, printPdfBlobWithDesktop, sharePdfBlob } from "./documentPrint";
import { isNativePrintPlatform } from "./nativeReceiptPrint";
import { timedReportPrint, type ReportExportKind } from "./reportExportDiagnostics";
import { renderReportDocumentPdf } from "./reportDocumentPdf";
import type { ReportDocumentModel } from "./reportDocumentModel";

export function buildReportDocumentPdfBlob(model: ReportDocumentModel): Blob {
  return renderReportDocumentPdf(model);
}

/** Native: share the PDF (WebView print is a no-op). Desktop: print the same PDF blob. */
export async function printReportPdfBlob(
  kind: ReportExportKind,
  filename: string,
  blob: Blob,
  options?: { title?: string; shareDialogTitle?: string },
): Promise<boolean> {
  return timedReportPrint(kind, async () => {
    if (isNativePrintPlatform()) {
      return sharePdfBlob(filename, blob, options?.shareDialogTitle ?? "Print or share");
    }
    return printPdfBlobWithDesktop(blob, options?.title ?? "Waka report");
  });
}

export async function downloadReportPdfBlob(filename: string, blob: Blob): Promise<boolean> {
  return downloadPdfBlob(filename, blob);
}

export async function shareReportPdfBlob(
  filename: string,
  blob: Blob,
  shareDialogTitle = "Share report",
): Promise<boolean> {
  return sharePdfBlob(filename, blob, shareDialogTitle);
}

export async function printReportDocumentModel(
  kind: ReportExportKind,
  filename: string,
  model: ReportDocumentModel,
  options?: { title?: string; shareDialogTitle?: string },
): Promise<boolean> {
  const blob = buildReportDocumentPdfBlob(model);
  return printReportPdfBlob(kind, filename, blob, options);
}
