/**
 * Physical cash tender — the cash handed at checkout, not collected / amount paid / debt.
 * Authoritative for NEW retail/pharmacy sales. Legacy rows omit this field.
 */

import type { Sale } from "../types";
import { parseDisplayMoney } from "./posCheckoutMoney";

export function hasAuthoritativeTenderCash(sale: Pick<Sale, "tenderCashUgx">): boolean {
  return sale.tenderCashUgx != null && Number.isFinite(sale.tenderCashUgx);
}

/** Clamp a checkout/finalize tender to a non-negative integer not exceeding amount paid. */
export function normalizeTenderCashUgx(raw: unknown, amountPaidUgx: number): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return undefined;
  const paid = Math.max(0, Math.floor(amountPaidUgx));
  return Math.max(0, Math.min(n, paid));
}

/** Reconstruct persisted metadata. Missing / invalid → undefined (legacy row). */
export function parsePersistedTenderCashUgx(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, n);
}

/** Cash keypad amount for retail/pharmacy checkout — not total − debt. */
export function physicalCashTenderFromCheckoutInputs(input: {
  paymentMethod: string;
  cashInput: string;
  draftPayable: number;
}): number {
  const cash = parseDisplayMoney(input.cashInput);
  if (input.paymentMethod === "mobile_money" || input.paymentMethod === "atm") {
    return 0;
  }
  if (input.paymentMethod === "cash") {
    return cash > 0 ? cash : Math.max(0, Math.floor(input.draftPayable));
  }
  return Math.max(0, cash);
}
