import { create } from "zustand";
import type {
  AuditAction,
  AuditLogEntry,
  BusinessType,
  Customer,
  DayCloseSummary,
  DebtPayment,
  LineInputMode,
  Product,
  Purchase,
  PurchaseLine,
  Sale,
  SaleLine,
  SellingMode,
  ShopPreferences,
  StockMovement,
  StockMovementKind,
  Supplier,
  SupplierPayment,
  SyncOperationKind,
  UserRole,
} from "../types";
import type { SessionActor } from "../lib/sessionActor";
import { getOrCreateDeviceId } from "../lib/deviceId";
import { createDefaultPreferences } from "../data/defaultSeed";
import { inferFromProductName } from "../lib/smartProductGuess";
import { writeSnapshot, readSnapshotWithFallback } from "../offline/localDb";
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
import { getBusinessProfile } from "../config/businessTypes";
import { dateKeyKampala } from "../lib/datesUg";
import { canTogglePosUiMode } from "../lib/permissions";

const MAX_AUDIT_LOGS = 5000;
const MAX_STOCK_MOVEMENTS = 4000;

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
  if (v === null) return null;
  if (typeof v !== "string") return null;
  const n = v.trim().toLowerCase();
  if (n === "owner" || n === "manager" || n === "cashier" || n === "stock_keeper") return n;
  return null;
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
    },
    opts?: { replaceAudit?: boolean },
  ) => void;

  /** Replace local state + disk from a full backup (owner only in UI). */
  applyRestoredSnapshot: (snap: PersistedSnapshot) => void;

  setSessionActor: (actor: SessionActor | null) => void;

  setPreferences: (p: Partial<ShopPreferences>) => void;
  completeBusinessOnboarding: (businessType: BusinessType) => void;
  updateBusinessType: (businessType: BusinessType) => void;

  setDraftInput: (input: DraftLineInput | null) => void;
  addDraftLineFromInput: () => { ok: boolean; errorKey?: string };
  removeDraftLine: (productId: string) => void;
  clearDraft: () => void;
  finalizeDraftSale: (opts: {
    debtUgx: number;
    customerId?: string | null;
  }) => { ok: boolean; errorKey?: string; firstSale?: boolean };

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
  }) => { ok: boolean; errorKey?: string };
  bulkQuickAddProducts: (
    rows: Array<{
      name: string;
      priceUgx: number;
      stockQty: number;
      category: string;
      inferName?: string;
    }>,
  ) => { added: number; skipped: number };
  duplicateProduct: (productId: string, nameSuffix: string) => { ok: boolean; errorKey?: string };
  removeProduct: (productId: string) => void;
  updateProductQuickPresets: (
    productId: string,
    presets: { quickPresetsMoneyUgx?: number[]; quickPresetsQty?: number[] },
  ) => void;
  adjustStock: (productId: string, delta: number, reason?: string) => void;
  addCustomer: (c: Omit<Customer, "id" | "createdAt" | "version" | "debtBalanceUgx">) => Customer;
  addDebtPayment: (customerId: string, amountUgx: number) => { ok: boolean; errorKey?: string };
  recordDayClose: (opts: { dateKey: string; countedCashUgx: number }) => void;

  addSupplier: (input: { name: string; phone?: string; location?: string; notes?: string }) => void;
  addSupplierPayment: (supplierId: string, amountUgx: number) => { ok: boolean; errorKey?: string };
  recordPurchase: (input: {
    supplierId: string;
    lines: Array<{ productId: string; qtyBuyingUnits: number; costPerBuyingUnitUgx: number }>;
    amountPaidUgx: number;
    notes?: string;
  }) => { ok: boolean; errorKey?: string };
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let draftPersistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(get: () => PosState) {
  if (!get()._hydrated) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const s = get();
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
      });
      const cur = usePosStore.getState();
      const nextKey = await maybeAppendDailyAutoBackup(cur.preferences.lastAutoBackupDateKey);
      if (nextKey && nextKey !== cur.preferences.lastAutoBackupDateKey) {
        usePosStore.setState((st) => ({
          preferences: { ...st.preferences, lastAutoBackupDateKey: nextKey },
        }));
      }
    })();
  }, 180);
}

function scheduleDraftPersist(get: () => PosState) {
  if (!get()._hydrated) return;
  if (draftPersistTimer) clearTimeout(draftPersistTimer);
  draftPersistTimer = setTimeout(() => {
    draftPersistTimer = null;
    const s = get();
    const input = s.draftInput
      ? { productId: s.draftInput.product.id, inputMode: s.draftInput.inputMode, value: s.draftInput.value }
      : null;
    void writePersistedDraft(s.draftLines, input);
  }, 400);
}

async function queueRemote(kind: SyncOperationKind, payload: unknown) {
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

function normalizeSale(s: Sale): Sale {
  return { ...s, customerId: s.customerId ?? null, soldByUserId: s.soldByUserId ?? null };
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
      _hydrated: true,
      draftLines: [],
      draftInput: null,
    }),

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
    });
    void clearPersistedDraft();
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

  completeBusinessOnboarding: (businessType) => {
    const prof = getBusinessProfile(businessType);
    set((s) => ({
      preferences: {
        ...s.preferences,
        businessType,
        kioskQuickSell: prof.kioskQuickSellDefault,
        onboardingDone: true,
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

  clearDraft: () => {
    set({ draftLines: [], draftInput: null });
    void clearPersistedDraft();
  },

  finalizeDraftSale: ({ debtUgx, customerId }) => {
    const state = get();
    if (!state.draftLines.length) return { ok: false, errorKey: "emptySale" };
    const isFirstSale = state.sales.length === 0;

    const subtotal = state.draftLines.reduce((a, l) => a + l.lineTotalUgx, 0);
    const total = subtotal;
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

    let estimatedProfitUgx = 0;
    for (const line of state.draftLines) {
      const p = products.find((x) => x.id === line.productId)!;
      estimatedProfitUgx += estimatedProfitForLine(p, line);
    }

    const actorId = state.sessionActor?.userId ?? null;
    const sale: Sale = {
      id: crypto.randomUUID(),
      lines: state.draftLines.map((l) => ({ ...l })),
      subtotalUgx: subtotal,
      totalUgx: total,
      cashPaidUgx,
      debtUgx: debt,
      estimatedProfitUgx,
      createdAt: new Date().toISOString(),
      pendingSync: true,
      lastSyncError: null,
      customerId: customerId ?? null,
      soldByUserId: actorId,
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

    void queueRemote("sale", { saleId: sale.id });
    void clearPersistedDraft();
    pushAudit("sale_completed", `Sale UGX ${total.toLocaleString()}`, {
      saleId: sale.id,
      totalUgx: total,
      debtUgx: debt,
      customerId: customerId ?? null,
      soldByUserId: actorId,
      lineCount: sale.lines.length,
    });
    return { ok: true, firstSale: isFirstSale };
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
    const cost = Math.min(price, Math.max(0, Math.floor(price * 0.72)));
    const minAlert = sellingMode === "portion" ? 1 : sellingMode === "weighted" ? 3 : 5;
    const sameShape = sellingMode === guess.sellingMode && baseUnit === guess.baseUnit;
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
      quickPresetsMoneyUgx: sameShape ? guess.quickPresetsMoneyUgx : undefined,
      quickPresetsQty: sameShape ? guess.quickPresetsQty : undefined,
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
    void queueRemote("stock_move", { productId, delta, note: reason ?? "" });
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
    void queueRemote("supplier", { kind: "payment", paymentId: payment.id });
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
    const supplier = state.suppliers.find((s) => s.id === input.supplierId);
    if (!supplier) return { ok: false, errorKey: "missingSupplier" };
    if (!input.lines.length) return { ok: false, errorKey: "emptySale" };

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
        supplierId: supplier.id,
      });
    }

    const purchase: Purchase = {
      id: purchaseId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      lines: builtLines,
      totalCostUgx,
      amountPaidUgx,
      balanceDeltaUgx,
      notes: (input.notes ?? "").trim(),
      createdAt,
      pendingSync: true,
    };

    const suppliers = state.suppliers.map((s) =>
      s.id === supplier.id
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

    void queueRemote("purchase", { purchaseId: purchase.id });
    pushAudit("purchase_saved", `Restock UGX ${totalCostUgx.toLocaleString()} · ${supplier.name}`, {
      purchaseId: purchase.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      totalCostUgx,
      amountPaidUgx,
      lineCount: builtLines.length,
    });
    return { ok: true };
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
    void queueRemote("sale", { kind: "day_close", id: row.id });
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
    shopCurrency:
      p.shopCurrency === undefined
        ? (base.shopCurrency ?? "UGX")
        : p.shopCurrency === null
          ? "UGX"
          : String(p.shopCurrency).trim().toUpperCase() || "UGX",
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

export async function bootstrapPosFromDisk(): Promise<void> {
  let snap = await readSnapshotWithFallback();
  const legacy = tryMigrateLegacyLocalStorage();
  if (legacy && (!snap || ((snap.products?.length ?? 0) === 0 && (snap.sales?.length ?? 0) === 0))) {
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
    };
    await writeSnapshot(migrated);
    snap = migrated;
    clearLegacyLocalStorage();
  }
  if (!snap) {
    const products: Product[] = [];
    const preferences = createDefaultPreferences();
    await writeSnapshot({
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
    });
    usePosStore.getState().hydrate({
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
    });
    await restoreDraftSaleFromDisk();
    return;
  }

  const preferences = mergePreferencesFromPartial(snap);
  usePosStore.getState().hydrate({
    products: (snap.products ?? []).map((p) => normalizeProduct(p as Product)),
    customers: (snap.customers ?? []).map((c) => normalizeCustomer(c as Customer)),
    sales: (snap.sales ?? []).map((s) => normalizeSale(s as Sale)),
    preferences,
    debtPayments: snap.debtPayments ?? [],
    dayCloses: snap.dayCloses ?? [],
    auditLogs: (snap as { auditLogs?: AuditLogEntry[] }).auditLogs ?? [],
    suppliers: (snap as { suppliers?: Supplier[] }).suppliers ?? [],
    purchases: (snap as { purchases?: Purchase[] }).purchases ?? [],
    supplierPayments: (snap as { supplierPayments?: SupplierPayment[] }).supplierPayments ?? [],
    stockMovements: (snap as { stockMovements?: StockMovement[] }).stockMovements ?? [],
  });
  await restoreDraftSaleFromDisk();
}

export function formatProductPriceLabel(product: Product): string {
  const u = product.baseUnit || "ea";
  const p = pricePerBaseUnitUgx(product);
  if (p <= 0) return "—";
  if (product.sellingMode === "unit") return `${p.toLocaleString()} UGX`;
  return `${p.toLocaleString()} UGX / ${u}`;
}
