import type {
  CashExpense,
  CashExpenseApprovalStatus,
  Language,
  Permission,
  ShopPreferences,
  UserRole,
} from "../types";
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

/** True when approve / reject / void would change that expense's drawer contribution. */
export function cashExpenseTransitionWouldAffectDrawer(
  expense: CashExpense,
  next: "approved" | "rejected" | "voided",
): boolean {
  const before = expenseCountsInDrawer(expense);
  if (next === "voided" || next === "rejected") return before;
  const after = !expense.deletedAt;
  return before !== after;
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

/** Same today-list rule as `/cash-expenses`. */
export function selectVisibleExpensesForDay(
  expenses: CashExpense[],
  dayKey: string,
  role: UserRole,
  actorUserId: string,
  actorPermissions?: Permission[] | null,
): CashExpense[] {
  return expenses
    .filter((e) => !e.deletedAt && e.paidOn === dayKey && canViewExpenseRow(role, e, actorUserId, actorPermissions))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Same drawer-counting total as the `/cash-expenses` KPI. */
export function sumDrawerExpenseAmounts(expenses: CashExpense[]): number {
  return expenses.filter(expenseCountsInDrawer).reduce((sum, e) => sum + Math.max(0, e.amountUgx), 0);
}

export function parseCashExpenseApprovalStatus(raw: unknown): CashExpenseApprovalStatus | undefined {
  if (raw === "pending" || raw === "approved" || raw === "rejected") return raw;
  return undefined;
}

export function cashExpenseApprovalMetadata(expense: CashExpense): Record<string, unknown> {
  return {
    approvalStatus: expense.approvalStatus ?? null,
    approvedByUserId: expense.approvedByUserId ?? null,
    approvedByLabel: expense.approvedByLabel ?? null,
    approvedAt: expense.approvedAt ?? null,
    rejectedByUserId: expense.rejectedByUserId ?? null,
    rejectedByLabel: expense.rejectedByLabel ?? null,
    rejectedAt: expense.rejectedAt ?? null,
    deviceId: expense.deviceId ?? null,
  };
}

export function buildCashExpensePushPayload(expense: CashExpense) {
  return {
    id: expense.id,
    category: expense.category,
    amount_ugx: expense.amountUgx,
    description: expense.description || null,
    paid_on: expense.paidOn,
    created_at: expense.createdAt,
    recorded_by_staff_id: expense.createdByUserId.startsWith("staff:") ? expense.createdByUserId : null,
    recorded_by_label: expense.createdByLabel ?? null,
    metadata: {
      wakaClient: true,
      ...cashExpenseApprovalMetadata(expense),
    },
  };
}

function optionalText(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const text = String(raw);
  return text ? text : undefined;
}

/** Reconstruct a cash expense from a cloud `expenses` row. Missing approvalStatus stays absent (legacy). */
export function cashExpenseFromCloudRow(raw: Record<string, unknown>): CashExpense | null {
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  const deletedAt = raw.deleted_at != null ? String(raw.deleted_at) : null;
  const meta =
    raw.metadata && typeof raw.metadata === "object" ? (raw.metadata as Record<string, unknown>) : {};
  const createdAt = String(raw.created_at ?? new Date().toISOString());
  const updatedAt = raw.updated_at != null ? String(raw.updated_at) : createdAt;
  return {
    id,
    category: String(raw.category ?? "Miscellaneous"),
    amountUgx: Number(raw.amount_ugx ?? 0),
    description: raw.description != null ? String(raw.description) : "",
    paidOn: String(raw.paid_on ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    createdAt,
    updatedAt,
    createdByUserId: String(raw.created_by ?? ""),
    createdByLabel:
      raw.recorded_by_label != null
        ? String(raw.recorded_by_label)
        : optionalText(meta.actorName),
    deviceId: optionalText(meta.deviceId),
    approvalStatus: parseCashExpenseApprovalStatus(meta.approvalStatus),
    approvedByUserId: meta.approvedByUserId != null ? String(meta.approvedByUserId) : null,
    approvedByLabel: meta.approvedByLabel != null ? String(meta.approvedByLabel) : null,
    approvedAt: meta.approvedAt != null ? String(meta.approvedAt) : null,
    rejectedByUserId: meta.rejectedByUserId != null ? String(meta.rejectedByUserId) : null,
    rejectedByLabel: meta.rejectedByLabel != null ? String(meta.rejectedByLabel) : null,
    rejectedAt: meta.rejectedAt != null ? String(meta.rejectedAt) : null,
    pendingSync: false,
    lastSyncError: null,
    deletedAt,
  };
}

/** Established LWW: newer `updatedAt` (else `createdAt`) wins. Tie keeps local. */
export function mergeCashExpenseFromCloudPull(local: CashExpense, remote: CashExpense): CashExpense {
  const ta = new Date(local.updatedAt ?? local.createdAt).getTime();
  const tb = new Date(remote.updatedAt ?? remote.createdAt).getTime();
  if (Number.isNaN(ta) && Number.isNaN(tb)) return local;
  if (Number.isNaN(tb)) return local;
  if (Number.isNaN(ta)) return remote;
  if (ta !== tb) return ta >= tb ? local : remote;
  return local;
}
