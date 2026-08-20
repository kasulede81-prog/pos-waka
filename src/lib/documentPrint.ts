import type { ReceiptPaperSize } from "../types";
import { saveExportedFile } from "./fileDownload";
import { printIsolatedHtmlDocument, printIsolatedPdfBlob } from "./isolatedPrint";
import { isNativePrintPlatform } from "./nativeReceiptPrint";
import { paperCss } from "./receiptPrint";

function wrapPrintHtml(bodyHtml: string, paper: ReceiptPaperSize, title: string): string {
  const css = paperCss(paper);
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${safeTitle}</title>
<style>
${css}
body { font-family: Inter, system-ui, sans-serif; padding: 8px; color: #111; margin: 0; }
@media print { body { padding: 0; } }
</style></head>
<body>${bodyHtml}</body></html>`;
}

export function printHtmlDocument(bodyHtml: string, paper: ReceiptPaperSize = "80mm", title = "Waka document"): boolean {
  if (typeof document === "undefined") return false;
  if (isNativePrintPlatform()) return false;
  return printIsolatedHtmlDocument(wrapPrintHtml(bodyHtml, paper, title));
}

export async function printHtmlDocumentWithDesktop(
  bodyHtml: string,
  paper: ReceiptPaperSize = "80mm",
  title = "Waka document",
): Promise<boolean> {
  return printHtmlDocument(bodyHtml, paper, title);
}

/** Desktop/web: print the generated PDF. Native WebView print is a no-op — callers must share the PDF instead. */
export function printPdfBlobWithDesktop(blob: Blob, title = "Waka report"): boolean {
  if (typeof document === "undefined") return false;
  if (isNativePrintPlatform()) return false;
  return printIsolatedPdfBlob(blob);
}

/** Electron: print focused window via main process (diagnostics / optional). */
export async function printElectronWindow(): Promise<boolean> {
  if (typeof window === "undefined" || !window.wakaDesktop?.print) return false;
  try {
    const result = await window.wakaDesktop.print({ silent: false });
    return result.ok;
  } catch {
    return false;
  }
}

export async function downloadPdfBlob(filename: string, blob: Blob): Promise<boolean> {
  return saveExportedFile(filename, blob, "application/pdf");
}

export async function sharePdfBlob(
  filename: string,
  blob: Blob,
  shareDialogTitle = "Share receipt",
): Promise<boolean> {
  return saveExportedFile(filename, blob, "application/pdf", { shareDialogTitle });
}

export function downloadCsvText(filename: string, body: string): Promise<boolean> {
  return saveExportedFile(filename, body, "text/csv;charset=utf-8");
}
