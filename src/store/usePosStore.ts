import { create } from "zustand";
import type {
  AuditAction,
  AuditLogEntry,
  BusinessType,
  ShopSellingStyle,
  Customer,
  DayCloseSummary,
  DebtPayment,
  LineInputMode,
  Product,
  Purchase,
  PurchaseLine,
  ReturnReason,
  ReturnRecord,
  Sale,
  SaleLine,
  SellingMode,
  ShiftRecord,
  ShopPreferences,
  Permission,
  StaffAccount,
  StockMovement,
  StockMovementKind,
  Supplier,
  SupplierPayment,
  SyncOperationKind,
  UserRole,
  VoidReason,
  VoidRecord,
  CashExpense,
} from "../types";
import type { SessionActor } from "../lib/sessionActor";
import { hasPermission } from "../lib/permissions";
import { checkStorePermission } from "../lib/storeAuthorization";
import { getOrCreateDeviceId } from "../lib/deviceId";
import { createDefaultPreferences, createDefaultProducts } from "../data/defaultSeed";
import { readCachedOwnerOnboardingComplete } from "../lib/ownerOnboarding";
import { isWorkspaceBootstrapped } from "../lib/workspaceBootstrapCache";
import { hasSupabaseConfig } from "../lib/supabase";
import { writeSnapshot, readSnapshotWithFallback, claimLegacySnapshotForCurrentAccount } from "../offline/localDb";
import { getActiveAccountKey } from "../offline/accountScope";
import { isNativeApp } from "../lib/nativeApp";
import { persistDebounceMs, runWhenIdle, yieldUiTick } from "../lib/uiYield";
import { scanTodaySalesHead } from "../lib/salesDayIndex";
import {
  buildPendingSaleFromDraft,
  closeTableSession,
  ensureHospitalityFloor,
  openNamedTabSessionOnFloor,
  openTableSessionOnFloor,
  sessionDisplayLabel,
  syncTableDisplayStatuses,
  defaultHospitalityFloor,
  defaultKitchenEnabledForBusinessType,
  isHospitalityBusinessType,
} from "../lib/hospitality";
import { sessionWaiterAttribution } from "../lib/waiterAttribution";
import { isPharmacyBusinessType, isPharmacyMode } from "../lib/pharmacy";
import { inferProductGuess } from "../lib/pharmacyUx";
import { isProductExpired, normalizeExpiryDate, shouldBlockExpiredSale } from "../lib/pharmacyExpiry";
import { pharmacyQuickAddRequiresBuyPrice } from "../lib/pharmacyCostIntegrity";
import { buildPharmacySaleLine, buyingUnitFromPackaging } from "../lib/pharmacyPackaging";
import { normalizeMedicineForm, normalizeMedicineStrength } from "../lib/pharmacyMedicine";
import {
  fireKitchenTicketsForLines,
  cancelKitchenTicket,
  mergeSaleLines,
  mergeSessionsOnFloor,
  pruneServedKitchenTickets,
  transferSessionToTable,
  updateKitchenTicketStatus,
} from "../lib/hospitalityOps";
import {
  addDiningArea,
  addDiningTable,
  removeDiningArea,
  removeDiningTable,
  renameDiningArea,
  updateDiningTable,
} from "../lib/hospitalityFloorEditor";
import { normalizeDataRetentionPolicy } from "../lib/dataRetention";
import { archiveSalesBeyondActiveWindow, INITIAL_SALES_LOAD_COUNT, SALES_PAGE_LOAD_SIZE } from "../lib/activeSalesWindow";
import { partitionForArchive } from "../lib/recordArchive";
import { assertBackupRestoreNotAborted, cancelBackupRestoreSession } from "../lib/backupRestoreSession";
import { maybeAppendDailyAutoBackup } from "../offline/backupEngine";
import { clearPersistedDraft, readPersistedDraft, resolveDraftFromPersisted, writePersistedDraft } from "../offline/draftStorage";
import type { PersistedSnapshot } from "../offline/localDb";
import { tryMigrateLegacyLocalStorage, clearLegacyLocalStorage } from "../offline/migrateLegacyStore";
import { enqueueSync } from "../offline/syncEngine";
import {
  buildSaleLine,
  buyingUnitsToBaseUnits,
  costPerBaseFromBuyingUnitCost,
  estimatedProfitForLine,
  pricePerBaseUnitUgx,
  purchaseLineCostTotalUgx,
  weightedCostAfterStockIn,
} from "../lib/sellingEngine";
import {
  applyDiscountToLine,
  listPriceForLine,
  applyCustomerDebtDelta,
  creditDebtReductionFromSaleAdjustment,
  reduceSaleTotalsByAmount,
  shiftExpectedCash,
  type DiscountMode,
} from "../lib/saleAdjustments";
import { mergeDraftSaleLine, rebuildDraftLineQuantity } from "../lib/draftCart";
import { deletedLineIdsFromDraft, ensureSaleLineId } from "../lib/pendingSaleMerge";
import { getDeviceOnline } from "../lib/deviceOnline";
import { isWalkInSupplierId, WALK_IN_SUPPLIER_ID } from "../lib/walkInSupplier";
import { getBusinessProfile } from "../config/businessTypes";
import { dateKeyKampala } from "../lib/datesUg";
import { getCompletedFinancials } from "../lib/financialMetrics";
import { getDrawerCashForDayInput } from "../lib/cashReconciliation";
import { resolveDebtorForSale } from "../lib/customerDebtActivity";
import { verifyCustomerDebtIntegrity } from "../lib/customerDebtIntegrity";
import { activeDayCloseForDate, canRecordDayClose } from "../lib/dayCloseIdempotency";
import { buildDayCloseSnapshot } from "../lib/dayCloseDocument";
import { validateDraftDiscount } from "../lib/discountGovernance";
import { buildArchiveForensicSummary } from "../lib/archiveForensics";
import { validateReturnAgainstSale } from "../lib/returnLimits";
import { validateReturnAuthorization } from "../lib/returnPolicy";
import { logPilotEventFromAudit, appendPilotEvent } from "../lib/pilotEventLog";
import { saleStockMovementsFromSale } from "../lib/inventoryIntegrity";
import { canTogglePosUiMode, normalizeUserRole, permissionsForRole } from "../lib/permissions";
import { normalizeShopCurrency } from "../lib/shopCurrency";
import { generateStaffUsername } from "../lib/staffAccountHelpers";
import { hashStaffSecret, normalizePin } from "../lib/staffSecret";
import {
  clearPendingStaffSelection,
  readPendingStaffSelection,
  readStaffSession,
} from "../lib/staffOfflineAuth";

const MAX_AUDIT_LOGS = 5000;
const MAX_STOCK_MOVEMENTS = 4000;

function queueHospitalityChange(input: { sessionIds?: string[]; ticketIds?: string[]; layout?: boolean }) {
  void import("../offline/hospitalityCloudSync").then(({ syncHospitalityAfterFloorChange }) =>
    syncHospitalityAfterFloorChange(input),
  );
}

function mergeAuditLogs(existing: AuditLogEntry[], incoming: AuditLogEntry[]): AuditLogEntry[] {
  const byId = new Map<string, AuditLogEntry>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_AUDIT_LOGS);
}

function mergeStockMovements(existing: StockMovement[], incoming: StockMovement[]): StockMovement[] {
  const byId = new Map<string, StockMovement>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_STOCK_MOVEMENTS);
}

function stockKindFromAdjustReason(reason: string | undefined): StockMovementKind {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("damage") || r.includes("spoiled") || r.includes("waste")) return "adjust_damage";
  if (r.includes("home") || r.includes("took") || r.includes("use")) return "adjust_use";
  if (r.includes("count") || r.includes("stocktake")) return "adjust_count";
  return "adjust_other";
}

function parseStoredUserRole(v: unknown): UserRole | null {
  return normalizeUserRole(v);
}

function normalizeStaffAccounts(raw: unknown): StaffAccount[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffAccount[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const role = parseStoredUserRole(obj.role);
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!role || !name) continue;
    out.push({
      id: typeof obj.id === "string" && obj.id ? obj.id : crypto.randomUUID(),
      name,
      username: typeof obj.username === "string" ? obj.username.trim().toLowerCase() || null : null,
      role,
      permissions: permissionsForRole(role),
      pin: typeof obj.pin === "string" ? obj.pin.replace(/\D/g, "").slice(0, 6) || null : null,
      password: typeof obj.password === "string" ? obj.password || null : null,
      pinHash: typeof obj.pinHash === "string" ? obj.pinHash.trim() || null : null,
      passwordHash: typeof obj.passwordHash === "string" ? obj.passwordHash.trim() || null : null,
      phone: typeof obj.phone === "string" ? obj.phone || null : null,
      active: obj.active !== false,
      createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
    });
  }
  return out;
}

function normalizeShifts(raw: unknown): ShiftRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item as Partial<ShiftRecord>;
      const role = parseStoredUserRole((o as { role?: unknown }).role);
      if (!o || !role || !o.actorUserId || !o.startAt) return null;
      return {
        id: o.id || crypto.randomUUID(),
        actorUserId: String(o.actorUserId),
        actorName: o.actorName ? String(o.actorName) : undefined,
        role,
        startAt: String(o.startAt),
        endAt: o.endAt ? String(o.endAt) : null,
        salesTotalUgx: Number(o.salesTotalUgx ?? 0) || 0,
        debtTotalUgx: Number(o.debtTotalUgx ?? 0) || 0,
        refundsUgx: Number(o.refundsUgx ?? 0) || 0,
        estimatedCashUgx: Number(o.estimatedCashUgx ?? 0) || 0,
        discountsTotalUgx: Number(o.discountsTotalUgx ?? 0) || 0,
        voidsTotalUgx: Number(o.voidsTotalUgx ?? 0) || 0,
        returnsTotalUgx: Number(o.returnsTotalUgx ?? 0) || 0,
        debtPaymentsTotalUgx: Number(o.debtPaymentsTotalUgx ?? 0) || 0,
        countedCashUgx: o.countedCashUgx != null ? Number(o.countedCashUgx) : null,
        cashDifferenceUgx: o.cashDifferenceUgx != null ? Number(o.cashDifferenceUgx) : null,
      };
    })
    .filter(Boolean) as ShiftRecord[];
}

type DraftLineInput = {
  product: Product;
  inputMode: LineInputMode;
  value: number;
  /** Pharmacy POS: `value` is count in this unit (tablet / strip / box). */
  pharmacySaleUnit?: import("../types").PharmacySaleUnitType;
};

export type PosState = {
  _hydrated: boolean;
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  preferences: ShopPreferences;
  debtPayments: DebtPayment[];
  dayCloses: DayCloseSummary[];
  auditLogs: AuditLogEntry[];
  suppliers: Supplier[];
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
  stockMovements: StockMovement[];
  voidRecords: VoidRecord[];
  returnRecords: ReturnRecord[];
  cashExpenses: CashExpense[];
  archivedSales: Sale[];
  archivedAuditLogs: AuditLogEntry[];
  archivedDayCloses: DayCloseSummary[];
  archivedVoidRecords: VoidRecord[];
  archivedReturnRecords: ReturnRecord[];
  /** Current signed-in actor (not persisted); synced from App shell / auth. */
  sessionActor: SessionActor | null;
  draftLines: SaleLine[];
  draftInput: DraftLineInput | null;
  /** Whole-cart discount in UGX (applied at checkout, not per line). */
  draftCartDiscountUgx: number;
  /** When set, draft cart belongs to an open table / pending sale */
  activePendingSaleId: string | null;
  /** Background sales history load — shows trust banner while older sales hydrate. */
  salesHistoryHydration: { active: boolean; loaded: number; total: number } | null;

  hydrate: (
    data: {
      products: Product[];
      customers: Customer[];
      sales: Sale[];
      preferences: ShopPreferences;
      debtPayments?: DebtPayment[];
      dayCloses?: DayCloseSummary[];
      auditLogs?: AuditLogEntry[];
      suppliers?: Supplier[];
      purchases?: Purchase[];
      supplierPayments?: SupplierPayment[];
      stockMovements?: StockMovement[];
      voidRecords?: VoidRecord[];
      returnRecords?: ReturnRecord[];
      cashExpenses?: CashExpense[];
      archivedSales?: Sale[];
      archivedAuditLogs?: AuditLogEntry[];
      archivedDayCloses?: DayCloseSummary[];
      archivedVoidRecords?: VoidRecord[];
      archivedReturnRecords?: ReturnRecord[];
    },
    opts?: { replaceAudit?: boolean },
  ) => void;

  /** Fast path: products + preferences only — UI can render while sales load in background. */
  hydrateEssentials: (data: {
    products: Product[];
    customers: Customer[];
    preferences: ShopPreferences;
  }) => void;

  /** Background path: sales history and back-office collections (sales optional if already set). */
  hydrateRemainder: (data: {
    sales?: Sale[];
    debtPayments?: DebtPayment[];
    dayCloses?: DayCloseSummary[];
    auditLogs?: AuditLogEntry[];
    suppliers?: Supplier[];
    purchases?: Purchase[];
    supplierPayments?: SupplierPayment[];
    stockMovements?: StockMovement[];
    voidRecords?: VoidRecord[];
    returnRecords?: ReturnRecord[];
    cashExpenses?: CashExpense[];
    archivedSales?: Sale[];
    archivedAuditLogs?: AuditLogEntry[];
    archivedDayCloses?: DayCloseSummary[];
    archivedVoidRecords?: VoidRecord[];
    archivedReturnRecords?: ReturnRecord[];
  }) => void;

  /** Replace local state + disk from a full backup (owner only in UI). Prefer await applyRestoredSnapshotFromBackup. */
  applyRestoredSnapshot: (snap: PersistedSnapshot) => void;

  /**
   * Detach the current session: drop ALL in-memory state and mark the store
   * unhydrated so that no further disk writes leak the previous account's data.
   * Persisted data on disk is NOT deleted; the namespaced snapshot for that
   * account stays intact and will be re-hydrated next time the same account
   * signs in.
   */
  resetForSignOut: () => void;

  setSessionActor: (actor: SessionActor | null) => void;

  setPreferences: (p: Partial<ShopPreferences>) => void;
  addStaffAccount: (input: {
    name: string;
    username?: string;
    role: UserRole;
    pin?: string;
    password?: string;
    phone?: string;
    permissions?: Permission[];
  }) => { ok: boolean; errorKey?: string; id?: string };
  updateStaffAccount: (id: string, patch: { name?: string; username?: string; role?: UserRole; phone?: string; active?: boolean }) => void;
  removeStaffAccount: (id: string) => void;
  resetStaffSecret: (id: string, patch: { pin?: string | null; password?: string | null }) => void;
  switchStaffAccount: (id: string | null) => void;
  setPosLocked: (locked: boolean) => void;
  setPilotModeEnabled: (enabled: boolean) => void;
  beginShift: () => void;
  endActiveShift: (actorUserId?: string) => void;
  logAuditAction: (action: AuditAction, summary: string, payload?: Record<string, unknown>) => void;
  completeBusinessOnboarding: (businessType: BusinessType) => void;
  completeShopOnboardingWizard: (input: {
    businessType: BusinessType;
    sellingStyle: ShopSellingStyle;
    latitude?: number;
    longitude?: number;
    gpsSkipped?: boolean;
  }) => void;
  updateBusinessType: (businessType: BusinessType) => void;

  setDraftInput: (input: DraftLineInput | null) => void;
  addDraftLineFromInput: () => { ok: boolean; errorKey?: string };
  removeDraftLine: (productId: string) => void;
  setDraftLineQuantity: (productId: string, quantity: number) => { ok: boolean; errorKey?: string };
  adjustDraftLineQuantity: (productId: string, delta: number) => { ok: boolean; errorKey?: string };
  applyDraftLineDiscount: (productId: string, mode: DiscountMode, value: number) => { ok: boolean; errorKey?: string };
  setDraftCartDiscount: (amountUgx: number) => { ok: boolean; errorKey?: string };
  clearDraft: () => void;
  ensureHospitalityFloor: () => void;
  openTable: (input: {
    tableId: string;
    guestCount: number;
    customerName?: string;
    customerPhone?: string;
  }) => { ok: boolean; errorKey?: string; sessionId?: string };
  openNamedTab: (input: {
    tabLabel: string;
    guestCount?: number;
    customerName?: string;
    customerPhone?: string;
  }) => { ok: boolean; errorKey?: string; sessionId?: string };
  resumeTableSession: (sessionId: string) => Promise<{ ok: boolean; errorKey?: string }>;
  saveTableBill: () => { ok: boolean; errorKey?: string };
  requestTableBill: (sessionId: string) => void;
  clearActiveTableOrder: () => void;
  transferTableSession: (sessionId: string, toTableId: string) => { ok: boolean; errorKey?: string };
  mergeTableSessions: (sourceSessionId: string, targetSessionId: string) => { ok: boolean; errorKey?: string };
  updateKitchenTicketStatus: (ticketId: string, status: import("../types").KitchenTicketStatus) => void;
  cancelKitchenTicket: (ticketId: string) => void;
  cleanupKitchenTickets: () => void;
  fireTableKitchenTickets: () => { ok: boolean; errorKey?: string };
  setHospitalityManualKitchenFire: (enabled: boolean) => void;
  addDiningArea: (name: string) => void;
  renameDiningArea: (areaId: string, name: string) => void;
  removeDiningArea: (areaId: string) => { ok: boolean; errorKey?: string };
  addDiningTable: (input: { areaId: string; label: string; capacity?: number }) => void;
  updateDiningTable: (
    tableId: string,
    patch: Partial<{ label: string; capacity: number; areaId: string; sortOrder: number; isActive: boolean }>,
  ) => void;
  removeDiningTable: (tableId: string) => { ok: boolean; errorKey?: string };
  savePendingSale: (referenceLabel?: string | null) => { ok: boolean; errorKey?: string; saleId?: string };
  resumePendingSale: (saleId: string) => { ok: boolean; errorKey?: string };
  cancelPendingSale: (saleId: string) => { ok: boolean; errorKey?: string };
  voidSaleLine: (input: {
    saleId: string;
    lineIndex: number;
    reason: VoidReason;
    note?: string;
  }) => { ok: boolean; errorKey?: string };
  returnProduct: (input: {
    saleId?: string | null;
    productId: string;
    quantity: number;
    refundAmountUgx: number;
    reason: ReturnReason;
    note?: string;
  }) => { ok: boolean; errorKey?: string; returnRecord?: ReturnRecord };
  closeShiftWithCashCount: (countedCashUgx: number) => { ok: boolean; errorKey?: string; differenceUgx?: number };
  finalizeDraftSale: (opts: {
    debtUgx: number;
    customerId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    paymentMethod?: "cash" | "atm" | "mobile_money" | "mixed" | "credit";
    amountPaidUgx?: number;
    changeGivenUgx?: number;
    splitBreakdown?: import("../types").BillSplitLine[] | null;
  }) => { ok: boolean; errorKey?: string; firstSale?: boolean; saleId?: string };

  addProduct: (p: Omit<Product, "id" | "updatedAt" | "version"> & Partial<Pick<Product, "quickPresetsMoneyUgx" | "quickPresetsQty">>) => void;
  quickAddProduct: (input: {
    name: string;
    priceUgx: number;
    stockQty: number;
    category: string;
    inferName?: string;
    sellingMode?: SellingMode;
    baseUnit?: string;
    buyingUnit?: string | null;
    conversionRate?: number | null;
    /** When set (e.g. from pack cost ÷ pieces), used instead of a guessed cost */
    costPricePerUnitUgx?: number | null;
    quickPresetsMoneyUgx?: number[];
    quickPresetsQty?: number[];
    medicineStrength?: string | null;
    medicineForm?: string | null;
    expiryDate?: string | null;
    minimumStockAlert?: number;
    pharmacyPackaging?: import("../types").PharmacyPackaging | null;
  }) => { ok: boolean; errorKey?: string };
  bulkQuickAddProducts: (
    rows: Array<{
      name: string;
      priceUgx: number;
      stockQty: number;
      category: string;
      inferName?: string;
      sellingMode?: SellingMode;
      baseUnit?: string;
      medicineStrength?: string | null;
      medicineForm?: string | null;
    }>,
  ) => { added: number; skipped: number };
  duplicateProduct: (productId: string, nameSuffix: string) => { ok: boolean; errorKey?: string };
  removeProduct: (productId: string) => void;
  updateProductQuickPresets: (
    productId: string,
    presets: { quickPresetsMoneyUgx?: number[]; quickPresetsQty?: number[] },
  ) => void;
  /** Full product edit (name, prices, stock count, pack/cost, presets). Stock count changes log a count adjustment. */
  updateProduct: (
    productId: string,
    patch: Partial<
      Pick<
        Product,
        | "name"
        | "sellingMode"
        | "baseUnit"
        | "buyingUnit"
        | "conversionRate"
        | "sellingPricePerUnitUgx"
        | "costPricePerUnitUgx"
        | "stockOnHand"
        | "minimumStockAlert"
        | "category"
        | "sku"
        | "expiryDate"
        | "medicineStrength"
        | "medicineForm"
        | "pharmacyPackaging"
        | "quickPresetsMoneyUgx"
        | "quickPresetsQty"
      >
    >,
  ) => { ok: boolean; errorKey?: string };
  adjustStock: (productId: string, delta: number, reason?: string) => void;
  /** Pharmacy: write off expired stock with audit trail and inventory loss value. */
  writeOffExpiredStock: (input: {
    productId: string;
    quantity?: number;
    note?: string;
  }) => { ok: boolean; errorKey?: string; lossValueUgx?: number };
  addCustomer: (c: Omit<Customer, "id" | "createdAt" | "version" | "debtBalanceUgx">) => Customer;
  addDebtPayment: (
    customerId: string,
    amountUgx: number,
  ) => { ok: boolean; errorKey?: string; payment?: import("../types").DebtPayment };
  recordDayClose: (opts: {
    dateKey: string;
    countedCashUgx: number;
    override?: boolean;
    overrideReason?: string;
  }) => Promise<{ ok: boolean; errorKey?: string }>;
  repairCustomerDebtIntegrity: () => { ok: boolean; healedCount: number; mismatchCount: number };
  addCashExpense: (input: { amountUgx: number; category: string; description?: string }) => { ok: boolean; errorKey?: string };
  voidCashExpense: (id: string) => { ok: boolean };

  addSupplier: (input: { name: string; phone?: string; location?: string; notes?: string }) => void;
  addSupplierPayment: (supplierId: string, amountUgx: number) => { ok: boolean; errorKey?: string };
  recordPurchase: (input: {
    supplierId?: string | null;
    /** Display name when buying in town (no fixed supplier). */
    supplierName?: string;
    lines: Array<{
      productId: string;
      qtyBuyingUnits?: number;
      costPerBuyingUnitUgx?: number;
      /** Pharmacy restock by tablet/strip/box — skips buying-unit conversion. */
      baseUnitsIn?: number;
      costPerBaseUnitUgx?: number;
    }>;
    amountPaidUgx: number;
    notes?: string;
  }) => { ok: boolean; errorKey?: string };

  /** Move old sales / activity to archive per retention policy (never auto-deletes). */
  runDataArchive: () => {
    moved: { sales: number; auditLogs: number; dayCloses: number; voidRecords: number; returnRecords: number; shifts: number };
  };
  /** Owner-only permanent removal of archived buckets on this device. */
  permanentlyDeleteArchived: () => void;
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let draftPersistTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounced incremental persist: accumulate prev/next across rapid mutations. */
let pendingPersistPrev: PosState | null = null;
let pendingPersistNext: PosState | null = null;
/** While > 0, auto-persist is paused (restore, cloud merge, etc.). */
let persistSuspended = 0;
let snapshotWriteInFlight = false;
let snapshotWriteQueued = false;

/** Pause debounced snapshot writes during heavy store mutations. */
export function suspendStorePersist(): () => void {
  persistSuspended += 1;
  return () => {
    persistSuspended = Math.max(0, persistSuspended - 1);
  };
}

function fireSnapshotWrite(forceFull = false): void {
  if (snapshotWriteInFlight) {
    snapshotWriteQueued = true;
    return;
  }
  snapshotWriteInFlight = true;
  void (async () => {
    try {
      if (isNativeApp()) {
        await yieldUiTick();
      }
      const cur = usePosStore.getState();
      if (!cur._hydrated || persistSuspended > 0) return;

      const prev = pendingPersistPrev ?? cur;
      const next = pendingPersistNext ?? cur;
      pendingPersistPrev = null;
      pendingPersistNext = null;

      const { flushIncrementalPersist, flushFullSnapshotPersist } = await import("../offline/incrementalPersist");
      const result = forceFull
        ? await flushFullSnapshotPersist(next, { skipLastGood: true })
        : await flushIncrementalPersist(prev, next);

      const { isDiagnosticsEnabled, recordPersistWrite, recordIncrementalPersist } = await import(
        "../lib/stabilityDiagnostics",
      );
      if (isDiagnosticsEnabled()) {
        if (result.mode === "full") recordPersistWrite(result.bytesWritten, result.durationMs);
        else recordIncrementalPersist(result);
      }

      const after = usePosStore.getState();
      if (!after._hydrated || persistSuspended > 0) return;

      const runBackup = () => {
        void (async () => {
          const latest = usePosStore.getState();
          if (!latest._hydrated) return;
          const nextKey = await maybeAppendDailyAutoBackup(latest.preferences.lastAutoBackupDateKey);
          if (nextKey && nextKey !== latest.preferences.lastAutoBackupDateKey) {
            usePosStore.setState((st) => ({
              preferences: { ...st.preferences, lastAutoBackupDateKey: nextKey },
            }));
          }
        })();
      };
      if (isNativeApp()) {
        runWhenIdle(runBackup, 4000);
      } else {
        runBackup();
      }
    } finally {
      snapshotWriteInFlight = false;
      if (snapshotWriteQueued) {
        snapshotWriteQueued = false;
        fireSnapshotWrite(false);
      }
    }
  })();
}

function fireDraftWrite(s: PosState): void {
  const input = s.draftInput
    ? { productId: s.draftInput.product.id, inputMode: s.draftInput.inputMode, value: s.draftInput.value }
    : null;
  void writePersistedDraft(s.draftLines, input, s.draftCartDiscountUgx);
}

function schedulePersist(prev: PosState, next: PosState) {
  if (!next._hydrated || persistSuspended > 0) return;
  if (!pendingPersistPrev) pendingPersistPrev = prev;
  pendingPersistNext = next;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    fireSnapshotWrite(false);
  }, persistDebounceMs());
}

function scheduleDraftPersist(get: () => PosState) {
  if (!get()._hydrated) return;
  if (draftPersistTimer) clearTimeout(draftPersistTimer);
  draftPersistTimer = setTimeout(() => {
    draftPersistTimer = null;
    fireDraftWrite(get());
  }, 400);
}

/**
 * Synchronously fire any pending persist timers so the in-flight snapshot is
 * captured under the CURRENT account key before an account switch swaps the
 * namespace. The async writes themselves capture the scoped key inside
 * `writeSnapshot` at call time, so they remain bound to the outgoing account
 * even after the active key flips to null / the next account.
 */
export function flushPendingPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
    const next = pendingPersistNext ?? usePosStore.getState();
    const prev = pendingPersistPrev ?? next;
    pendingPersistPrev = null;
    pendingPersistNext = null;
    if (next._hydrated && persistSuspended === 0) {
      void import("../offline/incrementalPersist").then((m) => m.flushIncrementalPersist(prev, next));
    }
  }
  if (draftPersistTimer) {
    clearTimeout(draftPersistTimer);
    draftPersistTimer = null;
    const s = usePosStore.getState();
    if (s._hydrated) fireDraftWrite(s);
  }
}

async function queueRemote(kind: SyncOperationKind, payload: unknown) {
  if (getActiveAccountKey()?.startsWith("demo:")) return;
  await enqueueSync({
    id: crypto.randomUUID(),
    kind,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
}

function defaultQuickPresetsForProduct(p: Omit<Product, "id" | "updatedAt" | "version">): Pick<Product, "quickPresetsMoneyUgx" | "quickPresetsQty"> {
  if (p.quickPresetsMoneyUgx?.length || p.quickPresetsQty?.length) {
    return { quickPresetsMoneyUgx: p.quickPresetsMoneyUgx, quickPresetsQty: p.quickPresetsQty };
  }
  if (p.sellingMode === "portion") return { quickPresetsMoneyUgx: [500, 1000, 2000], quickPresetsQty: [0.5, 1, 2] };
  if (p.sellingMode === "weighted") {
    const u = p.sellingPricePerUnitUgx;
    return {
      quickPresetsQty: [1, 2, 5],
      quickPresetsMoneyUgx: [u, u * 2, u * 5],
    };
  }
  const u = p.sellingPricePerUnitUgx;
  return { quickPresetsMoneyUgx: u > 0 ? [u, u * 2, u * 3] : [], quickPresetsQty: [1, 2, 3] };
}

function normalizeProduct(p: Product): Product {
  const d = defaultQuickPresetsForProduct(p);
  const hasMoney = (p.quickPresetsMoneyUgx?.length ?? 0) > 0;
  const hasQty = (p.quickPresetsQty?.length ?? 0) > 0;
  return {
    ...p,
    quickPresetsMoneyUgx: hasMoney ? p.quickPresetsMoneyUgx : d.quickPresetsMoneyUgx,
    quickPresetsQty: hasQty ? p.quickPresetsQty : d.quickPresetsQty,
  };
}

function normalizeCustomer(c: Customer): Customer {
  return { ...c, debtBalanceUgx: typeof c.debtBalanceUgx === "number" ? c.debtBalanceUgx : 0 };
}

function normalizeSaleLine(line: SaleLine): SaleLine {
  const unitPriceUgx = Math.max(0, Math.floor(Number(line.unitPriceUgx) || 0));
  const unitCostUgx = Math.max(0, Math.floor(Number(line.unitCostUgx) || 0));
  const lineTotalUgx = Math.max(0, Math.floor(Number(line.lineTotalUgx) || 0));
  const quantity = Math.max(0, Number(line.quantity) || 0);
  const estimatedProfitUgx = Number.isFinite(line.estimatedProfitUgx)
    ? Math.round(line.estimatedProfitUgx)
    : Math.round(lineTotalUgx - quantity * unitCostUgx);
  return {
    ...line,
    quantity,
    unitPriceUgx,
    unitCostUgx,
    lineTotalUgx,
    originalLineTotalUgx: Math.max(0, Math.floor(Number(line.originalLineTotalUgx ?? lineTotalUgx) || 0)),
    discountUgx: Math.max(0, Math.floor(Number(line.discountUgx) || 0)),
    estimatedProfitUgx,
    moneyAmountUgx: line.moneyAmountUgx ?? null,
    saleUnitType:
      line.saleUnitType === "tablet" || line.saleUnitType === "strip" || line.saleUnitType === "box"
        ? line.saleUnitType
        : null,
    saleUnitQty: line.saleUnitQty != null && line.saleUnitQty > 0 ? line.saleUnitQty : null,
    voided: line.voided === true,
    voidedAt: line.voidedAt ?? null,
  };
}

function normalizeSale(s: Sale): Sale {
  const lines = (s.lines ?? []).map(normalizeSaleLine);
  const estimatedProfitUgx = Number.isFinite(s.estimatedProfitUgx)
    ? Math.round(s.estimatedProfitUgx)
    : lines.reduce((sum, line) => sum + line.estimatedProfitUgx, 0);
  return {
    ...s,
    status: s.status ?? "completed",
    lines,
    estimatedProfitUgx,
    customerId: s.customerId ?? null,
    soldByUserId: s.soldByUserId ?? null,
    waiterStaffId: s.waiterStaffId ?? null,
    waiterName: s.waiterName ?? null,
    referenceLabel: s.referenceLabel ?? null,
    tableSessionId: s.tableSessionId ?? null,
  };
}

function normalizeSupplier(s: Supplier): Supplier {
  return {
    ...s,
    balanceOwedUgx: typeof s.balanceOwedUgx === "number" ? s.balanceOwedUgx : 0,
    totalPurchasesUgx: typeof s.totalPurchasesUgx === "number" ? s.totalPurchasesUgx : 0,
    phone: s.phone ?? "",
    location: s.location ?? "",
    notes: s.notes ?? "",
    lastSupplyAt: s.lastSupplyAt ?? null,
  };
}

function normalizePurchase(p: Purchase): Purchase {
  return {
    ...p,
    pendingSync: p.pendingSync !== false,
    notes: p.notes ?? "",
    lines: Array.isArray(p.lines) ? p.lines : [],
  };
}

function normalizeSupplierPayment(p: SupplierPayment): SupplierPayment {
  return { ...p, pendingSync: p.pendingSync !== false };
}

function normalizeStockMovement(m: StockMovement): StockMovement {
  return { ...m, supplierId: m.supplierId ?? null };
}

function normalizeCashExpense(e: CashExpense): CashExpense {
  return {
    ...e,
    description: e.description ?? "",
    pendingSync: e.pendingSync !== false,
    lastSyncError: e.lastSyncError ?? null,
    deletedAt: e.deletedAt ?? null,
  };
}

export const usePosStore = create<PosState>((set, get) => {
  const pushAudit = (action: AuditAction, payloadSummary: string, payload: Record<string, unknown>) => {
    const actor = get().sessionActor;
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      deviceId: getOrCreateDeviceId(),
      actorUserId: actor?.userId ?? "unknown",
      actorName: actor?.displayName,
      role: actor?.role ?? "cashier",
      action,
      payloadSummary,
      payload,
    };
    set((s) => ({ auditLogs: mergeAuditLogs(s.auditLogs, [entry]) }));
    logPilotEventFromAudit(action, payloadSummary, payload);
    void queueRemote("audit_log", { entry });
  };

  const denyUnlessPerm = (permission: Permission, actionLabel: string) => {
    const actor = get().sessionActor;
    const check = checkStorePermission(actor, permission);
    if (check.ok) return null;
    pushAudit("auth_forbidden", `Denied ${actionLabel}`, {
      permission,
      action: actionLabel,
      attemptedRole: actor?.role ?? null,
      errorKey: check.errorKey,
    });
    return check;
  };

  return {
  _hydrated: false,
  products: [],
  customers: [],
  sales: [],
  preferences: createDefaultPreferences(),
  debtPayments: [],
  dayCloses: [],
  auditLogs: [],
  suppliers: [],
  purchases: [],
  supplierPayments: [],
  stockMovements: [],
  voidRecords: [],
  returnRecords: [],
  cashExpenses: [],
  archivedSales: [],
  archivedAuditLogs: [],
  archivedDayCloses: [],
  archivedVoidRecords: [],
  archivedReturnRecords: [],
  sessionActor: null,
  draftLines: [],
  draftInput: null,
  draftCartDiscountUgx: 0,
  activePendingSaleId: null,
  salesHistoryHydration: null,

  hydrate: (data, opts) =>
    set({
      products: data.products.map(normalizeProduct),
      customers: data.customers.map(normalizeCustomer),
      sales: data.sales.map(normalizeSale),
      preferences: data.preferences,
      debtPayments: data.debtPayments ?? [],
      dayCloses: data.dayCloses ?? [],
      auditLogs: opts?.replaceAudit ? (data.auditLogs ?? []) : mergeAuditLogs(data.auditLogs ?? [], get().auditLogs),
      suppliers: (data.suppliers ?? []).map(normalizeSupplier),
      purchases: (data.purchases ?? []).map(normalizePurchase),
      supplierPayments: (data.supplierPayments ?? []).map(normalizeSupplierPayment),
      stockMovements: mergeStockMovements(data.stockMovements ?? [], opts?.replaceAudit ? [] : get().stockMovements).map(
        normalizeStockMovement,
      ),
      voidRecords: data.voidRecords ?? [],
      returnRecords: data.returnRecords ?? [],
      cashExpenses: (data.cashExpenses ?? []).map(normalizeCashExpense),
      archivedSales: (data.archivedSales ?? []).map(normalizeSale),
      archivedAuditLogs: data.archivedAuditLogs ?? [],
      archivedDayCloses: data.archivedDayCloses ?? [],
      archivedVoidRecords: data.archivedVoidRecords ?? [],
      archivedReturnRecords: data.archivedReturnRecords ?? [],
      _hydrated: true,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
    }),

  hydrateEssentials: (data) =>
    set({
      products: data.products.map(normalizeProduct),
      customers: data.customers.map(normalizeCustomer),
      sales: [],
      preferences: data.preferences,
      debtPayments: [],
      dayCloses: [],
      auditLogs: [],
      suppliers: [],
      purchases: [],
      supplierPayments: [],
      stockMovements: [],
      voidRecords: [],
      returnRecords: [],
      cashExpenses: [],
      archivedSales: [],
      archivedAuditLogs: [],
      archivedDayCloses: [],
      archivedVoidRecords: [],
      archivedReturnRecords: [],
      _hydrated: true,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
    }),

  hydrateRemainder: (data) =>
    set((s) => ({
      sales: data.sales ? data.sales.map(normalizeSale) : s.sales,
      debtPayments: data.debtPayments ?? s.debtPayments,
      dayCloses: data.dayCloses ?? s.dayCloses,
      auditLogs: mergeAuditLogs(data.auditLogs ?? [], s.auditLogs),
      suppliers: (data.suppliers ?? []).map(normalizeSupplier),
      purchases: (data.purchases ?? []).map(normalizePurchase),
      supplierPayments: (data.supplierPayments ?? []).map(normalizeSupplierPayment),
      stockMovements: mergeStockMovements(data.stockMovements ?? [], s.stockMovements).map(normalizeStockMovement),
      voidRecords: data.voidRecords ?? s.voidRecords,
      returnRecords: data.returnRecords ?? s.returnRecords,
      cashExpenses: data.cashExpenses ? data.cashExpenses.map(normalizeCashExpense) : s.cashExpenses,
      archivedSales: data.archivedSales ? data.archivedSales.map(normalizeSale) : s.archivedSales,
      archivedAuditLogs: data.archivedAuditLogs ?? s.archivedAuditLogs,
      archivedDayCloses: data.archivedDayCloses ?? s.archivedDayCloses,
      archivedVoidRecords: data.archivedVoidRecords ?? s.archivedVoidRecords,
      archivedReturnRecords: data.archivedReturnRecords ?? s.archivedReturnRecords,
    })),

  applyRestoredSnapshot: (snap) => {
    void applyRestoredSnapshotFromBackup(snap);
  },

  resetForSignOut: () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (draftPersistTimer) {
      clearTimeout(draftPersistTimer);
      draftPersistTimer = null;
    }
    set({
      _hydrated: false,
      products: [],
      customers: [],
      sales: [],
      preferences: createDefaultPreferences(),
      debtPayments: [],
      dayCloses: [],
      auditLogs: [],
      suppliers: [],
      purchases: [],
      supplierPayments: [],
      stockMovements: [],
      voidRecords: [],
      returnRecords: [],
      cashExpenses: [],
      archivedSales: [],
      archivedAuditLogs: [],
      archivedDayCloses: [],
      archivedVoidRecords: [],
      archivedReturnRecords: [],
      sessionActor: null,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
    });
  },

  setSessionActor: (actor) => set({ sessionActor: actor }),

  setPreferences: (p) => {
    set((s) => {
      const merged = { ...s.preferences, ...p };
      const role = s.sessionActor?.role ?? "cashier";
      if (!canTogglePosUiMode(role) && merged.posUiMode === "owner_back_office") {
        merged.posUiMode = "cashier";
      }
      return { preferences: merged };
    });
  },

  addStaffAccount: (input) => {
    const name = input.name.trim();
    if (!name) return { ok: false, errorKey: "staffNameRequired" };
    const role = normalizeUserRole(input.role);
    if (!role || role === "owner") return { ok: false, errorKey: "staffCreateFail" };
    const pin = normalizePin(input.pin ?? "") || null;
    const password = (input.password ?? "").trim() || null;
    if (!password && pin?.length !== 4) return { ok: false, errorKey: "staffPinMust4" };

    const existing = get().preferences.staffAccounts ?? [];
    let username = (input.username ?? "").trim().toLowerCase() || null;
    if (!username) username = generateStaffUsername(name, existing);
    else if (existing.some((a) => (a.username ?? "").toLowerCase() === username)) {
      return { ok: false, errorKey: "staffUsernameTaken" };
    }

    const row: StaffAccount = {
      id: crypto.randomUUID(),
      name,
      username,
      role,
      permissions: input.permissions ?? permissionsForRole(role),
      pin: null,
      password: null,
      pinHash: pin ? hashStaffSecret(pin) : null,
      passwordHash: password ? hashStaffSecret(password) : null,
      phone: (input.phone ?? "").trim() || null,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({
      preferences: {
        ...s.preferences,
        staffAccounts: [row, ...(s.preferences.staffAccounts ?? [])],
      },
    }));
    return { ok: true, id: row.id };
  },

  updateStaffAccount: (id, patch) => {
    set((s) => ({
      preferences: {
        ...s.preferences,
        staffAccounts: (s.preferences.staffAccounts ?? []).map((a) => {
          const nextRole = patch.role !== undefined ? normalizeUserRole(patch.role) : a.role;
          return a.id === id
            ? {
                ...a,
                name: patch.name?.trim() ?? a.name,
                role: nextRole ?? a.role,
                username:
                  patch.username === undefined
                    ? (a.username ?? null)
                    : patch.username.trim().toLowerCase() || null,
                permissions: nextRole ? permissionsForRole(nextRole) : permissionsForRole(a.role),
                phone: patch.phone === undefined ? a.phone : patch.phone.trim() || null,
                active: patch.active ?? a.active,
                updatedAt: new Date().toISOString(),
              }
            : a;
        }),
      },
    }));
  },

  removeStaffAccount: (id) => {
    set((s) => ({
      preferences: {
        ...s.preferences,
        staffAccounts: (s.preferences.staffAccounts ?? []).filter((a) => a.id !== id),
        activeStaffId: s.preferences.activeStaffId === id ? null : s.preferences.activeStaffId,
      },
    }));
  },

  resetStaffSecret: (id, patch) => {
    set((s) => ({
      preferences: {
        ...s.preferences,
        staffAccounts: (s.preferences.staffAccounts ?? []).map((a) =>
          a.id === id
            ? {
                ...a,
                pin: patch.pin === undefined ? a.pin : null,
                password: patch.password === undefined ? a.password : null,
                pinHash:
                  patch.pin === undefined
                    ? (a.pinHash ?? null)
                    : (normalizePin(patch.pin ?? "") ? hashStaffSecret(normalizePin(patch.pin ?? "")) : null),
                passwordHash:
                  patch.password === undefined
                    ? (a.passwordHash ?? null)
                    : (patch.password?.trim() ? hashStaffSecret(patch.password.trim()) : null),
                updatedAt: new Date().toISOString(),
              }
            : a,
        ),
      },
    }));
  },

  switchStaffAccount: (id) => {
    const prev = get().preferences.activeStaffId ?? null;
    if (prev && prev !== id) {
      get().endActiveShift();
    }
    set((s) => ({ preferences: { ...s.preferences, activeStaffId: id } }));
    if (id && prev !== id) {
      get().beginShift();
    }
  },

  setPosLocked: (locked) => {
    set((s) => ({ preferences: { ...s.preferences, posLocked: locked } }));
  },
  setPilotModeEnabled: (enabled) => {
    set((s) => ({ preferences: { ...s.preferences, pilotModeEnabled: enabled } }));
  },
  logAuditAction: (action, summary, payload) => {
    pushAudit(action, summary, payload ?? {});
  },

  beginShift: () => {
    const s = get();
    const actor = s.sessionActor;
    if (!actor) return;
    const open = s.preferences.shifts?.find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    if (open) return;
    const row: ShiftRecord = {
      id: crypto.randomUUID(),
      actorUserId: actor.userId,
      actorName: actor.displayName,
      role: actor.role,
      startAt: new Date().toISOString(),
      endAt: null,
      salesTotalUgx: 0,
      debtTotalUgx: 0,
      refundsUgx: 0,
      estimatedCashUgx: 0,
      discountsTotalUgx: 0,
      voidsTotalUgx: 0,
      returnsTotalUgx: 0,
      debtPaymentsTotalUgx: 0,
      countedCashUgx: null,
      cashDifferenceUgx: null,
    };
    set((st) => ({
      preferences: {
        ...st.preferences,
        shifts: [row, ...(st.preferences.shifts ?? [])],
      },
    }));
    pushAudit("shift_start", `Shift start ${actor.displayName ?? actor.userId}`, { shiftId: row.id, actorUserId: actor.userId });
  },

  endActiveShift: (actorUserId) => {
    const s = get();
    const actor = s.sessionActor;
    const uid = actorUserId ?? actor?.userId;
    if (!uid) return;
    const open = (s.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === uid);
    if (!open) return;
    const endAt = new Date().toISOString();
    const startMs = new Date(open.startAt).getTime();
    const endMs = new Date(endAt).getTime();
    set((st) => ({
      preferences: {
        ...st.preferences,
        shifts: (st.preferences.shifts ?? []).map((sh) =>
          sh.id === open.id
            ? {
                ...sh,
                endAt,
              }
            : sh,
        ),
      },
      auditLogs: st.auditLogs.filter((e) => {
        const t = new Date(e.at).getTime();
        if (Number.isNaN(t)) return true;
        return t < startMs || t > endMs;
      }),
    }));
    pushAudit("shift_end", `Shift end ${actor?.displayName ?? uid}`, { shiftId: open.id, actorUserId: uid });
  },

  completeBusinessOnboarding: (businessType) => {
    const prof = getBusinessProfile(businessType);
    const hospitality = isHospitalityBusinessType(businessType);
    const pharmacy = isPharmacyBusinessType(businessType);
    set((s) => ({
      preferences: {
        ...s.preferences,
        businessType,
        kioskQuickSell: prof.kioskQuickSellDefault,
        onboardingDone: true,
        onboardingWizardDone: true,
        schemaVersion: 2,
        hospitalityModeEnabled: hospitality ? true : s.preferences.hospitalityModeEnabled,
        pharmacyModeEnabled: pharmacy ? true : s.preferences.pharmacyModeEnabled,
        hospitalityFloor: hospitality
          ? (s.preferences.hospitalityFloor ?? defaultHospitalityFloor())
          : s.preferences.hospitalityFloor,
        hospitalityKitchenEnabled: hospitality
          ? (s.preferences.hospitalityKitchenEnabled ??
            defaultKitchenEnabledForBusinessType(businessType))
          : s.preferences.hospitalityKitchenEnabled,
      },
    }));
  },

  completeShopOnboardingWizard: (input) => {
    const prof = getBusinessProfile(input.businessType);
    const hospitality = isHospitalityBusinessType(input.businessType);
    const pharmacy = isPharmacyBusinessType(input.businessType);
    set((s) => ({
      preferences: {
        ...s.preferences,
        businessType: input.businessType,
        shopSellingStyle: input.sellingStyle,
        mixedPackSelling: input.sellingStyle === "mixed",
        kioskQuickSell: prof.kioskQuickSellDefault,
        onboardingDone: true,
        onboardingWizardDone: true,
        schemaVersion: 2,
        hospitalityModeEnabled: hospitality ? true : s.preferences.hospitalityModeEnabled,
        pharmacyModeEnabled: pharmacy ? true : s.preferences.pharmacyModeEnabled,
        hospitalityFloor: hospitality
          ? (s.preferences.hospitalityFloor ?? defaultHospitalityFloor())
          : s.preferences.hospitalityFloor,
        hospitalityKitchenEnabled: hospitality
          ? (s.preferences.hospitalityKitchenEnabled ??
            defaultKitchenEnabledForBusinessType(input.businessType))
          : s.preferences.hospitalityKitchenEnabled,
      },
    }));
  },

  updateBusinessType: (businessType) => {
    const prof = getBusinessProfile(businessType);
    set((s) => ({
      preferences: {
        ...s.preferences,
        businessType,
        kioskQuickSell: prof.kioskQuickSellDefault,
        schemaVersion: 2,
      },
    }));
  },

  setDraftInput: (input) => {
    set({ draftInput: input });
    scheduleDraftPersist(get);
  },

  addDraftLineFromInput: () => {
    const d = get().draftInput;
    if (!d) return { ok: false, errorKey: "noSelection" };
    const built =
      d.pharmacySaleUnit && d.inputMode === "quantity"
        ? buildPharmacySaleLine(d.product, d.pharmacySaleUnit, d.value)
        : buildSaleLine(d.product, d.inputMode, d.value);
    if (!built.line || built.error) {
      return { ok: false, errorKey: built.error ?? "invalid" };
    }
    set((state) => {
      const existing = state.draftLines.find((l) => l.productId === built.line!.productId);
      const merged = mergeDraftSaleLine(existing, built.line!, d.product);
      return {
        draftLines: [
          ...state.draftLines.filter((l) => l.productId !== built.line!.productId),
          merged,
        ],
        draftInput: null,
      };
    });
    scheduleDraftPersist(get);
    return { ok: true };
  },

  removeDraftLine: (productId) => {
    set((s) => ({ draftLines: s.draftLines.filter((l) => l.productId !== productId) }));
    scheduleDraftPersist(get);
  },

  setDraftLineQuantity: (productId, quantity) => {
    const state = get();
    const line = state.draftLines.find((l) => l.productId === productId);
    const product = state.products.find((p) => p.id === productId);
    if (!line || !product) return { ok: false, errorKey: "noSelection" };
    if (quantity <= 0) {
      set((s) => ({ draftLines: s.draftLines.filter((l) => l.productId !== productId) }));
      scheduleDraftPersist(get);
      return { ok: true };
    }
    const next = rebuildDraftLineQuantity(product, quantity, line);
    if (!next) return { ok: false, errorKey: "invalidQty" };
    set((s) => ({
      draftLines: s.draftLines.map((l) => (l.productId === productId ? next : l)),
    }));
    scheduleDraftPersist(get);
    return { ok: true };
  },

  adjustDraftLineQuantity: (productId, delta) => {
    const state = get();
    const line = state.draftLines.find((l) => l.productId === productId);
    const product = state.products.find((p) => p.id === productId);
    if (!line || !product) return { ok: false, errorKey: "noSelection" };
    const nextQty = Math.round((line.quantity + delta) * 10000) / 10000;
    return get().setDraftLineQuantity(productId, nextQty);
  },

  applyDraftLineDiscount: (productId, mode, value) => {
    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const line = state.draftLines.find((l) => l.productId === productId);
    if (!line) return { ok: false, errorKey: "noSelection" };
    const next = applyDiscountToLine(line, mode, value);
    if (!next) return { ok: false, errorKey: "invalid" };
    const list = listPriceForLine(line);
    const discountUgx = Math.max(0, list - next.lineTotalUgx);
    const policy = validateDraftDiscount({
      prefs: state.preferences,
      role: actor.role,
      discountUgx,
      lineSubtotalUgx: list,
    });
    if (!policy.ok) return { ok: false, errorKey: policy.errorKey };
    set((s) => ({
      draftLines: s.draftLines.map((l) => (l.productId === productId ? next : l)),
    }));
    scheduleDraftPersist(get);
    return { ok: true };
  },

  setDraftCartDiscount: (amountUgx) => {
    const state = get();
    const actor = state.sessionActor;
    const lineSubtotal = state.draftLines.reduce((a, l) => a + l.lineTotalUgx, 0);
    const capped = Math.min(Math.max(0, Math.floor(amountUgx)), lineSubtotal);
    if (actor) {
      const policy = validateDraftDiscount({
        prefs: state.preferences,
        role: actor.role,
        discountUgx: capped,
        lineSubtotalUgx: lineSubtotal,
      });
      if (!policy.ok) return { ok: false, errorKey: policy.errorKey };
    }
    set({ draftCartDiscountUgx: capped });
    scheduleDraftPersist(get);
    return { ok: true };
  },

  clearDraft: () => {
    set({ draftLines: [], draftInput: null, draftCartDiscountUgx: 0, activePendingSaleId: null });
    void clearPersistedDraft();
  },

  ensureHospitalityFloor: () => {
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor);
    if (floor === state.preferences.hospitalityFloor) return;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: floor,
        hospitalityModeEnabled: state.preferences.hospitalityModeEnabled ?? true,
      },
    });
    flushPendingPersist();
  },

  openTable: ({ tableId, guestCount, customerName, customerPhone }) => {
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const table = floor.tables.find((t) => t.id === tableId);
    if (!table || !table.isActive) return { ok: false, errorKey: "invalid" };
    if (floor.sessions.some((s) => s.tableId === tableId && (s.status === "open" || s.status === "payment_pending"))) {
      return { ok: false, errorKey: "tableOccupied" };
    }
    const area = floor.areas.find((a) => a.id === table.areaId);
    const saleId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const actor = state.sessionActor;
    const referenceLabel = `${table.label}${area ? ` · ${area.name}` : ""}`;
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: [],
      cartDiscountUgx: 0,
      tableSessionId: sessionId,
      referenceLabel,
      soldByUserId: actor?.userId ?? null,
      waiterStaffId: actor?.userId ?? null,
      waiterName: actor?.displayName ?? null,
    });
    const nextFloor = openTableSessionOnFloor({
      floor,
      tableId,
      saleId,
      sessionId,
      guestCount: Math.max(1, guestCount),
      customerName,
      customerPhone,
      waiterStaffId: actor?.userId ?? null,
      waiterLabel: actor?.displayName ?? null,
    });
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      preferences: {
        ...state.preferences,
        hospitalityFloor: nextFloor,
        activeTableSessionId: sessionId,
      },
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
      activePendingSaleId: saleId,
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert" });
    queueHospitalityChange({ sessionIds: [sessionId] });
    flushPendingPersist();
    return { ok: true, sessionId };
  },

  openNamedTab: ({ tabLabel, guestCount, customerName, customerPhone }) => {
    const label = tabLabel.trim();
    if (!label) return { ok: false, errorKey: "invalid" };
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const normalized = label.toLowerCase();
    if (
      floor.sessions.some(
        (s) =>
          s.sessionKind === "named_tab" &&
          (s.status === "open" || s.status === "payment_pending") &&
          (s.tabLabel ?? "").trim().toLowerCase() === normalized,
      )
    ) {
      return { ok: false, errorKey: "tableOccupied" };
    }
    const saleId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const actor = state.sessionActor;
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: [],
      cartDiscountUgx: 0,
      tableSessionId: sessionId,
      referenceLabel: label,
      soldByUserId: actor?.userId ?? null,
      waiterStaffId: actor?.userId ?? null,
      waiterName: actor?.displayName ?? null,
    });
    const nextFloor = openNamedTabSessionOnFloor({
      floor,
      tabLabel: label,
      saleId,
      sessionId,
      guestCount: guestCount ?? 1,
      customerName,
      customerPhone,
      waiterStaffId: actor?.userId ?? null,
      waiterLabel: actor?.displayName ?? null,
    });
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      preferences: {
        ...state.preferences,
        hospitalityFloor: nextFloor,
        activeTableSessionId: sessionId,
      },
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
      activePendingSaleId: saleId,
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert" });
    queueHospitalityChange({ sessionIds: [sessionId] });
    flushPendingPersist();
    return { ok: true, sessionId };
  },

  resumeTableSession: async (sessionId) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const session = floor.sessions.find((s) => s.id === sessionId);
    if (!session || (session.status !== "open" && session.status !== "payment_pending")) {
      return { ok: false, errorKey: "invalid" };
    }
    if (getDeviceOnline() && hasSupabaseConfig) {
      const { refreshPendingSaleFromCloud } = await import("../offline/cloudSync");
      await refreshPendingSaleFromCloud(session.saleId);
    }
    const fresh = get();
    const sale = fresh.sales.find((s) => s.id === session.saleId);
    if (!sale) return { ok: false, errorKey: "missingProduct" };
    set({
      draftLines: sale.lines.map((l) => ({ ...ensureSaleLineId(l) })),
      draftCartDiscountUgx: 0,
      activePendingSaleId: sale.id,
      preferences: { ...fresh.preferences, activeTableSessionId: sessionId },
      draftInput: null,
    });
    return { ok: true };
  },

  saveTableBill: () => {
    const state = get();
    const saleId = state.activePendingSaleId;
    if (!saleId) return { ok: false, errorKey: "invalid" };
    const sessionId = state.preferences.activeTableSessionId;
    const existing = state.sales.find((s) => s.id === saleId);
    const baseUpdatedAt = existing?.updatedAt ?? null;
    const draftLines = state.draftLines.map((l) => ensureSaleLineId(l));
    const deletedLineIds = existing ? deletedLineIdsFromDraft(existing.lines, draftLines) : [];
    const floorForWaiter = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const tableWaiter = sessionWaiterAttribution(floorForWaiter, sessionId ?? existing?.tableSessionId);
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: draftLines,
      cartDiscountUgx: state.draftCartDiscountUgx,
      tableSessionId: sessionId ?? existing?.tableSessionId ?? null,
      referenceLabel: existing?.referenceLabel ?? null,
      soldByUserId: state.sessionActor?.userId ?? existing?.soldByUserId ?? null,
      waiterStaffId: existing?.waiterStaffId ?? tableWaiter.waiterStaffId,
      waiterName: existing?.waiterName ?? tableWaiter.waiterName,
      existing: existing ?? null,
    });
    const manualFire = state.preferences.hospitalityManualKitchenFire === true;
    const priorTicketIds = new Set((state.preferences.hospitalityFloor?.kitchenTickets ?? []).map((t) => t.id));
    let nextFloor = state.preferences.hospitalityFloor;
    if (nextFloor && sessionId && !manualFire) {
      const session = nextFloor.sessions.find((s) => s.id === sessionId);
      if (session) {
        const table = session.tableId ? nextFloor.tables.find((t) => t.id === session.tableId) : undefined;
        const area = table ? nextFloor.areas.find((a) => a.id === table.areaId) : undefined;
        const label = sessionDisplayLabel(session, nextFloor);
        nextFloor = fireKitchenTicketsForLines({
          floor: nextFloor,
          session,
          previousLines: existing?.lines ?? [],
          newLines: pendingSale.lines,
          products: state.products,
          tableLabel: label,
          areaName: area?.name ?? null,
        });
      }
    }
    if (nextFloor && sessionId) {
      const now = new Date().toISOString();
      nextFloor = {
        ...nextFloor,
        sessions: nextFloor.sessions.map((s) =>
          s.id === sessionId ? { ...s, updatedAt: now, pendingSync: true } : s,
        ),
      };
    }
    const newTicketIds = (nextFloor?.kitchenTickets ?? [])
      .filter((t) => !priorTicketIds.has(t.id))
      .map((t) => t.id);
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      draftLines: pendingSale.lines.map((l) => ({ ...l })),
      preferences: nextFloor ? { ...state.preferences, hospitalityFloor: nextFloor } : state.preferences,
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert", baseUpdatedAt, deletedLineIds });
    if (sessionId) queueHospitalityChange({ sessionIds: [sessionId], ticketIds: newTicketIds });
    flushPendingPersist();
    return { ok: true };
  },

  fireTableKitchenTickets: () => {
    const state = get();
    const saleId = state.activePendingSaleId;
    const sessionId = state.preferences.activeTableSessionId;
    if (!saleId || !sessionId) return { ok: false, errorKey: "invalid" };
    const existing = state.sales.find((s) => s.id === saleId);
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: state.draftLines,
      cartDiscountUgx: state.draftCartDiscountUgx,
      tableSessionId: sessionId,
      referenceLabel: existing?.referenceLabel ?? null,
      soldByUserId: state.sessionActor?.userId ?? existing?.soldByUserId ?? null,
      existing: existing ?? null,
    });
    let nextFloor = state.preferences.hospitalityFloor;
    if (!nextFloor) return { ok: false, errorKey: "invalid" };
    const session = nextFloor.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, errorKey: "invalid" };
    const priorTicketIds = new Set((nextFloor.kitchenTickets ?? []).map((t) => t.id));
    const table = session.tableId ? nextFloor.tables.find((t) => t.id === session.tableId) : undefined;
    const area = table ? nextFloor.areas.find((a) => a.id === table.areaId) : undefined;
    nextFloor = fireKitchenTicketsForLines({
      floor: nextFloor,
      session,
      previousLines: existing?.lines ?? [],
      newLines: pendingSale.lines,
      products: state.products,
      tableLabel: sessionDisplayLabel(session, nextFloor),
      areaName: area?.name ?? null,
    });
    const newTicketIds = (nextFloor.kitchenTickets ?? []).filter((t) => !priorTicketIds.has(t.id)).map((t) => t.id);
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      preferences: { ...state.preferences, hospitalityFloor: nextFloor },
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert" });
    queueHospitalityChange({ sessionIds: [sessionId], ticketIds: newTicketIds });
    flushPendingPersist();
    return { ok: true };
  },

  requestTableBill: (sessionId) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const sessions = floor.sessions.map((s) =>
      s.id === sessionId && s.status === "open" ? { ...s, status: "payment_pending" as const } : s,
    );
    const nextFloor = syncTableDisplayStatuses({ ...floor, sessions });
    set({ preferences: { ...state.preferences, hospitalityFloor: nextFloor } });
    queueHospitalityChange({ sessionIds: [sessionId] });
    flushPendingPersist();
  },

  clearActiveTableOrder: () => {
    set({
      activePendingSaleId: null,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
      preferences: { ...get().preferences, activeTableSessionId: null },
    });
    void clearPersistedDraft();
  },

  transferTableSession: (sessionId, toTableId) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const session = floor.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, errorKey: "invalid" };
    const { floor: nextFloor, saleReference } = transferSessionToTable(floor, sessionId, toTableId);
    if (!saleReference) return { ok: false, errorKey: "tableOccupied" };
    const existingSale = state.sales.find((s) => s.id === session.saleId);
    const baseUpdatedAt = existingSale?.updatedAt ?? null;
    const sales = state.sales.map((s) =>
      s.id === session.saleId ? { ...s, referenceLabel: saleReference, updatedAt: new Date().toISOString(), pendingSync: true } : s,
    );
    set({ preferences: { ...state.preferences, hospitalityFloor: nextFloor }, sales });
    void queueRemote("pending_sales", {
      saleId: session.saleId,
      kind: "pending_upsert",
      baseUpdatedAt,
    });
    queueHospitalityChange({ sessionIds: [sessionId] });
    flushPendingPersist();
    return { ok: true };
  },

  mergeTableSessions: (sourceSessionId, targetSessionId) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const source = floor.sessions.find((s) => s.id === sourceSessionId);
    const target = floor.sessions.find((s) => s.id === targetSessionId);
    if (!source || !target) return { ok: false, errorKey: "invalid" };
    const sourceSale = state.sales.find((s) => s.id === source.saleId);
    const targetSale = state.sales.find((s) => s.id === target.saleId);
    if (!sourceSale || !targetSale) return { ok: false, errorKey: "missingProduct" };
    const mergedLines = mergeSaleLines(targetSale.lines, sourceSale.lines);
    const updatedTarget = buildPendingSaleFromDraft({
      saleId: targetSale.id,
      lines: mergedLines,
      cartDiscountUgx: 0,
      tableSessionId: target.id,
      referenceLabel: targetSale.referenceLabel,
      soldByUserId: targetSale.soldByUserId ?? null,
      existing: targetSale,
    });
    const cancelledSource: Sale = { ...sourceSale, status: "cancelled", updatedAt: new Date().toISOString(), pendingSync: true };
    const nextFloor = mergeSessionsOnFloor(floor, sourceSessionId, targetSessionId);
    set({
      sales: [updatedTarget, cancelledSource, ...state.sales.filter((s) => s.id !== targetSale.id && s.id !== sourceSale.id)],
      preferences: { ...state.preferences, hospitalityFloor: nextFloor, activeTableSessionId: targetSessionId },
      draftLines: mergedLines.map((l) => ({ ...ensureSaleLineId(l) })),
      activePendingSaleId: targetSale.id,
    });
    void queueRemote("pending_sales", {
      saleId: targetSale.id,
      kind: "pending_upsert",
      baseUpdatedAt: targetSale.updatedAt ?? null,
    });
    void queueRemote("pending_sales", { saleId: sourceSale.id, kind: "pending_cancel" });
    queueHospitalityChange({ sessionIds: [sourceSessionId, targetSessionId] });
    flushPendingPersist();
    return { ok: true };
  },

  updateKitchenTicketStatus: (ticketId, status) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: updateKitchenTicketStatus(floor, ticketId, status),
      },
    });
    queueHospitalityChange({ ticketIds: [ticketId] });
    flushPendingPersist();
  },

  cancelKitchenTicket: (ticketId) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: cancelKitchenTicket(floor, ticketId),
      },
    });
    queueHospitalityChange({ ticketIds: [ticketId] });
    flushPendingPersist();
  },

  cleanupKitchenTickets: () => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: pruneServedKitchenTickets(floor),
      },
    });
    flushPendingPersist();
  },

  setHospitalityManualKitchenFire: (enabled) => {
    set((s) => ({
      preferences: { ...s.preferences, hospitalityManualKitchenFire: enabled },
    }));
    flushPendingPersist();
  },

  addDiningArea: (name) => {
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const next = addDiningArea(floor, name);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  renameDiningArea: (areaId, name) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const next = renameDiningArea(floor, areaId, name);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  removeDiningArea: (areaId) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const next = removeDiningArea(floor, areaId);
    if (next.tables.length === floor.tables.length && next.areas.length === floor.areas.length) {
      return { ok: false, errorKey: "tableOccupied" };
    }
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
    return { ok: true };
  },

  addDiningTable: (input) => {
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const next = addDiningTable(floor, input);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  updateDiningTable: (tableId, patch) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const next = updateDiningTable(floor, tableId, patch);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  removeDiningTable: (tableId) => {
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const next = removeDiningTable(floor, tableId);
    if (next.tables.length === floor.tables.length) return { ok: false, errorKey: "tableOccupied" };
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
    return { ok: true };
  },

  savePendingSale: (referenceLabel) => {
    const state = get();
    if (!state.draftLines.length) return { ok: false, errorKey: "emptySale" };
    const saleId = state.activePendingSaleId ?? crypto.randomUUID();
    const existing = state.sales.find((s) => s.id === saleId);
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: state.draftLines,
      cartDiscountUgx: state.draftCartDiscountUgx,
      referenceLabel: referenceLabel?.trim() || existing?.referenceLabel || null,
      soldByUserId: state.sessionActor?.userId ?? existing?.soldByUserId ?? null,
      existing: existing ?? null,
    });
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      activePendingSaleId: saleId,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
    });
    void clearPersistedDraft();
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert" });
    flushPendingPersist();
    return { ok: true, saleId };
  },

  resumePendingSale: (saleId) => {
    const state = get();
    if (state.draftLines.length && !state.activePendingSaleId) {
      return { ok: false, errorKey: "invalid" };
    }
    const sale = state.sales.find((s) => s.id === saleId && s.status === "pending");
    if (!sale) return { ok: false, errorKey: "invalid" };
    set({
      draftLines: sale.lines.map((l) => ({ ...l })),
      draftCartDiscountUgx: 0,
      activePendingSaleId: sale.id,
      draftInput: null,
      preferences: {
        ...state.preferences,
        activeTableSessionId: sale.tableSessionId ?? null,
      },
    });
    return { ok: true };
  },

  cancelPendingSale: (saleId) => {
    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    if (!hasPermission(actor.role, "sale_void")) return { ok: false, errorKey: "forbidden" };
    const sale = state.sales.find((s) => s.id === saleId && s.status === "pending");
    if (!sale) return { ok: false, errorKey: "invalid" };
    const cancelled: Sale = { ...sale, status: "cancelled", updatedAt: new Date().toISOString(), pendingSync: true };
    let nextPrefs = state.preferences;
    if (sale.tableSessionId && nextPrefs.hospitalityFloor) {
      nextPrefs = {
        ...nextPrefs,
        hospitalityFloor: closeTableSession(nextPrefs.hospitalityFloor, sale.tableSessionId, "cancelled"),
        activeTableSessionId:
          nextPrefs.activeTableSessionId === sale.tableSessionId ? null : nextPrefs.activeTableSessionId,
      };
    }
    set({
      sales: [cancelled, ...state.sales.filter((s) => s.id !== saleId)],
      preferences: nextPrefs,
      ...(state.activePendingSaleId === saleId
        ? { activePendingSaleId: null, draftLines: [], draftInput: null, draftCartDiscountUgx: 0 }
        : {}),
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_cancel" });
    flushPendingPersist();
    return { ok: true };
  },

  finalizeDraftSale: ({
    debtUgx,
    customerId: inputCustomerId,
    customerName,
    customerPhone,
    paymentMethod,
    amountPaidUgx,
    changeGivenUgx,
    splitBreakdown,
  }) => {
    const denied = denyUnlessPerm("pos.sell", "finalizeDraftSale");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    if (!state.draftLines.length) return { ok: false, errorKey: "emptySale" };

    if (
      isPharmacyMode(state.preferences.businessType, state.preferences.pharmacyModeEnabled) &&
      shouldBlockExpiredSale(state.preferences.pharmacyExpiredSaleBehavior)
    ) {
      for (const line of state.draftLines) {
        const p = state.products.find((x) => x.id === line.productId);
        if (p && isProductExpired(p)) return { ok: false, errorKey: "pharmacyExpiredSaleBlocked" };
      }
    }

    const isFirstSale = state.sales.length === 0;

    const saleLines = state.draftLines.map((line) => normalizeSaleLine(line));
    const listSubtotal = saleLines.reduce((a, l) => a + (l.originalLineTotalUgx ?? l.lineTotalUgx), 0);
    const lineSubtotal = saleLines.reduce((a, l) => a + l.lineTotalUgx, 0);
    const cartDiscount = Math.min(Math.max(0, Math.floor(state.draftCartDiscountUgx)), lineSubtotal);
    const actorRole = state.sessionActor?.role ?? "cashier";
    const discountPolicy = validateDraftDiscount({
      prefs: state.preferences,
      role: actorRole,
      discountUgx: cartDiscount,
      lineSubtotalUgx: lineSubtotal,
    });
    if (!discountPolicy.ok) return { ok: false, errorKey: discountPolicy.errorKey };

    const total = Math.max(0, lineSubtotal - cartDiscount);
    const discountTotal = Math.max(0, listSubtotal - total);
    const debt = Math.min(Math.max(0, Math.floor(debtUgx)), total);
    const cashPaidUgx = total - debt;

    let customers = state.customers;
    let customerId: string | null = inputCustomerId?.trim() || null;
    let createdDebtor: Customer | undefined;
    if (debt > 0) {
      const debtor = resolveDebtorForSale(customers, {
        customerId,
        customerName,
        customerPhone,
      });
      if (!debtor.ok) return { ok: false, errorKey: debtor.errorKey };
      customers = debtor.customers;
      customerId = debtor.customerId;
      createdDebtor = debtor.createdCustomer;
    }

    const products = [...state.products];
    for (const line of state.draftLines) {
      const idx = products.findIndex((p) => p.id === line.productId);
      if (idx === -1) return { ok: false, errorKey: "missingProduct" };
      const p = products[idx];
      const next = p.stockOnHand - line.quantity;
      if (next < -0.0001) return { ok: false, errorKey: "noStock" };
      products[idx] = {
        ...p,
        stockOnHand: Math.max(0, next),
        updatedAt: new Date().toISOString(),
        version: p.version + 1,
      };
    }

    const estimatedProfitUgx = saleLines.reduce((sum, line) => {
      const p = products.find((x) => x.id === line.productId)!;
      return sum + estimatedProfitForLine(p, line);
    }, 0);

    const actorId = state.sessionActor?.userId ?? null;
    const actor = state.sessionActor;
    const todayKey = dateKeyKampala(new Date());
    const receiptSeq = scanTodaySalesHead(state.sales, todayKey).nextReceiptSeq;
    const pendingId = state.activePendingSaleId;
    const existingPending = pendingId ? state.sales.find((s) => s.id === pendingId && s.status === "pending") : null;
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const sessionWaiter = sessionWaiterAttribution(floor, existingPending?.tableSessionId);
    const sale: Sale = {
      id: existingPending?.id ?? crypto.randomUUID(),
      status: "completed",
      referenceLabel: existingPending?.referenceLabel ?? null,
      tableSessionId: existingPending?.tableSessionId ?? null,
      updatedAt: new Date().toISOString(),
      receiptSeq,
      lines: saleLines,
      subtotalUgx: listSubtotal,
      totalUgx: total,
      cashPaidUgx,
      debtUgx: debt,
      discountTotalUgx: discountTotal,
      voidedTotalUgx: 0,
      estimatedProfitUgx,
      createdAt: existingPending?.createdAt ?? new Date().toISOString(),
      pendingSync: true,
      lastSyncError: null,
      customerId: customerId ?? null,
      soldByUserId: actorId,
      waiterStaffId:
        existingPending?.waiterStaffId ?? sessionWaiter.waiterStaffId ?? null,
      waiterName: existingPending?.waiterName ?? sessionWaiter.waiterName ?? null,
      splitBreakdown: splitBreakdown ?? null,
      paymentMethod: paymentMethod ?? (debt > 0 ? (cashPaidUgx > 0 ? "mixed" : "credit") : "cash"),
      amountPaidUgx: Number.isFinite(amountPaidUgx) ? Math.max(0, Math.floor(amountPaidUgx ?? 0)) : cashPaidUgx,
      changeGivenUgx: Number.isFinite(changeGivenUgx) ? Math.max(0, Math.floor(changeGivenUgx ?? 0)) : 0,
    };

    if (customerId && debt > 0) {
      customers = customers.map((c) =>
        c.id === customerId
          ? { ...c, debtBalanceUgx: c.debtBalanceUgx + debt, version: c.version + 1 }
          : c,
      );
    }

    const shopKey = getActiveAccountKey() ?? "local";
    const saleMovements: StockMovement[] = saleStockMovementsFromSale(shopKey, {
      id: sale.id,
      createdAt: sale.createdAt,
      lines: saleLines,
    });

    const auditEntries: AuditLogEntry[] = [];
    const buildAudit = (action: AuditAction, payloadSummary: string, payload: Record<string, unknown>): AuditLogEntry => ({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      deviceId: getOrCreateDeviceId(),
      actorUserId: actor?.userId ?? "unknown",
      actorName: actor?.displayName,
      role: actor?.role ?? "cashier",
      action,
      payloadSummary,
      payload,
    });
    auditEntries.push(
      buildAudit("sale_completed", `Sale UGX ${total.toLocaleString()}`, {
        saleId: sale.id,
        totalUgx: total,
        debtUgx: debt,
        customerId: customerId ?? null,
        soldByUserId: actorId,
        lineCount: sale.lines.length,
        firstLineName: sale.lines[0]?.name ?? null,
      }),
    );
    if (createdDebtor) {
      auditEntries.push(
        buildAudit("customer_add", createdDebtor.name, {
          customerId: createdDebtor.id,
          name: createdDebtor.name,
          source: "debt_sale",
        }),
      );
    }
    if (discountTotal > 0) {
      auditEntries.push(
        buildAudit("discount_given", `Discount UGX ${discountTotal.toLocaleString()}`, {
          saleId: sale.id,
          discountUgx: discountTotal,
          soldByUserId: actorId,
        }),
      );
    }

    let nextPreferences = state.preferences;
    const closedSessionId = existingPending?.tableSessionId ?? null;
    if (closedSessionId && nextPreferences.hospitalityFloor) {
      nextPreferences = {
        ...nextPreferences,
        hospitalityFloor: closeTableSession(nextPreferences.hospitalityFloor, closedSessionId),
        activeTableSessionId: null,
      };
    }
    if (actor) {
      nextPreferences = {
        ...nextPreferences,
        shifts: (nextPreferences.shifts ?? []).map((sh) =>
          !sh.endAt && sh.actorUserId === actor.userId
            ? {
                ...sh,
                salesTotalUgx: sh.salesTotalUgx + total,
                debtTotalUgx: sh.debtTotalUgx + debt,
                estimatedCashUgx: sh.estimatedCashUgx + cashPaidUgx,
                discountsTotalUgx: (sh.discountsTotalUgx ?? 0) + discountTotal,
              }
            : sh,
        ),
      };
    }

    set({
      products,
      sales: [sale, ...state.sales.filter((s) => s.id !== sale.id)],
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      customers,
      stockMovements: mergeStockMovements(saleMovements, state.stockMovements),
      preferences: nextPreferences,
      auditLogs: mergeAuditLogs(state.auditLogs, auditEntries),
    });

    void queueRemote("pending_sales", { saleId: sale.id });
    if (closedSessionId) queueHospitalityChange({ sessionIds: [closedSessionId] });
    for (const entry of auditEntries) {
      void queueRemote("audit_log", { entry });
    }
    void clearPersistedDraft();
    void import("../offline/entityStore").then(({ putEntity, putEntitiesBatch }) => {
      void putEntity("sale", sale.id, sale, sale.createdAt);
      const stockChanged = products.filter((p) => {
        const old = state.products.find((x) => x.id === p.id);
        return old != null && old.stockOnHand !== p.stockOnHand;
      });
      if (stockChanged.length > 0) {
        void putEntitiesBatch(
          "product",
          stockChanged.map((p) => ({ id: p.id, data: p, sortKey: p.updatedAt })),
        );
      }
      if (createdDebtor) {
        void putEntity("customer", createdDebtor.id, customers.find((x) => x.id === createdDebtor!.id) ?? createdDebtor, createdDebtor.createdAt);
        void queueRemote("customer", { id: createdDebtor.id });
      }
      if (customerId && debt > 0 && !createdDebtor) {
        const c = customers.find((x) => x.id === customerId);
        if (c) void putEntity("customer", c.id, c, c.createdAt);
        void queueRemote("customer", { id: customerId });
      }
    });
    flushPendingPersist();
    return { ok: true, firstSale: isFirstSale, saleId: sale.id };
  },

  voidSaleLine: ({ saleId, lineIndex, reason, note }) => {
    const denied = denyUnlessPerm("sale_void", "voidSaleLine");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const saleIdx = state.sales.findIndex((s) => s.id === saleId);
    if (saleIdx === -1) return { ok: false, errorKey: "missingProduct" };
    const sale = state.sales[saleIdx]!;
    const line = sale.lines[lineIndex];
    if (!line || line.voided) return { ok: false, errorKey: "invalid" };

    const amount = line.lineTotalUgx;
    const cashReduce = Math.min(amount, sale.cashPaidUgx);
    const debtReduce = creditDebtReductionFromSaleAdjustment(sale, amount);
    const openShift = (state.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    const at = new Date().toISOString();

    const voidRec: VoidRecord = {
      id: crypto.randomUUID(),
      saleId,
      lineIndex,
      productId: line.productId,
      productName: line.name,
      quantity: line.quantity,
      amountUgx: amount,
      reason,
      note: note?.trim() || undefined,
      actorUserId: actor.userId,
      actorName: actor.displayName,
      shiftId: openShift?.id ?? null,
      createdAt: at,
    };

    const totals = reduceSaleTotalsByAmount(sale, amount);
    const updatedLines = sale.lines.map((l, i) => (i === lineIndex ? { ...l, voided: true, voidedAt: at } : l));
    const updatedSale: Sale = {
      ...sale,
      ...totals,
      lines: updatedLines,
      estimatedProfitUgx: Math.max(0, sale.estimatedProfitUgx - line.estimatedProfitUgx),
      pendingSync: true,
    };

    const products = [...state.products];
    const pIdx = products.findIndex((p) => p.id === line.productId);
    const preVoidProduct = pIdx >= 0 ? products[pIdx]! : null;
    if (pIdx >= 0) {
      const p = products[pIdx]!;
      products[pIdx] = {
        ...p,
        stockOnHand: p.stockOnHand + line.quantity,
        updatedAt: at,
        version: p.version + 1,
      };
    }

    const movement: StockMovement = {
      id: crypto.randomUUID(),
      at,
      productId: line.productId,
      productName: line.name,
      deltaBaseUnits: line.quantity,
      kind: "adjust_other",
      summary: `Void +${line.quantity}`,
      refId: voidRec.id,
      supplierId: null,
    };

    const sales = [...state.sales];
    sales[saleIdx] = updatedSale;
    const customers = applyCustomerDebtDelta(state.customers, sale.customerId, -debtReduce);

    set({
      sales,
      products,
      customers,
      voidRecords: [voidRec, ...state.voidRecords],
      stockMovements: mergeStockMovements([movement], state.stockMovements),
    });

    if (openShift) {
      set((st) => ({
        preferences: {
          ...st.preferences,
          shifts: (st.preferences.shifts ?? []).map((sh) =>
            sh.id === openShift.id
              ? {
                  ...sh,
                  estimatedCashUgx: Math.max(0, sh.estimatedCashUgx - cashReduce),
                  voidsTotalUgx: (sh.voidsTotalUgx ?? 0) + amount,
                  refundsUgx: sh.refundsUgx + amount,
                }
              : sh,
          ),
        },
      }));
    }

    pushAudit("sale_void", `Void ${line.name} UGX ${amount.toLocaleString()}`, {
      voidId: voidRec.id,
      saleId,
      productName: line.name,
      amountUgx: amount,
      reason,
      note: note ?? null,
      actorUserId: actor.userId,
    });
    void queueRemote("pending_stock_updates", {
      productId: line.productId,
      delta: line.quantity,
      note: "void",
      baseUpdatedAt: preVoidProduct?.updatedAt ?? at,
      baseStockOnHand: preVoidProduct?.stockOnHand,
    });
    void queueRemote("sale", { saleId });
    if (sale.customerId && debtReduce > 0) {
      void queueRemote("customer", { id: sale.customerId });
    }
    return { ok: true };
  },

  returnProduct: ({ saleId, productId, quantity, refundAmountUgx, reason, note }) => {
    const denied = denyUnlessPerm("sale_void", "returnProduct");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const qty = Math.max(0, Number(quantity) || 0);
    const refund = Math.max(0, Math.floor(refundAmountUgx));
    if (qty <= 0 || refund <= 0) return { ok: false, errorKey: "invalid" };

    const saleIdxPrecheck = saleId ? state.sales.findIndex((s) => s.id === saleId) : -1;
    const auth = validateReturnAuthorization({
      role: actor.role,
      saleId: saleId ?? null,
      saleFound: saleIdxPrecheck >= 0,
      note: note ?? "",
    });
    if (!auth.ok) return { ok: false, errorKey: auth.errorKey };

    const product = state.products.find((p) => p.id === productId);
    if (!product) return { ok: false, errorKey: "missingProduct" };

    const openShift = (state.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    const at = new Date().toISOString();

    const returnRec: ReturnRecord = {
      id: crypto.randomUUID(),
      saleId: saleId ?? null,
      productId,
      productName: product.name,
      quantity: qty,
      refundAmountUgx: refund,
      reason,
      note: note?.trim() || undefined,
      actorUserId: actor.userId,
      actorName: actor.displayName,
      shiftId: openShift?.id ?? null,
      createdAt: at,
    };

    const products = state.products.map((p) =>
      p.id === productId
        ? { ...p, stockOnHand: p.stockOnHand + qty, updatedAt: at, version: p.version + 1 }
        : p,
    );

    const movement: StockMovement = {
      id: crypto.randomUUID(),
      at,
      productId,
      productName: product.name,
      deltaBaseUnits: qty,
      kind: "adjust_other",
      summary: `Return +${qty}`,
      refId: returnRec.id,
      supplierId: null,
    };

    let sales = state.sales;
    let customers = state.customers;
    let debtReduce = 0;
    let linkedCustomerId: string | null = null;
    if (saleId) {
      const saleIdx = sales.findIndex((s) => s.id === saleId);
      if (saleIdx >= 0) {
        const sale = sales[saleIdx]!;
        const limit = validateReturnAgainstSale({
          sale,
          productId,
          quantity: qty,
          refundAmountUgx: refund,
          returnRecords: state.returnRecords,
        });
        if (!limit.ok) return { ok: false, errorKey: limit.errorKey };
        linkedCustomerId = sale.customerId ?? null;
        debtReduce = creditDebtReductionFromSaleAdjustment(sale, refund);
        const totals = reduceSaleTotalsByAmount(sale, refund);
        const updated: Sale = { ...sale, ...totals, pendingSync: true };
        customers = applyCustomerDebtDelta(customers, sale.customerId, -debtReduce);
        sales = [...sales];
        sales[saleIdx] = updated;
      }
    }

    set({
      products,
      sales,
      customers,
      returnRecords: [returnRec, ...state.returnRecords],
      stockMovements: mergeStockMovements([movement], state.stockMovements),
    });

    if (openShift) {
      set((st) => ({
        preferences: {
          ...st.preferences,
          shifts: (st.preferences.shifts ?? []).map((sh) =>
            sh.id === openShift.id
              ? {
                  ...sh,
                  estimatedCashUgx: Math.max(0, sh.estimatedCashUgx - refund),
                  returnsTotalUgx: (sh.returnsTotalUgx ?? 0) + refund,
                  refundsUgx: sh.refundsUgx + refund,
                }
              : sh,
          ),
        },
      }));
    }

    pushAudit("sale_return", `Return ${product.name} UGX ${refund.toLocaleString()}`, {
      returnId: returnRec.id,
      saleId: saleId ?? null,
      productName: product.name,
      quantity: qty,
      refundUgx: refund,
      reason,
      note: note ?? null,
      actorUserId: actor.userId,
    });
    void queueRemote("pending_returns", {
      returnId: returnRec.id,
      saleId: saleId ?? null,
      productId,
      quantity: qty,
      refundAmountUgx: refund,
    });
    if (linkedCustomerId && debtReduce > 0) {
      void queueRemote("customer", { id: linkedCustomerId });
    }
    return { ok: true, returnRecord: returnRec };
  },

  closeShiftWithCashCount: (countedCashUgx) => {
    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const open = (state.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    if (!open) return { ok: false, errorKey: "invalid" };
    const expected = shiftExpectedCash(open);
    const counted = Math.max(0, Math.floor(countedCashUgx));
    const differenceUgx = counted - expected;
    const endAt = new Date().toISOString();

    set((st) => ({
      preferences: {
        ...st.preferences,
        shifts: (st.preferences.shifts ?? []).map((sh) =>
          sh.id === open.id
            ? {
                ...sh,
                endAt,
                countedCashUgx: counted,
                cashDifferenceUgx: differenceUgx,
              }
            : sh,
        ),
      },
    }));

    pushAudit("shift_close_count", `Shift close · expected UGX ${expected.toLocaleString()} · counted UGX ${counted.toLocaleString()}`, {
      shiftId: open.id,
      expectedCashUgx: expected,
      countedCashUgx: counted,
      differenceUgx,
      actorUserId: actor.userId,
    });
    return { ok: true, differenceUgx };
  },

  quickAddProduct: (input) => {
    const denied = denyUnlessPerm("products.add", "quickAddProduct");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const trimmed = input.name.trim();
    if (!trimmed) return { ok: false, errorKey: "invalid" };
    const hint = (input.inferName ?? trimmed).trim();
    const prefs = get().preferences;
    const guess = inferProductGuess(hint, prefs.businessType, prefs.pharmacyModeEnabled);
    const sellingMode = input.sellingMode ?? guess.sellingMode;
    const baseUnit = (input.baseUnit ?? guess.baseUnit).trim() || "ea";
    const buyingUnit = input.buyingUnit !== undefined ? input.buyingUnit : guess.buyingUnit;
    const conversionRate = input.conversionRate !== undefined ? input.conversionRate : guess.conversionRate;
    const price = Math.max(0, Math.floor(input.priceUgx));
    if (price <= 0) return { ok: false, errorKey: "invalid" };
    const stock = Math.max(0, Number(input.stockQty) || 0);
    const pharmacyRequiresBuy = pharmacyQuickAddRequiresBuyPrice(prefs.businessType, prefs.pharmacyModeEnabled);
    if (pharmacyRequiresBuy && stock <= 0) return { ok: false, errorKey: "pharmacyOpeningStockRequired" };
    const costExplicit =
      input.costPricePerUnitUgx !== undefined && input.costPricePerUnitUgx !== null
        ? Math.max(0, Math.floor(Number(input.costPricePerUnitUgx)))
        : null;
    if (pharmacyRequiresBuy) {
      if (costExplicit === null || costExplicit <= 0) return { ok: false, errorKey: "pharmacyBuyPriceRequired" };
    }
    const cost =
      costExplicit !== null ? costExplicit : Math.min(price, Math.max(0, Math.floor(price * 0.72)));
    const minAlert =
      input.minimumStockAlert !== undefined
        ? Math.max(0, Math.floor(input.minimumStockAlert))
        : sellingMode === "portion"
          ? 1
          : sellingMode === "weighted"
            ? 3
            : 5;
    const presetMoney = input.quickPresetsMoneyUgx?.filter((x) => x > 0);
    const presetQty = input.quickPresetsQty?.filter((x) => x > 0);
    const sameShape =
      sellingMode === guess.sellingMode &&
      baseUnit === guess.baseUnit &&
      !presetMoney?.length &&
      !presetQty?.length;
    get().addProduct({
      name: trimmed,
      sellingMode,
      baseUnit,
      buyingUnit,
      conversionRate,
      sellingPricePerUnitUgx: price,
      costPricePerUnitUgx: cost,
      stockOnHand: stock,
      minimumStockAlert: minAlert,
      category: input.category,
      sku: `SKU-${Date.now()}`,
      medicineStrength: normalizeMedicineStrength(input.medicineStrength ?? null),
      medicineForm: normalizeMedicineForm(input.medicineForm ?? null),
      expiryDate: normalizeExpiryDate(input.expiryDate ?? null),
      pharmacyPackaging: input.pharmacyPackaging ?? null,
      quickPresetsMoneyUgx: presetMoney?.length ? presetMoney : sameShape ? guess.quickPresetsMoneyUgx : undefined,
      quickPresetsQty: presetQty?.length ? presetQty : sameShape ? guess.quickPresetsQty : undefined,
    });
    return { ok: true };
  },

  bulkQuickAddProducts: (rows) => {
    let added = 0;
    let skipped = 0;
    const cat = rows[0]?.category ?? "General";
    for (const row of rows) {
      const r = get().quickAddProduct({
        name: row.name,
        priceUgx: row.priceUgx,
        stockQty: row.stockQty,
        category: row.category || cat,
        inferName: row.inferName,
        sellingMode: row.sellingMode,
        baseUnit: row.baseUnit,
        medicineStrength: row.medicineStrength ?? null,
        medicineForm: row.medicineForm ?? null,
      });
      if (r.ok) added += 1;
      else skipped += 1;
    }
    return { added, skipped };
  },

  duplicateProduct: (productId, nameSuffix) => {
    const denied = denyUnlessPerm("products.add", "duplicateProduct");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const p = get().products.find((x) => x.id === productId);
    if (!p) return { ok: false, errorKey: "missingProduct" };
    get().addProduct({
      name: `${p.name}${nameSuffix}`,
      sellingMode: p.sellingMode,
      baseUnit: p.baseUnit,
      buyingUnit: p.buyingUnit,
      conversionRate: p.conversionRate,
      sellingPricePerUnitUgx: p.sellingPricePerUnitUgx,
      costPricePerUnitUgx: p.costPricePerUnitUgx,
      stockOnHand: p.stockOnHand,
      minimumStockAlert: p.minimumStockAlert,
      category: p.category,
      sku: `SKU-${Date.now()}`,
      quickPresetsMoneyUgx: p.quickPresetsMoneyUgx,
      quickPresetsQty: p.quickPresetsQty,
      expiryDate: p.expiryDate ?? null,
      medicineStrength: p.medicineStrength ?? null,
      medicineForm: p.medicineForm ?? null,
    });
    return { ok: true };
  },

  removeProduct: (productId) => {
    const denied = denyUnlessPerm("products.remove", "removeProduct");
    if (denied) return;

    const p = get().products.find((x) => x.id === productId);
    set((s) => ({ products: s.products.filter((x) => x.id !== productId) }));
    void import("../offline/incrementalPersist").then((m) => m.markProductDeleted(productId));
    void queueRemote("product", { id: productId, deleted: true });
    pushAudit("product_remove", p?.name ?? productId, { productId, name: p?.name });
  },

  addProduct: (p) => {
    const denied = denyUnlessPerm("products.add", "addProduct");
    if (denied) return;

    const now = new Date().toISOString();
    const qp = defaultQuickPresetsForProduct(p);
    const row: Product = {
      ...p,
      id: crypto.randomUUID(),
      updatedAt: now,
      version: 1,
      quickPresetsMoneyUgx: p.quickPresetsMoneyUgx ?? qp.quickPresetsMoneyUgx,
      quickPresetsQty: p.quickPresetsQty ?? qp.quickPresetsQty,
    };
    set((s) => ({ products: [normalizeProduct(row), ...s.products] }));
    void queueRemote("product", { id: row.id, isNew: true });
    pushAudit("product_add", row.name, { productId: row.id, name: row.name, category: row.category });
  },

  updateProductQuickPresets: (productId, presets) => {
    const denied = denyUnlessPerm("products.edit_presets", "updateProductQuickPresets");
    if (denied) return;

    set((s) => ({
      products: s.products.map((p) =>
        p.id === productId
          ? {
              ...p,
              quickPresetsMoneyUgx: presets.quickPresetsMoneyUgx ?? p.quickPresetsMoneyUgx,
              quickPresetsQty: presets.quickPresetsQty ?? p.quickPresetsQty,
              updatedAt: new Date().toISOString(),
              version: p.version + 1,
            }
          : p,
      ),
    }));
    void queueRemote("product", { id: productId, presets: true, catalogOnly: true });
    const pn = get().products.find((x) => x.id === productId)?.name ?? productId;
    pushAudit("product_presets", `Presets ${pn}`, { productId });
  },

  updateProduct: (productId, patch) => {
    const denied = denyUnlessPerm("stock.adjust", "updateProduct");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const prev = get().products.find((p) => p.id === productId);
    if (!prev) return { ok: false, errorKey: "missingProduct" };

    const merged: Product = { ...prev };

    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (!n) return { ok: false, errorKey: "invalid" };
      merged.name = n;
    }
    if (patch.sellingMode !== undefined) merged.sellingMode = patch.sellingMode;
    if (patch.baseUnit !== undefined) {
      const u = patch.baseUnit.trim();
      if (!u) return { ok: false, errorKey: "invalid" };
      merged.baseUnit = u;
    }
    if (patch.buyingUnit !== undefined) {
      const b = patch.buyingUnit;
      merged.buyingUnit = b === null || b === "" ? null : String(b).trim() || null;
    }
    if (patch.conversionRate !== undefined) {
      if (patch.conversionRate === null || patch.conversionRate <= 0 || Number.isNaN(patch.conversionRate)) {
        merged.conversionRate = null;
      } else {
        merged.conversionRate = patch.conversionRate;
      }
    }
    if (patch.sellingPricePerUnitUgx !== undefined) {
      const v = Math.max(0, Math.floor(Number(patch.sellingPricePerUnitUgx)));
      if (v <= 0) return { ok: false, errorKey: "invalid" };
      merged.sellingPricePerUnitUgx = v;
    }
    if (patch.costPricePerUnitUgx !== undefined) {
      merged.costPricePerUnitUgx = Math.max(0, Math.floor(Number(patch.costPricePerUnitUgx)));
    }
    if (patch.stockOnHand !== undefined) {
      merged.stockOnHand = Math.max(0, Number(patch.stockOnHand) || 0);
    }
    if (patch.minimumStockAlert !== undefined) {
      merged.minimumStockAlert = Math.max(0, Math.floor(Number(patch.minimumStockAlert)));
    }
    if (patch.category !== undefined) {
      merged.category = String(patch.category ?? "").trim();
    }
    if (patch.sku !== undefined) {
      const sk = String(patch.sku ?? "").trim();
      merged.sku = sk.length > 0 ? sk : prev.sku;
    }
    if (patch.expiryDate !== undefined) {
      merged.expiryDate = normalizeExpiryDate(patch.expiryDate ?? null);
    }
    if (patch.medicineStrength !== undefined) {
      merged.medicineStrength = normalizeMedicineStrength(patch.medicineStrength ?? null);
    }
    if (patch.medicineForm !== undefined) {
      merged.medicineForm = normalizeMedicineForm(patch.medicineForm ?? null);
    }
    if (patch.quickPresetsMoneyUgx !== undefined) {
      merged.quickPresetsMoneyUgx = patch.quickPresetsMoneyUgx;
    }
    if (patch.quickPresetsQty !== undefined) {
      merged.quickPresetsQty = patch.quickPresetsQty;
    }
    if (patch.pharmacyPackaging !== undefined) {
      merged.pharmacyPackaging = patch.pharmacyPackaging;
      if (patch.pharmacyPackaging?.enabled) {
        const bu = buyingUnitFromPackaging(patch.pharmacyPackaging);
        merged.baseUnit = patch.pharmacyPackaging.baseUnit || merged.baseUnit;
        merged.buyingUnit = bu.buyingUnit;
        merged.conversionRate = bu.conversionRate;
      }
    }

    const prevStock = prev.stockOnHand;
    const nextStock = merged.stockOnHand;
    const stockDelta = nextStock - prevStock;

    const at = new Date().toISOString();
    const movement: StockMovement | null =
      Math.abs(stockDelta) > 1e-6
        ? {
            id: crypto.randomUUID(),
            at,
            productId,
            productName: merged.name,
            deltaBaseUnits: stockDelta,
            kind: "adjust_count",
            summary: `Count → ${nextStock}`,
            supplierId: null,
          }
        : null;

    const normalized = normalizeProduct({
      ...merged,
      version: prev.version + 1,
      updatedAt: at,
    });

    set((s) => ({
      products: s.products.map((p) => (p.id === productId ? normalized : p)),
      stockMovements: movement ? mergeStockMovements([movement], s.stockMovements) : s.stockMovements,
    }));

    if (Math.abs(stockDelta) > 1e-6) {
      void queueRemote("pending_stock_updates", {
        productId,
        delta: stockDelta,
        note: "count",
        baseUpdatedAt: prev.updatedAt,
        baseStockOnHand: prevStock,
      });
    }
    void queueRemote("product", { id: productId, catalogOnly: true });
    pushAudit("product_update", merged.name, { productId, name: merged.name });
    return { ok: true };
  },

  adjustStock: (productId, delta, reason) => {
    const denied = denyUnlessPerm("stock.adjust", "adjustStock");
    if (denied) return;

    const prev = get().products.find((p) => p.id === productId);
    const at = new Date().toISOString();
    const kind = stockKindFromAdjustReason(reason);
    const movement: StockMovement = {
      id: crypto.randomUUID(),
      at,
      productId,
      productName: prev?.name ?? productId,
      deltaBaseUnits: delta,
      kind,
      summary: `${reason ?? "adjust"} ${delta >= 0 ? "+" : ""}${delta}`,
      supplierId: null,
    };
    set((s) => ({
      products: s.products.map((p) =>
        p.id === productId
          ? {
              ...p,
              stockOnHand: Math.max(0, p.stockOnHand + delta),
              updatedAt: new Date().toISOString(),
              version: p.version + 1,
            }
          : p,
      ),
      stockMovements: mergeStockMovements([movement], s.stockMovements),
    }));
    void queueRemote("pending_stock_updates", {
      productId,
      delta,
      note: reason ?? "",
      baseUpdatedAt: prev?.updatedAt ?? null,
      baseStockOnHand: prev?.stockOnHand,
    });
    pushAudit("stock_adjust", `${reason ?? "adjust"} ${delta >= 0 ? "+" : ""}${delta} · ${prev?.name ?? productId}`, {
      productId,
      delta,
      reason: reason ?? "",
      productName: prev?.name,
    });
  },

  writeOffExpiredStock: ({ productId, quantity, note }) => {
    const denied = denyUnlessPerm("pharmacy.expired_writeoff", "writeOffExpiredStock");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    if (!isPharmacyMode(state.preferences.businessType, state.preferences.pharmacyModeEnabled)) {
      return { ok: false, errorKey: "invalid" };
    }

    const p = state.products.find((x) => x.id === productId);
    if (!p) return { ok: false, errorKey: "missingProduct" };
    if (!isProductExpired(p)) return { ok: false, errorKey: "pharmacyWriteOffNotExpired" };

    const onHand = Math.max(0, Number(p.stockOnHand) || 0);
    if (onHand <= 0) return { ok: false, errorKey: "noStock" };

    const qty = quantity != null ? Math.min(onHand, Math.max(0, Number(quantity) || 0)) : onHand;
    if (qty <= 0) return { ok: false, errorKey: "invalidQty" };

    const costPerUnit = Math.max(0, Math.floor(p.costPricePerUnitUgx));
    const lossValueUgx = Math.round(qty * costPerUnit);
    const at = new Date().toISOString();
    const writeOffId = crypto.randomUUID();
    const delta = -qty;

    const movement: StockMovement = {
      id: crypto.randomUUID(),
      at,
      productId: p.id,
      productName: p.name,
      deltaBaseUnits: delta,
      kind: "adjust_expired_writeoff",
      summary: `Expired write-off −${qty} ${p.baseUnit}`,
      refId: writeOffId,
      supplierId: null,
    };

    set((s) => ({
      products: s.products.map((row) =>
        row.id === productId
          ? {
              ...row,
              stockOnHand: Math.max(0, row.stockOnHand + delta),
              updatedAt: at,
              version: row.version + 1,
            }
          : row,
      ),
      stockMovements: mergeStockMovements([movement], s.stockMovements),
    }));

    void queueRemote("pending_stock_updates", {
      productId,
      delta,
      note: "expired_writeoff",
      baseUpdatedAt: p.updatedAt,
      baseStockOnHand: p.stockOnHand,
    });

    pushAudit("expired_stock_writeoff", `Expired write-off ${p.name} −${qty} · loss UGX ${lossValueUgx.toLocaleString()}`, {
      writeOffId,
      productId,
      productName: p.name,
      quantity: qty,
      lossValueUgx,
      costPerUnitUgx: costPerUnit,
      expiryDate: p.expiryDate ?? null,
      note: note?.trim() || null,
    });

    return { ok: true, lossValueUgx };
  },

  addCustomer: (c) => {
    const denied = denyUnlessPerm("customers.view", "addCustomer");
    if (denied) {
      return {
        ...c,
        id: "denied",
        createdAt: new Date().toISOString(),
        version: 1,
        debtBalanceUgx: 0,
      };
    }

    const row: Customer = {
      ...c,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      version: 1,
      debtBalanceUgx: 0,
    };
    set((s) => ({ customers: [row, ...s.customers] }));
    void queueRemote("customer", { id: row.id });
    pushAudit("customer_add", row.name, { customerId: row.id, name: row.name });
    return row;
  },

  addDebtPayment: (customerId, amountUgx) => {
    const denied = denyUnlessPerm("customers.debt", "addDebtPayment");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const amount = Math.floor(Math.max(0, amountUgx));
    if (amount <= 0) return { ok: false, errorKey: "invalidMoney" };
    const state = get();
    const c = state.customers.find((x) => x.id === customerId);
    if (!c) return { ok: false, errorKey: "missingProduct" };
    const pay = Math.min(amount, c.debtBalanceUgx);
    if (pay <= 0) return { ok: false, errorKey: "invalid" };

    const payment: DebtPayment = {
      id: crypto.randomUUID(),
      customerId,
      amountUgx: pay,
      createdAt: new Date().toISOString(),
    };

    set({
      customers: state.customers.map((x) =>
        x.id === customerId
          ? { ...x, debtBalanceUgx: x.debtBalanceUgx - pay, version: x.version + 1 }
          : x,
      ),
      debtPayments: [payment, ...state.debtPayments],
    });

    const actor = state.sessionActor;
    if (actor) {
      set((st) => ({
        preferences: {
          ...st.preferences,
          shifts: (st.preferences.shifts ?? []).map((sh) =>
            !sh.endAt && sh.actorUserId === actor.userId
              ? {
                  ...sh,
                  debtPaymentsTotalUgx: (sh.debtPaymentsTotalUgx ?? 0) + pay,
                }
              : sh,
          ),
        },
      }));
    }
    void queueRemote("customer", { kind: "debt_payment", paymentId: payment.id });
    pushAudit("debt_payment", `Payment UGX ${pay.toLocaleString()}`, {
      customerId,
      paymentId: payment.id,
      amountUgx: pay,
    });
    return { ok: true, payment };
  },

  addSupplier: (input) => {
    const denied = denyUnlessPerm("suppliers.manage", "addSupplier");
    if (denied) return;

    const name = input.name.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const row: Supplier = {
      id: crypto.randomUUID(),
      name,
      phone: (input.phone ?? "").trim(),
      location: (input.location ?? "").trim(),
      notes: (input.notes ?? "").trim(),
      balanceOwedUgx: 0,
      lastSupplyAt: null,
      totalPurchasesUgx: 0,
      createdAt: now,
      version: 1,
    };
    set((s) => ({ suppliers: [normalizeSupplier(row), ...s.suppliers] }));
    void queueRemote("supplier", { id: row.id });
    pushAudit("supplier_add", row.name, { supplierId: row.id, name: row.name });
  },

  addSupplierPayment: (supplierId, amountUgx) => {
    const denied = denyUnlessPerm("suppliers.manage", "addSupplierPayment");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const sup = state.suppliers.find((x) => x.id === supplierId);
    if (!sup) return { ok: false, errorKey: "missingSupplier" };
    const pay = Math.min(Math.floor(Math.max(0, amountUgx)), Math.max(0, sup.balanceOwedUgx));
    if (pay <= 0) return { ok: false, errorKey: "invalidMoney" };
    const payment: SupplierPayment = {
      id: crypto.randomUUID(),
      supplierId,
      amountUgx: pay,
      createdAt: new Date().toISOString(),
      pendingSync: true,
    };
    set({
      suppliers: state.suppliers.map((s) =>
        s.id === supplierId
          ? { ...s, balanceOwedUgx: Math.max(0, s.balanceOwedUgx - pay), version: s.version + 1 }
          : s,
      ),
      supplierPayments: [payment, ...state.supplierPayments],
    });
    void queueRemote("pending_expenses", { kind: "supplier_payment", paymentId: payment.id, supplierId, amountUgx: pay });
    pushAudit("supplier_payment", `Paid supplier UGX ${pay.toLocaleString()}`, {
      supplierId,
      supplierName: sup.name,
      paymentId: payment.id,
      amountUgx: pay,
    });
    return { ok: true };
  },

  recordPurchase: (input) => {
    const denied = denyUnlessPerm("purchases.record", "recordPurchase");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    if (!input.lines.length) return { ok: false, errorKey: "emptySale" };

    const walkIn = isWalkInSupplierId(input.supplierId);
    let supplierId: string;
    let supplierName: string;

    if (walkIn) {
      supplierId = WALK_IN_SUPPLIER_ID;
      supplierName = (input.supplierName ?? "").trim() || "Town / market";
    } else {
      const supplierRow = state.suppliers.find((s) => s.id === input.supplierId);
      if (!supplierRow) return { ok: false, errorKey: "missingSupplier" };
      supplierId = supplierRow.id;
      supplierName = supplierRow.name;
    }

    let totalCostUgx = 0;
    const builtLines: PurchaseLine[] = [];
    for (const ln of input.lines) {
      const p = state.products.find((x) => x.id === ln.productId);
      if (!p) return { ok: false, errorKey: "missingProduct" };
      const baseInDirect = ln.baseUnitsIn != null ? Math.max(0, Math.floor(ln.baseUnitsIn)) : 0;
      const qtyBuy = ln.qtyBuyingUnits != null ? ln.qtyBuyingUnits : 0;
      const costBuy = ln.costPerBuyingUnitUgx != null ? ln.costPerBuyingUnitUgx : 0;
      const costBase = ln.costPerBaseUnitUgx != null ? ln.costPerBaseUnitUgx : 0;
      if (baseInDirect <= 0 && (qtyBuy <= 0 || costBuy < 0)) return { ok: false, errorKey: "invalid" };
      if (baseInDirect > 0) {
        if (costBase < 0) return { ok: false, errorKey: "invalid" };
        totalCostUgx += baseInDirect * Math.round(costBase);
        builtLines.push({
          productId: p.id,
          name: p.name,
          qtyBuyingUnits: baseInDirect,
          costPerBuyingUnitUgx: Math.round(costBase),
        });
      } else {
        totalCostUgx += purchaseLineCostTotalUgx({
          qtyBuyingUnits: qtyBuy,
          costPerBuyingUnitUgx: costBuy,
        });
        builtLines.push({
          productId: p.id,
          name: p.name,
          qtyBuyingUnits: qtyBuy,
          costPerBuyingUnitUgx: Math.round(costBuy),
        });
      }
    }

    const amountPaidUgx = Math.max(0, Math.floor(input.amountPaidUgx));
    const balanceDeltaUgx = totalCostUgx - amountPaidUgx;
    const createdAt = new Date().toISOString();
    const purchaseId = crypto.randomUUID();

    const products = [...state.products];
    const movements: StockMovement[] = [];

    for (const ln of builtLines) {
      const idx = products.findIndex((x) => x.id === ln.productId);
      if (idx === -1) return { ok: false, errorKey: "missingProduct" };
      const p = products[idx];
      const directBase = input.lines.find((x) => x.productId === ln.productId)?.baseUnitsIn;
      const baseIn =
        directBase != null && directBase > 0
          ? Math.floor(directBase)
          : buyingUnitsToBaseUnits(p, ln.qtyBuyingUnits);
      if (baseIn <= 0) return { ok: false, errorKey: "invalidQty" };
      const lineInput = input.lines.find((x) => x.productId === ln.productId);
      const incomingCostPerBase =
        lineInput?.costPerBaseUnitUgx != null && lineInput.costPerBaseUnitUgx >= 0
          ? Math.round(lineInput.costPerBaseUnitUgx)
          : costPerBaseFromBuyingUnitCost(p, ln.costPerBuyingUnitUgx);
      const newCost = weightedCostAfterStockIn(p.stockOnHand, p.costPricePerUnitUgx, baseIn, incomingCostPerBase);
      const newStock = p.stockOnHand + baseIn;
      products[idx] = {
        ...p,
        stockOnHand: newStock,
        costPricePerUnitUgx: newCost,
        updatedAt: createdAt,
        version: p.version + 1,
      };
      movements.push({
        id: crypto.randomUUID(),
        at: createdAt,
        productId: p.id,
        productName: p.name,
        deltaBaseUnits: baseIn,
        kind: "purchase_in",
        summary: `Restock +${baseIn} ${p.baseUnit}`,
        refId: purchaseId,
        supplierId: walkIn ? null : supplierId,
      });
    }

    const purchase: Purchase = {
      id: purchaseId,
      supplierId,
      supplierName,
      lines: builtLines,
      totalCostUgx,
      amountPaidUgx,
      balanceDeltaUgx,
      notes: (input.notes ?? "").trim(),
      createdAt,
      pendingSync: true,
    };

    const suppliers = walkIn
      ? state.suppliers
      : state.suppliers.map((s) =>
          s.id === supplierId
            ? {
                ...s,
                balanceOwedUgx: s.balanceOwedUgx + balanceDeltaUgx,
                totalPurchasesUgx: s.totalPurchasesUgx + totalCostUgx,
                lastSupplyAt: createdAt,
                version: s.version + 1,
              }
            : s,
        );

    set({
      products,
      purchases: [purchase, ...state.purchases],
      suppliers: suppliers.map(normalizeSupplier),
      stockMovements: mergeStockMovements(movements, state.stockMovements),
    });

    void queueRemote("pending_purchases", { purchaseId: purchase.id });
    void queueRemote("pending_stock_updates", { kind: "purchase", purchaseId: purchase.id });
    if (!walkIn) void queueRemote("supplier", { id: supplierId });
    pushAudit("purchase_saved", `Restock UGX ${totalCostUgx.toLocaleString()} · ${supplierName}`, {
      purchaseId: purchase.id,
      supplierId,
      supplierName,
      totalCostUgx,
      amountPaidUgx,
      lineCount: builtLines.length,
    });
    return { ok: true };
  },

  runDataArchive: () => {
    const denied = denyUnlessPerm("settings.shop", "runDataArchive");
    if (denied) {
      return {
        moved: { sales: 0, auditLogs: 0, dayCloses: 0, voidRecords: 0, returnRecords: 0, shifts: 0 },
      };
    }

    const s = get();
    const windowed = archiveSalesBeyondActiveWindow(s.sales, s.archivedSales);
    const policy = normalizeDataRetentionPolicy(s.preferences.dataRetentionPolicy);
    const shifts = s.preferences.shifts ?? [];
    const archivedShifts = s.preferences.archivedShifts ?? [];
    const result = partitionForArchive(policy, {
      sales: windowed.sales,
      archivedSales: windowed.archivedSales,
      auditLogs: s.auditLogs,
      archivedAuditLogs: s.archivedAuditLogs,
      dayCloses: s.dayCloses,
      archivedDayCloses: s.archivedDayCloses,
      voidRecords: s.voidRecords,
      archivedVoidRecords: s.archivedVoidRecords,
      returnRecords: s.returnRecords,
      archivedReturnRecords: s.archivedReturnRecords,
      shifts,
      archivedShifts,
    });
    const movedTotal =
      windowed.moved +
      result.moved.sales +
      result.moved.auditLogs +
      result.moved.dayCloses +
      result.moved.voidRecords +
      result.moved.returnRecords +
      result.moved.shifts;
    if (movedTotal === 0) {
      return { moved: result.moved };
    }
    set({
      sales: result.sales,
      archivedSales: result.archivedSales,
      auditLogs: result.auditLogs,
      archivedAuditLogs: result.archivedAuditLogs,
      dayCloses: result.dayCloses,
      archivedDayCloses: result.archivedDayCloses,
      voidRecords: result.voidRecords,
      archivedVoidRecords: result.archivedVoidRecords,
      returnRecords: result.returnRecords,
      archivedReturnRecords: result.archivedReturnRecords,
      preferences: {
        ...s.preferences,
        shifts: result.shifts,
        archivedShifts: result.archivedShifts,
        lastArchiveRunAt: new Date().toISOString(),
      },
    });
    appendPilotEvent("archive", `Archived ${movedTotal} records`, { movedTotal });
    return { moved: result.moved };
  },

  permanentlyDeleteArchived: () => {
    const denied = denyUnlessPerm("settings.shop", "permanentlyDeleteArchived");
    if (denied) return;

    const state = get();
    const forensic = buildArchiveForensicSummary({
      archivedSales: state.archivedSales,
      archivedReturnRecords: state.archivedReturnRecords,
      archivedVoidRecords: state.archivedVoidRecords,
      archivedAuditLogs: state.archivedAuditLogs,
      lastArchiveRunAt: state.preferences.lastArchiveRunAt,
    });
    const counts = {
      archivedSales: forensic.salesCount,
      archivedAuditLogs: forensic.auditCount,
      archivedDayCloses: state.archivedDayCloses.length,
      archivedVoidRecords: forensic.voidCount,
      archivedReturnRecords: forensic.returnsCount,
      archivedShifts: (state.preferences.archivedShifts ?? []).length,
    };

    const totalRecordsRemoved =
      counts.archivedSales +
      counts.archivedAuditLogs +
      counts.archivedDayCloses +
      counts.archivedVoidRecords +
      counts.archivedReturnRecords +
      counts.archivedShifts;

    pushAudit("archive_purge", "Permanent archive purge", {
      forensic,
      ...counts,
      totalRecordsRemoved,
    });

    set({
      archivedSales: [],
      archivedAuditLogs: [],
      archivedDayCloses: [],
      archivedVoidRecords: [],
      archivedReturnRecords: [],
      preferences: {
        ...get().preferences,
        archivedShifts: [],
      },
    });
  },

  addCashExpense: (input) => {
    const denied = denyUnlessPerm("expenses.record", "addCashExpense");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const amountUgx = Math.floor(input.amountUgx);
    if (amountUgx <= 0) return { ok: false, errorKey: "cashExpenseAmountRequired" };
    const category = input.category.trim().slice(0, 64);
    if (!category) return { ok: false, errorKey: "cashExpenseCategoryRequired" };
    const now = new Date().toISOString();
    const paidOn = dateKeyKampala(new Date());
    const row: CashExpense = {
      id: crypto.randomUUID(),
      category,
      amountUgx,
      description: (input.description ?? "").trim(),
      paidOn,
      createdAt: now,
      createdByUserId: actor.userId,
      createdByLabel: actor.displayName,
      pendingSync: true,
      lastSyncError: null,
      deletedAt: null,
    };
    set((s) => ({ cashExpenses: [row, ...s.cashExpenses] }));
    pushAudit("cash_expense_created", `${category} UGX ${amountUgx.toLocaleString()}`, {
      expenseId: row.id,
      amountUgx,
      category,
    });
    void queueRemote("pending_cash_expenses", { expenseId: row.id });
    if (hasSupabaseConfig) {
      void import("../offline/cloudSync").then((m) => m.syncCashExpenseImmediately(row.id));
    }
    return { ok: true };
  },

  voidCashExpense: (id) => {
    const denied = denyUnlessPerm("expenses.delete", "voidCashExpense");
    if (denied) return { ok: false };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false };
    const row = state.cashExpenses.find((e) => e.id === id && !e.deletedAt);
    if (!row) return { ok: false };
    const now = new Date().toISOString();
    set((s) => ({
      cashExpenses: s.cashExpenses.map((e) =>
        e.id === id ? { ...e, deletedAt: now, pendingSync: true } : e,
      ),
    }));
    pushAudit("cash_expense_voided", `Removed ${row.category} UGX ${row.amountUgx.toLocaleString()}`, {
      expenseId: id,
    });
    void queueRemote("pending_cash_expenses", { expenseId: id, void: true });
    return { ok: true };
  },

  recordDayClose: async ({ dateKey, countedCashUgx, override, overrideReason }) => {
    const denied = denyUnlessPerm("day.close", "recordDayClose");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    await ensureAllActiveSalesLoaded();
    if (!(await isActiveSalesFullyLoaded())) {
      return { ok: false, errorKey: "closeDaySalesNotLoaded" };
    }

    const state = get();
    const gate = canRecordDayClose(state.dayCloses, dateKey, override);
    if (!gate.ok) return { ok: false, errorKey: gate.errorKey };

    const existing = activeDayCloseForDate(state.dayCloses, dateKey);
    if (existing && override) {
      const reason = (overrideReason ?? "").trim();
      if (reason.length < 3) return { ok: false, errorKey: "dayCloseOverrideReasonRequired" };
    }
    const drawer = getDrawerCashForDayInput({
      sales: state.sales,
      returns: state.returnRecords,
      products: state.products,
      debtPayments: state.debtPayments,
      cashExpenses: state.cashExpenses,
      day: dateKey,
    });
    const fin = getCompletedFinancials(state.sales, state.returnRecords, state.products, { day: dateKey });
    const expectedCashUgx = drawer.expectedDrawerCashUgx;
    const totalSalesUgx = fin.revenueUgx;
    const totalDebtUgx = fin.debtIssuedUgx;
    const profitEstimateUgx = fin.profitUgx;
    const counted = Math.max(0, Math.floor(countedCashUgx));
    const diff = counted - expectedCashUgx;
    const now = new Date().toISOString();
    const actor = state.sessionActor;
    const closedByLabel = actor?.displayName?.trim() || actor?.role || "Owner";
    const closeId = crypto.randomUUID();
    const documentSnapshot = buildDayCloseSnapshot({
      closedByUserId: actor?.userId ?? null,
      closedByLabel,
      row: {
        id: closeId,
        dateKey,
        expectedCashUgx,
        countedCashUgx: counted,
        differenceUgx: diff,
        totalSalesUgx,
        totalDebtUgx,
        profitEstimateUgx,
        createdAt: now,
        replacesCloseId: existing?.id ?? null,
        overrideReason: existing && override ? (overrideReason ?? "").trim() : null,
      },
      drawer: {
        cashFromSalesUgx: drawer.cashFromSalesUgx,
        debtCollectedUgx: drawer.debtCollectedUgx,
        refundsUgx: drawer.refundsUgx,
        expenseUgx: drawer.expenseUgx,
      },
      transactionCount: fin.transactionCount,
    });
    const row: DayCloseSummary = {
      id: closeId,
      dateKey,
      expectedCashUgx,
      countedCashUgx: counted,
      differenceUgx: diff,
      totalSalesUgx,
      totalDebtUgx,
      profitEstimateUgx,
      createdAt: now,
      replacesCloseId: existing?.id ?? null,
      overrideReason: existing && override ? (overrideReason ?? "").trim() : null,
      documentSnapshot,
    };
    set((s) => ({
      dayCloses: [
        row,
        ...s.dayCloses.map((d) =>
          existing && d.id === existing.id ? { ...d, supersededAt: now } : d,
        ),
      ],
    }));
    void queueRemote("pending_sales", { kind: "day_close", id: row.id });
    if (existing && override) {
      pushAudit("day_close_override", `Re-close ${dateKey}`, {
        previousCloseId: existing.id,
        newCloseId: row.id,
        overrideReason: row.overrideReason,
        dateKey,
      });
    }
    pushAudit("day_close", `Close ${dateKey} counted UGX ${counted.toLocaleString()}`, {
      dayCloseId: row.id,
      dateKey,
      expectedCashUgx: expectedCashUgx,
      countedCashUgx: counted,
      differenceUgx: diff,
      totalSalesUgx,
      totalDebtUgx,
      profitEstimateUgx,
      cashFromSalesUgx: drawer.cashFromSalesUgx,
      debtCollectedUgx: drawer.debtCollectedUgx,
      refundsUgx: drawer.refundsUgx,
      expenseUgx: drawer.expenseUgx,
    });
    return { ok: true };
  },

  repairCustomerDebtIntegrity: () => {
    const denied = denyUnlessPerm("owner.dashboard", "repairCustomerDebtIntegrity");
    if (denied) return { ok: false, healedCount: 0, mismatchCount: 0 };

    const state = get();
    const before = verifyCustomerDebtIntegrity(state.customers, state.sales, state.debtPayments, { heal: false });
    const result = verifyCustomerDebtIntegrity(state.customers, state.sales, state.debtPayments, { heal: true });
    if (result.healedCount > 0) {
      set({ customers: result.customers });
    }
    pushAudit("debt_reconcile", `Debt reconciliation healed ${result.healedCount}`, {
      healedCount: result.healedCount,
      mismatchCountBefore: before.mismatches.length,
      mismatchCountAfter: result.mismatches.length,
    });
    return {
      ok: result.ok,
      healedCount: result.healedCount,
      mismatchCount: result.mismatches.length,
    };
  },
};
});

function persistRelevantUnchanged(a: PosState, b: PosState): boolean {
  return (
    a.products === b.products &&
    a.customers === b.customers &&
    a.sales === b.sales &&
    a.preferences === b.preferences &&
    a.debtPayments === b.debtPayments &&
    a.dayCloses === b.dayCloses &&
    a.auditLogs === b.auditLogs &&
    a.suppliers === b.suppliers &&
    a.purchases === b.purchases &&
    a.supplierPayments === b.supplierPayments &&
    a.stockMovements === b.stockMovements &&
    a.voidRecords === b.voidRecords &&
    a.returnRecords === b.returnRecords &&
    a.cashExpenses === b.cashExpenses &&
    a.archivedSales === b.archivedSales &&
    a.archivedAuditLogs === b.archivedAuditLogs &&
    a.archivedDayCloses === b.archivedDayCloses &&
    a.archivedVoidRecords === b.archivedVoidRecords &&
    a.archivedReturnRecords === b.archivedReturnRecords
  );
}

usePosStore.subscribe((state, prev) => {
  if (!state._hydrated || persistSuspended > 0) return;
  if (prev && persistRelevantUnchanged(prev, state)) return;
  schedulePersist(prev ?? state, state);
});

function mergePreferencesFromPartial(raw: Partial<{ preferences?: ShopPreferences }>): ShopPreferences {
  const base = createDefaultPreferences();
  const p = raw.preferences;
  if (!p) {
    return { ...base, onboardingDone: true, schemaVersion: 2 };
  }
  const legacy = (p.schemaVersion ?? 0) < 2;
  const bt = p.businessType ?? base.businessType;
  const prof = getBusinessProfile(bt);
  return {
    businessType: bt,
    kioskQuickSell: typeof p.kioskQuickSell === "boolean" ? p.kioskQuickSell : prof.kioskQuickSellDefault,
    onboardingDone: legacy ? true : typeof p.onboardingDone === "boolean" ? p.onboardingDone : false,
    schemaVersion: 2,
    celebratedFirstSale: typeof p.celebratedFirstSale === "boolean" ? p.celebratedFirstSale : base.celebratedFirstSale,
    saleSoundOn: typeof p.saleSoundOn === "boolean" ? p.saleSoundOn : base.saleSoundOn ?? true,
    hapticsOn: typeof p.hapticsOn === "boolean" ? p.hapticsOn : base.hapticsOn ?? true,
    posUiMode: p.posUiMode === "owner_back_office" || p.posUiMode === "cashier" ? p.posUiMode : base.posUiMode ?? "cashier",
    devRoleOverride:
      p.devRoleOverride === undefined
        ? (base.devRoleOverride ?? null)
        : p.devRoleOverride === null
          ? null
          : parseStoredUserRole(p.devRoleOverride),
    cashVarianceThresholdPct:
      typeof p.cashVarianceThresholdPct === "number" && p.cashVarianceThresholdPct >= 0
        ? p.cashVarianceThresholdPct
        : base.cashVarianceThresholdPct ?? 5,
    cashVarianceThresholdUgxFixed:
      typeof p.cashVarianceThresholdUgxFixed === "number" && p.cashVarianceThresholdUgxFixed >= 0
        ? p.cashVarianceThresholdUgxFixed
        : base.cashVarianceThresholdUgxFixed ?? 10_000,
    lastAutoBackupDateKey: p.lastAutoBackupDateKey ?? base.lastAutoBackupDateKey,
    activeBranchId:
      p.activeBranchId === undefined
        ? (base.activeBranchId ?? null)
        : p.activeBranchId === null
          ? null
          : String(p.activeBranchId),
    branchDisplayName:
      p.branchDisplayName === undefined
        ? (base.branchDisplayName ?? null)
        : p.branchDisplayName === null
          ? null
          : String(p.branchDisplayName),
    backOfficePin:
      p.backOfficePin === undefined
        ? (base.backOfficePin ?? null)
        : p.backOfficePin === null || p.backOfficePin === ""
          ? null
          : String(p.backOfficePin).replace(/\D/g, "").slice(0, 6) || null,
    shopDisplayName:
      p.shopDisplayName === undefined
        ? (base.shopDisplayName ?? null)
        : p.shopDisplayName === null
          ? null
          : String(p.shopDisplayName),
    shopPhoneE164:
      p.shopPhoneE164 === undefined
        ? (base.shopPhoneE164 ?? null)
        : p.shopPhoneE164 === null
          ? null
          : String(p.shopPhoneE164),
    shopAddressLine:
      p.shopAddressLine === undefined
        ? (base.shopAddressLine ?? null)
        : p.shopAddressLine === null
          ? null
          : String(p.shopAddressLine),
    shopCurrency: normalizeShopCurrency(p.shopCurrency ?? base.shopCurrency),
    staffAccounts: normalizeStaffAccounts(p.staffAccounts),
    activeStaffId:
      p.activeStaffId === undefined
        ? (base.activeStaffId ?? null)
        : p.activeStaffId === null
          ? null
          : String(p.activeStaffId),
    posLocked: typeof p.posLocked === "boolean" ? p.posLocked : base.posLocked ?? false,
    shifts: normalizeShifts(p.shifts),
    favoriteProductIds: Array.isArray(p.favoriteProductIds)
      ? (p.favoriteProductIds as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 40)
      : base.favoriteProductIds,
    recentProductIds: Array.isArray(p.recentProductIds)
      ? (p.recentProductIds as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 60)
      : base.recentProductIds,
    posSellCategoryFilter:
      p.posSellCategoryFilter === undefined || p.posSellCategoryFilter === null || String(p.posSellCategoryFilter).trim() === ""
        ? undefined
        : String(p.posSellCategoryFilter).trim().slice(0, 120),
    receiptPaperSize:
      p.receiptPaperSize === "58mm" || p.receiptPaperSize === "80mm" || p.receiptPaperSize === "a4"
        ? p.receiptPaperSize
        : base.receiptPaperSize ?? "80mm",
    dataRetentionPolicy: normalizeDataRetentionPolicy(p.dataRetentionPolicy ?? base.dataRetentionPolicy),
    archivedShifts: normalizeShifts(p.archivedShifts ?? base.archivedShifts),
    lastMonthlyReportPromptMonth:
      p.lastMonthlyReportPromptMonth === undefined
        ? (base.lastMonthlyReportPromptMonth ?? null)
        : p.lastMonthlyReportPromptMonth === null
          ? null
          : String(p.lastMonthlyReportPromptMonth).slice(0, 7) || null,
    lastArchiveRunAt:
      p.lastArchiveRunAt === undefined ? (base.lastArchiveRunAt ?? null) : p.lastArchiveRunAt === null ? null : String(p.lastArchiveRunAt),
    discountControlMode:
      p.discountControlMode === "manager_approval" || p.discountControlMode === "max_percent"
        ? p.discountControlMode
        : (base.discountControlMode ?? "unrestricted"),
    discountMaxPercentThreshold:
      typeof p.discountMaxPercentThreshold === "number" && p.discountMaxPercentThreshold >= 0 && p.discountMaxPercentThreshold <= 100
        ? p.discountMaxPercentThreshold
        : (base.discountMaxPercentThreshold ?? 10),
  };
}

async function restoreDraftSaleFromDisk(): Promise<void> {
  const draft = await readPersistedDraft();
  if (!draft) return;
  const products = usePosStore.getState().products;
  const { draftLines, draftInput } = resolveDraftFromPersisted(draft, products);
  if (draftLines.length > 0 || draftInput || (draft.draftCartDiscountUgx ?? 0) > 0) {
    usePosStore.setState({
      draftLines,
      draftInput,
      draftCartDiscountUgx: Math.max(0, Math.floor(draft.draftCartDiscountUgx ?? 0)),
    });
  }
}

const SALES_HYDRATE_BATCH = isNativeApp() ? 50 : 120;
const SALES_RESTORE_BATCH = isNativeApp() ? 12 : 60;
const ARCHIVED_RESTORE_BATCH = isNativeApp() ? 12 : 60;

/** Stop an in-progress backup restore (import / local copy). */
export function cancelBackupRestoreInProgress(): void {
  cancelBackupRestoreSession();
}

async function hydrateSalesBatched(
  raw: Sale[],
  opts?: { batchSize?: number; sessionId?: number; onProgress?: (percent: number) => void },
): Promise<void> {
  if (raw.length === 0) {
    usePosStore.setState({ sales: [] });
    opts?.onProgress?.(100);
    return;
  }
  const batch = opts?.batchSize ?? SALES_HYDRATE_BATCH;
  const normalized: Sale[] = [];
  for (let i = 0; i < raw.length; i += batch) {
    assertBackupRestoreNotAborted(opts?.sessionId);
    const chunk = raw.slice(i, i + batch);
    normalized.push(...chunk.map((s) => normalizeSale(s as Sale)));
    opts?.onProgress?.(Math.min(100, Math.round(((i + chunk.length) / raw.length) * 100)));
    if (i + batch < raw.length) {
      await yieldUiTick();
    }
  }
  usePosStore.setState({ sales: normalized });
}

async function hydrateArchivedSalesBatched(
  raw: Sale[],
  opts?: { batchSize?: number; sessionId?: number; onProgress?: (percent: number) => void },
): Promise<void> {
  if (raw.length === 0) {
    usePosStore.setState({ archivedSales: [] });
    opts?.onProgress?.(100);
    return;
  }
  const batch = opts?.batchSize ?? ARCHIVED_RESTORE_BATCH;
  const normalized: Sale[] = [];
  for (let i = 0; i < raw.length; i += batch) {
    assertBackupRestoreNotAborted(opts?.sessionId);
    const chunk = raw.slice(i, i + batch);
    normalized.push(...chunk.map((s) => normalizeSale(s as Sale)));
    opts?.onProgress?.(Math.min(100, Math.round(((i + chunk.length) / raw.length) * 100)));
    if (i + batch < raw.length) {
      await yieldUiTick();
    }
  }
  usePosStore.setState({ archivedSales: normalized });
}

function reportRestoreProgress(
  onProgress: ((percent: number) => void) | undefined,
  sliceStart: number,
  sliceEnd: number,
  innerPct: number,
): void {
  if (!onProgress) return;
  const span = sliceEnd - sliceStart;
  onProgress(sliceStart + Math.round((innerPct / 100) * span));
}

/** Write current in-memory store to IndexedDB after a restore (can run after UI unblocks). */
export async function persistRestoredSnapshotToDisk(sessionId?: number): Promise<void> {
  const restoreAuth = checkStorePermission(usePosStore.getState().sessionActor, "settings.shop");
  if (!restoreAuth.ok) {
    usePosStore.getState().logAuditAction("auth_forbidden", "Denied backup persist", {
      permission: "settings.shop",
      action: "backup_persist",
      errorKey: restoreAuth.errorKey,
    });
    throw new Error(restoreAuth.errorKey);
  }

  assertBackupRestoreNotAborted(sessionId);
  await yieldUiTick();
  assertBackupRestoreNotAborted(sessionId);
  const s = usePosStore.getState();
  const { flushFullSnapshotPersist } = await import("../offline/incrementalPersist");
  await flushFullSnapshotPersist(s, { skipLastGood: true });
}

/**
 * Restore a full backup into memory without blocking the UI (batched sales).
 * Call persistRestoredSnapshotToDisk() afterward to save to the phone.
 */
export async function applyRestoredSnapshotFromBackup(
  snap: PersistedSnapshot,
  opts?: { sessionId?: number; onProgress?: (percent: number) => void },
): Promise<void> {
  const restoreAuth = checkStorePermission(usePosStore.getState().sessionActor, "settings.shop");
  if (!restoreAuth.ok) {
    usePosStore.getState().logAuditAction("auth_forbidden", "Denied backup restore", {
      permission: "settings.shop",
      action: "backup_restore",
      errorKey: restoreAuth.errorKey,
    });
    throw new Error(restoreAuth.errorKey);
  }

  const sessionId = opts?.sessionId;
  const release = suspendStorePersist();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (draftPersistTimer) {
    clearTimeout(draftPersistTimer);
    draftPersistTimer = null;
  }

  try {
    assertBackupRestoreNotAborted(sessionId);
    const preferences = mergePreferencesFromPartial({ preferences: snap.preferences });

    usePosStore.getState().hydrateEssentials({
      products: snap.products.map(normalizeProduct),
      customers: (snap.customers ?? []).map(normalizeCustomer),
      preferences,
    });
    reportRestoreProgress(opts?.onProgress, 0, 8, 100);
    await yieldUiTick();

    assertBackupRestoreNotAborted(sessionId);
    usePosStore.getState().hydrateRemainder({
      debtPayments: snap.debtPayments ?? [],
      dayCloses: snap.dayCloses ?? [],
      auditLogs: snap.auditLogs ?? [],
      suppliers: (snap.suppliers ?? []).map(normalizeSupplier),
      purchases: (snap.purchases ?? []).map(normalizePurchase),
      supplierPayments: (snap.supplierPayments ?? []).map(normalizeSupplierPayment),
      stockMovements: (snap.stockMovements ?? []).map(normalizeStockMovement),
      voidRecords: snap.voidRecords ?? [],
      returnRecords: snap.returnRecords ?? [],
      cashExpenses: (snap.cashExpenses ?? []).map(normalizeCashExpense),
      archivedSales: [],
      archivedAuditLogs: snap.archivedAuditLogs ?? [],
      archivedDayCloses: snap.archivedDayCloses ?? [],
      archivedVoidRecords: snap.archivedVoidRecords ?? [],
      archivedReturnRecords: snap.archivedReturnRecords ?? [],
    });
    reportRestoreProgress(opts?.onProgress, 8, 12, 100);
    await yieldUiTick();

    await hydrateSalesBatched(snap.sales, {
      sessionId,
      batchSize: SALES_RESTORE_BATCH,
      onProgress: (p) => reportRestoreProgress(opts?.onProgress, 12, 82, p),
    });

    assertBackupRestoreNotAborted(sessionId);
    await hydrateArchivedSalesBatched(snap.archivedSales ?? [], {
      sessionId,
      batchSize: ARCHIVED_RESTORE_BATCH,
      onProgress: (p) => reportRestoreProgress(opts?.onProgress, 82, 100, p),
    });

    void clearPersistedDraft();
    await yieldUiTick();
  } finally {
    release();
  }
}

function scheduleHydrateRemainderFromSnap(snap: Partial<PersistedSnapshot>): void {
  const run = () => {
    void (async () => {
      if (!usePosStore.getState()._hydrated) return;
      const allSales = (snap.sales ?? []) as Sale[];
      const head = allSales.slice(0, INITIAL_SALES_LOAD_COUNT);
      const tail = allSales.slice(INITIAL_SALES_LOAD_COUNT);
      await hydrateSalesBatched(head);
      usePosStore.getState().hydrateRemainder({
        debtPayments: snap.debtPayments ?? [],
        dayCloses: snap.dayCloses ?? [],
        auditLogs: (snap as { auditLogs?: AuditLogEntry[] }).auditLogs ?? [],
        suppliers: (snap as { suppliers?: Supplier[] }).suppliers ?? [],
        purchases: (snap as { purchases?: Purchase[] }).purchases ?? [],
        supplierPayments: (snap as { supplierPayments?: SupplierPayment[] }).supplierPayments ?? [],
        stockMovements: (snap as { stockMovements?: StockMovement[] }).stockMovements ?? [],
        voidRecords: (snap as { voidRecords?: VoidRecord[] }).voidRecords ?? [],
        returnRecords: (snap as { returnRecords?: ReturnRecord[] }).returnRecords ?? [],
        cashExpenses: ((snap as { cashExpenses?: CashExpense[] }).cashExpenses ?? []).map(normalizeCashExpense),
        archivedSales: (snap.archivedSales ?? []).map(normalizeSale),
        archivedAuditLogs: snap.archivedAuditLogs ?? [],
        archivedDayCloses: snap.archivedDayCloses ?? [],
        archivedVoidRecords: snap.archivedVoidRecords ?? [],
        archivedReturnRecords: snap.archivedReturnRecords ?? [],
      });
      if (tail.length > 0) {
        scheduleBackgroundSalesHydrate(tail);
      }
    })();
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 800 });
  } else {
    setTimeout(run, 0);
  }
}

/** Load remaining sales from entity store in background pages. */
function scheduleBackgroundSalesHydrateByIds(ids: string[]): void {
  void (async () => {
    const { getEntitiesByIds } = await import("../offline/entityStore");
    usePosStore.setState({ salesHistoryHydration: { active: true, loaded: 0, total: ids.length } });
    let loaded = 0;
    for (let i = 0; i < ids.length; i += SALES_PAGE_LOAD_SIZE) {
      await yieldUiTick();
      const batch = (await getEntitiesByIds<Sale>("sale", ids.slice(i, i + SALES_PAGE_LOAD_SIZE))).map(normalizeSale);
      loaded += batch.length;
      usePosStore.setState((s) => {
        const have = new Set(s.sales.map((x) => x.id));
        const merged = [...s.sales];
        for (const row of batch) {
          if (!have.has(row.id)) merged.push(row);
        }
        merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
        return {
          sales: merged,
          salesHistoryHydration: { active: true, loaded, total: ids.length },
        };
      });
    }
    usePosStore.setState({ salesHistoryHydration: null });
  })();
}

/** Load remaining sales in background without blocking checkout. */
function scheduleBackgroundSalesHydrate(sales: Sale[]): void {
  void (async () => {
    usePosStore.setState({ salesHistoryHydration: { active: true, loaded: 0, total: sales.length } });
    let loaded = 0;
    for (let i = 0; i < sales.length; i += SALES_PAGE_LOAD_SIZE) {
      await yieldUiTick();
      const chunk = sales.slice(i, i + SALES_PAGE_LOAD_SIZE);
      loaded += chunk.length;
      usePosStore.setState((s) => {
        const have = new Set(s.sales.map((x) => x.id));
        const merged = [...s.sales];
        for (const row of chunk) {
          if (!have.has(row.id)) merged.push(normalizeSale(row));
        }
        merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
        return {
          sales: merged,
          salesHistoryHydration: { active: true, loaded, total: sales.length },
        };
      });
    }
    usePosStore.setState({ salesHistoryHydration: null });
  })();
}

/** True when every active sale id from the entity manifest is present in RAM. */
export async function isActiveSalesFullyLoaded(): Promise<boolean> {
  const { readEntityManifest } = await import("../offline/entityStore");
  const manifest = await readEntityManifest();
  if (!manifest) return true;
  const have = new Set(usePosStore.getState().sales.map((s) => s.id));
  return manifest.salesOrder.every((id) => have.has(id));
}

/** Load any sales not yet in RAM (reports/search). */
export async function ensureAllActiveSalesLoaded(): Promise<void> {
  const { readEntityManifest, getEntitiesByIds } = await import("../offline/entityStore");
  const manifest = await readEntityManifest();
  if (!manifest) return;
  const state = usePosStore.getState();
  const have = new Set(state.sales.map((s) => s.id));
  const missingIds = manifest.salesOrder.filter((id) => !have.has(id));
  if (missingIds.length === 0) return;
  for (let i = 0; i < missingIds.length; i += SALES_PAGE_LOAD_SIZE) {
    await yieldUiTick();
    const batch = await getEntitiesByIds<Sale>("sale", missingIds.slice(i, i + SALES_PAGE_LOAD_SIZE));
    usePosStore.setState((s) => {
      const ids = new Set(s.sales.map((x) => x.id));
      const merged = [...s.sales];
      for (const row of batch) {
        if (!ids.has(row.id)) merged.push(normalizeSale(row));
      }
      merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return { sales: merged };
    });
  }
}

function snapshotHasInventoryOrSales(snap: Partial<PersistedSnapshot> | null | undefined): boolean {
  return Boolean(snap && ((snap.products?.length ?? 0) > 0 || (snap.sales?.length ?? 0) > 0));
}

async function resolveLegacySnapshotIfEmpty(
  snap: Partial<PersistedSnapshot> | null,
): Promise<Partial<PersistedSnapshot> | null> {
  if (snapshotHasInventoryOrSales(snap)) return snap;
  const legacyIdb = await claimLegacySnapshotForCurrentAccount();
  if (legacyIdb) return legacyIdb;
  const legacy = tryMigrateLegacyLocalStorage();
  if (!legacy) return snap;
  const migrated = {
    products: legacy.products.map(normalizeProduct),
    customers: legacy.customers.map(normalizeCustomer),
    sales: legacy.sales.map(normalizeSale),
    preferences: { ...createDefaultPreferences(), onboardingDone: true, schemaVersion: 2 },
    debtPayments: [] as DebtPayment[],
    dayCloses: [] as DayCloseSummary[],
    auditLogs: [] as AuditLogEntry[],
    suppliers: [] as Supplier[],
    purchases: [] as Purchase[],
    supplierPayments: [] as SupplierPayment[],
    stockMovements: [] as StockMovement[],
    voidRecords: [] as VoidRecord[],
    returnRecords: [] as ReturnRecord[],
  };
  void writeSnapshot(migrated);
  clearLegacyLocalStorage();
  return migrated;
}

function applyBootstrapPreferences(snap: Partial<PersistedSnapshot>): ShopPreferences {
  const preferences = mergePreferencesFromPartial(snap);
  const pendingStaff = readPendingStaffSelection();
  const activeKey = getActiveAccountKey();
  if (pendingStaff && activeKey && pendingStaff.accountKey === activeKey) {
    const exists = (preferences.staffAccounts ?? []).some((s) => s.id === pendingStaff.staffId && s.active);
    preferences.activeStaffId = exists ? pendingStaff.staffId : null;
    clearPendingStaffSelection();
  }
  return preferences;
}

/** Non-blocking follow-up after the shell can render (draft, prune, cloud pull). */
function schedulePostBootstrapTasks(): void {
  const run = () => {
    void runPostBootstrapTasks();
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    setTimeout(run, 0);
  }
}

async function runPostBootstrapTasks(): Promise<void> {
  if (!usePosStore.getState()._hydrated) return;
  void restoreDraftSaleFromDisk();
  runWhenIdle(() => usePosStore.getState().runDataArchive(), 4000);

  if (!readStaffSession() && usePosStore.getState().preferences.activeStaffId) {
    usePosStore.getState().switchStaffAccount(null);
  }

  const key = getActiveAccountKey();
  if (!hasSupabaseConfig || !key?.startsWith("sb:")) return;
  const { shouldPausePosBackgroundWork } = await import("../lib/backgroundWorkPolicy");
  if (shouldPausePosBackgroundWork()) return;

  const { supabase: sb } = await import("../lib/supabase");
  if (!sb) return;
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session?.user) return;

  const { hydrateLocalShopProfileFromCloud } = await import("../lib/businessProfile");
  const { applyShopRecoverySignalsForCurrentShop } = await import("../lib/shopRecoverySignals");
  void hydrateLocalShopProfileFromCloud().catch(() => undefined);
  void applyShopRecoverySignalsForCurrentShop().catch(() => undefined);
  const { isLocalShopDataEmpty } = await import("../lib/cloudSnapshotSync");
  const { scheduleBackgroundCloudSync } = await import("../offline/cloudSync");
  const localEmpty = isLocalShopDataEmpty();
  scheduleBackgroundCloudSync({
    pull: localEmpty,
    delayMs: isNativeApp() ? 2_500 : 800,
  });
}

function hydrateEssentialsFromSnap(snap: Partial<PersistedSnapshot>): void {
  const preferences = applyBootstrapPreferences(snap);
  usePosStore.getState().hydrateEssentials({
    products: (snap.products ?? []) as Product[],
    customers: (snap.customers ?? []) as Customer[],
    preferences,
  });
}

function scheduleLegacySnapshotMigration(initialSnap: Partial<PersistedSnapshot> | null): void {
  void (async () => {
    const legacySnap = await resolveLegacySnapshotIfEmpty(initialSnap);
    if (!legacySnap || !snapshotHasInventoryOrSales(legacySnap)) return;
    if (!usePosStore.getState()._hydrated) return;
    hydrateEssentialsFromSnap(legacySnap);
    scheduleHydrateRemainderFromSnap(legacySnap);
    const next = usePosStore.getState();
    void writeSnapshot({
      products: next.products,
      customers: next.customers,
      sales: next.sales,
      preferences: next.preferences,
      debtPayments: next.debtPayments,
      dayCloses: next.dayCloses,
      auditLogs: next.auditLogs,
      suppliers: next.suppliers,
      purchases: next.purchases,
      supplierPayments: next.supplierPayments,
      stockMovements: next.stockMovements,
      voidRecords: next.voidRecords,
      returnRecords: next.returnRecords,
    });
  })();
}

const BOOTSTRAP_DISK_TIMEOUT_MS = 12_000;

/** Returning Supabase owners should not be sent through new-shop onboarding after a slow/empty disk read. */
function preferencesForAccountBootstrap(key: string): ShopPreferences {
  const preferences = createDefaultPreferences();
  if (!key.startsWith("sb:")) return preferences;
  const userId = key.slice(3);
  if (isWorkspaceBootstrapped(userId) || readCachedOwnerOnboardingComplete(userId) === true) {
    preferences.onboardingDone = true;
    preferences.onboardingWizardDone = true;
    preferences.schemaVersion = 2;
  }
  return preferences;
}

/** Load local POS data; never hang the UI longer than BOOTSTRAP_DISK_TIMEOUT_MS. */
export async function bootstrapPosFromDisk(): Promise<void> {
  const key = getActiveAccountKey();
  if (!key) {
    usePosStore.getState().resetForSignOut();
    return;
  }
  if (key.startsWith("demo:")) {
    usePosStore.getState().resetForSignOut();
    const prefs = createDefaultPreferences();
    prefs.onboardingDone = true;
    prefs.shopDisplayName = "Demo shop";
    prefs.kioskQuickSell = true;
    const products = createDefaultProducts();
    usePosStore.getState().hydrateEssentials({
      products,
      customers: [],
      preferences: prefs,
    });
    schedulePostBootstrapTasks();
    return;
  }

  const load = async () => {
    const { readEntityManifest, getEntitiesByBucket, getEntitiesByIds, migrateSnapshotToEntities } = await import(
      "../offline/entityStore",
    );
    const manifest = await readEntityManifest();
    if (manifest) {
      const products = (await getEntitiesByBucket<Product>("product")).map(normalizeProduct);
      const customers = (await getEntitiesByBucket<Customer>("customer")).map(normalizeCustomer);
      const tombstones = manifest.tombstones ?? {};
      const filteredProducts = products.filter((p) => !tombstones[p.id]);
      usePosStore.getState().hydrateEssentials({
        products: filteredProducts,
        customers,
        preferences: manifest.preferences,
      });
      const headIds = manifest.salesOrder.slice(0, INITIAL_SALES_LOAD_COUNT);
      const headSales = (await getEntitiesByIds<Sale>("sale", headIds)).map(normalizeSale);
      await hydrateSalesBatched(headSales);
      if (manifest.salesOrder.length > INITIAL_SALES_LOAD_COUNT) {
        scheduleBackgroundSalesHydrateByIds(manifest.salesOrder.slice(INITIAL_SALES_LOAD_COUNT));
      }
      usePosStore.getState().hydrateRemainder({
        debtPayments: await getEntitiesByBucket("debtPayment"),
        dayCloses: await getEntitiesByBucket("dayClose"),
        auditLogs: await getEntitiesByBucket("auditLog"),
        suppliers: (await getEntitiesByBucket<Supplier>("supplier")).map(normalizeSupplier),
        purchases: (await getEntitiesByBucket<Purchase>("purchase")).map(normalizePurchase),
        supplierPayments: (await getEntitiesByBucket<SupplierPayment>("supplierPayment")).map(normalizeSupplierPayment),
        stockMovements: (await getEntitiesByBucket<StockMovement>("stockMovement")).map(normalizeStockMovement),
        voidRecords: await getEntitiesByBucket("voidRecord"),
        returnRecords: await getEntitiesByBucket("returnRecord"),
        archivedSales: (await getEntitiesByIds<Sale>("archivedSale", manifest.archivedSalesOrder)).map(normalizeSale),
        archivedAuditLogs: await getEntitiesByBucket("archivedAuditLog"),
        archivedDayCloses: await getEntitiesByBucket("archivedDayClose"),
        archivedVoidRecords: await getEntitiesByBucket("archivedVoidRecord"),
        archivedReturnRecords: await getEntitiesByBucket("archivedReturnRecord"),
      });
      return;
    }

    const snap = await readSnapshotWithFallback();
    if (snap) {
      void migrateSnapshotToEntities(snap as PersistedSnapshot);
    }
    if (snapshotHasInventoryOrSales(snap)) {
      hydrateEssentialsFromSnap(snap!);
      scheduleHydrateRemainderFromSnap(snap!);
      return;
    }

    if (snap) {
      hydrateEssentialsFromSnap(snap);
    } else {
      const preferences = preferencesForAccountBootstrap(key);
      usePosStore.getState().hydrateEssentials({ products: [], customers: [], preferences });
      void writeSnapshot({
        products: [],
        customers: [],
        sales: [],
        preferences,
        debtPayments: [],
        dayCloses: [],
        auditLogs: [],
        suppliers: [],
        purchases: [],
        supplierPayments: [],
        stockMovements: [],
        voidRecords: [],
        returnRecords: [],
      });
    }
    scheduleLegacySnapshotMigration(snap);
  };

  try {
    await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("bootstrap_timeout")), BOOTSTRAP_DISK_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    if (!usePosStore.getState()._hydrated) {
      usePosStore.getState().hydrateEssentials({
        products: [],
        customers: [],
        preferences: preferencesForAccountBootstrap(key),
      });
    }
    if (import.meta.env.DEV) console.warn("[waka-pos] bootstrap disk", e);
  }
  schedulePostBootstrapTasks();
}

export function formatProductPriceLabel(product: Product): string {
  const u = product.baseUnit || "ea";
  const p = pricePerBaseUnitUgx(product);
  if (p <= 0) return "—";
  if (product.sellingMode === "unit") return `${p.toLocaleString()} UGX`;
  return `${p.toLocaleString()} UGX / ${u}`;
}
