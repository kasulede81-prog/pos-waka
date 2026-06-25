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
