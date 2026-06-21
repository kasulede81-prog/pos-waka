import type { ReceiptPaperSize } from "../types";
import { printHtmlDocumentWithDesktop, sharePdfBlob } from "./documentPrint";
import { isNativePrintPlatform } from "./nativeReceiptPrint";

export type NativePrintFallbackOptions = {
  pdfFilename: string;
  buildPdfBlob: () => Blob;
  htmlBody: string;
  paper?: ReceiptPaperSize;
  title?: string;
  shareDialogTitle?: string;
};

/** On Android/iOS: try HTML print first, then share PDF. On web/desktop: HTML print dialog. */
export async function printDocumentNativeFallback(options: NativePrintFallbackOptions): Promise<boolean> {
  const htmlOk = await printHtmlDocumentWithDesktop(
    options.htmlBody,
    options.paper ?? "a4",
    options.title ?? "Waka document",
  );
  if (htmlOk) return true;
  if (isNativePrintPlatform()) {
    const blob = options.buildPdfBlob();
    return sharePdfBlob(options.pdfFilename, blob, options.shareDialogTitle);
  }
  return false;
}
