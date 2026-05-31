import type { Language, ShopPreferences, UserRole } from "../types";
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

export function canRecordCashExpenses(role: UserRole, preferences: ShopPreferences): boolean {
  if (!hasPermission(role, "expenses.record")) return false;
  if (role === "cashier" && preferences.staffCanRecordCashExpenses === false) return false;
  return true;
}

export function canEditCashExpenses(role: UserRole): boolean {
  return hasPermission(role, "expenses.edit");
}

export function canDeleteCashExpenses(role: UserRole): boolean {
  return hasPermission(role, "expenses.delete");
}
