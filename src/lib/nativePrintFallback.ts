import { jsPDF } from "jspdf";
import type { ReceiptPaperSize } from "../types";
import { printHtmlDocumentWithDesktop, sharePdfBlob } from "./documentPrint";
import { isNativePrintPlatform } from "./nativeReceiptPrint";
import { createPdfLayout, pdfGap, pdfLine } from "./pdfLayout";

export type NativePrintFallbackOptions = {
  pdfFilename: string;
  buildPdfBlob: () => Blob;
  htmlBody: string;
  paper?: ReceiptPaperSize;
  title?: string;
  shareDialogTitle?: string;
};

/** On Android/iOS: open share sheet with PDF (user picks Print). On web/desktop: browser print dialog. */
export async function printDocumentNativeFallback(options: NativePrintFallbackOptions): Promise<boolean> {
  if (isNativePrintPlatform()) {
    const blob = options.buildPdfBlob();
    return sharePdfBlob(
      options.pdfFilename,
      blob,
      options.shareDialogTitle ?? "Print or share",
    );
  }

  const htmlOk = await printHtmlDocumentWithDesktop(
    options.htmlBody,
    options.paper ?? "a4",
    options.title ?? "Waka document",
  );
  return htmlOk;
}

/**
 * Native-safe print for a simple title + text list (batch list, near-expiry sheet, …).
 *
 * These pages previously built HTML and called `printHtmlDocument`, which returns
 * `false` on Android/iOS — the button silently did nothing. Native now shares a PDF
 * the user can print; web/desktop still open the browser print dialog.
 *
 * Returns false when neither path produced output, so the caller can say so.
 */
export async function printTextListDocument(options: {
  pdfFilename: string;
  title: string;
  subtitle?: string;
  lines: string[];
  htmlBody: string;
  paper?: ReceiptPaperSize;
  shareDialogTitle?: string;
}): Promise<boolean> {
  return printDocumentNativeFallback({
    pdfFilename: options.pdfFilename,
    buildPdfBlob: () => {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const layout = createPdfLayout(doc);
      pdfLine(layout, doc, options.title, { size: 14, bold: true });
      if (options.subtitle) pdfLine(layout, doc, options.subtitle, { size: 11, bold: true });
      pdfLine(layout, doc, new Date().toLocaleString("en-UG", { timeZone: "Africa/Kampala" }), { size: 9 });
      pdfGap(layout, 8);
      if (!options.lines.length) {
        pdfLine(layout, doc, "—", { size: 9 });
      } else {
        for (const line of options.lines) pdfLine(layout, doc, line, { size: 9 });
      }
      return doc.output("blob");
    },
    htmlBody: options.htmlBody,
    paper: options.paper ?? "a4",
    title: options.title,
    shareDialogTitle: options.shareDialogTitle ?? options.title,
  });
}
