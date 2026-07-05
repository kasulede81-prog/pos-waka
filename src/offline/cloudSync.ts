import type {
  AuditLogEntry,
  CashExpense,
  CashDrawerAdjustment,
  Customer,
  DayCloseSummary,
  DayDrawerOpen,
  DebtPayment,
  InventoryCountSession,
  Product,
  Purchase,
  ReturnRecord,
  Sale,
  SaleLine,
  SellingMode,
  ShiftRecord,
  StockMovement,
  Supplier,
  SupplierPayment,
} from "../types";
import { isPendingSale, saleStatusOf } from "../lib/saleStatus";
import { hydrateSaleFinancialsFromCloud } from "../lib/saleLineFinancialHydration";
import { mergePendingSalePair, mergePendingSales, ensureSaleLineId } from "../lib/pendingSaleMerge";
import { decodeSaleLineFromCloud, type CloudSaleLineRow } from "../lib/saleLineCloudCodec";
import { mergeSaleFromCloudPull } from "../lib/saleFinancialMerge";
import { isSupabaseEmailVerified } from "../lib/emailVerification";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { getDeviceOnline } from "../lib/deviceOnline";
import { shouldPausePosBackgroundPull } from "../lib/backgroundWorkPolicy";
import { SYNC_PULL_MIN_INTERVAL_MS } from "../lib/syncTiming";
import { isNativeApp } from "../lib/nativeApp";
import { writeSyncHealthMeta, readSyncHealthMeta } from "../lib/syncMeta";
import { setCachedShopId } from "../lib/shopSyncContext";
import { pullEntitySafe } from "../lib/pullEntitySafe";
import { recordEntityPullErrors } from "../lib/pullDiagnostics";
import {
  markBootstrapSyncComplete,
  needsBootstrapPull,
  readSyncCheckpoints,
  updateCheckpointsAfterIncrementalPull,
} from "../lib/syncCheckpoints";
import { usePosStore } from "../store/usePosStore";
import type { SyncOperation } from "../types";
import { reportSyncIssue } from "../lib/monitoring";
import { mergeReturnRecordsForRecovery, rowToReturnRecord, type CloudReturnRow } from "../lib/returnRecovery";
import {
  buildPurchaseCloudPushPayload,
  mergePurchaseRecoveryBundle,
  rowToPurchase,
  rowToSupplier,
  rowToSupplierPayment,
  type CloudPurchaseRow,
  type CloudSupplierRow,
} from "../lib/purchaseRecovery";
import { isWalkInSupplierId } from "../lib/walkInSupplier";
import { isPurchaseVoided } from "../lib/purchaseCorrections";
import { purchaseLineBaseUnitsIn } from "../lib/purchaseLineSync";
import {
  mergeProductFromCloudPull,
  patchProductsWithServerStock,
  type ServerProductStockRow,
} from "../lib/inventoryIntegrity";
import { normalizePharmacyPackaging } from "../lib/pharmacyPackaging";
import { defaultReceiptDisplayOptions } from "../lib/receiptBranding";
import { mergeDebtPaymentsFromCloudPull, parseDebtPaymentRows } from "../lib/debtPaymentRecovery";
import { mergeCustomerFromCloudPull } from "../lib/customerDebtReconciliation";
import {
  mergeCashDrawerAdjustmentsFromCloudPull,
  parseCashDrawerAdjustmentRows,
} from "../lib/cashDrawerAdjustmentRecovery";
import { mergeDayDrawerOpensFromCloudPull } from "../lib/dayDrawerOpenRecovery";
import {
  pullDayDrawerOpensFromRpc,
  syncDayDrawerOpenOperation,
} from "../lib/dayDrawerOpenCloudSync";
import { mergeInventoryCountSessionsFromCloudPull } from "../lib/inventoryCountRecovery";
import {
  pullInventoryCountSessionsFromRpc,
  pushInventoryCountSessionToCloud,
} from "../lib/inventoryCountCloudSync";
import { mergeShiftsFromCloudPull } from "../lib/shiftRecovery";
import { pullShiftsFromRpc, pushShiftToCloud } from "../lib/shiftCloudSync";
import {
  pullStockMovementsFull,
  pullStockMovementsIncremental,
} from "../lib/stockMovementCloudSync";
import { mergeStockMovementsFromCloudPull } from "../lib/stockMovementRecovery";
import { mergeDayClosesFromCloudPull } from "../lib/dayCloseRecovery";
import { pullDayClosesFromRpc, pushDayCloseToCloud } from "../lib/dayCloseCloudSync";
import { normalizeUnitCostUgx, normalizePackCostUgx } from "../lib/costPrecision";
import { runPostSyncDebtValidation } from "../lib/debtSyncDiagnostics";
import { pullCursorUntilExhausted, pullOffsetRangeUntilExhausted } from "../lib/cloudPullPagination";

type ShopCtx = { shopId: string; userId: string };

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01";
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function resolveShopCtx(): Promise<ShopCtx | null> {
  if (!hasSupabaseConfig || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  const userId = user?.id;
  if (!userId || !user) return null;
  if (!isSupabaseEmailVerified(user)) return null;
  const orgShop = await resolvePrimaryOrganizationForUser(userId);
  if (!orgShop) {
    setCachedShopId(null);
    return null;
  }
  setCachedShopId(orgShop.shopId);
  return { shopId: orgShop.shopId, userId };
}

function productSku(p: Product): string {
  const raw = (p.sku || "").trim();
  if (raw.length > 0 && raw.length <= 64) return raw.slice(0, 64);
  return `waka-${p.id.replace(/-/g, "").slice(0, 40)}`;
}

function productToRow(p: Product, shopId: string, opts?: { includeStock?: boolean }) {
  const row: Record<string, unknown> = {
    id: p.id,
    shop_id: shopId,
    name: p.name,
    unit: p.baseUnit || "ea",
    base_unit: p.baseUnit || "ea",
    selling_mode: p.sellingMode,
    buying_unit: p.buyingUnit ?? null,
    conversion_rate: p.conversionRate ?? null,
    selling_price_per_unit_ugx: Math.max(0, Math.floor(p.sellingPricePerUnitUgx)),
    cost_price_per_unit_ugx: Math.max(0, Math.round(p.costPricePerUnitUgx)),
    price_ugx: Math.max(0, Math.floor(p.sellingPricePerUnitUgx)),
    cost_ugx: Math.max(0, Math.round(p.costPricePerUnitUgx)),
    reorder_level: Number(p.minimumStockAlert) || 0,
    minimum_stock_alert: Number(p.minimumStockAlert) || 0,
    sku: productSku(p),
    is_active: true,
    metadata: {
      category: p.category ?? "",
      version: p.version,
      quickPresetsMoneyUgx: p.quickPresetsMoneyUgx ?? [],
      quickPresetsQty: p.quickPresetsQty ?? [],
      expiryDate: p.expiryDate ?? null,
      medicineStrength: p.medicineStrength ?? null,
      medicineForm: p.medicineForm ?? null,
      pharmacyPackaging: p.pharmacyPackaging ?? null,
      exactCostPricePerUnitUgx: p.costPricePerUnitUgx,
      buyingPackCostUgx: p.buyingPackCostUgx ?? null,
      packCostUnitsDepleted: p.packCostUnitsDepleted ?? null,
      wakaClient: true,
    },
    updated_at: p.updatedAt || new Date().toISOString(),
  };
  if (opts?.includeStock !== false) {
    row.stock_on_hand = Number(p.stockOnHand) || 0;
  }
  return row;
}

function rowToProduct(row: Record<string, unknown>): Product | null {
  const id = String(row.id ?? "");
  if (!isUuid(id)) return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const exactMeta = meta.exactCostPricePerUnitUgx;
  const costFromRow = Number(row.cost_price_per_unit_ugx ?? row.cost_ugx ?? 0);
  const sellingMode = (row.selling_mode as SellingMode) || "unit";
  const expiryRaw = meta.expiryDate ?? meta.expiry_date;
  const strengthRaw = meta.medicineStrength ?? meta.medicine_strength;
  const formRaw = meta.medicineForm ?? meta.medicine_form;
  return {
    id,
    name: String(row.name ?? ""),
    sellingMode,
    baseUnit: String(row.base_unit ?? row.unit ?? "ea"),
    buyingUnit: (row.buying_unit as string | null) ?? null,
    conversionRate: row.conversion_rate != null ? Number(row.conversion_rate) : null,
    sellingPricePerUnitUgx: Math.max(0, Math.floor(Number(row.selling_price_per_unit_ugx ?? row.price_ugx ?? 0))),
    costPricePerUnitUgx: normalizeUnitCostUgx(
      exactMeta != null && Number.isFinite(Number(exactMeta)) ? Number(exactMeta) : costFromRow,
    ),
    buyingPackCostUgx:
      meta.buyingPackCostUgx != null && Number(meta.buyingPackCostUgx) > 0
        ? normalizePackCostUgx(Number(meta.buyingPackCostUgx))
        : null,
    packCostUnitsDepleted:
      meta.packCostUnitsDepleted != null && Number.isFinite(Number(meta.packCostUnitsDepleted))
        ? Math.max(0, Math.floor(Number(meta.packCostUnitsDepleted)))
        : undefined,
    stockOnHand: Number(row.stock_on_hand ?? 0),
    minimumStockAlert: Number(row.minimum_stock_alert ?? row.reorder_level ?? 0),
    category: String(meta.category ?? ""),
    sku: String(row.sku ?? ""),
    expiryDate: expiryRaw != null && String(expiryRaw).trim() ? String(expiryRaw).trim().slice(0, 10) : null,
    medicineStrength:
      strengthRaw != null && String(strengthRaw).trim() ? String(strengthRaw).trim().slice(0, 64) : null,
    medicineForm: formRaw != null && String(formRaw).trim() ? String(formRaw).trim().slice(0, 64) : null,
    pharmacyPackaging: normalizePharmacyPackaging(meta.pharmacyPackaging),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    version: Math.max(1, Math.floor(Number(meta.version ?? 1))),
    quickPresetsMoneyUgx: Array.isArray(meta.quickPresetsMoneyUgx)
      ? (meta.quickPresetsMoneyUgx as number[]).filter((x) => x > 0)
      : undefined,
    quickPresetsQty: Array.isArray(meta.quickPresetsQty) ? (meta.quickPresetsQty as number[]).filter((x) => x > 0) : undefined,
  };
}

function rowToCustomer(row: Record<string, unknown>): Customer | null {
  const id = String(row.id ?? "");
  if (!isUuid(id)) return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    id,
    name: String(row.name ?? ""),
    phone: String(row.phone_e164 ?? meta.phone ?? ""),
    location: String(meta.location ?? row.notes ?? ""),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    version: Math.max(1, Math.floor(Number(meta.version ?? 1))),
    debtBalanceUgx: Math.max(0, Math.floor(Number(meta.debtBalanceUgx ?? 0))),
  };
}

function rowToSaleLine(row: Record<string, unknown>): SaleLine {
  return decodeSaleLineFromCloud(row as CloudSaleLineRow);
}

function rowToSale(row: Record<string, unknown>, lines: SaleLine[]): Sale | null {
  const id = String(row.id ?? "");
  if (!isUuid(id)) return null;
  const dbStatus = String(row.status ?? "completed");
  if (dbStatus === "void" || dbStatus === "refunded") return null;
  let status: import("../types").SaleStatus = "completed";
  if (dbStatus === "draft") status = "pending";
  else if (dbStatus === "cancelled") status = "cancelled";
  const updatedAt = String(row.updated_at ?? row.completed_at ?? row.created_at ?? new Date().toISOString());
  return {
    id,
    status,
    referenceLabel: row.reference_label != null ? String(row.reference_label) : null,
    tableSessionId: row.table_session_id != null ? String(row.table_session_id) : null,
    updatedAt,
    lines,
    subtotalUgx: Math.max(0, Math.floor(Number(row.subtotal_ugx ?? row.total_ugx ?? 0))),
    totalUgx: Math.max(0, Math.floor(Number(row.total_ugx ?? 0))),
    cashPaidUgx: status === "completed" ? Math.max(0, Math.floor(Number(row.cash_amount_ugx ?? 0))) : 0,
    debtUgx: status === "completed" ? Math.max(0, Math.floor(Number(row.debt_amount_ugx ?? 0))) : 0,
    discountTotalUgx: Math.max(0, Math.floor(Number(row.discount_ugx ?? 0))),
    estimatedProfitUgx: Math.max(0, Math.floor(Number((row.metadata as Record<string, unknown>)?.estimatedProfitUgx ?? 0))),
    createdAt: String(row.completed_at ?? row.created_at ?? new Date().toISOString()),
    pendingSync: false,
    lastSyncError: null,
    customerId: (row.customer_id as string | null) ?? null,
    soldByUserId: (row.created_by as string | null) ?? null,
    receiptHeaderSnapshot: parseReceiptHeaderSnapshot((row.metadata as Record<string, unknown>)?.receiptHeaderSnapshot),
    receiptFooterSnapshot: parseReceiptFooterSnapshot((row.metadata as Record<string, unknown>)?.receiptFooterSnapshot),
    receiptCustomerName:
      (row.metadata as Record<string, unknown>)?.receiptCustomerName != null
        ? String((row.metadata as Record<string, unknown>).receiptCustomerName)
        : null,
    receiptCustomerPhone:
      (row.metadata as Record<string, unknown>)?.receiptCustomerPhone != null
        ? String((row.metadata as Record<string, unknown>).receiptCustomerPhone)
        : null,
  };
}

function parseReceiptHeaderSnapshot(raw: unknown): import("../types").ReceiptHeaderSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? r.lines.map((l) => String(l)).filter(Boolean) : [];
  return lines.length ? { lines } : null;
}

function parseReceiptFooterSnapshot(raw: unknown): import("../types").ReceiptFooterSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? r.lines.map((l) => String(l)).filter(Boolean) : [];
  const displayRaw = r.displayOptions;
  const displayOptions =
    displayRaw && typeof displayRaw === "object"
      ? { ...defaultReceiptDisplayOptions(), ...(displayRaw as object) }
      : defaultReceiptDisplayOptions();
  return {
    lines,
    poweredBy: r.poweredBy != null ? String(r.poweredBy) : null,
    displayOptions,
  };
}

function customerToRow(c: Customer, shopId: string) {
  const phone = c.phone?.trim();
  const phoneE164 = phone && /^\+256[0-9]{9}$/.test(phone) ? phone : null;
  return {
    id: c.id,
    shop_id: shopId,
    name: c.name,
    phone_e164: phoneE164,
    notes: c.location?.trim() || null,
    metadata: {
      location: c.location ?? "",
      debtBalanceUgx: c.debtBalanceUgx,
      version: c.version,
      phone: c.phone ?? "",
      wakaClient: true,
    },
    updated_at: new Date().toISOString(),
  };
}

function newer<T extends { updatedAt?: string; createdAt?: string; version?: number }>(a: T, b: T): T {
  const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
  const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
  if (ta !== tb) return ta >= tb ? a : b;
  return (a.version ?? 0) >= (b.version ?? 0) ? a : b;
}

const MERGE_CHUNK_SIZE = 200;

function mergeById<T extends { id: string }>(local: T[], remote: T[], pick: (a: T, b: T) => T): T[] {
  const map = new Map<string, T>();
  for (const r of remote) map.set(r.id, r);
  for (const l of local) {
    const existing = map.get(l.id);
    map.set(l.id, existing ? pick(l, existing) : l);
  }
  return [...map.values()];
}

async function mergeByIdChunked<T extends { id: string }>(
  local: T[],
  remote: T[],
  pick: (a: T, b: T) => T,
  tombstoneIds?: Set<string>,
): Promise<T[]> {
  const filteredRemote = tombstoneIds?.size ? remote.filter((r) => !tombstoneIds.has(r.id)) : remote;
  if (filteredRemote.length + local.length <= MERGE_CHUNK_SIZE) {
    return mergeById(local, filteredRemote, pick);
  }
  const map = new Map<string, T>();
  for (let i = 0; i < filteredRemote.length; i += MERGE_CHUNK_SIZE) {
    const chunk = filteredRemote.slice(i, i + MERGE_CHUNK_SIZE);
    for (const r of chunk) map.set(r.id, r);
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  for (let i = 0; i < local.length; i += MERGE_CHUNK_SIZE) {
    const chunk = local.slice(i, i + MERGE_CHUNK_SIZE);
    for (const l of chunk) {
      const existing = map.get(l.id);
      map.set(l.id, existing ? pick(l, existing) : l);
    }
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return [...map.values()];
}

function markSaleSyncState(saleId: string, synced: boolean, errorCode: string | null): void {
  usePosStore.setState((s) => ({
    sales: s.sales.map((x) =>
      x.id === saleId ? { ...x, pendingSync: !synced, lastSyncError: synced ? null : errorCode } : x,
    ),
  }));
}

/** Push catalog fields only — never overwrites server stock (use pushProductStockToCloud for deltas). */
export async function pushProductCatalogToCloud(
  product: Product,
  ctx: ShopCtx,
  opts?: { includeStock?: boolean },
): Promise<boolean> {
  if (!supabase || !isUuid(product.id)) return false;
  const { error } = await supabase
    .from("products")
    .upsert(productToRow(product, ctx.shopId, { includeStock: opts?.includeStock === true }), { onConflict: "id" });
  return !error;
}

export async function pushProductToCloud(product: Product, ctx: ShopCtx, deleted = false): Promise<boolean> {
  if (!supabase || !isUuid(product.id)) return false;
  if (deleted) {
    const { error } = await supabase
      .from("products")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", product.id)
      .eq("shop_id", ctx.shopId);
    return !error;
  }
  return pushProductCatalogToCloud(product, ctx);
}

export async function pushProductStockToCloud(
  productId: string,
  ctx: ShopCtx,
  opts: {
    delta: number;
    note?: string;
    baseUpdatedAt?: string | null;
    baseStockOnHand?: number;
    attempt?: number;
  },
): Promise<boolean> {
  if (!supabase || !isUuid(productId)) return false;

  const attempt = opts.attempt ?? 0;
  const { data, error } = await supabase.rpc("shop_push_product_stock", {
    p_shop_id: ctx.shopId,
    p_payload: {
      product_id: productId,
      delta: opts.delta,
      note: opts.note ?? "",
      base_updated_at: opts.baseUpdatedAt ?? null,
      base_stock_on_hand: opts.baseStockOnHand ?? null,
    },
  });

  if (error) {
    reportSyncIssue("product_stock_rpc_failed", { productId, code: error.code ?? "unknown" });
    return false;
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    server_stock_on_hand?: number;
    server_updated_at?: string;
    stock_on_hand?: number;
    updated_at?: string;
  } | null;

  if (!result?.ok) {
    if (result?.error === "stale_version") {
      reportSyncIssue("product_stock_stale", {
        productId,
        serverStock: result.server_stock_on_hand,
        baseStock: opts.baseStockOnHand,
      });
    }
    if (result?.error === "stale_version" && attempt < 3) {
      const serverStock = Number(result.server_stock_on_hand ?? 0);
      const serverUpdatedAt = String(result.server_updated_at ?? new Date().toISOString());
      const local = usePosStore.getState().products.find((p) => p.id === productId);
      if (local) {
        usePosStore.setState((s) => ({
          products: s.products.map((p) =>
            p.id === productId
              ? { ...p, stockOnHand: serverStock, updatedAt: serverUpdatedAt, version: p.version + 1 }
              : p,
          ),
        }));
      }
      const refreshed = usePosStore.getState().products.find((p) => p.id === productId);
      return pushProductStockToCloud(productId, ctx, {
        ...opts,
        baseUpdatedAt: serverUpdatedAt,
        baseStockOnHand: refreshed?.stockOnHand ?? serverStock,
        attempt: attempt + 1,
      });
    }
    reportSyncIssue("product_stock_push_failed", { productId, error: result?.error ?? "unknown" });
    return false;
  }

  const serverStock = Number(result.stock_on_hand ?? 0);
  const serverUpdatedAt = String(result.updated_at ?? new Date().toISOString());
  usePosStore.setState((s) => ({
    products: s.products.map((p) =>
      p.id === productId
        ? { ...p, stockOnHand: serverStock, updatedAt: serverUpdatedAt, version: p.version + 1 }
        : p,
    ),
  }));
  return true;
}

export async function pushAuditLogToCloud(entry: AuditLogEntry, ctx: ShopCtx): Promise<boolean> {
  if (!supabase) return false;

  const actorId = isUuid(entry.actorUserId) ? entry.actorUserId : ctx.userId;
  const clientEntryId = isUuid(entry.id) ? entry.id : null;
  if (!clientEntryId) return false;

  const row: Record<string, unknown> = {
    shop_id: ctx.shopId,
    actor_user_id: actorId,
    role: entry.role,
    action: entry.action,
    payload_summary: entry.payloadSummary.slice(0, 500),
    payload: entry.payload,
    device_id: entry.deviceId ?? null,
    client_entry_id: clientEntryId,
    created_at: entry.at,
  };

  const { error } = await supabase.from("audit_logs").insert(row);

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") return true;
    reportSyncIssue("audit_log_push_failed", { entryId: entry.id, code: code ?? "unknown" });
    return false;
  }
  return true;
}

export async function pushDebtPaymentToCloud(
  paymentId: string,
  ctx: ShopCtx,
  attempt = 0,
): Promise<boolean> {
  if (!supabase || !isUuid(paymentId)) return false;

  const state = usePosStore.getState();
  const payment = state.debtPayments.find((p) => p.id === paymentId);
  if (!payment) return true;

  const customer = state.customers.find((c) => c.id === payment.customerId);
  if (!customer || !isUuid(customer.id)) return true;

  const expectedBalance = customer.debtBalanceUgx + payment.amountUgx;

  const { data, error } = await supabase.rpc("shop_push_debt_payment", {
    p_shop_id: ctx.shopId,
    p_payload: {
      payment_id: payment.id,
      customer_id: payment.customerId,
      amount_ugx: payment.amountUgx,
      created_at: payment.createdAt,
      expected_balance_ugx: expectedBalance,
    },
  });

  if (error) {
    reportSyncIssue("debt_payment_rpc_failed", { paymentId, code: error.code ?? "unknown" });
    return false;
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    server_balance_ugx?: number;
    new_balance_ugx?: number;
  } | null;

  if (!result?.ok) {
    if (result?.error === "stale_balance" && attempt < 2) {
      const serverBalance = Number(result.server_balance_ugx ?? customer.debtBalanceUgx);
      usePosStore.setState((s) => ({
        customers: s.customers.map((c) =>
          c.id === payment.customerId ? { ...c, debtBalanceUgx: serverBalance, version: c.version + 1 } : c,
        ),
      }));
      return pushDebtPaymentToCloud(paymentId, ctx, attempt + 1);
    }
    reportSyncIssue("debt_payment_push_failed", { paymentId, error: result?.error ?? "unknown" });
    return false;
  }

  const newBalance = Number(result.new_balance_ugx ?? customer.debtBalanceUgx);
  usePosStore.setState((s) => ({
    customers: s.customers.map((c) =>
      c.id === payment.customerId ? { ...c, debtBalanceUgx: newBalance, version: c.version + 1 } : c,
    ),
  }));
  return true;
}

export async function pushCustomerToCloud(customer: Customer, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(customer.id)) return false;
  const { error } = await supabase.from("customers").upsert(customerToRow(customer, ctx.shopId), { onConflict: "id" });
  return !error;
}

async function resolveSaleForSync(saleId: string): Promise<Sale | null> {
  const state = usePosStore.getState();
  const inRam = state.sales.find((s) => s.id === saleId);
  if (inRam) return inRam;
  const inArchive = state.archivedSales.find((s) => s.id === saleId);
  if (inArchive) return inArchive;
  const { getEntitiesByIds } = await import("./entityStore");
  const [fromDisk] = await getEntitiesByIds<Sale>("sale", [saleId]);
  if (fromDisk) return fromDisk;
  const [fromArchiveDisk] = await getEntitiesByIds<Sale>("archivedSale", [saleId]);
  return fromArchiveDisk ?? null;
}

async function resolveReturnForSync(returnId: string): Promise<ReturnRecord | null> {
  const state = usePosStore.getState();
  const inRam = state.returnRecords.find((r) => r.id === returnId);
  if (inRam) return inRam;
  const inArchive = state.archivedReturnRecords.find((r) => r.id === returnId);
  if (inArchive) return inArchive;
  const { getEntitiesByIds } = await import("./entityStore");
  const [fromDisk] = await getEntitiesByIds<ReturnRecord>("returnRecord", [returnId]);
  if (fromDisk) return fromDisk;
  const [fromArchiveDisk] = await getEntitiesByIds<ReturnRecord>("archivedReturnRecord", [returnId]);
  return fromArchiveDisk ?? null;
}

function buildSalePushPayload(sale: Sale, ctx: ShopCtx) {
  const qtyByProduct = new Map<string, number>();
  for (const line of sale.lines) {
    if (line.voided || !isUuid(line.productId)) continue;
    qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.quantity);
  }

  const activeLines = sale.lines.filter((line) => !line.voided).map(ensureSaleLineId);
  return {
    sale: {
      id: sale.id,
      customer_id: sale.customerId && isUuid(sale.customerId) ? sale.customerId : null,
      payment_status: sale.debtUgx > 0 ? "partial" : "paid",
      subtotal_ugx: sale.subtotalUgx,
      tax_ugx: 0,
      discount_ugx: sale.discountTotalUgx ?? 0,
      total_ugx: sale.totalUgx,
      cash_amount_ugx: sale.cashPaidUgx,
      debt_amount_ugx: sale.debtUgx,
      issue_receipt: false,
      created_by: sale.soldByUserId && isUuid(sale.soldByUserId) ? sale.soldByUserId : ctx.userId,
      completed_at: sale.createdAt,
      metadata: {
        estimatedProfitUgx: sale.estimatedProfitUgx,
        wakaClient: true,
        receiptHeaderSnapshot: sale.receiptHeaderSnapshot ?? null,
        receiptFooterSnapshot: sale.receiptFooterSnapshot ?? null,
        receiptCustomerName: sale.receiptCustomerName ?? null,
        receiptCustomerPhone: sale.receiptCustomerPhone ?? null,
      },
      created_at: sale.createdAt,
      updated_at: sale.createdAt,
    },
    lines: activeLines.map((line, idx) => ({
      id: line.id,
      product_id: line.productId,
      quantity: line.quantity,
      unit_price_ugx: line.unitPriceUgx,
      line_discount_ugx: line.discountUgx ?? Math.max(0, (line.originalLineTotalUgx ?? line.lineTotalUgx) - line.lineTotalUgx),
      line_total_ugx: line.lineTotalUgx,
      line_input_mode: line.inputMode,
      money_amount_ugx: line.moneyAmountUgx ?? null,
      metadata: {
        name: line.name,
        unitCostUgx: line.unitCostUgx,
        cogsUgx: line.cogsUgx,
        cartDiscountUgx: line.cartDiscountUgx,
        netRevenueUgx: line.netRevenueUgx,
        grossProfitUgx: line.grossProfitUgx,
        baseUnit: line.baseUnit,
        estimatedProfitUgx: line.estimatedProfitUgx,
        lineIndex: idx,
      },
    })),
    payments:
      sale.cashPaidUgx > 0
        ? [
            {
              method: "cash",
              amount_ugx: sale.cashPaidUgx,
              recorded_by: ctx.userId,
            },
          ]
        : [],
  };
}

function buildPendingSalePushPayload(
  sale: Sale,
  ctx: ShopCtx,
  opts?: { baseUpdatedAt?: string | null; deletedLineIds?: string[] },
) {
  const activeLines = sale.lines.filter((line) => !line.voided).map(ensureSaleLineId);
  const now = new Date().toISOString();
  return {
    base_updated_at: opts?.baseUpdatedAt ?? null,
    deleted_line_ids: opts?.deletedLineIds ?? [],
    sale: {
      id: sale.id,
      customer_id: sale.customerId && isUuid(sale.customerId) ? sale.customerId : null,
      subtotal_ugx: sale.subtotalUgx,
      tax_ugx: 0,
      discount_ugx: sale.discountTotalUgx ?? 0,
      total_ugx: sale.totalUgx,
      reference_label: sale.referenceLabel ?? null,
      table_session_id: sale.tableSessionId && isUuid(sale.tableSessionId) ? sale.tableSessionId : null,
      created_by: sale.soldByUserId && isUuid(sale.soldByUserId) ? sale.soldByUserId : ctx.userId,
      created_at: sale.createdAt,
      updated_at: sale.updatedAt ?? sale.createdAt,
      metadata: { estimatedProfitUgx: sale.estimatedProfitUgx, wakaClient: true, hospitality: true },
    },
    lines: activeLines.map((line, idx) => ({
      id: line.id,
      product_id: line.productId,
      quantity: line.quantity,
      unit_price_ugx: line.unitPriceUgx,
      line_discount_ugx: line.discountUgx ?? 0,
      line_total_ugx: line.lineTotalUgx,
      line_input_mode: line.inputMode,
      money_amount_ugx: line.moneyAmountUgx ?? null,
      metadata: {
        name: line.name,
        unitCostUgx: line.unitCostUgx,
        cogsUgx: line.cogsUgx,
        cartDiscountUgx: line.cartDiscountUgx,
        netRevenueUgx: line.netRevenueUgx,
        grossProfitUgx: line.grossProfitUgx,
        baseUnit: line.baseUnit,
        estimatedProfitUgx: line.estimatedProfitUgx,
        updatedAt: line.updatedAt ?? now,
        lineIndex: idx,
      },
    })),
  };
}

function parseServerPendingLines(raw: unknown): SaleLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => rowToSaleLine(row as Record<string, unknown>));
}

function applyMergedPendingSaleToStore(merged: Sale): void {
  usePosStore.setState((s) => ({
    sales: [merged, ...s.sales.filter((x) => x.id !== merged.id)],
  }));
}

export async function refreshPendingSaleFromCloud(saleId: string, ctx?: ShopCtx): Promise<Sale | null> {
  if (!supabase || !isUuid(saleId)) return null;
  const shopCtx = ctx ?? (await resolveShopCtx());
  if (!shopCtx) return null;

  const { data, error } = await supabase
    .from("sales")
    .select("*, sale_line_items(*)")
    .eq("id", saleId)
    .eq("shop_id", shopCtx.shopId)
    .maybeSingle();

  if (error || !data) return null;
  const raw = data as Record<string, unknown>;
  const status = String(raw.status ?? "");
  if (status !== "draft") return null;

  const items = (raw.sale_line_items as Record<string, unknown>[] | null) ?? [];
  const lines = items.map((ln) => rowToSaleLine(ln));
  const remote = rowToSale(raw, lines);
  if (!remote || remote.status !== "pending") return null;

  const state = usePosStore.getState();
  const local = state.sales.find((s) => s.id === saleId);
  const merged = local ? mergePendingSalePair(local, remote) : remote;
  applyMergedPendingSaleToStore(merged);

  const activeSessionId = state.preferences.activeTableSessionId;
  const session = state.preferences.hospitalityFloor?.sessions.find((s) => s.id === activeSessionId);
  if (session?.saleId === saleId && state.activePendingSaleId === saleId) {
    usePosStore.setState({ draftLines: merged.lines.map((l) => ({ ...l })) });
  }
  return merged;
}

export async function refreshOpenPendingSalesFromCloud(ctx?: ShopCtx): Promise<void> {
  const shopCtx = ctx ?? (await resolveShopCtx());
  if (!shopCtx || !getDeviceOnline()) return;
  const floor = usePosStore.getState().preferences.hospitalityFloor;
  if (!floor) return;
  const saleIds = [
    ...new Set(
      floor.sessions
        .filter((s) => s.status === "open" || s.status === "payment_pending")
        .map((s) => s.saleId)
        .filter(isUuid),
    ),
  ];
  for (const saleId of saleIds) {
    await refreshPendingSaleFromCloud(saleId, shopCtx);
  }
}

export async function pushPendingSaleToCloud(
  sale: Sale,
  ctx: ShopCtx,
  opts?: { baseUpdatedAt?: string | null; deletedLineIds?: string[]; attempt?: number },
): Promise<boolean> {
  if (!supabase || !isUuid(sale.id)) {
    markSaleSyncState(sale.id, false, "invalid_sale_id");
    return false;
  }
  if (!isPendingSale(sale)) {
    return pushSaleToCloud(sale, ctx);
  }

  const attempt = opts?.attempt ?? 0;
  const payload = buildPendingSalePushPayload(sale, ctx, {
    baseUpdatedAt: opts?.baseUpdatedAt ?? null,
    deletedLineIds: opts?.deletedLineIds,
  });
  const { data, error } = await supabase.rpc("shop_push_pending_sale", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });

  if (error) {
    markSaleSyncState(sale.id, false, error.code ?? "pending_sale_rpc_failed");
    reportSyncIssue("pending_sale_rpc_failed", { saleId: sale.id, code: error.code ?? "unknown" });
    return false;
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    server_updated_at?: string;
    updated_at?: string;
    lines?: unknown;
  } | null;

  if (!result?.ok) {
    if (result?.error === "stale_version" && attempt < 3) {
      const serverLines = parseServerPendingLines(result.lines);
      const serverUpdatedAt = String(result.server_updated_at ?? new Date().toISOString());
      const serverSale: Sale = {
        ...sale,
        lines: serverLines,
        updatedAt: serverUpdatedAt,
        status: "pending",
      };
      const merged = mergePendingSales(serverSale, sale);
      applyMergedPendingSaleToStore(merged);
      return pushPendingSaleToCloud(merged, ctx, {
        baseUpdatedAt: serverUpdatedAt,
        deletedLineIds: [],
        attempt: attempt + 1,
      });
    }
    markSaleSyncState(sale.id, false, result?.error ?? "pending_sale_rejected");
    reportSyncIssue("pending_sale_rejected", { saleId: sale.id, error: result?.error ?? "unknown" });
    return false;
  }

  const serverUpdatedAt = result.updated_at ? String(result.updated_at) : sale.updatedAt;
  if (serverUpdatedAt) {
    usePosStore.setState((s) => ({
      sales: s.sales.map((x) =>
        x.id === sale.id ? { ...x, updatedAt: serverUpdatedAt, pendingSync: false, lastSyncError: null } : x,
      ),
    }));
  } else {
    markSaleSyncState(sale.id, true, null);
  }
  return true;
}

export async function pushCancelPendingSaleToCloud(saleId: string, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(saleId)) return false;
  const { data, error } = await supabase.rpc("shop_cancel_pending_sale", {
    p_shop_id: ctx.shopId,
    p_sale_id: saleId,
  });
  if (error) {
    markSaleSyncState(saleId, false, error.code ?? "cancel_pending_failed");
    return false;
  }
  const result = data as { ok?: boolean; error?: string } | null;
  if (!result?.ok) {
    markSaleSyncState(saleId, false, result?.error ?? "cancel_pending_rejected");
    return false;
  }
  markSaleSyncState(saleId, true, null);
  return true;
}

/** Route draft vs completed sales to the correct cloud RPC. */
export async function pushSaleRowToCloud(
  sale: Sale,
  ctx: ShopCtx,
  opts?: { baseUpdatedAt?: string | null; deletedLineIds?: string[] },
): Promise<boolean> {
  if (isPendingSale(sale)) return pushPendingSaleToCloud(sale, ctx, opts);
  if (saleStatusOf(sale) === "cancelled") return pushCancelPendingSaleToCloud(sale.id, ctx);
  return pushSaleToCloud(sale, ctx);
}

export async function pushSaleToCloud(sale: Sale, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(sale.id)) {
    markSaleSyncState(sale.id, false, "invalid_sale_id");
    return false;
  }
  if (isPendingSale(sale)) {
    return pushPendingSaleToCloud(sale, ctx);
  }
  if (saleStatusOf(sale) === "cancelled") {
    return pushCancelPendingSaleToCloud(sale.id, ctx);
  }

  const payload = buildSalePushPayload(sale, ctx);
  const { data, error } = await supabase.rpc("shop_push_sale_complete", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });

  if (error) {
    markSaleSyncState(sale.id, false, error.code ?? "sale_rpc_failed");
    reportSyncIssue("sale_rpc_failed", { saleId: sale.id, code: error.code ?? "unknown" });
    return false;
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    product_stocks?: ServerProductStockRow[];
  } | null;
  if (!result?.ok) {
    markSaleSyncState(sale.id, false, result?.error ?? "sale_rpc_rejected");
    reportSyncIssue("sale_rpc_rejected", { saleId: sale.id, error: result?.error ?? "unknown" });
    return false;
  }

  const stockRows = Array.isArray(result?.product_stocks) ? result.product_stocks : [];
  if (stockRows.length > 0) {
    usePosStore.setState((s) => ({
      products: patchProductsWithServerStock(s.products, stockRows),
    }));
  } else {
    await refreshProductStockFromCloud(
      sale.lines.filter((l) => !l.voided).map((l) => l.productId),
      ctx,
    );
  }

  markSaleSyncState(sale.id, true, null);
  return true;
}

/** Fetch authoritative stock_on_hand from cloud after sale or pull. */
export async function refreshProductStockFromCloud(
  productIds: string[],
  ctx: ShopCtx,
): Promise<void> {
  if (!supabase || productIds.length === 0) return;
  const ids = [...new Set(productIds)].filter((id) => isUuid(id));
  if (ids.length === 0) return;

  const { data, error } = await supabase
    .from("products")
    .select("id, stock_on_hand, updated_at")
    .eq("shop_id", ctx.shopId)
    .in("id", ids);

  if (error || !data?.length) return;

  const rows: ServerProductStockRow[] = data.map((row) => ({
    product_id: String(row.id),
    stock_on_hand: Number(row.stock_on_hand ?? 0),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }));

  usePosStore.setState((s) => ({
    products: patchProductsWithServerStock(s.products, rows),
  }));
}

async function pushReturnToCloud(returnRow: ReturnRecord, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(returnRow.id)) return false;
  const payload = {
    id: returnRow.id,
    sale_id: returnRow.saleId && isUuid(returnRow.saleId) ? returnRow.saleId : null,
    product_id: returnRow.productId,
    quantity: returnRow.quantity,
    refund_amount_ugx: returnRow.refundAmountUgx,
    reason: returnRow.reason,
    note: returnRow.note ?? null,
    created_by: isUuid(returnRow.actorUserId) ? returnRow.actorUserId : ctx.userId,
    created_at: returnRow.createdAt,
    metadata: {
      productName: returnRow.productName,
      actorName: returnRow.actorName ?? null,
      shiftId: returnRow.shiftId ?? null,
      cogsUgx: returnRow.cogsUgx ?? null,
      unitCostUgx: returnRow.unitCostUgx ?? null,
      wakaClient: true,
    },
  };
  const { data, error } = await supabase.rpc("shop_push_sale_return", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (isMissingTableError(error)) return false;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  return result?.ok === true;
}

function rowToCashExpense(raw: Record<string, unknown>): CashExpense | null {
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  const deletedAt = raw.deleted_at != null ? String(raw.deleted_at) : null;
  return {
    id,
    category: String(raw.category ?? "Miscellaneous"),
    amountUgx: Number(raw.amount_ugx ?? 0),
    description: raw.description != null ? String(raw.description) : "",
    paidOn: String(raw.paid_on ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    createdAt: String(raw.created_at ?? new Date().toISOString()),
    createdByUserId: String(raw.created_by ?? ""),
    createdByLabel:
      raw.recorded_by_label != null
        ? String(raw.recorded_by_label)
        : raw.metadata && typeof raw.metadata === "object"
          ? String((raw.metadata as Record<string, unknown>).actorName ?? "")
          : undefined,
    pendingSync: false,
    lastSyncError: null,
    deletedAt,
  };
}

async function pushCashExpenseToCloud(expense: CashExpense, ctx: ShopCtx, voided = false): Promise<boolean> {
  if (!supabase || !isUuid(expense.id)) return false;
  if (voided || expense.deletedAt) {
    const { data, error } = await supabase.rpc("shop_void_cash_expense", {
      p_shop_id: ctx.shopId,
      p_expense_id: expense.id,
    });
    if (error) {
      if (isMissingTableError(error)) return true;
      return false;
    }
    const result = data as { ok?: boolean } | null;
    return result?.ok === true;
  }
  const payload = {
    id: expense.id,
    category: expense.category,
    amount_ugx: expense.amountUgx,
    description: expense.description || null,
    paid_on: expense.paidOn,
    created_at: expense.createdAt,
    recorded_by_staff_id: expense.createdByUserId.startsWith("staff:") ? expense.createdByUserId : null,
    recorded_by_label: expense.createdByLabel ?? null,
    metadata: { wakaClient: true },
  };
  const { data, error } = await supabase.rpc("shop_push_cash_expense", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (isMissingTableError(error)) return true;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  return result?.ok === true;
}

export async function syncCashExpenseImmediately(expenseId: string): Promise<boolean> {
  if (!hasSupabaseConfig) return false;
  if (!getDeviceOnline()) return false;
  const row = usePosStore.getState().cashExpenses.find((e) => e.id === expenseId);
  if (!row) return false;
  const ctx = await resolveShopCtx();
  if (!ctx) return false;
  const ok = await pushCashExpenseToCloud(row, ctx, Boolean(row.deletedAt));
  if (ok) {
    usePosStore.setState((s) => ({
      cashExpenses: s.cashExpenses.map((e) =>
        e.id === expenseId ? { ...e, pendingSync: false, lastSyncError: null } : e,
      ),
    }));
  }
  return ok;
}

async function pushCashDrawerAdjustmentToCloud(adj: CashDrawerAdjustment, ctx: ShopCtx): Promise<boolean> {
  if (!supabase) return false;
  const payload = {
    id: adj.id,
    type: adj.type,
    amount_ugx: adj.amountUgx,
    note: adj.note,
    actor_user_id: adj.actorUserId,
    actor_label: adj.actorName ?? null,
    occurred_at: adj.occurredAt,
    created_at: adj.createdAt,
    deleted_at: adj.deletedAt,
    metadata: { wakaClient: true },
  };
  const { data, error } = await supabase.rpc("shop_push_cash_drawer_adjustment", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (isMissingTableError(error)) return true;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  return result?.ok === true;
}

export async function syncCashDrawerAdjustmentImmediately(adjustmentId: string): Promise<boolean> {
  if (!hasSupabaseConfig) return false;
  if (!getDeviceOnline()) return false;
  const row = usePosStore.getState().cashDrawerAdjustments.find((a) => a.id === adjustmentId);
  if (!row) return false;
  const ctx = await resolveShopCtx();
  if (!ctx) return false;
  const ok = await pushCashDrawerAdjustmentToCloud(row, ctx);
  if (ok) {
    usePosStore.setState((s) => ({
      cashDrawerAdjustments: s.cashDrawerAdjustments.map((a) =>
        a.id === adjustmentId ? { ...a, pendingSync: false, lastSyncError: null, syncedAt: new Date().toISOString() } : a,
      ),
    }));
  }
  return ok;
}

async function pushPurchaseToCloud(purchase: Purchase, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(purchase.id)) return false;
  const payload = buildPurchaseCloudPushPayload(purchase);
  const { data, error } = await supabase.rpc("shop_push_purchase", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (isMissingTableError(error)) return false;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  return result?.ok === true;
}

function markPurchaseSynced(purchaseId: string, extra?: Partial<Purchase>): void {
  usePosStore.setState((s) => ({
    purchases: s.purchases.map((p) =>
      p.id === purchaseId ? { ...p, pendingSync: false, ...extra } : p,
    ),
  }));
}

async function syncPurchaseVoidStockReversal(purchase: Purchase, ctx: ShopCtx): Promise<boolean> {
  if (purchase.voidStockSyncedAt) return true;
  if (!purchase.preVoidCloudSynced) return true;

  for (const ln of purchase.lines) {
    const product = usePosStore.getState().products.find((p) => p.id === ln.productId);
    if (!product) continue;
    const baseOut = purchaseLineBaseUnitsIn(product, ln);
    if (baseOut <= 0) continue;
    const catalogOk = await pushProductCatalogToCloud(product, ctx);
    if (!catalogOk) return false;
    const stockOk = await pushProductStockToCloud(product.id, ctx, {
      delta: -baseOut,
      note: `purchase_void:${purchase.id}`,
      baseUpdatedAt: product.updatedAt,
      baseStockOnHand: product.stockOnHand + baseOut,
    });
    if (!stockOk) return false;
  }

  markPurchaseSynced(purchase.id, { voidStockSyncedAt: new Date().toISOString() });
  return true;
}

async function syncPurchaseVoidBundle(purchaseId: string, ctx: ShopCtx): Promise<boolean> {
  const purchase = usePosStore.getState().purchases.find((p) => p.id === purchaseId);
  if (!purchase) return true;
  if (!isPurchaseVoided(purchase)) return syncPurchaseBundle(purchaseId, ctx);

  const purchaseOk = await pushPurchaseToCloud(purchase, ctx);
  if (!purchaseOk) return false;

  const stockOk = await syncPurchaseVoidStockReversal(purchase, ctx);
  if (!stockOk) return false;

  if (!isWalkInSupplierId(purchase.supplierId)) {
    const supplier = usePosStore.getState().suppliers.find((s) => s.id === purchase.supplierId);
    if (supplier) {
      const supplierOk = await pushSupplierToCloud(supplier, ctx);
      if (!supplierOk) return false;
    }
  }

  markPurchaseSynced(purchaseId);
  return true;
}

async function syncPurchaseBundle(purchaseId: string, ctx: ShopCtx): Promise<boolean> {
  const purchase = usePosStore.getState().purchases.find((p) => p.id === purchaseId);
  if (!purchase) return true;
  if (isPurchaseVoided(purchase)) return syncPurchaseVoidBundle(purchaseId, ctx);

  const purchaseOk = await pushPurchaseToCloud(purchase, ctx);
  if (!purchaseOk) return false;

  for (const ln of purchase.lines) {
    const product = usePosStore.getState().products.find((p) => p.id === ln.productId);
    if (!product) continue;
    const baseIn = purchaseLineBaseUnitsIn(product, ln);
    if (baseIn <= 0) continue;
    const catalogOk = await pushProductCatalogToCloud(product, ctx);
    if (!catalogOk) return false;
    const stockOk = await pushProductStockToCloud(product.id, ctx, {
      delta: baseIn,
      note: `purchase:${purchase.id}`,
      baseUpdatedAt: product.updatedAt,
      baseStockOnHand: product.stockOnHand - baseIn,
    });
    if (!stockOk) return false;
  }

  if (!isWalkInSupplierId(purchase.supplierId)) {
    const supplier = usePosStore.getState().suppliers.find((s) => s.id === purchase.supplierId);
    if (supplier) {
      const supplierOk = await pushSupplierToCloud(supplier, ctx);
      if (!supplierOk) return false;
    }
  }

  markPurchaseSynced(purchaseId);
  return true;
}

async function pushSupplierToCloud(supplier: Supplier, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(supplier.id) || isWalkInSupplierId(supplier.id)) return true;
  const payload = {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    location: supplier.location,
    notes: supplier.notes,
    balance_owed_ugx: supplier.balanceOwedUgx,
    total_purchases_ugx: supplier.totalPurchasesUgx,
    last_supply_at: supplier.lastSupplyAt,
    created_at: supplier.createdAt,
    metadata: { wakaClient: true, version: supplier.version },
  };
  const { data, error } = await supabase.rpc("shop_push_supplier", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (isMissingTableError(error)) return false;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  return result?.ok === true;
}

async function pushSupplierPaymentToCloud(payment: SupplierPayment, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(payment.id)) return false;
  const payload = {
    id: payment.id,
    supplier_id: payment.supplierId,
    amount_ugx: payment.amountUgx,
    created_at: payment.createdAt,
    metadata: { wakaClient: true },
  };
  const { data, error } = await supabase.rpc("shop_push_supplier_payment", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (isMissingTableError(error)) return false;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  const ok = result?.ok === true;
  if (ok) {
    usePosStore.setState((s) => ({
      supplierPayments: s.supplierPayments.map((p) =>
        p.id === payment.id ? { ...p, pendingSync: false } : p,
      ),
    }));
  }
  return ok;
}

/** Push one sale to Supabase as soon as possible (after checkout). */
export async function syncSaleImmediately(saleId: string): Promise<boolean> {
  if (!hasSupabaseConfig) return false;
  if (!getDeviceOnline()) return false;
  const sale = await resolveSaleForSync(saleId);
  if (!sale) return false;
  const ctx = await resolveShopCtx();
  if (!ctx) return false;
  return pushSaleRowToCloud(sale, ctx);
}

export async function processCloudSyncOperation(op: SyncOperation): Promise<boolean> {
  const { assertOrganizationOperationsAllowed } = await import("../lib/organizationDeletionState");
  try {
    await assertOrganizationOperationsAllowed();
  } catch {
    return false;
  }

  const ctx = await resolveShopCtx();
  if (!ctx) return false;

  const payload = op.payload as Record<string, unknown>;

  switch (op.kind) {
    case "product": {
      const productId = String(payload.id ?? "");
      if (payload.deleted) {
        if (!isUuid(productId)) return true;
        const { error } = await supabase!
          .from("products")
          .update({ is_active: false })
          .eq("id", productId)
          .eq("shop_id", ctx.shopId);
        if (!error) {
          const { clearProductTombstone } = await import("./entityStore");
          await clearProductTombstone(productId);
        }
        return !error;
      }
      if (payload.presets === true || payload.catalogOnly === true) {
        const product = usePosStore.getState().products.find((p) => p.id === productId);
        if (!product) return true;
        return pushProductCatalogToCloud(product, ctx);
      }
      const includeStock = payload.isNew === true;
      const product = usePosStore.getState().products.find((p) => p.id === productId);
      if (!product) return true;
      return pushProductCatalogToCloud(product, ctx, { includeStock });
    }
    case "pending_purchases": {
      const purchaseId = String(payload.purchaseId ?? "");
      if (!purchaseId) return true;
      if (payload.void === true) return syncPurchaseVoidBundle(purchaseId, ctx);
      return syncPurchaseBundle(purchaseId, ctx);
    }
    case "purchase": {
      const purchaseId = String(payload.purchaseId ?? payload.id ?? "");
      if (!purchaseId) return true;
      if (payload.void === true) return syncPurchaseVoidBundle(purchaseId, ctx);
      return syncPurchaseBundle(purchaseId, ctx);
    }
    case "supplier": {
      const supplierId = String(payload.id ?? "");
      const supplier = usePosStore.getState().suppliers.find((s) => s.id === supplierId);
      if (!supplier) return true;
      return pushSupplierToCloud(supplier, ctx);
    }
    case "pending_stock_updates":
    case "stock_move": {
      if (payload.kind === "purchase_void") {
        const purchaseId = String(payload.purchaseId ?? "");
        if (!purchaseId) return true;
        return syncPurchaseVoidBundle(purchaseId, ctx);
      }
      if (payload.kind === "purchase") {
        const purchaseId = String(payload.purchaseId ?? "");
        if (!purchaseId) return true;
        return syncPurchaseBundle(purchaseId, ctx);
      }
      const productId = String(payload.productId ?? payload.id ?? "");
      const delta = Number(payload.delta ?? 0);
      if (isUuid(productId) && delta !== 0) {
        return pushProductStockToCloud(productId, ctx, {
          delta,
          note: typeof payload.note === "string" ? payload.note : "",
          baseUpdatedAt: typeof payload.baseUpdatedAt === "string" ? payload.baseUpdatedAt : null,
          baseStockOnHand: typeof payload.baseStockOnHand === "number" ? payload.baseStockOnHand : undefined,
        });
      }
      if (payload.catalogOnly === true && isUuid(productId)) {
        const product = usePosStore.getState().products.find((p) => p.id === productId);
        if (!product) return true;
        return pushProductCatalogToCloud(product, ctx);
      }
      reportSyncIssue("stock_update_missing_delta", { productId, kind: op.kind });
      return false;
    }
    case "pending_sales":
    case "sale": {
      if (payload.kind === "day_close") return true;
      const saleId = String(payload.saleId ?? "");
      if (payload.kind === "pending_cancel") {
        return pushCancelPendingSaleToCloud(saleId, ctx);
      }
      const sale = await resolveSaleForSync(saleId);
      if (!sale) return false;
      return pushSaleRowToCloud(sale, ctx, {
        baseUpdatedAt: typeof payload.baseUpdatedAt === "string" ? payload.baseUpdatedAt : null,
        deletedLineIds: Array.isArray(payload.deletedLineIds)
          ? payload.deletedLineIds.filter((id): id is string => typeof id === "string")
          : undefined,
      });
    }
    case "pending_returns": {
      const returnId = String(payload.returnId ?? "");
      const row = await resolveReturnForSync(returnId);
      if (!row) return false;
      if (row.saleId) {
        const sale = await resolveSaleForSync(row.saleId);
        if (sale) {
          const synced = await pushSaleRowToCloud(sale, ctx);
          if (!synced) return false;
        }
      }
      return pushReturnToCloud(row, ctx);
    }
    case "pending_expenses":
      if (payload.kind === "supplier_payment") {
        const paymentId = String(payload.paymentId ?? "");
        const payment = usePosStore.getState().supplierPayments.find((p) => p.id === paymentId);
        if (!payment) return true;
        return pushSupplierPaymentToCloud(payment, ctx);
      }
      return true;
    case "pending_day_drawer_opens": {
      const ctx = await resolveShopCtx();
      if (!ctx) return false;
      return syncDayDrawerOpenOperation(payload as Record<string, unknown>, ctx);
    }
    case "pending_inventory_counts": {
      const sessionId = String(payload.sessionId ?? "");
      if (!sessionId) return true;
      const session = usePosStore.getState().inventoryCountSessions.find((r) => r.id === sessionId);
      if (!session) return true;
      const ok = await pushInventoryCountSessionToCloud(session, ctx);
      if (ok) {
        usePosStore.setState((s) => ({
          inventoryCountSessions: s.inventoryCountSessions.map((row) =>
            row.id === sessionId ? { ...row, pendingSync: false } : row,
          ),
        }));
      }
      return ok;
    }
    case "pending_shifts": {
      const shiftId = String(payload.shiftId ?? "");
      if (!shiftId) return true;
      const shift = (usePosStore.getState().preferences.shifts ?? []).find((r) => r.id === shiftId);
      if (!shift) return true;
      const ok = await pushShiftToCloud(shift, ctx);
      if (ok) {
        usePosStore.setState((s) => ({
          preferences: {
            ...s.preferences,
            shifts: (s.preferences.shifts ?? []).map((row) =>
              row.id === shiftId ? { ...row, pendingSync: false } : row,
            ),
          },
        }));
      }
      return ok;
    }
    case "pending_day_closes": {
      const closeId = String(payload.closeId ?? "");
      if (!closeId) return true;
      const close = usePosStore.getState().dayCloses.find((r) => r.id === closeId);
      if (!close) return true;
      const ok = await pushDayCloseToCloud(close, ctx);
      if (ok) {
        usePosStore.setState((s) => ({
          dayCloses: s.dayCloses.map((row) =>
            row.id === closeId ? { ...row, pendingSync: false } : row,
          ),
        }));
      }
      return ok;
    }
    case "pending_cash_expenses": {
      const expenseId = String(payload.expenseId ?? "");
      const row = usePosStore.getState().cashExpenses.find((e) => e.id === expenseId);
      if (!row) return true;
      const voided = Boolean(payload.void);
      const ok = await pushCashExpenseToCloud(row, ctx, voided);
      if (ok) {
        usePosStore.setState((s) => ({
          cashExpenses: s.cashExpenses.map((e) =>
            e.id === expenseId ? { ...e, pendingSync: false, lastSyncError: null } : e,
          ),
        }));
      }
      return ok;
    }
    case "pending_cash_drawer_adjustments": {
      const adjustmentId = String(payload.adjustmentId ?? "");
      if (!adjustmentId) return true;
      return syncCashDrawerAdjustmentImmediately(adjustmentId);
    }
    case "customer": {
      if (payload.kind === "debt_payment") {
        const paymentId = String(payload.paymentId ?? "");
        if (!paymentId) return true;
        return pushDebtPaymentToCloud(paymentId, ctx);
      }
      const customerId = String(payload.id ?? "");
      const customer = usePosStore.getState().customers.find((c) => c.id === customerId);
      if (!customer) return true;
      return pushCustomerToCloud(customer, ctx);
    }
    case "pending_hospitality": {
      const { processHospitalitySyncOperation } = await import("./hospitalityCloudSync");
      return processHospitalitySyncOperation(payload);
    }
    case "pending_staff": {
      const { processPendingStaffSync } = await import("../lib/staffSyncQueue");
      const staffPayload = payload as import("../lib/staffSyncQueue").PendingStaffSyncPayload;
      if (!staffPayload?.staff?.id) return true;
      return processPendingStaffSync(staffPayload);
    }
    case "audit_log": {
      const raw = payload.entry as AuditLogEntry | undefined;
      if (!raw?.id || !raw.action) return true;
      return pushAuditLogToCloud(raw, ctx);
    }
    default: {
      const { appendDeviceAuditEntry } = await import("../lib/deviceAudit");
      reportSyncIssue("sync_unknown_operation", { kind: op.kind, opId: op.id });
      appendDeviceAuditEntry("sync_unknown_operation", `Unknown sync op: ${op.kind}`, {
        kind: op.kind,
        opId: op.id,
        attempts: op.attempts,
      });
      return false;
    }
  }
}

export type CloudPullMode = "full" | "incremental";

export type CloudPullStats = {
  mode: CloudPullMode;
  products: number;
  customers: number;
  sales: number;
  debtPayments: number;
  returns: number;
  purchases: number;
  suppliers: number;
  supplierPayments: number;
  deletedProducts: number;
  voidedSales: number;
  expenses: number;
  payloadBytes: number;
  durationMs: number;
  salesTruncated?: boolean;
  stockMovements?: number;
  entityErrors?: Record<string, string>;
  partialSuccess?: boolean;
};

export type CloudPullCheckpoints = {
  salesAt: string;
  productsAt: string;
  customersAt: string;
  debtPaymentsAt: string;
  expensesAt: string;
  returnsAt: string;
  purchasesAt: string;
  suppliersAt: string;
  supplierPaymentsAt: string;
  cashDrawerAdjustmentsAt: string;
  dayDrawerOpensAt: string;
  inventoryCountSessionsAt: string;
  shiftsAt: string;
  dayClosesAt: string;
  stockMovementsAt: string;
};

export type CloudPullResult = {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  returnRecords: ReturnRecord[];
  /** Cloud rows with updated_at for merge (same ids as returnRecords). */
  returnCloudRows: CloudReturnRow[];
  purchases: Purchase[];
  purchaseCloudRows: CloudPurchaseRow[];
  supplierCloudRows: CloudSupplierRow[];
  supplierPayments: SupplierPayment[];
  cashExpenses: CashExpense[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  dayDrawerOpens: DayDrawerOpen[];
  inventoryCountSessions: InventoryCountSession[];
  shifts: ShiftRecord[];
  dayCloses: DayCloseSummary[];
  stockMovements: StockMovement[];
  deletedProductIds: string[];
  voidedSaleIds: string[];
  stats: CloudPullStats;
  checkpoints?: CloudPullCheckpoints;
  recoveredAuditLogs?: AuditLogEntry[];
};

const FULL_SALES_PAGE = 800;
const INCREMENTAL_SALES_LIMIT = 500;
const INCREMENTAL_PRODUCTS_LIMIT = 500;
const INCREMENTAL_CUSTOMERS_LIMIT = 500;
const INCREMENTAL_EXPENSES_LIMIT = 200;
const INCREMENTAL_RETURNS_LIMIT = 500;
const INCREMENTAL_PURCHASES_LIMIT = 500;
const INCREMENTAL_SUPPLIERS_LIMIT = 500;
const INCREMENTAL_SUPPLIER_PAYMENTS_LIMIT = 500;
const INCREMENTAL_DEBT_PAYMENTS_LIMIT = 500;
const INCREMENTAL_MAX_PAGES = 40;

let lastSalesPullTruncated = false;

export function wasLastSalesPullTruncated(): boolean {
  return lastSalesPullTruncated;
}

const CUSTOMER_DEBT_PAYMENTS_SELECT = "id, shop_id, customer_id, amount_ugx, created_at, metadata";

const SHOP_PURCHASES_SELECT =
  "id, shop_id, supplier_id, supplier_name, total_cost_ugx, amount_paid_ugx, balance_delta_ugx, notes, lines, created_at, updated_at, voided_at, void_reason, metadata";

const SHOP_SUPPLIERS_SELECT =
  "id, shop_id, name, phone, location, notes, balance_owed_ugx, total_purchases_ugx, last_supply_at, created_at, updated_at, metadata";

const SHOP_SUPPLIER_PAYMENTS_SELECT =
  "id, shop_id, supplier_id, amount_ugx, created_at, updated_at, metadata";

const SALE_RETURNS_SELECT =
  "id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason, note, created_by, created_at, updated_at, metadata";

function maxIsoTimestamp(current: string, candidate: unknown): string {
  const next = typeof candidate === "string" ? candidate : "";
  return next && next > current ? next : current;
}

function maxRowUpdatedAt(rows: Record<string, unknown>[], since: string): string {
  let maxAt = since;
  for (const row of rows) {
    maxAt = maxIsoTimestamp(maxAt, row.updated_at ?? row.created_at);
  }
  return maxAt;
}

function estimatePayloadBytes(rows: unknown[]): number {
  try {
    return rows.reduce<number>((n, r) => n + JSON.stringify(r).length, 0);
  } catch {
    return 0;
  }
}

function parseSaleRows(rawRows: Record<string, unknown>[]): { sales: Sale[]; voidedIds: string[] } {
  const sales: Sale[] = [];
  const voidedIds: string[] = [];
  for (const raw of rawRows) {
    const status = String(raw.status ?? "completed");
    const id = String(raw.id ?? "");
    if (status === "void" || status === "refunded") {
      if (isUuid(id)) voidedIds.push(id);
      continue;
    }
    const items = (raw.sale_line_items as Record<string, unknown>[] | null) ?? [];
    const lines = items.map((ln) => rowToSaleLine(ln));
    const sale = rowToSale(raw, lines);
    if (sale) sales.push(hydrateSaleFinancialsFromCloud(sale));
  }
  return { sales, voidedIds };
}

async function pullSalesFull(ctx: ShopCtx): Promise<{
  sales: Sale[];
  voidedIds: string[];
  bytes: number;
  truncated: boolean;
}> {
  const sales: Sale[] = [];
  const voidedIds: string[] = [];
  let bytes = 0;
  let offset = 0;
  for (;;) {
    const { data: saleRows, error: sErr } = await supabase!
      .from("sales")
      .select("*, sale_line_items(*)")
      .eq("shop_id", ctx.shopId)
      .in("status", ["completed", "draft"])
      .order("created_at", { ascending: false })
      .range(offset, offset + FULL_SALES_PAGE - 1);
    if (sErr) throw sErr;
    const batch = (saleRows ?? []) as Record<string, unknown>[];
    bytes += estimatePayloadBytes(batch);
    if (batch.length === 0) break;
    const parsed = parseSaleRows(batch);
    sales.push(...parsed.sales);
    voidedIds.push(...parsed.voidedIds);
    if (batch.length < FULL_SALES_PAGE) break;
    offset += FULL_SALES_PAGE;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }

  let voidOffset = 0;
  for (;;) {
    const { data: voidedRows, error: vErr } = await supabase!
      .from("sales")
      .select("id")
      .eq("shop_id", ctx.shopId)
      .eq("status", "voided")
      .order("created_at", { ascending: true })
      .range(voidOffset, voidOffset + FULL_SALES_PAGE - 1);
    if (vErr) throw vErr;
    const batch = voidedRows ?? [];
    if (batch.length === 0) break;
    for (const row of batch) {
      const id = String((row as { id?: string }).id ?? "");
      if (isUuid(id) && !voidedIds.includes(id)) voidedIds.push(id);
    }
    if (batch.length < FULL_SALES_PAGE) break;
    voidOffset += FULL_SALES_PAGE;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }

  lastSalesPullTruncated = false;
  return { sales, voidedIds, bytes, truncated: false };
}

async function pullSalesIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ sales: Sale[]; voidedIds: string[]; bytes: number; checkpointAt: string; truncated: boolean }> {
  const sales: Sale[] = [];
  const voidedIds: string[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;
  let truncated = false;
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const { data: saleRows, error: sErr } = await supabase!
      .from("sales")
      .select("*, sale_line_items(*)")
      .eq("shop_id", ctx.shopId)
      .gt("updated_at", cursor)
      .order("updated_at", { ascending: true })
      .limit(INCREMENTAL_SALES_LIMIT);
    if (sErr) throw sErr;
    const batch = (saleRows ?? []) as Record<string, unknown>[];
    bytes += estimatePayloadBytes(batch);
    if (batch.length === 0) break;
    checkpointAt = maxRowUpdatedAt(batch, checkpointAt);
    const parsed = parseSaleRows(batch);
    sales.push(...parsed.sales);
    voidedIds.push(...parsed.voidedIds);
    if (batch.length < INCREMENTAL_SALES_LIMIT) break;
    if (page === INCREMENTAL_MAX_PAGES - 1) {
      truncated = true;
      lastSalesPullTruncated = true;
    }
    cursor = checkpointAt;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  if (!truncated) {
    lastSalesPullTruncated = false;
  }
  return { sales, voidedIds, bytes, checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString(), truncated };
}

async function pullProductsFull(ctx: ShopCtx): Promise<{ products: Product[]; deletedIds: string[]; bytes: number }> {
  let bytes = 0;
  const productRows = await pullOffsetRangeUntilExhausted({
    pageSize: INCREMENTAL_PRODUCTS_LIMIT,
    fetchRange: async (offset) => {
      const { data: rows, error: pErr } = await supabase!
        .from("products")
        .select("*")
        .eq("shop_id", ctx.shopId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .range(offset, offset + INCREMENTAL_PRODUCTS_LIMIT - 1);
      if (pErr) throw pErr;
      const batch = rows ?? [];
      bytes += estimatePayloadBytes(batch);
      return batch as Record<string, unknown>[];
    },
  });
  const products: Product[] = [];
  for (const r of productRows) {
    const p = rowToProduct(r);
    if (p) products.push(p);
  }

  const deletedRaw = await pullOffsetRangeUntilExhausted({
    pageSize: INCREMENTAL_PRODUCTS_LIMIT,
    fetchRange: async (offset) => {
      const { data: rows, error: dErr } = await supabase!
        .from("products")
        .select("id")
        .eq("shop_id", ctx.shopId)
        .eq("is_active", false)
        .order("updated_at", { ascending: true })
        .range(offset, offset + INCREMENTAL_PRODUCTS_LIMIT - 1);
      if (dErr) throw dErr;
      const batch = rows ?? [];
      bytes += estimatePayloadBytes(batch);
      return batch as Record<string, unknown>[];
    },
  });
  const deletedIds: string[] = [];
  for (const r of deletedRaw) {
    const id = String(r.id ?? "");
    if (isUuid(id)) deletedIds.push(id);
  }

  return { products, deletedIds, bytes };
}

async function pullProductsIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ products: Product[]; deletedIds: string[]; bytes: number; checkpointAt: string }> {
  const products: Product[] = [];
  const deletedIds: string[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const { data: productRows, error: pErr } = await supabase!
      .from("products")
      .select("*")
      .eq("shop_id", ctx.shopId)
      .gt("updated_at", cursor)
      .order("updated_at", { ascending: true })
      .limit(INCREMENTAL_PRODUCTS_LIMIT);
    if (pErr) throw pErr;
    const rows = productRows ?? [];
    bytes += estimatePayloadBytes(rows);
    if (rows.length === 0) break;
    checkpointAt = maxRowUpdatedAt(rows as Record<string, unknown>[], checkpointAt);
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const active = row.is_active !== false;
      if (!active) {
        const id = String(row.id ?? "");
        if (isUuid(id)) deletedIds.push(id);
        continue;
      }
      const p = rowToProduct(row);
      if (p) products.push(p);
    }
    if (rows.length < INCREMENTAL_PRODUCTS_LIMIT) break;
    cursor = checkpointAt;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return { products, deletedIds, bytes, checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString() };
}

async function pullCustomersFull(ctx: ShopCtx): Promise<{ customers: Customer[]; bytes: number }> {
  let bytes = 0;
  const rows = await pullOffsetRangeUntilExhausted({
    pageSize: INCREMENTAL_CUSTOMERS_LIMIT,
    fetchRange: async (offset) => {
      const { data: customerRows, error: cErr } = await supabase!
        .from("customers")
        .select("*")
        .eq("shop_id", ctx.shopId)
        .order("updated_at", { ascending: false })
        .range(offset, offset + INCREMENTAL_CUSTOMERS_LIMIT - 1);
      if (cErr) throw cErr;
      const batch = customerRows ?? [];
      bytes += estimatePayloadBytes(batch);
      return batch as Record<string, unknown>[];
    },
  });
  const customers = rows
    .map((r) => rowToCustomer(r))
    .filter((c): c is Customer => c != null);
  return { customers, bytes };
}

async function pullCustomersIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ customers: Customer[]; bytes: number; checkpointAt: string }> {
  const customers: Customer[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const { data: customerRows, error: cErr } = await supabase!
      .from("customers")
      .select("*")
      .eq("shop_id", ctx.shopId)
      .gt("updated_at", cursor)
      .order("updated_at", { ascending: true })
      .limit(INCREMENTAL_CUSTOMERS_LIMIT);
    if (cErr) throw cErr;
    const rows = customerRows ?? [];
    bytes += estimatePayloadBytes(rows);
    if (rows.length === 0) break;
    checkpointAt = maxRowUpdatedAt(rows as Record<string, unknown>[], checkpointAt);
    customers.push(
      ...rows.map((r) => rowToCustomer(r as Record<string, unknown>)).filter((c): c is Customer => c != null),
    );
    if (rows.length < INCREMENTAL_CUSTOMERS_LIMIT) break;
    cursor = checkpointAt;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return { customers, bytes, checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString() };
}

const CASH_EXPENSE_SELECT =
  "id, category, amount_ugx, description, paid_on, created_at, created_by, recorded_by_label, metadata, deleted_at, updated_at";

async function pullCashExpensesPage(
  ctx: ShopCtx,
  filter: { since?: string; full?: boolean; cursor?: string },
): Promise<{ rows: CashExpense[]; bytes: number; checkpointAt: string }> {
  let q = supabase!
    .from("expenses")
    .select(CASH_EXPENSE_SELECT)
    .eq("shop_id", ctx.shopId)
    .eq("expense_type", "cash_drawer");
  if (filter.full) {
    const cursor = filter.cursor ?? new Date(0).toISOString();
    if (cursor > new Date(0).toISOString()) {
      q = q.gt("updated_at", cursor);
    }
  } else if (filter.since) {
    q = q.or(`created_at.gt.${filter.since},updated_at.gt.${filter.since}`);
  }
  const { data, error } = await q.order("updated_at", { ascending: true }).limit(INCREMENTAL_EXPENSES_LIMIT);
  if (error) {
    if (isMissingTableError(error)) return { rows: [], bytes: 0, checkpointAt: filter.since ?? new Date(0).toISOString() };
    throw error;
  }
  const raw = (data ?? []) as Record<string, unknown>[];
  const rows = raw.map(rowToCashExpense).filter((e): e is CashExpense => e != null);
  const checkpointAt = maxRowUpdatedAt(raw, filter.since ?? new Date(0).toISOString());
  return { rows, bytes: estimatePayloadBytes(raw), checkpointAt };
}

/** Cash drawer expenses (created_at / updated_at). */
async function pullExpensesIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ cashExpenses: CashExpense[]; count: number; bytes: number; checkpointAt: string }> {
  try {
    let cashExpenses: CashExpense[] = [];
    let count = 0;
    let bytes = 0;
    let cursor = since;
    let checkpointAt = since;
    for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
      const pageResult = await pullCashExpensesPage(ctx, { since: cursor });
      bytes += pageResult.bytes;
      if (pageResult.rows.length === 0) break;
      cashExpenses = cashExpenses.concat(pageResult.rows);
      checkpointAt = pageResult.checkpointAt;
      count += pageResult.rows.length;
      if (pageResult.rows.length < INCREMENTAL_EXPENSES_LIMIT) break;
      cursor = checkpointAt;
    }
    return {
      cashExpenses,
      count,
      bytes,
      checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString(),
    };
  } catch {
    return { cashExpenses: [], count: 0, bytes: 0, checkpointAt: since };
  }
}

async function pullCashDrawerAdjustmentsFromRpc(
  ctx: ShopCtx,
  since: string | null,
): Promise<{ cashDrawerAdjustments: CashDrawerAdjustment[]; bytes: number; checkpointAt: string }> {
  if (!supabase) {
    return { cashDrawerAdjustments: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
  }
  const { data, error } = await supabase.rpc("shop_pull_cash_drawer_adjustments", {
    p_shop_id: ctx.shopId,
    p_since: since,
  });
  if (error) {
    if (isMissingTableError(error)) {
      return { cashDrawerAdjustments: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
    }
    throw error;
  }
  const result = data as { ok?: boolean; rows?: unknown[] } | null;
  if (!result?.ok) {
    return { cashDrawerAdjustments: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
  }
  const raw = result.rows ?? [];
  const cashDrawerAdjustments = parseCashDrawerAdjustmentRows(raw);
  let checkpointAt = since ?? new Date(0).toISOString();
  for (const row of cashDrawerAdjustments) {
    checkpointAt = maxIsoTimestamp(checkpointAt, row.updatedAt);
  }
  return { cashDrawerAdjustments, bytes: estimatePayloadBytes(raw), checkpointAt };
}

async function pullCashDrawerAdjustmentsIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ cashDrawerAdjustments: CashDrawerAdjustment[]; count: number; bytes: number; checkpointAt: string }> {
  try {
    const page = await pullCashDrawerAdjustmentsFromRpc(ctx, since);
    return {
      cashDrawerAdjustments: page.cashDrawerAdjustments,
      count: page.cashDrawerAdjustments.length,
      bytes: page.bytes,
      checkpointAt: page.checkpointAt > since ? page.checkpointAt : new Date().toISOString(),
    };
  } catch {
    return { cashDrawerAdjustments: [], count: 0, bytes: 0, checkpointAt: since };
  }
}

async function pullCashDrawerAdjustmentsFull(
  ctx: ShopCtx,
): Promise<{ cashDrawerAdjustments: CashDrawerAdjustment[]; bytes: number }> {
  const page = await pullCashDrawerAdjustmentsFromRpc(ctx, null);
  return { cashDrawerAdjustments: page.cashDrawerAdjustments, bytes: page.bytes };
}

async function pullDayDrawerOpensIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ dayDrawerOpens: DayDrawerOpen[]; count: number; bytes: number; checkpointAt: string }> {
  try {
    const page = await pullDayDrawerOpensFromRpc(ctx, since);
    return {
      dayDrawerOpens: page.dayDrawerOpens,
      count: page.dayDrawerOpens.length,
      bytes: page.bytes,
      checkpointAt: page.checkpointAt > since ? page.checkpointAt : new Date().toISOString(),
    };
  } catch {
    return { dayDrawerOpens: [], count: 0, bytes: 0, checkpointAt: since };
  }
}

async function pullDayDrawerOpensFull(
  ctx: ShopCtx,
): Promise<{ dayDrawerOpens: DayDrawerOpen[]; bytes: number }> {
  const page = await pullDayDrawerOpensFromRpc(ctx, null);
  return { dayDrawerOpens: page.dayDrawerOpens, bytes: page.bytes };
}

function parseReturnRows(rows: Record<string, unknown>[]): CloudReturnRow[] {
  const out: CloudReturnRow[] = [];
  for (const row of rows) {
    const parsed = rowToReturnRecord(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

async function pullReturnsPage(
  ctx: ShopCtx,
  since: string,
): Promise<{ rows: CloudReturnRow[]; bytes: number; checkpointAt: string }> {
  const { data, error } = await supabase!
    .from("sale_returns")
    .select(SALE_RETURNS_SELECT)
    .eq("shop_id", ctx.shopId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(INCREMENTAL_RETURNS_LIMIT);

  if (error) {
    if (isMissingTableError(error)) {
      return { rows: [], bytes: 0, checkpointAt: since };
    }
    throw error;
  }
  const raw = (data ?? []) as Record<string, unknown>[];
  const rows = parseReturnRows(raw);
  const checkpointAt = raw.length > 0 ? maxRowUpdatedAt(raw, since) : since;
  return { rows, bytes: estimatePayloadBytes(raw), checkpointAt };
}

async function pullReturnsFull(ctx: ShopCtx): Promise<{ returnRows: CloudReturnRow[]; bytes: number }> {
  const result = await pullCursorUntilExhausted({
    initialCursor: new Date(0).toISOString(),
    pageSizeHint: INCREMENTAL_RETURNS_LIMIT,
    pullPage: (cursor) => pullReturnsPage(ctx, cursor),
  });
  return { returnRows: result.rows, bytes: result.bytes };
}

async function pullReturnsIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ returnRows: CloudReturnRow[]; bytes: number; checkpointAt: string }> {
  const returnRows: CloudReturnRow[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const pageResult = await pullReturnsPage(ctx, cursor);
    bytes += pageResult.bytes;
    if (pageResult.rows.length === 0) break;
    checkpointAt = pageResult.checkpointAt;
    returnRows.push(...pageResult.rows);
    if (pageResult.rows.length < INCREMENTAL_RETURNS_LIMIT) break;
    cursor = checkpointAt;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return {
    returnRows,
    bytes,
    checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString(),
  };
}

function parsePurchaseRows(rows: Record<string, unknown>[]): CloudPurchaseRow[] {
  const out: CloudPurchaseRow[] = [];
  for (const row of rows) {
    const parsed = rowToPurchase(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseSupplierRows(rows: Record<string, unknown>[]): CloudSupplierRow[] {
  const out: CloudSupplierRow[] = [];
  for (const row of rows) {
    const parsed = rowToSupplier(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseSupplierPaymentRows(rows: Record<string, unknown>[]): SupplierPayment[] {
  const out: SupplierPayment[] = [];
  for (const row of rows) {
    const parsed = rowToSupplierPayment(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

async function pullPurchasesPage(
  ctx: ShopCtx,
  since: string,
): Promise<{ rows: CloudPurchaseRow[]; bytes: number; checkpointAt: string }> {
  const { data, error } = await supabase!
    .from("shop_purchases")
    .select(SHOP_PURCHASES_SELECT)
    .eq("shop_id", ctx.shopId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(INCREMENTAL_PURCHASES_LIMIT);

  if (error) {
    if (isMissingTableError(error)) return { rows: [], bytes: 0, checkpointAt: since };
    throw error;
  }
  const raw = (data ?? []) as Record<string, unknown>[];
  const rows = parsePurchaseRows(raw);
  const checkpointAt = raw.length > 0 ? maxRowUpdatedAt(raw, since) : since;
  return { rows, bytes: estimatePayloadBytes(raw), checkpointAt };
}

async function pullPurchasesFull(ctx: ShopCtx): Promise<{ purchaseRows: CloudPurchaseRow[]; bytes: number }> {
  const result = await pullCursorUntilExhausted({
    initialCursor: new Date(0).toISOString(),
    pageSizeHint: INCREMENTAL_PURCHASES_LIMIT,
    pullPage: (cursor) => pullPurchasesPage(ctx, cursor),
  });
  return { purchaseRows: result.rows, bytes: result.bytes };
}

async function pullPurchasesIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ purchaseRows: CloudPurchaseRow[]; bytes: number; checkpointAt: string }> {
  const purchaseRows: CloudPurchaseRow[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const pageResult = await pullPurchasesPage(ctx, cursor);
    bytes += pageResult.bytes;
    if (pageResult.rows.length === 0) break;
    checkpointAt = pageResult.checkpointAt;
    purchaseRows.push(...pageResult.rows);
    if (pageResult.rows.length < INCREMENTAL_PURCHASES_LIMIT) break;
    cursor = checkpointAt;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return {
    purchaseRows,
    bytes,
    checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString(),
  };
}

async function pullSuppliersPage(
  ctx: ShopCtx,
  since: string,
): Promise<{ rows: CloudSupplierRow[]; bytes: number; checkpointAt: string }> {
  const { data, error } = await supabase!
    .from("shop_suppliers")
    .select(SHOP_SUPPLIERS_SELECT)
    .eq("shop_id", ctx.shopId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(INCREMENTAL_SUPPLIERS_LIMIT);

  if (error) {
    if (isMissingTableError(error)) return { rows: [], bytes: 0, checkpointAt: since };
    throw error;
  }
  const raw = (data ?? []) as Record<string, unknown>[];
  const rows = parseSupplierRows(raw);
  const checkpointAt = raw.length > 0 ? maxRowUpdatedAt(raw, since) : since;
  return { rows, bytes: estimatePayloadBytes(raw), checkpointAt };
}

async function pullSuppliersFull(ctx: ShopCtx): Promise<{ supplierRows: CloudSupplierRow[]; bytes: number }> {
  const result = await pullCursorUntilExhausted({
    initialCursor: new Date(0).toISOString(),
    pageSizeHint: INCREMENTAL_SUPPLIERS_LIMIT,
    pullPage: (cursor) => pullSuppliersPage(ctx, cursor),
  });
  return { supplierRows: result.rows, bytes: result.bytes };
}

async function pullSuppliersIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ supplierRows: CloudSupplierRow[]; bytes: number; checkpointAt: string }> {
  const supplierRows: CloudSupplierRow[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const pageResult = await pullSuppliersPage(ctx, cursor);
    bytes += pageResult.bytes;
    if (pageResult.rows.length === 0) break;
    checkpointAt = pageResult.checkpointAt;
    supplierRows.push(...pageResult.rows);
    if (pageResult.rows.length < INCREMENTAL_SUPPLIERS_LIMIT) break;
    cursor = checkpointAt;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return {
    supplierRows,
    bytes,
    checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString(),
  };
}

async function pullSupplierPaymentsPage(
  ctx: ShopCtx,
  since: string,
): Promise<{ rows: SupplierPayment[]; bytes: number; checkpointAt: string }> {
  const { data, error } = await supabase!
    .from("shop_supplier_payments")
    .select(SHOP_SUPPLIER_PAYMENTS_SELECT)
    .eq("shop_id", ctx.shopId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(INCREMENTAL_SUPPLIER_PAYMENTS_LIMIT);

  if (error) {
    if (isMissingTableError(error)) return { rows: [], bytes: 0, checkpointAt: since };
    throw error;
  }
  const raw = (data ?? []) as Record<string, unknown>[];
  const rows = parseSupplierPaymentRows(raw);
  const checkpointAt = raw.length > 0 ? maxRowUpdatedAt(raw, since) : since;
  return { rows, bytes: estimatePayloadBytes(raw), checkpointAt };
}

async function pullSupplierPaymentsFull(
  ctx: ShopCtx,
): Promise<{ supplierPayments: SupplierPayment[]; bytes: number }> {
  const result = await pullCursorUntilExhausted({
    initialCursor: new Date(0).toISOString(),
    pageSizeHint: INCREMENTAL_SUPPLIER_PAYMENTS_LIMIT,
    pullPage: (cursor) => pullSupplierPaymentsPage(ctx, cursor),
  });
  return { supplierPayments: result.rows, bytes: result.bytes };
}

async function pullSupplierPaymentsIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ supplierPayments: SupplierPayment[]; bytes: number; checkpointAt: string }> {
  const supplierPayments: SupplierPayment[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const pageResult = await pullSupplierPaymentsPage(ctx, cursor);
    bytes += pageResult.bytes;
    if (pageResult.rows.length === 0) break;
    checkpointAt = pageResult.checkpointAt;
    supplierPayments.push(...pageResult.rows);
    if (pageResult.rows.length < INCREMENTAL_SUPPLIER_PAYMENTS_LIMIT) break;
    cursor = checkpointAt;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return {
    supplierPayments,
    bytes,
    checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString(),
  };
}

function maxDebtPaymentCreatedAt(rows: Record<string, unknown>[], since: string): string {
  let checkpointAt = since;
  for (const row of rows) {
    checkpointAt = maxIsoTimestamp(checkpointAt, row.created_at);
  }
  return checkpointAt;
}

async function pullDebtPaymentsPage(
  ctx: ShopCtx,
  since: string,
): Promise<{ rows: DebtPayment[]; bytes: number; checkpointAt: string }> {
  const { data, error } = await supabase!
    .from("customer_debt_payments")
    .select(CUSTOMER_DEBT_PAYMENTS_SELECT)
    .eq("shop_id", ctx.shopId)
    .gt("created_at", since)
    .order("created_at", { ascending: true })
    .limit(INCREMENTAL_DEBT_PAYMENTS_LIMIT);

  if (error) {
    if (isMissingTableError(error)) return { rows: [], bytes: 0, checkpointAt: since };
    throw error;
  }
  const raw = (data ?? []) as Record<string, unknown>[];
  const rows = parseDebtPaymentRows(raw);
  const checkpointAt = raw.length > 0 ? maxDebtPaymentCreatedAt(raw, since) : since;
  return { rows, bytes: estimatePayloadBytes(raw), checkpointAt };
}

async function pullDebtPaymentsFull(ctx: ShopCtx): Promise<{ debtPayments: DebtPayment[]; bytes: number }> {
  const result = await pullCursorUntilExhausted({
    initialCursor: new Date(0).toISOString(),
    pageSizeHint: INCREMENTAL_DEBT_PAYMENTS_LIMIT,
    pullPage: (cursor) => pullDebtPaymentsPage(ctx, cursor),
  });
  return { debtPayments: result.rows, bytes: result.bytes };
}

async function pullDebtPaymentsIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ debtPayments: DebtPayment[]; bytes: number; checkpointAt: string }> {
  const debtPayments: DebtPayment[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const pageResult = await pullDebtPaymentsPage(ctx, cursor);
    bytes += pageResult.bytes;
    if (pageResult.rows.length === 0) break;
    checkpointAt = pageResult.checkpointAt;
    debtPayments.push(...pageResult.rows);
    if (pageResult.rows.length < INCREMENTAL_DEBT_PAYMENTS_LIMIT) break;
    cursor = checkpointAt;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return {
    debtPayments,
    bytes,
    checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString(),
  };
}

/** Pull customer debt payments from cloud (full or incremental by created_at cursor). */
export async function pullDebtPayments(opts?: {
  forceFull?: boolean;
}): Promise<{ debtPayments: DebtPayment[]; checkpointAt: string } | null> {
  const ctx = await resolveShopCtx();
  if (!ctx || !supabase) return null;
  const cp = readSyncCheckpoints();
  if (opts?.forceFull === true || !cp.bootstrapComplete) {
    const full = await pullDebtPaymentsFull(ctx);
    return { debtPayments: full.debtPayments, checkpointAt: new Date().toISOString() };
  }
  const since = cp.lastDebtPaymentsSyncAt ?? new Date(0).toISOString();
  const inc = await pullDebtPaymentsIncremental(ctx, since);
  return { debtPayments: inc.debtPayments, checkpointAt: inc.checkpointAt };
}

async function pullCashExpensesFull(ctx: ShopCtx): Promise<{ cashExpenses: CashExpense[]; bytes: number }> {
  const result = await pullCursorUntilExhausted({
    initialCursor: new Date(0).toISOString(),
    pageSizeHint: INCREMENTAL_EXPENSES_LIMIT,
    pullPage: (cursor) => pullCashExpensesPage(ctx, { full: true, cursor }),
  });
  return { cashExpenses: result.rows, bytes: result.bytes };
}

export async function pullShopDataFromCloud(opts?: {
  mode?: CloudPullMode;
  forceFull?: boolean;
  cloudRecovery?: boolean;
  onRecoveryStep?: (
    step: import("../lib/cloudRecoverySession").CloudRecoveryStepId,
    counts?: Partial<import("../lib/cloudRecoverySession").CloudRecoveryEntityCounts>,
  ) => void;
}): Promise<CloudPullResult | null> {
  const started = performance.now();
  const ctx = await resolveShopCtx();
  if (!ctx || !supabase) return null;

  const state = usePosStore.getState();
  const localEmpty = state.products.length === 0 && state.sales.length === 0 && state.customers.length === 0;
  const mode: CloudPullMode =
    opts?.forceFull === true || opts?.mode === "full" || needsBootstrapPull(localEmpty) ? "full" : "incremental";

  const cp = readSyncCheckpoints();
  let products: Product[] = [];
  let customers: Customer[] = [];
  let sales: Sale[] = [];
  let deletedProductIds: string[] = [];
  let voidedSaleIds: string[] = [];
  let cashExpenses: CashExpense[] = [];
  let cashDrawerAdjustments: CashDrawerAdjustment[] = [];
  let dayDrawerOpens: DayDrawerOpen[] = [];
  let inventoryCountSessions: InventoryCountSession[] = [];
  let shifts: ShiftRecord[] = [];
  let dayCloses: DayCloseSummary[] = [];
  let stockMovements: StockMovement[] = [];
  let returnCloudRows: CloudReturnRow[] = [];
  let purchaseCloudRows: CloudPurchaseRow[] = [];
  let supplierCloudRows: CloudSupplierRow[] = [];
  let supplierPayments: SupplierPayment[] = [];
  let debtPayments: DebtPayment[] = [];
  let expenseCount = 0;
  let returnCount = 0;
  let purchaseCount = 0;
  let supplierCount = 0;
  let supplierPaymentCount = 0;
  let debtPaymentCount = 0;
  let payloadBytes = 0;
  let pullCheckpoints: CloudPullCheckpoints | undefined;
  let salesTruncated = false;
  let stockMovementCount = 0;

  const entityErrors: Record<string, string> = {};
  let recoveredAuditLogs: AuditLogEntry[] = [];

  if (mode === "full") {
    const p = await pullEntitySafe("products", entityErrors, () => pullProductsFull(ctx));
    if (p) {
      products = p.products;
      deletedProductIds = p.deletedIds;
      payloadBytes += p.bytes;
      opts?.onRecoveryStep?.("products", { products: products.length });
    }

    const s = await pullEntitySafe("sales", entityErrors, () => pullSalesFull(ctx));
    if (s) {
      sales = s.sales;
      voidedSaleIds = s.voidedIds;
      payloadBytes += s.bytes;
      salesTruncated = s.truncated;
      lastSalesPullTruncated = s.truncated;
      opts?.onRecoveryStep?.("sales", { sales: sales.length });
    }

    const c = await pullEntitySafe("customers", entityErrors, () => pullCustomersFull(ctx));
    if (c) {
      customers = c.customers;
      payloadBytes += c.bytes;
      opts?.onRecoveryStep?.("customers", { customers: customers.length });
    }

    const exFull = await pullEntitySafe("cash_expenses", entityErrors, () => pullCashExpensesFull(ctx));
    if (exFull) {
      cashExpenses = exFull.cashExpenses;
      expenseCount = exFull.cashExpenses.length;
      payloadBytes += exFull.bytes;
    }

    const retFull = await pullEntitySafe("returns", entityErrors, () => pullReturnsFull(ctx));
    if (retFull) {
      returnCloudRows = retFull.returnRows;
      returnCount = retFull.returnRows.length;
      payloadBytes += retFull.bytes;
      opts?.onRecoveryStep?.("returns");
    }

    const purFull = await pullEntitySafe("purchases", entityErrors, () => pullPurchasesFull(ctx));
    if (purFull) {
      purchaseCloudRows = purFull.purchaseRows;
      purchaseCount = purFull.purchaseRows.length;
      payloadBytes += purFull.bytes;
    }

    const supFull = await pullEntitySafe("suppliers", entityErrors, () => pullSuppliersFull(ctx));
    if (supFull) {
      supplierCloudRows = supFull.supplierRows;
      supplierCount = supFull.supplierRows.length;
      payloadBytes += supFull.bytes;
    }

    const payFull = await pullEntitySafe("supplier_payments", entityErrors, () => pullSupplierPaymentsFull(ctx));
    if (payFull) {
      supplierPayments = payFull.supplierPayments;
      supplierPaymentCount = payFull.supplierPayments.length;
      payloadBytes += payFull.bytes;
    }

    const dpFull = await pullEntitySafe("debt_payments", entityErrors, () => pullDebtPaymentsFull(ctx));
    if (dpFull) {
      debtPayments = dpFull.debtPayments;
      debtPaymentCount = dpFull.debtPayments.length;
      payloadBytes += dpFull.bytes;
    }

    const adjFull = await pullEntitySafe("cash_drawer_adjustments", entityErrors, () =>
      pullCashDrawerAdjustmentsFull(ctx),
    );
    if (adjFull) {
      cashDrawerAdjustments = adjFull.cashDrawerAdjustments;
      payloadBytes += adjFull.bytes;
    }

    const ddoFull = await pullEntitySafe("day_drawer_opens", entityErrors, () => pullDayDrawerOpensFull(ctx));
    if (ddoFull) {
      dayDrawerOpens = ddoFull.dayDrawerOpens;
      payloadBytes += ddoFull.bytes;
    }

    const icsFull = await pullEntitySafe("inventory_count_sessions", entityErrors, () =>
      pullInventoryCountSessionsFromRpc(ctx, null),
    );
    if (icsFull) {
      inventoryCountSessions = icsFull.sessions;
      payloadBytes += icsFull.bytes;
      opts?.onRecoveryStep?.("inventory", {
        inventory: inventoryCountSessions.length > 0 ? inventoryCountSessions.length : products.length,
      });
    }

    const shiftsFull = await pullEntitySafe("shifts", entityErrors, () => pullShiftsFromRpc(ctx, null));
    if (shiftsFull) {
      shifts = shiftsFull.shifts;
      payloadBytes += shiftsFull.bytes;
      opts?.onRecoveryStep?.("shifts", { shifts: shifts.length });
    }

    const dcFull = await pullEntitySafe("day_closes", entityErrors, () => pullDayClosesFromRpc(ctx, null));
    if (dcFull) {
      dayCloses = dcFull.dayCloses;
      payloadBytes += dcFull.bytes;
      opts?.onRecoveryStep?.("day_closes", { dayCloses: dayCloses.length });
    }

    opts?.onRecoveryStep?.("cash", {
      cashRecords: cashDrawerAdjustments.length + dayDrawerOpens.length + cashExpenses.length,
    });

    const smFull = await pullEntitySafe("stock_movements", entityErrors, () => pullStockMovementsFull(ctx));
    if (smFull) {
      stockMovements = smFull.movements;
      stockMovementCount = smFull.movements.length;
      payloadBytes += smFull.bytes;
    }
  } else {
    const sinceProducts = cp.lastProductsSyncAt ?? new Date(0).toISOString();
    const sinceCustomers = cp.lastCustomersSyncAt ?? new Date(0).toISOString();
    const sinceSales = cp.lastSalesSyncAt ?? new Date(0).toISOString();
    const sinceExpenses = cp.lastExpensesSyncAt ?? new Date(0).toISOString();
    const sinceReturns = cp.lastReturnsSyncAt ?? new Date(0).toISOString();
    const sinceDebtPayments = cp.lastDebtPaymentsSyncAt ?? new Date(0).toISOString();

    const p = await pullEntitySafe("products", entityErrors, () => pullProductsIncremental(ctx, sinceProducts));
    if (p) {
      products = p.products;
      deletedProductIds = p.deletedIds;
      payloadBytes += p.bytes;
    }

    const c = await pullEntitySafe("customers", entityErrors, () => pullCustomersIncremental(ctx, sinceCustomers));
    if (c) {
      customers = c.customers;
      payloadBytes += c.bytes;
    }

    const s = await pullEntitySafe("sales", entityErrors, () => pullSalesIncremental(ctx, sinceSales));
    if (s) {
      sales = s.sales;
      voidedSaleIds = s.voidedIds;
      payloadBytes += s.bytes;
      if (s.truncated) {
        salesTruncated = true;
        lastSalesPullTruncated = true;
      }
    }

    const ex = await pullEntitySafe("cash_expenses", entityErrors, () => pullExpensesIncremental(ctx, sinceExpenses));
    if (ex) {
      cashExpenses = ex.cashExpenses;
      expenseCount = ex.count;
      payloadBytes += ex.bytes;
    }

    const ret = await pullEntitySafe("returns", entityErrors, () => pullReturnsIncremental(ctx, sinceReturns));
    if (ret) {
      returnCloudRows = ret.returnRows;
      returnCount = ret.returnRows.length;
      payloadBytes += ret.bytes;
    }

    const sincePurchases = cp.lastPurchasesSyncAt ?? new Date(0).toISOString();
    const sinceSuppliers = cp.lastSuppliersSyncAt ?? new Date(0).toISOString();
    const sinceSupplierPayments = cp.lastSupplierPaymentsSyncAt ?? new Date(0).toISOString();

    const pur = await pullEntitySafe("purchases", entityErrors, () => pullPurchasesIncremental(ctx, sincePurchases));
    if (pur) {
      purchaseCloudRows = pur.purchaseRows;
      purchaseCount = pur.purchaseRows.length;
      payloadBytes += pur.bytes;
    }

    const sup = await pullEntitySafe("suppliers", entityErrors, () => pullSuppliersIncremental(ctx, sinceSuppliers));
    if (sup) {
      supplierCloudRows = sup.supplierRows;
      supplierCount = sup.supplierRows.length;
      payloadBytes += sup.bytes;
    }

    const pay = await pullEntitySafe("supplier_payments", entityErrors, () =>
      pullSupplierPaymentsIncremental(ctx, sinceSupplierPayments),
    );
    if (pay) {
      supplierPayments = pay.supplierPayments;
      supplierPaymentCount = pay.supplierPayments.length;
      payloadBytes += pay.bytes;
    }

    const dp = await pullEntitySafe("debt_payments", entityErrors, () =>
      pullDebtPaymentsIncremental(ctx, sinceDebtPayments),
    );
    if (dp) {
      debtPayments = dp.debtPayments;
      debtPaymentCount = dp.debtPayments.length;
      payloadBytes += dp.bytes;
    }

    const sinceCashDrawerAdjustments = cp.lastCashDrawerAdjustmentsSyncAt ?? new Date(0).toISOString();
    const adj = await pullEntitySafe("cash_drawer_adjustments", entityErrors, () =>
      pullCashDrawerAdjustmentsIncremental(ctx, sinceCashDrawerAdjustments),
    );
    if (adj) {
      cashDrawerAdjustments = adj.cashDrawerAdjustments;
      payloadBytes += adj.bytes;
    }

    const sinceDayDrawerOpens = cp.lastDayDrawerOpensSyncAt ?? new Date(0).toISOString();
    const ddo = await pullEntitySafe("day_drawer_opens", entityErrors, () =>
      pullDayDrawerOpensIncremental(ctx, sinceDayDrawerOpens),
    );
    if (ddo) {
      dayDrawerOpens = ddo.dayDrawerOpens;
      payloadBytes += ddo.bytes;
    }

    const sinceIcs = cp.lastInventoryCountSessionsSyncAt ?? new Date(0).toISOString();
    const ics = await pullEntitySafe("inventory_count_sessions", entityErrors, () =>
      pullInventoryCountSessionsFromRpc(ctx, sinceIcs),
    );
    if (ics) {
      inventoryCountSessions = ics.sessions;
      payloadBytes += ics.bytes;
    }

    const sinceShifts = cp.lastShiftsSyncAt ?? new Date(0).toISOString();
    const sh = await pullEntitySafe("shifts", entityErrors, () => pullShiftsFromRpc(ctx, sinceShifts));
    if (sh) {
      shifts = sh.shifts;
      payloadBytes += sh.bytes;
    }

    const sinceDayCloses = cp.lastDayClosesSyncAt ?? new Date(0).toISOString();
    const dc = await pullEntitySafe("day_closes", entityErrors, () => pullDayClosesFromRpc(ctx, sinceDayCloses));
    if (dc) {
      dayCloses = dc.dayCloses;
      payloadBytes += dc.bytes;
    }

    const sinceStockMovements = cp.lastStockMovementsSyncAt ?? new Date(0).toISOString();
    const sm = await pullEntitySafe("stock_movements", entityErrors, () =>
      pullStockMovementsIncremental(ctx, sinceStockMovements),
    );
    if (sm) {
      stockMovements = sm.movements;
      stockMovementCount = sm.movements.length;
      payloadBytes += sm.bytes;
    }

    pullCheckpoints = {
      salesAt: s?.checkpointAt ?? sinceSales,
      productsAt: p?.checkpointAt ?? sinceProducts,
      customersAt: c?.checkpointAt ?? sinceCustomers,
      debtPaymentsAt: dp?.checkpointAt ?? sinceDebtPayments,
      expensesAt: ex?.checkpointAt ?? sinceExpenses,
      returnsAt: ret?.checkpointAt ?? sinceReturns,
      purchasesAt: pur?.checkpointAt ?? sincePurchases,
      suppliersAt: sup?.checkpointAt ?? sinceSuppliers,
      supplierPaymentsAt: pay?.checkpointAt ?? sinceSupplierPayments,
      cashDrawerAdjustmentsAt: adj?.checkpointAt ?? sinceCashDrawerAdjustments,
      dayDrawerOpensAt: ddo?.checkpointAt ?? sinceDayDrawerOpens,
      inventoryCountSessionsAt: ics?.checkpointAt ?? sinceIcs,
      shiftsAt: sh?.checkpointAt ?? sinceShifts,
      dayClosesAt: dc?.checkpointAt ?? sinceDayCloses,
      stockMovementsAt: sm?.checkpointAt ?? sinceStockMovements,
    };
  }

  if (opts?.cloudRecovery) {
    const audit = await pullEntitySafe("audit_logs", entityErrors, async () => {
      const { pullAuditLogsFromCloud } = await import("../lib/auditCloudSync");
      return pullAuditLogsFromCloud(ctx.shopId, {
        onProgress: (progress) => {
          opts?.onRecoveryStep?.("audit");
          void progress;
        },
      });
    });
    if (audit) {
      recoveredAuditLogs = audit;
      opts?.onRecoveryStep?.("audit");
    }
  }

  recordEntityPullErrors(entityErrors);

  void supabase
    .from("sync_health")
    .upsert(
      {
        shop_id: ctx.shopId,
        last_pull_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id" },
    )
    .then(() => undefined);

  const pulledAt = new Date().toISOString();
  const hasPartialIssue = salesTruncated || Object.keys(entityErrors).length > 0;
  writeSyncHealthMeta({
    lastSuccessAt: pulledAt,
    lastPullAt: pulledAt,
    lastIssueCode: hasPartialIssue ? "partial" : "none",
    lastIssueAt: hasPartialIssue ? pulledAt : null,
  });

  const stats: CloudPullStats = {
    mode,
    products: products.length,
    customers: customers.length,
    sales: sales.length,
    debtPayments: debtPaymentCount,
    deletedProducts: deletedProductIds.length,
    voidedSales: voidedSaleIds.length,
    expenses: expenseCount,
    returns: returnCount,
    purchases: purchaseCount,
    suppliers: supplierCount,
    supplierPayments: supplierPaymentCount,
    payloadBytes,
    durationMs: Math.round(performance.now() - started),
    salesTruncated,
    stockMovements: stockMovementCount,
    entityErrors: Object.keys(entityErrors).length > 0 ? entityErrors : undefined,
    partialSuccess: Object.keys(entityErrors).length > 0,
  };

  const { isDiagnosticsEnabled, recordCloudPullStats } = await import("../lib/stabilityDiagnostics");
  if (isDiagnosticsEnabled()) recordCloudPullStats(stats);

  return {
    products,
    customers,
    sales,
    debtPayments,
    returnRecords: returnCloudRows.map((r) => r.record),
    returnCloudRows,
    purchases: purchaseCloudRows.map((r) => r.record),
    purchaseCloudRows,
    supplierCloudRows,
    supplierPayments,
    cashExpenses,
    cashDrawerAdjustments,
    dayDrawerOpens,
    inventoryCountSessions,
    shifts,
    dayCloses,
    stockMovements,
    deletedProductIds,
    voidedSaleIds,
    stats,
    checkpoints: pullCheckpoints,
    recoveredAuditLogs: recoveredAuditLogs.length > 0 ? recoveredAuditLogs : undefined,
  };
}

/** Merge cloud into local store after disk bootstrap (new device / desktop login). */
export async function pullCloudAndMergeIntoStore(opts?: {
  forceFull?: boolean;
  cloudRecovery?: boolean;
  onRecoveryStep?: (
    step: import("../lib/cloudRecoverySession").CloudRecoveryStepId,
    counts?: Partial<import("../lib/cloudRecoverySession").CloudRecoveryEntityCounts>,
  ) => void;
}): Promise<boolean> {
  const shouldMarkBootstrap = opts?.cloudRecovery !== true;
  const failMerge = (errorKey: string): boolean => {
    if (opts?.cloudRecovery) throw new Error(errorKey);
    return false;
  };

  const assertCloudRecoveryStoreHydrated = async (): Promise<void> => {
    if (!opts?.cloudRecovery) return;
    const { storeHasCoreRecoveryData, MERGE_PRODUCED_EMPTY_STORE_ERROR } = await import("../lib/recoveryHydration");
    const { logRecoveryDiagnosticEvent, recordRecoveryIntegrityDiagnostics } = await import(
      "../lib/cloudRecoverySession"
    );
    const merged = usePosStore.getState();
    const shifts = merged.preferences.shifts ?? [];
    recordRecoveryIntegrityDiagnostics({
      finalStoreCounts: {
        products: merged.products.length,
        sales: merged.sales.length,
        customers: merged.customers.length,
        inventory:
          merged.inventoryCountSessions.length > 0
            ? merged.inventoryCountSessions.length
            : merged.products.length,
        shifts: shifts.length,
        dayCloses: merged.dayCloses.length,
        cashRecords:
          merged.cashDrawerAdjustments.length + merged.dayDrawerOpens.length + merged.cashExpenses.length,
      },
    });
    if (!storeHasCoreRecoveryData()) {
      logRecoveryDiagnosticEvent("merge_produced_empty_store");
      throw new Error(MERGE_PRODUCED_EMPTY_STORE_ERROR);
    }
  };

  const { assertOrganizationOperationsAllowed } = await import("../lib/organizationDeletionState");
  try {
    await assertOrganizationOperationsAllowed();
  } catch {
    return failMerge("organization_deleted");
  }

  const mergeStarted = Date.now();
  const { applyShopRecoverySignalsForCurrentShop } = await import("../lib/shopRecoverySignals");
  const { applyRestoredSnapshotFromBackup, persistRestoredSnapshotToDisk } = await import(
    "../store/usePosStore",
  );
  if (!hasSupabaseConfig) return failMerge("cloud_pull_not_configured");
  const cloud = await pullShopDataFromCloud({
    forceFull: opts?.forceFull,
    onRecoveryStep: opts?.onRecoveryStep,
    cloudRecovery: opts?.cloudRecovery,
  });
  if (!cloud) return failMerge("cloud_pull_failed");

  const state = usePosStore.getState();
  if (!state._hydrated) return failMerge("store_not_hydrated");

  const hasCloud =
    cloud.products.length > 0 ||
    cloud.sales.length > 0 ||
    cloud.customers.length > 0 ||
    cloud.returnRecords.length > 0 ||
    cloud.purchaseCloudRows.length > 0 ||
    cloud.supplierCloudRows.length > 0 ||
    cloud.supplierPayments.length > 0 ||
    cloud.debtPayments.length > 0 ||
    cloud.cashDrawerAdjustments.length > 0 ||
    cloud.dayDrawerOpens.length > 0 ||
    cloud.inventoryCountSessions.length > 0 ||
    cloud.shifts.length > 0 ||
    cloud.dayCloses.length > 0 ||
    cloud.stockMovements.length > 0 ||
    cloud.deletedProductIds.length > 0 ||
    cloud.voidedSaleIds.length > 0;
  const localEmpty =
    state.products.length === 0 && state.sales.length === 0 && state.customers.length === 0;

  if (!hasCloud) {
    if (opts?.cloudRecovery) {
      const { logRecoveryDiagnosticEvent } = await import("../lib/cloudRecoverySession");
      logRecoveryDiagnosticEvent("merge_produced_empty_store");
      return failMerge("merge_produced_empty_store");
    }
    if (cloud.stats.mode === "full" && shouldMarkBootstrap) markBootstrapSyncComplete();
    else {
      updateCheckpointsAfterIncrementalPull({
        sales: true,
        products: true,
        customers: true,
        debts: true,
        expenses: true,
        returns: true,
        purchases: true,
        suppliers: true,
        supplierPayments: true,
        cashDrawerAdjustments: true,
        dayDrawerOpens: true,
        inventoryCountSessions: true,
        shifts: true,
        dayCloses: true,
        stockMovements: true,
        salesAt: cloud.checkpoints?.salesAt,
        productsAt: cloud.checkpoints?.productsAt,
        customersAt: cloud.checkpoints?.customersAt,
        debtPaymentsAt: cloud.checkpoints?.debtPaymentsAt,
        expensesAt: cloud.checkpoints?.expensesAt,
        returnsAt: cloud.checkpoints?.returnsAt,
        purchasesAt: cloud.checkpoints?.purchasesAt,
        suppliersAt: cloud.checkpoints?.suppliersAt,
        supplierPaymentsAt: cloud.checkpoints?.supplierPaymentsAt,
        cashDrawerAdjustmentsAt: cloud.checkpoints?.cashDrawerAdjustmentsAt,
        dayDrawerOpensAt: cloud.checkpoints?.dayDrawerOpensAt,
        inventoryCountSessionsAt: cloud.checkpoints?.inventoryCountSessionsAt,
        shiftsAt: cloud.checkpoints?.shiftsAt,
        dayClosesAt: cloud.checkpoints?.dayClosesAt,
        stockMovementsAt: cloud.checkpoints?.stockMovementsAt,
      });
    }
    const { isDiagnosticsEnabled, recordSyncDuration } = await import("../lib/stabilityDiagnostics");
    if (isDiagnosticsEnabled()) recordSyncDuration(cloud.stats.durationMs);
    return true;
  }

  const purchaseRecovery = mergePurchaseRecoveryBundle(
    {
      purchases: state.purchases,
      suppliers: state.suppliers,
      supplierPayments: state.supplierPayments,
    },
    {
      purchaseCloudRows: cloud.purchaseCloudRows,
      supplierCloudRows: cloud.supplierCloudRows,
      supplierPayments: cloud.supplierPayments,
    },
  );

  if (localEmpty && hasCloud) {
    const debtPayments = mergeDebtPaymentsFromCloudPull([], cloud.debtPayments);
    const { reconcileCustomersForBootstrapRecovery } = await import("../lib/bootstrapDebtRecovery");
    const customers = reconcileCustomersForBootstrapRecovery(cloud.customers, cloud.sales, debtPayments);
    const mergedDayDrawerOpens =
      cloud.dayDrawerOpens.length > 0
        ? await mergeDayDrawerOpensFromCloudPull([], cloud.dayDrawerOpens)
        : state.dayDrawerOpens;
    const mergedInventoryCounts =
      cloud.inventoryCountSessions.length > 0
        ? mergeInventoryCountSessionsFromCloudPull([], cloud.inventoryCountSessions)
        : state.inventoryCountSessions;
    const mergedShifts =
      cloud.shifts.length > 0
        ? mergeShiftsFromCloudPull([], cloud.shifts)
        : state.preferences.shifts ?? [];
    const mergedDayCloses =
      cloud.dayCloses.length > 0 ? mergeDayClosesFromCloudPull([], cloud.dayCloses) : state.dayCloses;
    const mergedStockMovements =
      cloud.stockMovements.length > 0
        ? mergeStockMovementsFromCloudPull([], cloud.stockMovements)
        : state.stockMovements;

    let archivedAuditLogs = state.archivedAuditLogs;
    if (cloud.recoveredAuditLogs?.length) {
      const { mergeAuditLogsFromCloudPull } = await import("../lib/auditCloudSync");
      archivedAuditLogs = mergeAuditLogsFromCloudPull(
        state.auditLogs,
        state.archivedAuditLogs,
        cloud.recoveredAuditLogs,
      ).archivedAuditLogs;
    }

    await applyRestoredSnapshotFromBackup(
      {
      products: cloud.products,
      customers,
      sales: cloud.sales,
      preferences: { ...state.preferences, shifts: mergedShifts },
      debtPayments,
      dayCloses: mergedDayCloses,
      auditLogs: state.auditLogs,
      suppliers: purchaseRecovery.suppliers,
      purchases: purchaseRecovery.purchases,
      supplierPayments: purchaseRecovery.supplierPayments,
      stockMovements: mergedStockMovements,
      voidRecords: state.voidRecords,
      returnRecords: mergeReturnRecordsForRecovery([], cloud.returnCloudRows),
      cashExpenses: cloud.cashExpenses.length > 0 ? cloud.cashExpenses : state.cashExpenses,
      cashDrawerAdjustments:
        cloud.cashDrawerAdjustments.length > 0 ? cloud.cashDrawerAdjustments : state.cashDrawerAdjustments,
      dayDrawerOpens: mergedDayDrawerOpens,
      inventoryCountSessions: mergedInventoryCounts,
      archivedSales: state.archivedSales,
      archivedAuditLogs,
      archivedDayCloses: state.archivedDayCloses,
      archivedVoidRecords: state.archivedVoidRecords,
      archivedReturnRecords: state.archivedReturnRecords,
      deletedProductIds: cloud.deletedProductIds,
      voidedSaleIds: cloud.voidedSaleIds,
      updatedAt: new Date().toISOString(),
      },
      { cloudRecovery: opts?.cloudRecovery },
    );
    await persistRestoredSnapshotToDisk(undefined, { cloudRecovery: opts?.cloudRecovery });
    if (shouldMarkBootstrap) markBootstrapSyncComplete();
    runPostSyncDebtValidation({
      customers: usePosStore.getState().customers,
      sales: usePosStore.getState().sales,
      debtPayments: usePosStore.getState().debtPayments,
    });
    await applyShopRecoverySignalsForCurrentShop();
    const { isDiagnosticsEnabled, recordCloudMergeDuration, recordSyncDuration } = await import(
      "../lib/stabilityDiagnostics",
    );
    if (isDiagnosticsEnabled()) {
      recordCloudMergeDuration(Date.now() - mergeStarted);
      recordSyncDuration(cloud.stats.durationMs);
    }
    await assertCloudRecoveryStoreHydrated();
    return true;
  }

  const { readProductTombstones } = await import("./entityStore");
  const { markProductDeleted } = await import("./incrementalPersist");
  const tombstones = await readProductTombstones();
  const tombstoneIds = new Set(Object.keys(tombstones));
  for (const id of cloud.deletedProductIds) tombstoneIds.add(id);

  const deletedProductSet = new Set(cloud.deletedProductIds);
  const voidedSaleSet = new Set(cloud.voidedSaleIds);

  const products = (
    await mergeByIdChunked(
      state.products.filter((p) => !tombstoneIds.has(p.id) && !deletedProductSet.has(p.id)),
      cloud.products,
      (a, b) => mergeProductFromCloudPull(a, b),
      tombstoneIds,
    )
  ).filter((p) => !deletedProductSet.has(p.id));

  const mergedSales = await mergeByIdChunked(state.sales, cloud.sales, (local, remote) =>
    mergeSaleFromCloudPull(local, remote),
  );
  const sales = mergedSales.filter((s) => !voidedSaleSet.has(s.id));

  const debtPayments = mergeDebtPaymentsFromCloudPull(state.debtPayments, cloud.debtPayments);
  const cpBeforeMerge = readSyncCheckpoints();
  const ledgerAuthoritative =
    cloud.stats.mode === "full" ||
    cloud.debtPayments.length > 0 ||
    cpBeforeMerge.lastDebtPaymentsSyncAt != null ||
    debtPayments.length > 0;

  const customers = await mergeByIdChunked(state.customers, cloud.customers, (a, b) =>
    mergeCustomerFromCloudPull(a, b, sales, debtPayments, { ledgerAuthoritative }),
  );

  const mergedCashExpenses =
    cloud.cashExpenses.length > 0
      ? await mergeByIdChunked(state.cashExpenses, cloud.cashExpenses, (a, b) =>
          newer({ ...a, updatedAt: a.createdAt }, { ...b, updatedAt: b.createdAt }),
        )
      : state.cashExpenses;

  const mergedCashDrawerAdjustments =
    cloud.cashDrawerAdjustments.length > 0
      ? await mergeCashDrawerAdjustmentsFromCloudPull(state.cashDrawerAdjustments, cloud.cashDrawerAdjustments)
      : state.cashDrawerAdjustments;

  const mergedDayDrawerOpens =
    cloud.dayDrawerOpens.length > 0
      ? await mergeDayDrawerOpensFromCloudPull(state.dayDrawerOpens, cloud.dayDrawerOpens)
      : state.dayDrawerOpens;

  const mergedInventoryCounts =
    cloud.inventoryCountSessions.length > 0
      ? mergeInventoryCountSessionsFromCloudPull(state.inventoryCountSessions, cloud.inventoryCountSessions)
      : state.inventoryCountSessions;

  const mergedShifts =
    cloud.shifts.length > 0
      ? mergeShiftsFromCloudPull(state.preferences.shifts ?? [], cloud.shifts)
      : state.preferences.shifts ?? [];

  const mergedDayCloses =
    cloud.dayCloses.length > 0
      ? mergeDayClosesFromCloudPull(state.dayCloses, cloud.dayCloses)
      : state.dayCloses;

  const mergedStockMovements =
    cloud.stockMovements.length > 0
      ? mergeStockMovementsFromCloudPull(state.stockMovements, cloud.stockMovements)
      : state.stockMovements;

  const returnRecords = mergeReturnRecordsForRecovery(state.returnRecords, cloud.returnCloudRows);

  let mergedArchivedAuditLogs = state.archivedAuditLogs;
  if (cloud.recoveredAuditLogs?.length) {
    const { mergeAuditLogsFromCloudPull } = await import("../lib/auditCloudSync");
    mergedArchivedAuditLogs = mergeAuditLogsFromCloudPull(
      state.auditLogs,
      state.archivedAuditLogs,
      cloud.recoveredAuditLogs,
    ).archivedAuditLogs;
  }

  const { suspendStorePersist } = await import("../store/usePosStore");
  const release = suspendStorePersist();
  try {
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
    usePosStore.setState({ products, customers });
    if (sales.length > 200) {
      await yieldUiTick();
    }
    usePosStore.setState({
      sales,
      debtPayments,
      cashExpenses: mergedCashExpenses,
      cashDrawerAdjustments: mergedCashDrawerAdjustments,
      dayDrawerOpens: mergedDayDrawerOpens,
      inventoryCountSessions: mergedInventoryCounts,
      dayCloses: mergedDayCloses,
      stockMovements: mergedStockMovements,
      preferences: { ...state.preferences, shifts: mergedShifts },
      returnRecords,
      purchases: purchaseRecovery.purchases,
      suppliers: purchaseRecovery.suppliers,
      supplierPayments: purchaseRecovery.supplierPayments,
      archivedAuditLogs: mergedArchivedAuditLogs,
    });

    const next = usePosStore.getState();
    const { flushFullSnapshotPersist } = await import("./incrementalPersist");
    await flushFullSnapshotPersist(next, { skipLastGood: true });
    runPostSyncDebtValidation({
      customers: next.customers,
      sales: next.sales,
      debtPayments: next.debtPayments,
    });
  } finally {
    release();
  }

  for (const id of cloud.deletedProductIds) {
    await markProductDeleted(id);
  }
  const { addVoidedSaleTombstones } = await import("./entityStore");
  await addVoidedSaleTombstones(cloud.voidedSaleIds);

  if (cloud.stats.mode === "full") {
    if (shouldMarkBootstrap) markBootstrapSyncComplete();
  } else {
    updateCheckpointsAfterIncrementalPull({
      sales: true,
      products: true,
      customers: true,
      debts: true,
      expenses: cloud.stats.expenses > 0 || cloud.checkpoints?.expensesAt != null,
      returns: cloud.stats.returns > 0 || cloud.checkpoints?.returnsAt != null,
      purchases: cloud.stats.purchases > 0 || cloud.checkpoints?.purchasesAt != null,
      suppliers: cloud.stats.suppliers > 0 || cloud.checkpoints?.suppliersAt != null,
      supplierPayments:
        cloud.stats.supplierPayments > 0 || cloud.checkpoints?.supplierPaymentsAt != null,
      cashDrawerAdjustments:
        cloud.cashDrawerAdjustments.length > 0 || cloud.checkpoints?.cashDrawerAdjustmentsAt != null,
      dayDrawerOpens: cloud.dayDrawerOpens.length > 0 || cloud.checkpoints?.dayDrawerOpensAt != null,
      inventoryCountSessions:
        cloud.inventoryCountSessions.length > 0 || cloud.checkpoints?.inventoryCountSessionsAt != null,
      shifts: cloud.shifts.length > 0 || cloud.checkpoints?.shiftsAt != null,
      dayCloses: cloud.dayCloses.length > 0 || cloud.checkpoints?.dayClosesAt != null,
      stockMovements: cloud.stockMovements.length > 0 || cloud.checkpoints?.stockMovementsAt != null,
      salesAt: cloud.checkpoints?.salesAt,
      productsAt: cloud.checkpoints?.productsAt,
      customersAt: cloud.checkpoints?.customersAt,
      debtPaymentsAt: cloud.checkpoints?.debtPaymentsAt,
      expensesAt: cloud.checkpoints?.expensesAt,
      returnsAt: cloud.checkpoints?.returnsAt,
      purchasesAt: cloud.checkpoints?.purchasesAt,
      suppliersAt: cloud.checkpoints?.suppliersAt,
      supplierPaymentsAt: cloud.checkpoints?.supplierPaymentsAt,
      cashDrawerAdjustmentsAt: cloud.checkpoints?.cashDrawerAdjustmentsAt,
      dayDrawerOpensAt: cloud.checkpoints?.dayDrawerOpensAt,
      inventoryCountSessionsAt: cloud.checkpoints?.inventoryCountSessionsAt,
      shiftsAt: cloud.checkpoints?.shiftsAt,
      dayClosesAt: cloud.checkpoints?.dayClosesAt,
      stockMovementsAt: cloud.checkpoints?.stockMovementsAt,
    });
  }

  await applyShopRecoverySignalsForCurrentShop();
  if (opts?.cloudRecovery) {
    const { reconcileRecoveryInventoryLedger } = await import("../lib/recoveryInventoryReconciliation");
    const { recordRecoveryIntegrityDiagnostics } = await import("../lib/cloudRecoverySession");
    const reconciliation = reconcileRecoveryInventoryLedger({ applyToStore: true });
    recordRecoveryIntegrityDiagnostics({
      inventoryReconciliation: {
        productsRestored: reconciliation.productsRestored,
        movementsRestored: reconciliation.movementsAfter,
        syntheticMovementsGenerated:
          reconciliation.syntheticSaleMovements + reconciliation.syntheticOpeningMovements,
        remainingMismatchCount: reconciliation.remainingMismatches.length,
        inventoryIntegrityStatus: reconciliation.status,
        mismatches: reconciliation.remainingMismatches,
      },
    });
    if (!reconciliation.healed && reconciliation.remainingMismatches.length > 0) {
      const { reportSyncIssue } = await import("../lib/monitoring");
      reportSyncIssue("recovery_inventory_integrity_mismatch", {
        mismatchCount: reconciliation.remainingMismatches.length,
        status: reconciliation.status,
      });
    }
  }
  const { isDiagnosticsEnabled, recordCloudMergeDuration, recordSyncDuration } = await import(
    "../lib/stabilityDiagnostics",
  );
  if (isDiagnosticsEnabled()) {
    recordCloudMergeDuration(Date.now() - mergeStarted);
    recordSyncDuration(cloud.stats.durationMs);
  }
  await assertCloudRecoveryStoreHydrated();
  return true;
}

/** Disaster recovery: re-download full catalog and sales history. */
export async function forceFullCloudSync(): Promise<boolean> {
  return pullCloudAndMergeIntoStore({ forceFull: true });
}

/** Push local rows still marked pendingSync to cloud (recovery / new device). */
export async function pushAllPendingToCloud(): Promise<{ ok: number; fail: number }> {
  const ctx = await resolveShopCtx();
  if (!ctx) return { ok: 0, fail: 0 };

  const { mapPool } = await import("../lib/asyncPool");
  const { SYNC_SALE_PUSH_CONCURRENCY } = await import("../lib/syncTiming");

  let ok = 0;
  let fail = 0;
  const { sales } = usePosStore.getState();
  const pendingSales = sales.filter((s) => s.pendingSync);
  const saleResults = await mapPool(pendingSales, SYNC_SALE_PUSH_CONCURRENCY, async (s) =>
    pushSaleRowToCloud(s, ctx),
  );
  ok += saleResults.ok;
  fail += saleResults.fail;

  for (const adj of usePosStore.getState().cashDrawerAdjustments) {
    if (!adj.pendingSync) continue;
    if (await pushCashDrawerAdjustmentToCloud(adj, ctx)) ok += 1;
    else fail += 1;
  }

  for (const row of usePosStore.getState().dayDrawerOpens) {
    if (!row.pendingSync) continue;
    const action = row.status === "voided" ? "void" : row.supersedesId ? "supersede" : "create";
    const payload: Record<string, unknown> = { action, dayOpenId: row.id };
    if (action === "supersede" && row.supersedesId) payload.previousId = row.supersedesId;
    if (await syncDayDrawerOpenOperation(payload, ctx)) ok += 1;
    else fail += 1;
  }

  for (const session of usePosStore.getState().inventoryCountSessions) {
    if (!session.pendingSync) continue;
    if (await pushInventoryCountSessionToCloud(session, ctx)) ok += 1;
    else fail += 1;
  }

  for (const shift of usePosStore.getState().preferences.shifts ?? []) {
    if (!shift.pendingSync) continue;
    if (await pushShiftToCloud(shift, ctx)) ok += 1;
    else fail += 1;
  }

  for (const close of usePosStore.getState().dayCloses) {
    if (!close.pendingSync) continue;
    if (await pushDayCloseToCloud(close, ctx)) ok += 1;
    else fail += 1;
  }

  return { ok, fail };
}

const PULL_MIN_INTERVAL_MS = SYNC_PULL_MIN_INTERVAL_MS;

function shouldPullFromCloud(): boolean {
  const last = readSyncHealthMeta().lastPullAt;
  if (!last) return true;
  const age = Date.now() - new Date(last).getTime();
  return age >= PULL_MIN_INTERVAL_MS;
}

/** Push pending sales/queue only (fast, for background sync). */
async function pushShopPendingToCloudInner(): Promise<{
  push: { ok: number; fail: number };
  queueFailed: number;
}> {
  const { assertOrganizationOperationsAllowed } = await import("../lib/organizationDeletionState");
  try {
    await assertOrganizationOperationsAllowed();
  } catch {
    return { push: { ok: 0, fail: 0 }, queueFailed: 0 };
  }

  let push = { ok: 0, fail: 0 };
  let queueFailed = 0;
  if (getDeviceOnline()) {
    push = await pushAllPendingToCloud();
    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();
    queueFailed = result.failed;
    writeSyncHealthMeta({ lastPushAt: new Date().toISOString() });
    const ctx = await resolveShopCtx();
    if (ctx) {
      const { sendShopPresenceHeartbeat } = await import("../lib/shopPresence");
      void sendShopPresenceHeartbeat(ctx.shopId);
    }
  }
  return { push, queueFailed };
}

export async function pushShopPendingToCloud(): Promise<{
  push: { ok: number; fail: number };
  queueFailed: number;
}> {
  const { withGlobalSyncMutex } = await import("../lib/globalSyncMutex");
  return withGlobalSyncMutex("pushPending", () => pushShopPendingToCloudInner());
}

/** Pull cloud data, push pending local rows, then drain the offline queue. */
async function syncShopWithCloudInner(opts?: {
  pull?: boolean;
  forceFull?: boolean;
}): Promise<{
  pulled: boolean;
  push: { ok: number; fail: number };
  queueFailed: number;
}> {
  const { assertOrganizationOperationsAllowed } = await import("../lib/organizationDeletionState");
  try {
    await assertOrganizationOperationsAllowed();
  } catch {
    return { pulled: false, push: { ok: 0, fail: 0 }, queueFailed: 0 };
  }

  if (hasSupabaseConfig && supabase) {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user && !isSupabaseEmailVerified(user)) {
      return { pulled: false, push: { ok: 0, fail: 0 }, queueFailed: 0 };
    }
  }
  const pullBlocked = shouldPausePosBackgroundPull();
  const doPull = pullBlocked
    ? false
    : opts?.pull === false
      ? false
      : opts?.pull === true
        ? true
        : shouldPullFromCloud();
  const pulled = doPull ? await pullCloudAndMergeIntoStore({ forceFull: opts?.forceFull }) : false;
  const { pullHospitalityStateFromCloud } = await import("./hospitalityCloudSync");
  if (getDeviceOnline() && !pullBlocked) {
    await pullHospitalityStateFromCloud(opts?.forceFull === true);
    const { pullAndMergeStaffDuringCloudSync } = await import("../lib/staffRecovery");
    await pullAndMergeStaffDuringCloudSync();
    void import("../lib/staffLoginSecurity").then(({ flushPendingStaffSecurityEvents }) => {
      flushPendingStaffSecurityEvents();
    });
    const { fetchDeviceAuthorityContext } = await import("../lib/deviceAuthority");
    await fetchDeviceAuthorityContext();
  }
  const { push, queueFailed } = await pushShopPendingToCloudInner();
  if (getDeviceOnline() && push.fail === 0) {
    const { uploadShopCloudSnapshot } = await import("../lib/cloudSnapshotSync");
    const { runWhenIdle } = await import("../lib/uiYield");
    runWhenIdle(() => void uploadShopCloudSnapshot().catch(() => false), isNativeApp() ? 15_000 : 4000);
  }
  return { pulled, push, queueFailed };
}

export async function syncShopWithCloud(opts?: {
  pull?: boolean;
  forceFull?: boolean;
}): Promise<{
  pulled: boolean;
  push: { ok: number; fail: number };
  queueFailed: number;
}> {
  const { withGlobalSyncMutex } = await import("../lib/globalSyncMutex");
  const { recordSyncDuration } = await import("../lib/performanceMetrics");
  const started = performance.now();
  const result = await withGlobalSyncMutex("syncShopWithCloud", () => syncShopWithCloudInner(opts));
  recordSyncDuration("syncShopWithCloud", performance.now() - started);
  return result;
}

/** Fire-and-forget cloud sync after local hydrate (does not block UI). */
let backgroundSyncTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleBackgroundCloudSync(opts?: { pull?: boolean; delayMs?: number }): void {
  if (!hasSupabaseConfig) return;
  if (shouldPausePosBackgroundPull()) {
    void import("../lib/posPushScheduler").then(({ schedulePushPendingUploads }) => schedulePushPendingUploads());
    return;
  }
  if (backgroundSyncTimer != null) return;
  const delay = opts?.delayMs ?? 0;
  backgroundSyncTimer = globalThis.setTimeout(() => {
    backgroundSyncTimer = null;
    void syncShopWithCloud({ pull: opts?.pull }).catch(() => undefined);
  }, delay);
}

export function computeSyncSalesStats(sales: Sale[]): {
  unsyncedCount: number;
  errorCount: number;
  errors: Array<{ id: string; error: string; createdAt: string }>;
} {
  let unsyncedCount = 0;
  let errorCount = 0;
  const errors: Array<{ id: string; error: string; createdAt: string }> = [];
  for (const s of sales) {
    if (s.pendingSync) unsyncedCount += 1;
    if (s.lastSyncError) {
      errorCount += 1;
      if (errors.length < 6) {
        errors.push({ id: s.id, error: s.lastSyncError, createdAt: s.createdAt });
      }
    }
  }
  return { unsyncedCount, errorCount, errors };
}

export function countUnsyncedSales(): number {
  return computeSyncSalesStats(usePosStore.getState().sales).unsyncedCount;
}

export function countSalesWithSyncErrors(): number {
  return computeSyncSalesStats(usePosStore.getState().sales).errorCount;
}

export function listSalesWithSyncErrors(limit = 5): Array<{ id: string; error: string; createdAt: string }> {
  return computeSyncSalesStats(usePosStore.getState().sales).errors.slice(0, limit);
}
