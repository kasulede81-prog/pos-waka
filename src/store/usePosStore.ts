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
} from "../types";
import type { SessionActor } from "../lib/sessionActor";
import { getOrCreateDeviceId } from "../lib/deviceId";
import { createDefaultPreferences, createDefaultProducts } from "../data/defaultSeed";
import { inferFromProductName } from "../lib/smartProductGuess";
import { hasSupabaseConfig } from "../lib/supabase";
import { writeSnapshot, readSnapshotWithFallback, claimLegacySnapshotForCurrentAccount } from "../offline/localDb";
import { getActiveAccountKey } from "../offline/accountScope";
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
  reduceSaleTotalsByAmount,
  shiftExpectedCash,
  type DiscountMode,
} from "../lib/saleAdjustments";
import { isWalkInSupplierId, WALK_IN_SUPPLIER_ID } from "../lib/walkInSupplier";
import { getBusinessProfile } from "../config/businessTypes";
import { dateKeyKampala } from "../lib/datesUg";
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

/**
 * Local Past-sales / snapshot retention: completed sale rows older than this
 * (rolling wall-clock, not Kampala calendar) are dropped from memory + the next
 * IndexedDB write. Does not remove server-side history if sync already uploaded;
 * stock movements stay for inventory audit.
 */
const LOCAL_SALE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
};

type PosState = {
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
  /** Current signed-in actor (not persisted); synced from App shell / auth. */
  sessionActor: SessionActor | null;
  draftLines: SaleLine[];
  draftInput: DraftLineInput | null;

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
  }) => void;

  /** Replace local state + disk from a full backup (owner only in UI). */
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
  applyDraftLineDiscount: (productId: string, mode: DiscountMode, value: number) => { ok: boolean; errorKey?: string };
  clearDraft: () => void;
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
  }) => { ok: boolean; errorKey?: string };
  closeShiftWithCashCount: (countedCashUgx: number) => { ok: boolean; errorKey?: string; differenceUgx?: number };
  finalizeDraftSale: (opts: {
    debtUgx: number;
    customerId?: string | null;
    paymentMethod?: "cash" | "mobile_money" | "mixed" | "credit";
    amountPaidUgx?: number;
    changeGivenUgx?: number;
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
        | "quickPresetsMoneyUgx"
        | "quickPresetsQty"
      >
    >,
  ) => { ok: boolean; errorKey?: string };
  adjustStock: (productId: string, delta: number, reason?: string) => void;
  addCustomer: (c: Omit<Customer, "id" | "createdAt" | "version" | "debtBalanceUgx">) => Customer;
  addDebtPayment: (customerId: string, amountUgx: number) => { ok: boolean; errorKey?: string };
  recordDayClose: (opts: { dateKey: string; countedCashUgx: number }) => void;

  addSupplier: (input: { name: string; phone?: string; location?: string; notes?: string }) => void;
  addSupplierPayment: (supplierId: string, amountUgx: number) => { ok: boolean; errorKey?: string };
  recordPurchase: (input: {
    supplierId?: string | null;
    /** Display name when buying in town (no fixed supplier). */
    supplierName?: string;
    lines: Array<{ productId: string; qtyBuyingUnits: number; costPerBuyingUnitUgx: number }>;
    amountPaidUgx: number;
    notes?: string;
  }) => { ok: boolean; errorKey?: string };

  /** Trim `sales` to the last 30 days (local device only); triggers persist via subscribe. */
  pruneExpiredSales: () => void;
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let draftPersistTimer: ReturnType<typeof setTimeout> | null = null;

function fireSnapshotWrite(s: PosState): void {
  void (async () => {
    await writeSnapshot({
      products: s.products,
      customers: s.customers,
      sales: s.sales,
      preferences: s.preferences,
      debtPayments: s.debtPayments,
      dayCloses: s.dayCloses,
      auditLogs: s.auditLogs,
      suppliers: s.suppliers,
      purchases: s.purchases,
      supplierPayments: s.supplierPayments,
      stockMovements: s.stockMovements,
      voidRecords: s.voidRecords,
      returnRecords: s.returnRecords,
    });
    const cur = usePosStore.getState();
    if (!cur._hydrated) return;
    const nextKey = await maybeAppendDailyAutoBackup(cur.preferences.lastAutoBackupDateKey);
    if (nextKey && nextKey !== cur.preferences.lastAutoBackupDateKey) {
      usePosStore.setState((st) => ({
        preferences: { ...st.preferences, lastAutoBackupDateKey: nextKey },
      }));
    }
  })();
}

function fireDraftWrite(s: PosState): void {
  const input = s.draftInput
    ? { productId: s.draftInput.product.id, inputMode: s.draftInput.inputMode, value: s.draftInput.value }
    : null;
  void writePersistedDraft(s.draftLines, input);
}

function schedulePersist(get: () => PosState) {
  if (!get()._hydrated) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    fireSnapshotWrite(get());
  }, 180);
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
    const s = usePosStore.getState();
    if (s._hydrated) fireSnapshotWrite(s);
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
    voided: line.voided === true,
    voidedAt: line.voidedAt ?? null,
  };
}

function normalizeSale(s: Sale): Sale {
  const lines = (s.lines ?? []).map(normalizeSaleLine);
  const estimatedProfitUgx = Number.isFinite(s.estimatedProfitUgx)
    ? Math.round(s.estimatedProfitUgx)
    : lines.reduce((sum, line) => sum + line.estimatedProfitUgx, 0);
  return { ...s, lines, estimatedProfitUgx, customerId: s.customerId ?? null, soldByUserId: s.soldByUserId ?? null };
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
    void queueRemote("audit_log", { entry });
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
  sessionActor: null,
  draftLines: [],
  draftInput: null,

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
      _hydrated: true,
      draftLines: [],
      draftInput: null,
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
      _hydrated: true,
      draftLines: [],
      draftInput: null,
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
    })),

  applyRestoredSnapshot: (snap) => {
    const preferences = mergePreferencesFromPartial({ preferences: snap.preferences });
    get().hydrate(
      {
        products: snap.products.map(normalizeProduct),
        customers: (snap.customers ?? []).map(normalizeCustomer),
        sales: snap.sales.map(normalizeSale),
        preferences,
        debtPayments: snap.debtPayments ?? [],
        dayCloses: snap.dayCloses ?? [],
        auditLogs: snap.auditLogs ?? [],
        suppliers: snap.suppliers ?? [],
        purchases: snap.purchases ?? [],
        supplierPayments: snap.supplierPayments ?? [],
        stockMovements: snap.stockMovements ?? [],
        voidRecords: snap.voidRecords ?? [],
        returnRecords: snap.returnRecords ?? [],
      },
      { replaceAudit: true },
    );
    const s = get();
    void writeSnapshot({
      products: s.products,
      customers: s.customers,
      sales: s.sales,
      preferences: s.preferences,
      debtPayments: s.debtPayments,
      dayCloses: s.dayCloses,
      auditLogs: s.auditLogs,
      suppliers: s.suppliers,
      purchases: s.purchases,
      supplierPayments: s.supplierPayments,
      stockMovements: s.stockMovements,
      voidRecords: s.voidRecords,
      returnRecords: s.returnRecords,
    });
    void clearPersistedDraft();
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
      sessionActor: null,
      draftLines: [],
      draftInput: null,
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
    set((s) => ({
      preferences: {
        ...s.preferences,
        businessType,
        kioskQuickSell: prof.kioskQuickSellDefault,
        onboardingDone: true,
        onboardingWizardDone: true,
        schemaVersion: 2,
      },
    }));
  },

  completeShopOnboardingWizard: (input) => {
    const prof = getBusinessProfile(input.businessType);
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
    const built = buildSaleLine(d.product, d.inputMode, d.value);
    if (!built.line || built.error) {
      return { ok: false, errorKey: built.error ?? "invalid" };
    }
    set((state) => ({
      draftLines: [...state.draftLines.filter((l) => l.productId !== built.line!.productId), built.line!],
      draftInput: null,
    }));
    scheduleDraftPersist(get);
    return { ok: true };
  },

  removeDraftLine: (productId) => {
    set((s) => ({ draftLines: s.draftLines.filter((l) => l.productId !== productId) }));
    scheduleDraftPersist(get);
  },

  applyDraftLineDiscount: (productId, mode, value) => {
    const state = get();
    const line = state.draftLines.find((l) => l.productId === productId);
    if (!line) return { ok: false, errorKey: "noSelection" };
    const next = applyDiscountToLine(line, mode, value);
    if (!next) return { ok: false, errorKey: "invalid" };
    set((s) => ({
      draftLines: s.draftLines.map((l) => (l.productId === productId ? next : l)),
    }));
    scheduleDraftPersist(get);
    return { ok: true };
  },

  clearDraft: () => {
    set({ draftLines: [], draftInput: null });
    void clearPersistedDraft();
  },

  finalizeDraftSale: ({ debtUgx, customerId, paymentMethod, amountPaidUgx, changeGivenUgx }) => {
    const state = get();
    if (!state.draftLines.length) return { ok: false, errorKey: "emptySale" };
    const isFirstSale = state.sales.length === 0;

    const saleLines = state.draftLines.map((line) => normalizeSaleLine(line));
    const listSubtotal = saleLines.reduce((a, l) => a + (l.originalLineTotalUgx ?? l.lineTotalUgx), 0);
    const subtotal = saleLines.reduce((a, l) => a + l.lineTotalUgx, 0);
    const total = subtotal;
    const discountTotal = Math.max(0, listSubtotal - subtotal);
    const debt = Math.min(Math.max(0, Math.floor(debtUgx)), total);
    const cashPaidUgx = total - debt;

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
    const todayKey = dateKeyKampala(new Date());
    const receiptSeq = state.sales.reduce(
      (maxSeq, s) =>
        dateKeyKampala(s.createdAt) === todayKey
          ? Math.max(maxSeq, Number.isFinite(s.receiptSeq) ? Math.floor(s.receiptSeq ?? 0) : 0)
          : maxSeq,
      0,
    ) + 1;
    const sale: Sale = {
      id: crypto.randomUUID(),
      receiptSeq,
      lines: saleLines,
      subtotalUgx: listSubtotal,
      totalUgx: total,
      cashPaidUgx,
      debtUgx: debt,
      discountTotalUgx: discountTotal,
      voidedTotalUgx: 0,
      estimatedProfitUgx,
      createdAt: new Date().toISOString(),
      pendingSync: true,
      lastSyncError: null,
      customerId: customerId ?? null,
      soldByUserId: actorId,
      paymentMethod: paymentMethod ?? (debt > 0 ? (cashPaidUgx > 0 ? "mixed" : "credit") : "cash"),
      amountPaidUgx: Number.isFinite(amountPaidUgx) ? Math.max(0, Math.floor(amountPaidUgx ?? 0)) : cashPaidUgx,
      changeGivenUgx: Number.isFinite(changeGivenUgx) ? Math.max(0, Math.floor(changeGivenUgx ?? 0)) : 0,
    };

    let customers = state.customers;
    if (customerId && debt > 0) {
      customers = customers.map((c) =>
        c.id === customerId
          ? { ...c, debtBalanceUgx: c.debtBalanceUgx + debt, version: c.version + 1 }
          : c,
      );
    }

    const saleMovements: StockMovement[] = state.draftLines.map((line) => ({
      id: crypto.randomUUID(),
      at: sale.createdAt,
      productId: line.productId,
      productName: line.name,
      deltaBaseUnits: -line.quantity,
      kind: "sale_out" as const,
      summary: `Sale −${line.quantity}`,
      refId: sale.id,
      supplierId: null,
    }));

    set({
      products,
      sales: [sale, ...state.sales],
      draftLines: [],
      draftInput: null,
      customers,
      stockMovements: mergeStockMovements(saleMovements, state.stockMovements),
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
                  salesTotalUgx: sh.salesTotalUgx + total,
                  debtTotalUgx: sh.debtTotalUgx + debt,
                  estimatedCashUgx: sh.estimatedCashUgx + cashPaidUgx,
                  discountsTotalUgx: (sh.discountsTotalUgx ?? 0) + discountTotal,
                }
              : sh,
          ),
        },
      }));
    }

    void queueRemote("pending_sales", { saleId: sale.id });
    if (hasSupabaseConfig && typeof navigator !== "undefined" && navigator.onLine) {
      void import("../offline/cloudSync").then((m) => m.syncSaleImmediately(sale.id));
    }
    void clearPersistedDraft();
    pushAudit("sale_completed", `Sale UGX ${total.toLocaleString()}`, {
      saleId: sale.id,
      totalUgx: total,
      debtUgx: debt,
      customerId: customerId ?? null,
      soldByUserId: actorId,
      lineCount: sale.lines.length,
      firstLineName: sale.lines[0]?.name ?? null,
    });
    if (discountTotal > 0) {
      pushAudit("discount_given", `Discount UGX ${discountTotal.toLocaleString()}`, {
        saleId: sale.id,
        discountUgx: discountTotal,
        soldByUserId: actorId,
      });
    }
    return { ok: true, firstSale: isFirstSale, saleId: sale.id };
  },

  voidSaleLine: ({ saleId, lineIndex, reason, note }) => {
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

    set({
      sales,
      products,
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
    return { ok: true };
  },

  returnProduct: ({ saleId, productId, quantity, refundAmountUgx, reason, note }) => {
    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const qty = Math.max(0, Number(quantity) || 0);
    const refund = Math.max(0, Math.floor(refundAmountUgx));
    if (qty <= 0 || refund <= 0) return { ok: false, errorKey: "invalid" };

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
    if (saleId) {
      const saleIdx = sales.findIndex((s) => s.id === saleId);
      if (saleIdx >= 0) {
        const sale = sales[saleIdx]!;
        const totals = reduceSaleTotalsByAmount(sale, refund);
        const updated: Sale = { ...sale, ...totals, pendingSync: true };
        sales = [...sales];
        sales[saleIdx] = updated;
      }
    }

    set({
      products,
      sales,
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
    return { ok: true };
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
    const trimmed = input.name.trim();
    if (!trimmed) return { ok: false, errorKey: "invalid" };
    const hint = (input.inferName ?? trimmed).trim();
    const guess = inferFromProductName(hint);
    const sellingMode = input.sellingMode ?? guess.sellingMode;
    const baseUnit = (input.baseUnit ?? guess.baseUnit).trim() || "ea";
    const buyingUnit = input.buyingUnit !== undefined ? input.buyingUnit : guess.buyingUnit;
    const conversionRate = input.conversionRate !== undefined ? input.conversionRate : guess.conversionRate;
    const price = Math.max(0, Math.floor(input.priceUgx));
    const stock = Math.max(0, Number(input.stockQty) || 0);
    const cost =
      input.costPricePerUnitUgx !== undefined && input.costPricePerUnitUgx !== null
        ? Math.max(0, Math.floor(Number(input.costPricePerUnitUgx)))
        : Math.min(price, Math.max(0, Math.floor(price * 0.72)));
    const minAlert = sellingMode === "portion" ? 1 : sellingMode === "weighted" ? 3 : 5;
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
      });
      if (r.ok) added += 1;
      else skipped += 1;
    }
    return { added, skipped };
  },

  duplicateProduct: (productId, nameSuffix) => {
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
    });
    return { ok: true };
  },

  removeProduct: (productId) => {
    const p = get().products.find((x) => x.id === productId);
    set((s) => ({ products: s.products.filter((x) => x.id !== productId) }));
    void queueRemote("product", { id: productId, deleted: true });
    pushAudit("product_remove", p?.name ?? productId, { productId, name: p?.name });
  },

  addProduct: (p) => {
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
    void queueRemote("product", { id: row.id });
    pushAudit("product_add", row.name, { productId: row.id, name: row.name, category: row.category });
  },

  updateProductQuickPresets: (productId, presets) => {
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
    void queueRemote("product", { id: productId, presets: true });
    const pn = get().products.find((x) => x.id === productId)?.name ?? productId;
    pushAudit("product_presets", `Presets ${pn}`, { productId });
  },

  updateProduct: (productId, patch) => {
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
    if (patch.quickPresetsMoneyUgx !== undefined) {
      merged.quickPresetsMoneyUgx = patch.quickPresetsMoneyUgx;
    }
    if (patch.quickPresetsQty !== undefined) {
      merged.quickPresetsQty = patch.quickPresetsQty;
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

    void queueRemote("product", { id: productId });
    pushAudit("product_update", merged.name, { productId, name: merged.name });
    return { ok: true };
  },

  adjustStock: (productId, delta, reason) => {
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
    void queueRemote("pending_stock_updates", { productId, delta, note: reason ?? "" });
    pushAudit("stock_adjust", `${reason ?? "adjust"} ${delta >= 0 ? "+" : ""}${delta} · ${prev?.name ?? productId}`, {
      productId,
      delta,
      reason: reason ?? "",
      productName: prev?.name,
    });
  },

  addCustomer: (c) => {
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
    void queueRemote("customer", { kind: "debt_payment", paymentId: payment.id });
    pushAudit("debt_payment", `Payment UGX ${pay.toLocaleString()}`, {
      customerId,
      paymentId: payment.id,
      amountUgx: pay,
    });
    return { ok: true };
  },

  addSupplier: (input) => {
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
    const pay = Math.floor(Math.max(0, amountUgx));
    if (pay <= 0) return { ok: false, errorKey: "invalidMoney" };
    const state = get();
    const sup = state.suppliers.find((x) => x.id === supplierId);
    if (!sup) return { ok: false, errorKey: "missingSupplier" };
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
      if (ln.qtyBuyingUnits <= 0 || ln.costPerBuyingUnitUgx < 0) return { ok: false, errorKey: "invalid" };
      totalCostUgx += purchaseLineCostTotalUgx(ln);
      builtLines.push({
        productId: p.id,
        name: p.name,
        qtyBuyingUnits: ln.qtyBuyingUnits,
        costPerBuyingUnitUgx: Math.round(ln.costPerBuyingUnitUgx),
      });
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
      const baseIn = buyingUnitsToBaseUnits(p, ln.qtyBuyingUnits);
      if (baseIn <= 0) return { ok: false, errorKey: "invalidQty" };
      const incomingCostPerBase = costPerBaseFromBuyingUnitCost(p, ln.costPerBuyingUnitUgx);
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

    void queueRemote("pending_stock_updates", { kind: "purchase", purchaseId: purchase.id });
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

  pruneExpiredSales: () => {
    const cutoff = Date.now() - LOCAL_SALE_RETENTION_MS;
    set((s) => {
      const next = s.sales.filter((sale) => {
        const ts = new Date(sale.createdAt).getTime();
        return !Number.isNaN(ts) && ts >= cutoff;
      });
      if (next.length === s.sales.length) return s;
      return { sales: next };
    });
  },

  recordDayClose: ({ dateKey, countedCashUgx }) => {
    const state = get();
    const daySales = state.sales.filter((s) => dateKeyKampala(s.createdAt) === dateKey);
    const expectedCashUgx = daySales.reduce((a, s) => a + s.cashPaidUgx, 0);
    const totalSalesUgx = daySales.reduce((a, s) => a + s.totalUgx, 0);
    const totalDebtUgx = daySales.reduce((a, s) => a + s.debtUgx, 0);
    const profitEstimateUgx = daySales.reduce((a, s) => a + s.estimatedProfitUgx, 0);
    const counted = Math.max(0, Math.floor(countedCashUgx));
    const diff = counted - expectedCashUgx;
    const row: DayCloseSummary = {
      id: crypto.randomUUID(),
      dateKey,
      expectedCashUgx,
      countedCashUgx: counted,
      differenceUgx: diff,
      totalSalesUgx,
      totalDebtUgx,
      profitEstimateUgx,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ dayCloses: [row, ...s.dayCloses] }));
    void queueRemote("pending_sales", { kind: "day_close", id: row.id });
    pushAudit("day_close", `Close ${dateKey} counted UGX ${counted.toLocaleString()}`, {
      dayCloseId: row.id,
      dateKey,
      expectedCashUgx: expectedCashUgx,
      countedCashUgx: counted,
      differenceUgx: diff,
    });
  },
};
});

usePosStore.subscribe((state) => {
  if (!state._hydrated) return;
  schedulePersist(() => usePosStore.getState());
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
  };
}

async function restoreDraftSaleFromDisk(): Promise<void> {
  const draft = await readPersistedDraft();
  if (!draft) return;
  const products = usePosStore.getState().products;
  const { draftLines, draftInput } = resolveDraftFromPersisted(draft, products);
  if (draftLines.length > 0 || draftInput) {
    usePosStore.setState({ draftLines, draftInput });
  }
}

const SALES_HYDRATE_BATCH = 120;

async function hydrateSalesBatched(raw: Sale[]): Promise<void> {
  if (raw.length === 0) return;
  const normalized: Sale[] = [];
  for (let i = 0; i < raw.length; i += SALES_HYDRATE_BATCH) {
    const chunk = raw.slice(i, i + SALES_HYDRATE_BATCH);
    normalized.push(...chunk.map((s) => normalizeSale(s as Sale)));
    if (i + SALES_HYDRATE_BATCH < raw.length) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
  usePosStore.setState({ sales: normalized });
}

function scheduleHydrateRemainderFromSnap(snap: Partial<PersistedSnapshot>): void {
  const run = () => {
    void (async () => {
      if (!usePosStore.getState()._hydrated) return;
      const sales = (snap.sales ?? []) as Sale[];
      await hydrateSalesBatched(sales);
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
      });
    })();
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 800 });
  } else {
    setTimeout(run, 0);
  }
}

async function resolveLegacySnapshotIfEmpty(
  snap: Partial<PersistedSnapshot> | null,
): Promise<Partial<PersistedSnapshot> | null> {
  const hasData = snap && ((snap.products?.length ?? 0) > 0 || (snap.sales?.length ?? 0) > 0);
  if (hasData) return snap;
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
  await restoreDraftSaleFromDisk();
  usePosStore.getState().pruneExpiredSales();

  if (!readStaffSession() && usePosStore.getState().preferences.activeStaffId) {
    usePosStore.getState().switchStaffAccount(null);
  }

  const key = getActiveAccountKey();
  if (!hasSupabaseConfig || !key?.startsWith("sb:")) return;

  const { supabase: sb } = await import("../lib/supabase");
  if (!sb) return;
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session?.user) return;

  const { hydrateLocalShopProfileFromCloud } = await import("../lib/businessProfile");
  const { applyShopRecoverySignalsForCurrentShop } = await import("../lib/shopRecoverySignals");
  void hydrateLocalShopProfileFromCloud().catch(() => undefined);
  void applyShopRecoverySignalsForCurrentShop().catch(() => undefined);
  const { scheduleBackgroundCloudSync } = await import("../offline/cloudSync");
  scheduleBackgroundCloudSync({ pull: true, delayMs: 400 });
  scheduleBackgroundCloudSync({ pull: false, delayMs: 12_000 });
}

export async function bootstrapPosFromDisk(): Promise<void> {
  const key = getActiveAccountKey();
  if (!key) {
    // Signed out / no namespace yet → nothing to hydrate.
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

  let snap = await readSnapshotWithFallback();
  snap = await resolveLegacySnapshotIfEmpty(snap);

  if (!snap) {
    const products: Product[] = [];
    const preferences = createDefaultPreferences();
    usePosStore.getState().hydrateEssentials({ products, customers: [], preferences });
    schedulePostBootstrapTasks();
    void writeSnapshot({
      products,
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
    return;
  }

  const preferences = applyBootstrapPreferences(snap);
  usePosStore.getState().hydrateEssentials({
    products: (snap.products ?? []) as Product[],
    customers: (snap.customers ?? []) as Customer[],
    preferences,
  });
  scheduleHydrateRemainderFromSnap(snap);
  schedulePostBootstrapTasks();
}

export function formatProductPriceLabel(product: Product): string {
  const u = product.baseUnit || "ea";
  const p = pricePerBaseUnitUgx(product);
  if (p <= 0) return "—";
  if (product.sellingMode === "unit") return `${p.toLocaleString()} UGX`;
  return `${p.toLocaleString()} UGX / ${u}`;
}
