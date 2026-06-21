import type { Language } from "../types";
import { t } from "./i18n";

/** Primary receipt/day-close print button label. */
export function receiptPrintActionLabel(lang: Language): string {
  return t(lang, "receiptPrint");
}
