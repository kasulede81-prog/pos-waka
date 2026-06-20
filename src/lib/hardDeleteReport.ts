export type HardDeleteCounts = Record<string, number>;

export type HardDeleteVerificationReport = {
  all_passed?: boolean;
  counts?: HardDeleteCounts;
  checked_at?: string;
  db_verification?: Record<string, unknown>;
};

export const HARD_DELETE_COUNT_LABELS: Array<{ key: keyof HardDeleteCounts; label: string }> = [
  { key: "organizations", label: "Organizations" },
  { key: "shops", label: "Shops" },
  { key: "products", label: "Products" },
  { key: "sales", label: "Sales" },
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "purchases", label: "Purchases" },
  { key: "shifts", label: "Shifts" },
  { key: "inventory_counts", label: "Inventory counts" },
  { key: "stock_movements", label: "Stock movements" },
  { key: "cloud_snapshots", label: "Cloud snapshots" },
  { key: "devices", label: "Devices" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "audit_logs", label: "Audit logs" },
  { key: "support_requests", label: "Support requests" },
  { key: "owner_auth_account", label: "Owner auth account" },
  { key: "staff_auth_accounts", label: "Staff auth accounts" },
];

export function formatHardDeleteReportLines(report: HardDeleteVerificationReport | null | undefined): string[] {
  if (!report?.counts) return [];
  return HARD_DELETE_COUNT_LABELS.map(({ key, label }) => {
    const n = report.counts?.[key] ?? 0;
    return `${label}: ${n}`;
  });
}
