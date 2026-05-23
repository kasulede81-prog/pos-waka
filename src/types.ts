export type Language = "en" | "lg";

/** POS staff role — persisted in snapshot + Supabase `shop_members` / user metadata when configured. */
export type UserRole = "owner" | "manager" | "cashier" | "stock_keeper";

/**
 * Fine-grained capabilities for UI and mutations.
 * See `src/lib/permissions.ts` for the role → permission matrix.
 */
export type Permission =
  | "pos.sell"
  | "stock.view"
  | "stock.adjust"
  | "products.add"
  | "products.remove"
  | "products.edit_presets"
  | "customers.view"
  | "customers.debt"
  | "day.close"
  | "reports.view"
  | "reports.profit"
  | "settings.view"
  | "settings.shop"
  | "owner.dashboard"
  | "owner.activity"
  | "owner.cash_history"
  | "nav.office"
  | "ui.toggle_mode"
  /** View suppliers and balances */
  | "suppliers.view"
  /** Add/edit suppliers and record supplier payments */
  | "suppliers.manage"
  /** Record stock-in / purchases (restock) */
  | "purchases.record"
  /** View purchase history in reports and product detail */
  | "purchases.view"
  /** Stock, suppliers, reports, settings hub — not for cashiers */
  | "back_office.access"
  /** View / print receipts (today’s slips) without full reports */
  | "receipts.view";

export type AuditAction =
  | "sale_completed"
  | "sale_refund"
  | "stock_adjust"
  | "price_change"
  | "debt_payment"
  | "day_close"
  | "back_office_unlock"
  | "shift_start"
  | "shift_end"
  | "product_add"
  | "product_remove"
  | "product_presets"
  | "product_update"
  | "customer_add"
  | "supplier_add"
  | "supplier_edit"
  | "purchase_saved"
  | "supplier_payment";

export type AuditLogEntry = {
  id: string;
  at: string;
  actorUserId: string;
  actorName?: string;
  role: UserRole;
  action: AuditAction;
  /** Short single-line for lists */
  payloadSummary: string;
  /** Structured detail for sync / inspection */
  payload: Record<string, unknown>;
  deviceId?: string;
};

export type ShiftRecord = {
  id: string;
  actorUserId: string;
  actorName?: string;
  role: UserRole;
  startAt: string;
  endAt?: string | null;
  salesTotalUgx: number;
  debtTotalUgx: number;
  refundsUgx: number;
  estimatedCashUgx: number;
};

/** What kind of shop this is — drives simple adaptive UI */
export type BusinessType =
  | "kiosk_duka"
  | "wholesale"
  | "mini_supermarket"
  | "hardware"
  | "restaurant"
  | "salon"
  | "pharmacy"
  | "boutique"
  | "electronics"
  | "produce_market"
  | "mobile_money_agent"
  | "other";

/** How the product is counted and priced at the kiosk */
export type SellingMode = "unit" | "weighted" | "portion";

export type LineInputMode = "quantity" | "money";

export type Product = {
  id: string;
  name: string;
  sellingMode: SellingMode;
  /** Stock and sales quantities are in this unit (ea, kg, litre, …) */
  baseUnit: string;
  /** Supplier pack (e.g. 20L jerrican) — optional */
  buyingUnit?: string | null;
  /** Base units per one buying unit — optional */
  conversionRate?: number | null;
  /** UGX per base unit (used for sell-by-money) */
  sellingPricePerUnitUgx: number;
  /** UGX cost per base unit — profit hints */
  costPricePerUnitUgx: number;
  stockOnHand: number;
  minimumStockAlert: number;
  category: string;
  sku: string;
  updatedAt: string;
  /** Monotonic for last-write-wins sync hints */
  version: number;
  /** Tap-to-sell amounts in UGX (e.g. 500, 1000 for oil) */
  quickPresetsMoneyUgx?: number[];
  /** Tap-to-sell amounts in base units (e.g. 1, 2, 5 kg) */
  quickPresetsQty?: number[];
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  location: string;
  createdAt: string;
  version: number;
  /** Running “mpa mpaka” balance in UGX */
  debtBalanceUgx: number;
};

/** Who you buy stock from (distributor, market, etc.) */
export type Supplier = {
  id: string;
  name: string;
  phone: string;
  location: string;
  notes: string;
  /** UGX you still owe this supplier */
  balanceOwedUgx: number;
  /** Last time you saved a purchase from them */
  lastSupplyAt?: string | null;
  /** Running total of all purchase invoices (UGX) */
  totalPurchasesUgx: number;
  createdAt: string;
  version: number;
};

/** One line on a restock / purchase slip — quantities in buying units (crate, sack, jerrican). */
export type PurchaseLine = {
  productId: string;
  name: string;
  qtyBuyingUnits: number;
  costPerBuyingUnitUgx: number;
};

/** Stock-in from a supplier (or walk-in) — updates shelf stock and cost. */
export type Purchase = {
  id: string;
  supplierId: string;
  supplierName: string;
  lines: PurchaseLine[];
  /** Sum of line costs */
  totalCostUgx: number;
  /** Cash or transfer paid now */
  amountPaidUgx: number;
  /** Added to supplier balance: totalCost - amountPaid (can be negative if overpaying old debt) */
  balanceDeltaUgx: number;
  notes: string;
  createdAt: string;
  pendingSync: boolean;
};

export type SupplierPayment = {
  id: string;
  supplierId: string;
  amountUgx: number;
  createdAt: string;
  pendingSync: boolean;
};

export type StockMovementKind =
  | "purchase_in"
  | "sale_out"
  | "adjust_damage"
  | "adjust_use"
  | "adjust_other"
  | "adjust_count";

export type StockMovement = {
  id: string;
  at: string;
  productId: string;
  productName: string;
  /** Positive = stock in, negative = stock out */
  deltaBaseUnits: number;
  kind: StockMovementKind;
  summary: string;
  refId?: string;
  supplierId?: string | null;
};

export type SaleLine = {
  productId: string;
  name: string;
  inputMode: LineInputMode;
  /** Quantity in product base units */
  quantity: number;
  /** Selling price per base unit at the time of sale */
  unitPriceUgx: number;
  /** Buying cost per base unit at the time of sale */
  unitCostUgx: number;
  lineTotalUgx: number;
  /** Simple estimate: line total minus buying cost x quantity */
  estimatedProfitUgx: number;
  /** When inputMode is money, what the customer handed */
  moneyAmountUgx?: number | null;
};

export type Sale = {
  id: string;
  lines: SaleLine[];
  subtotalUgx: number;
  totalUgx: number;
  cashPaidUgx: number;
  /** Amount still on account */
  debtUgx: number;
  estimatedProfitUgx: number;
  createdAt: string;
  pendingSync: boolean;
  lastSyncError?: string | null;
  /** When set, sale debt is linked to this person for balance tracking */
  customerId?: string | null;
  /** Staff who completed the sale (session actor); drives cashier performance on owner dashboard */
  soldByUserId?: string | null;
};

export type DebtPayment = {
  id: string;
  customerId: string;
  amountUgx: number;
  createdAt: string;
};

/** End-of-day note — counted cash vs expected */
export type DayCloseSummary = {
  id: string;
  dateKey: string;
  expectedCashUgx: number;
  countedCashUgx: number;
  differenceUgx: number;
  totalSalesUgx: number;
  totalDebtUgx: number;
  profitEstimateUgx: number;
  createdAt: string;
};

export const EXPENSE_CATEGORIES = [
  "transport",
  "rent",
  "salaries",
  "electricity",
  "airtime",
  "miscellaneous",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type Expense = {
  id: string;
  category: ExpenseCategory;
  amountUgx: number;
  note: string;
  paidAt: string;
  pendingSync: boolean;
};

export type StaffAccount = {
  id: string;
  name: string;
  role: UserRole;
  pin?: string | null;
  password?: string | null;
  phone?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Receipt printer paper — 58mm / 80mm thermal, or A4 for office printers. */
export type ReceiptPaperSize = "58mm" | "80mm" | "a4";

export type ShopPreferences = {
  businessType: BusinessType;
  /** Giant one-hand sell screen */
  kioskQuickSell: boolean;
  /** First-time business type picker */
  onboardingDone: boolean;
  /** 2 = new prefs shape; missing = older snapshot → skip onboarding */
  schemaVersion?: number;
  /** After first-sale celebration modal is dismissed */
  celebratedFirstSale?: boolean;
  /** Short tone when a sale completes (Android / speakers) */
  saleSoundOn?: boolean;
  /** Vibration on key taps and sale success */
  hapticsOn?: boolean;
  /**
   * Touch-first cashier flow vs owner back office (extra dashboard / cash history).
   * Only owner/manager may set `owner_back_office`; others stay on cashier.
   */
  posUiMode?: "cashier" | "owner_back_office";
  /**
   * Offline / dev only: simulate another role. Honoured only when Supabase is off or `import.meta.env.DEV`,
   * and the real auth role is owner — see `resolveSessionActor`.
   */
  devRoleOverride?: UserRole | null;
  /** Flag day-close variance when abs(diff) exceeds max(pct of expected, fixed UGX). */
  cashVarianceThresholdPct?: number;
  cashVarianceThresholdUgxFixed?: number;
  /** Kampala date key (YYYY-MM-DD) of last automatic daily backup written */
  lastAutoBackupDateKey?: string;
  /**
   * Multi-branch (future): when set, rows may be tagged with this id for sync and dashboards.
   * Single-shop installs leave these unset.
   */
  activeBranchId?: string | null;
  branchDisplayName?: string | null;
  /**
   * Optional 4–6 digit PIN to unlock Back Office on this device (stored in local snapshot).
   * Not bank-grade; deters casual access on shared phones.
   */
  backOfficePin?: string | null;
  /** Business profile (owner setup) cached locally for offline UX. */
  shopDisplayName?: string | null;
  shopPhoneE164?: string | null;
  shopAddressLine?: string | null;
  shopCurrency?: string | null;
  /** Local multi-user profiles for fast shared-device switch. */
  staffAccounts?: StaffAccount[];
  /** Active staff profile on this device; null = auth role session. */
  activeStaffId?: string | null;
  /** Lock screen state for quick shift switches. */
  posLocked?: boolean;
  shifts?: ShiftRecord[];
  /** Product ids starred on Sell screen (fast access) */
  favoriteProductIds?: string[];
  /** Recently added-to-cart product ids (newest first); capped in UI logic */
  recentProductIds?: string[];
  /** Sell screen category chip: real category name, or `__waka_uncategorized__`; omit / null = All */
  posSellCategoryFilter?: string | null;
  /** Thermal / AirPrint receipt width (Settings → Receipts). */
  receiptPaperSize?: ReceiptPaperSize;
};

export type SyncOperationKind =
  | "sale"
  | "product"
  | "customer"
  | "stock_move"
  | "audit_log"
  | "purchase"
  | "supplier";

export type SyncOperation = {
  id: string;
  kind: SyncOperationKind;
  payload: unknown;
  createdAt: string;
  attempts: number;
};

/** High-level connectivity for the tiny header strip */
export type SyncStatus = "online" | "offline" | "syncing" | "pending";
