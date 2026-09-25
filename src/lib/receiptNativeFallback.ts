/**
 * Shared post-thermal receipt fallback ladder (printing audit, fix P1.1–P1.4).
 *
 * Every receipt type attempts the thermal/ESC-POS path first (printQueue →
 * printerAdapter). This helper owns the rungs *after* that, so restaurant, void,
 * return and debt receipts all degrade identically instead of each carrying its
 * own partial ladder:
 *
 *   web / desktop → isolated browser print (rich HTML first, then plain text)
 *   Android / iOS → system share sheet with a generated PDF the user can print
 *
 * Waiting on a WebView `window.print()` is what made these surfaces fail silently
 * on Android, so the native branch never attempts a browser dialog.
 *
 * Printing is a side channel: this helper never touches a sale, and a failure is
 * reported to the caller (`ok:false`) so the UI can say so rather than imply success.
 */
import type { ReceiptPaperSize } from "../types";
import { printHtmlDocument } from "./documentPrint";
import { isNativePrintPlatform } from "./nativePrintPlatform";
import { sharePlainReceiptForPrint } from "./nativeReceiptPrint";
import { printReceiptText } from "./receiptPrint";

export type ReceiptFallbackMode = "html" | "share" | "none";

export type ReceiptFallbackResult = {
  ok: boolean;
  mode: ReceiptFallbackMode;
  error?: string;
};

export const RECEIPT_PRINT_UNAVAILABLE = "Printing is not available on this device.";

/**
 * Browser print on web/desktop; share the PDF on Android/iOS.
 *
 * @param opts.html      Web/desktop rich receipt HTML (preferred over plain text).
 * @param opts.plainText Receipt text used for the browser text print and the native PDF.
 * @param opts.sharePdf  Native-only receipt-specific PDF share, tried after the plain-text PDF.
 */
export async function printReceiptFallback(opts: {
  plainText: string;
  html?: string;
  paper?: ReceiptPaperSize;
  filenameStem?: string;
  sharePdf?: () => Promise<boolean>;
  title?: string;
}): Promise<ReceiptFallbackResult> {
  const paper = opts.paper ?? "80mm";

  if (!isNativePrintPlatform()) {
    if (opts.html && printHtmlDocument(opts.html, paper, opts.title ?? "Waka receipt")) {
      return { ok: true, mode: "html" };
    }
    if (printReceiptText(opts.plainText, paper)) return { ok: true, mode: "html" };
    return { ok: false, mode: "none", error: RECEIPT_PRINT_UNAVAILABLE };
  }

  if (await sharePlainReceiptForPrint(opts.plainText, paper, opts.filenameStem ?? "waka-receipt")) {
    return { ok: true, mode: "share" };
  }
  if (opts.sharePdf && (await opts.sharePdf())) return { ok: true, mode: "share" };
  return {
    ok: false,
    mode: "none",
    error: "Could not open the share sheet to print this receipt.",
  };
}
