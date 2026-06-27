import type { AuditAction } from "../../types";

export type InvestigationTab = "timeline" | "staff" | "refunds";

export type InvestigationCategory =
  | "all"
  | "sales"
  | "inventory"
  | "products"
  | "purchases"
  | "suppliers"
  | "customers"
  | "debts"
  | "payments"
  | "expenses"
  | "cash_drawer"
  | "refunds"
  | "discounts"
  | "price_changes"
  | "returns"
  | "authentication"
  | "security"
  | "users"
  | "permissions"
  | "settings"
  | "cloud_sync"
  | "system"
  | "errors"
  | "warnings";

export type InvestigationKpiId =
  | "activities_today"
  | "sales"
  | "inventory"
  | "security"
  | "warnings"
  | "errors"
  | "failed_syncs"
  | "refunds";

export type ActivitySeverity = "completed" | "info" | "warning" | "security" | "error";

export type ActivityStatusTone = ActivitySeverity;

export type TimelineRow =
  | { kind: "header"; id: string; label: string }
  | { kind: "entry"; id: string; entryIndex: number };

export type InvestigationKpiCard = {
  id: InvestigationKpiId;
  labelKey: string;
  value: number;
  iconTone: "orange" | "green" | "yellow" | "purple" | "red" | "slate";
};

export const INVESTIGATION_TABS: InvestigationTab[] = ["timeline", "staff", "refunds"];

export const INVESTIGATION_CATEGORIES: InvestigationCategory[] = [
  "all",
  "sales",
  "inventory",
  "products",
  "purchases",
  "suppliers",
  "customers",
  "debts",
  "payments",
  "expenses",
  "cash_drawer",
  "refunds",
  "discounts",
  "price_changes",
  "returns",
  "authentication",
  "security",
  "users",
  "permissions",
  "settings",
  "cloud_sync",
  "system",
  "errors",
  "warnings",
];

export type CategoryActionMap = Partial<Record<InvestigationCategory, ReadonlySet<AuditAction>>>;
