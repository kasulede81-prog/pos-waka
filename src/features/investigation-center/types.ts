import type { AuditAction } from "../../types";

export type InvestigationTab = "timeline" | "staff" | "refunds" | "compliance";

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
  | "warnings"
  | PharmacyInvestigationCategory;

export type PharmacyInvestigationCategory =
  | "prescriptions"
  | "controlled_medicines"
  | "dispensing"
  | "batch_operations"
  | "fefo"
  | "expiry"
  | "compliance"
  | "supplier_returns"
  | "controlled_returns";

export type InvestigationKpiId =
  | "activities_today"
  | "sales"
  | "inventory"
  | "security"
  | "warnings"
  | "errors"
  | "failed_syncs"
  | "refunds"
  | PharmacyInvestigationKpiId;

export type PharmacyInvestigationKpiId =
  | "rx_today"
  | "medicines_dispensed"
  | "controlled_events"
  | "near_expiry"
  | "expired_medicines"
  | "batch_writeoffs"
  | "fefo_overrides"
  | "compliance_alerts";

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

export type PharmacyInvestigationKpiCard = InvestigationKpiCard & {
  id: PharmacyInvestigationKpiId;
};

export const INVESTIGATION_TABS: InvestigationTab[] = ["timeline", "staff", "refunds"];

export const INVESTIGATION_TABS_WITH_COMPLIANCE: InvestigationTab[] = [
  ...INVESTIGATION_TABS,
  "compliance",
];

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
