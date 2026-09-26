import type { Language } from "../types";
import { t } from "./i18n";

/** Primary receipt/day-close print button label. */
export function receiptPrintActionLabel(lang: Language): string {
  return t(lang, "receiptPrint");
}

/**
 * Supplier statement print label. Reports are not receipts — reusing the receipt label
 * made merchant report buttons read as receipt buttons (printing audit P3.1).
 */
export function statementPrintActionLabel(lang: Language): string {
  return t(lang, "supplierStatementPrint");
}
