import type { CashExpense, Language, Permission, ShopPreferences, UserRole } from "../types";
import { hasActorPermission } from "./permissions";
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

export function canRecordCashExpenses(
  role: UserRole,
  preferences: ShopPreferences,
  actorPermissions?: Permission[] | null,
): boolean {
  if (!hasActorPermission(role, "expenses.record", actorPermissions)) return false;
  if (role === "cashier" && !cashierExpenseRecordingEnabled(preferences)) return false;
  return true;
}

export function canEditCashExpenses(role: UserRole, actorPermissions?: Permission[] | null): boolean {
  return hasActorPermission(role, "expenses.edit", actorPermissions);
}

export function canApproveCashExpenses(role: UserRole, actorPermissions?: Permission[] | null): boolean {
  return hasActorPermission(role, "expenses.approve", actorPermissions);
}

export function canDeleteCashExpenses(role: UserRole, actorPermissions?: Permission[] | null): boolean {
  return hasActorPermission(role, "expenses.delete", actorPermissions);
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
  actorPermissions?: Permission[] | null,
): boolean {
  if (hasActorPermission(role, "back_office.access", actorPermissions)) return true;
  return expense.createdByUserId === actorUserId;
}
