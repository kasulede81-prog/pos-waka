import type { ReceiptPaperSize } from "../types";
import { saveExportedFile } from "./fileDownload";
import { isNativePrintPlatform } from "./nativeReceiptPrint";
import { paperCss } from "./receiptPrint";

declare global {
  interface Window {
    wakaDesktop?: {
      platform?: string;
      print?: (opts?: { silent?: boolean }) => Promise<{ ok: boolean; error?: string }>;
      escPosNetwork?: (opts: {
        host: string;
        port: number;
        data: number[];
      }) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

function wrapPrintHtml(bodyHtml: string, paper: ReceiptPaperSize, title: string): string {
  const css = paperCss(paper);
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${title}</title>
<style>
${css}
body { font-family: Inter, system-ui, sans-serif; padding: 8px; color: #111; margin: 0; }
@media print { body { padding: 0; } }
</style></head>
<body>${bodyHtml}</body></html>`;
}

export function printHtmlDocument(bodyHtml: string, paper: ReceiptPaperSize = "80mm", title = "Waka document"): boolean {
  if (typeof document === "undefined") return false;
  /** Android/iOS WebView: iframe window.print() is a no-op — use share PDF fallback instead. */
  if (isNativePrintPlatform()) return false;

  const html = wrapPrintHtml(bodyHtml, paper, title);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument ?? win?.document;
  if (!win || !doc) {
    iframe.remove();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    window.setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 800);
  };

  const doPrint = () => {
    try {
      win.focus();
      win.print();
      cleanup();
      return true;
    } catch {
      cleanup();
      return false;
    }
  };

  if (doc.readyState === "complete") {
    window.setTimeout(doPrint, 150);
    return true;
  }

  iframe.onload = () => {
    window.setTimeout(doPrint, 150);
  };
  return true;
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

  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  iframe.src = url;

  const cleanup = () => {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1200);
  };

  const doPrint = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return false;
    }
    try {
      win.focus();
      win.print();
      cleanup();
      return true;
    } catch {
      cleanup();
      return false;
    }
  };

  iframe.onload = () => {
    window.setTimeout(doPrint, 200);
  };
  return true;
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
