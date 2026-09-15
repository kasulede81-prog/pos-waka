import type { BusinessType } from "../types";

/** Commercial enterprise role labels mapped to existing POS/org roles. */
export type EnterpriseRoleLabel =
  | "owner"
  | "enterprise_administrator"
  | "regional_manager"
  | "branch_manager"
  | "supervisor"
  | "cashier"
  | "pharmacist"
  | "assistant_pharmacist"
  | "restaurant_manager"
  | "kitchen_manager"
  | "bar_manager"
  | "inventory_manager"
  | "auditor"
  | "read_only"
  | "inspector";

export type BranchStatus = "active" | "disabled" | "archived";

/** Branch = cloud `shops` row with enterprise profile fields. */
export type EnterpriseBranch = {
  id: string;
  organizationId: string;
  name: string;
  code: string | null;
  addressLine: string | null;
  city: string | null;
  district: string | null;
  phoneE164: string | null;
  managerUserId: string | null;
  timezone: string;
  currency: string;
  taxProfile: Record<string, unknown>;
  businessTypes: BusinessType[];
  businessType: BusinessType;
  status: BranchStatus;
  isActive: boolean;
  contacts: Record<string, unknown>;
  shopNumber: string | null;
  createdAt: string;
  archivedAt: string | null;
};

export type EnterpriseOrganizationContext = {
  organizationId: string;
  primaryShopId: string | null;
  branchCount: number;
  /** Single-store customers: implicit HQ with one branch — no migration required. */
  isSingleBranch: boolean;
};

export type StockTransferStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "shipped"
  | "in_transit"
  | "received"
  | "completed"
  | "cancelled"
  | "rejected";

export type EnterpriseStockTransferLine = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  batchId: string | null;
  batchNumber: string | null;
  batchExpiry: string | null;
  unitCostUgx: number;
  receivedQuantity: number;
};

export type EnterpriseStockTransfer = {
  id: string;
  organizationId: string;
  fromShopId: string;
  toShopId: string;
  status: StockTransferStatus;
  reason: string | null;
  controlledTransfer: boolean;
  lines: EnterpriseStockTransferLine[];
  createdAt: string;
  updatedAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
  completedAt: string | null;
};

export type EnterprisePurchaseOrderStatus =
  | "pending"
  | "approved"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

export type EnterprisePurchaseOrder = {
  id: string;
  organizationId: string;
  supplierId: string | null;
  supplierName: string | null;
  status: EnterprisePurchaseOrderStatus;
  poNumber: string | null;
  notes: string | null;
  totalUgx: number;
  branchIds: string[];
  createdAt: string;
  updatedAt: string;
  orderedAt: string | null;
};

export type EnterpriseDashboardMetrics = {
  ok: boolean;
  organizationId?: string;
  from?: string;
  to?: string;
  branchCount: number;
  branchesOnline: number;
  branchesOffline: number;
  todaySalesUgx: number;
  todayProfitUgx: number;
  openShifts: number;
  openBusinessDays: number;
  pendingSyncDevices: number;
  lowStockBranches: number;
  nearExpiryAlerts: number;
  controlledMedicineAlerts: number;
  topBranches: unknown[];
  recentAudits: EnterpriseAuditRow[];
  error?: string;
};

export type EnterpriseAuditRow = {
  id: string;
  shopId: string;
  actorUserId: string | null;
  role: string | null;
  action: string;
  summary: string;
  payload: unknown;
  deviceId: string | null;
  at: string;
};

export type EnterpriseReportExportFormat = "pdf" | "excel" | "csv";

/** Internal API surface (not public HTTP — architecture preparation). */
export type EnterpriseApiDomain =
  | "sales"
  | "inventory"
  | "purchases"
  | "customers"
  | "patients"
  | "hospitality"
  | "staff"
  | "devices"
  | "reports"
  | "authentication";

export type EnterpriseApiEndpoint = {
  domain: EnterpriseApiDomain;
  operation: string;
  version: "v1";
  shopScoped: boolean;
  orgScoped: boolean;
};

export const ENTERPRISE_PERFORMANCE_BUDGETS = {
  maxProductsPerBranch: 100_000,
  maxSalesPerBranch: 1_000_000,
  maxStaffPerOrg: 100,
  maxDevicesPerOrg: 50,
  dashboardQueryMs: 2_000,
  reportPageSize: 500,
} as const;
