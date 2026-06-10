import type { Language } from "../types";
import { t } from "./i18n";
import { isNativePrintPlatform } from "./nativeReceiptPrint";

/** Primary receipt/day-close print button — native uses share-sheet fallback. */
export function receiptPrintActionLabel(lang: Language): string {
  return isNativePrintPlatform() ? t(lang, "receiptPrintOrShare") : t(lang, "receiptPrint");
}
