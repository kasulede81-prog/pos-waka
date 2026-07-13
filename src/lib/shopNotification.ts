import { t } from "./i18n";
import type { Language } from "../types";

const ACTION_SUCCESS_KEYS: Record<string, string> = {
  "customer.add": "notifyCustomerSaved",
  "customer.debt_payment": "notifyDebtPaymentSaved",
  "supplier.payment": "notifySupplierPaymentSaved",
  "supplier.remove": "notifySupplierRemoved",
  "expense.record": "notifyExpenseSaved",
  "kitchen.reprint": "notifyKitchenReprintOk",
};

const ACTION_ERROR_KEYS: Record<string, string> = {
  "customer.add": "notifyCustomerSaveFailed",
  "customer.debt_payment": "notifyDebtPaymentFailed",
  "supplier.payment": "notifySupplierPaymentFailed",
  "kitchen.reprint": "notifyKitchenPrintFailed",
};

/** Resolve a user-facing error from store errorKey or raw message. */
export function resolveShopErrorMessage(lang: Language, errorKeyOrMessage: string): string {
  if (!errorKeyOrMessage) return t(lang, "notifyErrorGeneric");
  if (errorKeyOrMessage.includes(" ") && errorKeyOrMessage.length > 24) return errorKeyOrMessage;
  const translated = t(lang, errorKeyOrMessage);
  if (translated !== errorKeyOrMessage) return translated;
  return t(lang, "notifyErrorGeneric");
}

export function shopActionSuccessMessage(lang: Language, action: string, overrideKey?: string): string {
  if (overrideKey) return t(lang, overrideKey);
  const key = ACTION_SUCCESS_KEYS[action];
  return key ? t(lang, key) : t(lang, "notifySuccessSaved");
}

export function shopActionErrorMessage(lang: Language, message: string, overrideKey?: string): string {
  if (overrideKey) return t(lang, overrideKey);
  return resolveShopErrorMessage(lang, message);
}

export function shopActionErrorFromResult(
  lang: Language,
  action: string,
  result: { ok: boolean; errorKey?: string; message?: string },
): string {
  if (result.ok) return "";
  const key = ACTION_ERROR_KEYS[action];
  if (key && result.errorKey) return t(lang, key);
  return resolveShopErrorMessage(lang, result.errorKey ?? result.message ?? "notifyErrorGeneric");
}
