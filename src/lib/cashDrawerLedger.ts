/**
 * Cash drawer ledger — adjustments, opening float, and V2 expected-cash inputs.
 */

import type { CashDrawerAdjustment, CashDrawerAdjustmentType, ShiftRecord } from "../types";
import type { Language } from "../types";
import { dateKeyKampala } from "./datesUg";
import { t } from "./i18n";

export const CASH_DRAWER_INFLOW_TYPES: readonly CashDrawerAdjustmentType[] = [
  "opening_float",
  "owner_injection",
  "safe_transfer_in",
  "cash_added",
  "float_replenishment",
] as const;

export const CASH_DRAWER_OUTFLOW_TYPES: readonly CashDrawerAdjustmentType[] = [
  "owner_withdrawal",
  "bank_deposit",
  "safe_transfer_out",
  "cash_removed",
] as const;

export function isCashDrawerInflow(type: CashDrawerAdjustmentType): boolean {
  return (CASH_DRAWER_INFLOW_TYPES as readonly string[]).includes(type);
}

export function isCashDrawerOutflow(type: CashDrawerAdjustmentType): boolean {
  return (CASH_DRAWER_OUTFLOW_TYPES as readonly string[]).includes(type);
}

export function cashDrawerAdjustmentSignedAmount(adj: CashDrawerAdjustment): number {
  const amt = Math.max(0, Math.floor(adj.amountUgx));
  if (isCashDrawerInflow(adj.type)) return amt;
  if (isCashDrawerOutflow(adj.type)) return -amt;
  return 0;
}

/** Net signed total for a list of adjustments. */
export function cashDrawerAdjustmentNet(adjustments: CashDrawerAdjustment[]): number {
  return adjustments.reduce((sum, a) => sum + cashDrawerAdjustmentSignedAmount(a), 0);
}

export function adjustmentsOnDay(adjustments: CashDrawerAdjustment[], day: string): CashDrawerAdjustment[] {
  return adjustments.filter((a) => !a.deletedAt && dateKeyKampala(a.occurredAt) === day);
}

export function sumAdjustmentsByType(
  adjustments: CashDrawerAdjustment[],
  day: string,
  types: readonly CashDrawerAdjustmentType[],
): number {
  const set = new Set<string>(types);
  return adjustmentsOnDay(adjustments, day)
    .filter((a) => set.has(a.type))
    .reduce((sum, a) => sum + Math.max(0, Math.floor(a.amountUgx)), 0);
}

export function sumAdjustmentInflowsExcludingOpening(
  adjustments: CashDrawerAdjustment[],
  day: string,
): number {
  return adjustmentsOnDay(adjustments, day)
    .filter((a) => isCashDrawerInflow(a.type) && a.type !== "opening_float")
    .reduce((sum, a) => sum + Math.max(0, Math.floor(a.amountUgx)), 0);
}

export function sumAdjustmentOutflows(adjustments: CashDrawerAdjustment[], day: string): number {
  return adjustmentsOnDay(adjustments, day)
    .filter((a) => isCashDrawerOutflow(a.type))
    .reduce((sum, a) => sum + Math.max(0, Math.floor(a.amountUgx)), 0);
}

/** Opening float from adjustments + shift rows that started on this day. */
export function resolveOpeningFloatUgx(
  day: string,
  adjustments: CashDrawerAdjustment[],
  shifts: ShiftRecord[],
): number {
  let total = sumAdjustmentsByType(adjustments, day, ["opening_float"]);
  for (const sh of shifts) {
    if (dateKeyKampala(sh.startAt) !== day) continue;
    const f = sh.openingFloatUgx ?? 0;
    if (f > 0) total += f;
  }
  return total;
}

export type AdjustmentBreakdownByType = Partial<Record<CashDrawerAdjustmentType, number>>;

export function adjustmentBreakdownByType(
  adjustments: CashDrawerAdjustment[],
  day: string,
): AdjustmentBreakdownByType {
  const out: AdjustmentBreakdownByType = {};
  for (const a of adjustmentsOnDay(adjustments, day)) {
    out[a.type] = (out[a.type] ?? 0) + Math.max(0, Math.floor(a.amountUgx));
  }
  return out;
}

export type ExpectedDrawerCashV2Input = {
  openingFloatUgx: number;
  cashSalesUgx: number;
  cashDebtCollectionsUgx: number;
  adjustmentInflowsUgx: number;
  adjustmentOutflowsUgx: number;
  cashExpensesUgx: number;
  cashSupplierPaymentsUgx: number;
  cashRefundsUgx: number;
};

/**
 * Canonical V2 expected physical cash in drawer.
 * Revenue / inventory / debt issuance are unchanged — drawer cash only.
 */
export function computeExpectedDrawerCashV2(input: ExpectedDrawerCashV2Input): number {
  const raw =
    Math.max(0, Math.floor(input.openingFloatUgx)) +
    Math.max(0, Math.floor(input.cashSalesUgx)) +
    Math.max(0, Math.floor(input.cashDebtCollectionsUgx)) +
    Math.max(0, Math.floor(input.adjustmentInflowsUgx)) -
    Math.max(0, Math.floor(input.cashExpensesUgx)) -
    Math.max(0, Math.floor(input.cashSupplierPaymentsUgx)) -
    Math.max(0, Math.floor(input.cashRefundsUgx)) -
    Math.max(0, Math.floor(input.adjustmentOutflowsUgx));
  return Math.max(0, raw);
}

export function normalizeCashDrawerAdjustment(row: CashDrawerAdjustment): CashDrawerAdjustment {
  return {
    ...row,
    amountUgx: Math.max(0, Math.floor(row.amountUgx)),
    note: row.note?.trim() ?? "",
    pendingSync: row.pendingSync ?? false,
    deletedAt: row.deletedAt ?? null,
  };
}

const ADJUSTMENT_TYPE_LABEL_KEYS: Record<CashDrawerAdjustmentType, Parameters<typeof t>[1]> = {
  opening_float: "cashDrawerTypeOpeningFloat",
  owner_injection: "cashDrawerTypeOwnerInjection",
  owner_withdrawal: "cashDrawerTypeOwnerWithdrawal",
  bank_deposit: "cashDrawerTypeBankDeposit",
  safe_transfer_in: "cashDrawerTypeSafeTransferIn",
  safe_transfer_out: "cashDrawerTypeSafeTransferOut",
  cash_added: "cashDrawerTypeCashAdded",
  cash_removed: "cashDrawerTypeCashRemoved",
  float_replenishment: "cashDrawerTypeFloatReplenishment",
};

export function cashDrawerAdjustmentTypeLabel(lang: Language, type: CashDrawerAdjustmentType): string {
  const key = ADJUSTMENT_TYPE_LABEL_KEYS[type];
  return key ? t(lang, key) : type;
}
