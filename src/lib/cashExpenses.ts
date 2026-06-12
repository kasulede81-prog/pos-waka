import type { CashExpense, Language, ShopPreferences, UserRole } from "../types";
import { hasPermission } from "./permissions";
import { t } from "./i18n";

/** Preset drawer expense categories (custom entry allowed). */
export const CASH_EXPENSE_CATEGORY_KEYS = [
  "lunch",
  "transport",
  "electricity",
  "water",
  "rent",
  "delivery",
  "cleaning",
  "airtime",
  "miscellaneous",
] as const;

export type CashExpenseCategoryKey = (typeof CASH_EXPENSE_CATEGORY_KEYS)[number];

export function cashExpenseCategoryLabel(lang: Language, key: string): string {
  const k = key.trim().toLowerCase().replace(/\s+/g, "_");
  const map: Record<string, string> = {
    lunch: t(lang, "cashExpenseCatLunch"),
    transport: t(lang, "cashExpenseCatTransport"),
    electricity: t(lang, "cashExpenseCatElectricity"),
    water: t(lang, "cashExpenseCatWater"),
    rent: t(lang, "cashExpenseCatRent"),
    delivery: t(lang, "cashExpenseCatDelivery"),
    cleaning: t(lang, "cashExpenseCatCleaning"),
    airtime: t(lang, "cashExpenseCatAirtime"),
    miscellaneous: t(lang, "cashExpenseCatMisc"),
    misc: t(lang, "cashExpenseCatMisc"),
  };
  return map[k] ?? key.trim();
}

export function cashierExpenseRecordingEnabled(preferences: ShopPreferences): boolean {
  return preferences.staffCanRecordCashExpenses === true;
}

export function canRecordCashExpenses(role: UserRole, preferences: ShopPreferences): boolean {
  if (!hasPermission(role, "expenses.record")) return false;
  if (role === "cashier" && !cashierExpenseRecordingEnabled(preferences)) return false;
  return true;
}

export function canEditCashExpenses(role: UserRole): boolean {
  return hasPermission(role, "expenses.edit");
}

export function canApproveCashExpenses(role: UserRole): boolean {
  return hasPermission(role, "expenses.approve");
}

export function canDeleteCashExpenses(role: UserRole): boolean {
  return hasPermission(role, "expenses.delete");
}

/** Whether expense affects drawer / expected cash totals. */
export function expenseCountsInDrawer(expense: CashExpense): boolean {
  if (expense.deletedAt) return false;
  const status = expense.approvalStatus ?? "approved";
  return status === "approved";
}

export function filterExpensesForDrawer(cashExpenses: CashExpense[]): CashExpense[] {
  return cashExpenses.filter(expenseCountsInDrawer);
}

export function resolveNewExpenseApprovalStatus(
  role: UserRole,
  preferences: ShopPreferences,
): "approved" | "pending" {
  if (role === "cashier" && preferences.requireCashierExpenseApproval === true) {
    return "pending";
  }
  return "approved";
}

export function canViewExpenseRow(
  role: UserRole,
  expense: CashExpense,
  actorUserId: string,
): boolean {
  if (hasPermission(role, "back_office.access")) return true;
  return expense.createdByUserId === actorUserId;
}
