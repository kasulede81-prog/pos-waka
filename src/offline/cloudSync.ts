import type {
  AuditLogEntry,
  CashExpense,
  Customer,
  Product,
  Purchase,
  ReturnRecord,
  Sale,
  SaleLine,
  SellingMode,
  Supplier,
  SupplierPayment,
} from "../types";
import { isPendingSale, saleStatusOf } from "../lib/saleStatus";
import { mergePendingSalePair, mergePendingSales, ensureSaleLineId } from "../lib/pendingSaleMerge";
import { mergeSaleFromCloudPull } from "../lib/saleFinancialMerge";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { getDeviceOnline } from "../lib/deviceOnline";
import { shouldPausePosBackgroundWork } from "../lib/backgroundWorkPolicy";
import { isNativeApp } from "../lib/nativeApp";
import { writeSyncHealthMeta, readSyncHealthMeta } from "../lib/syncMeta";
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
  mergePurchaseRecoveryBundle,
  rowToPurchase,
  rowToSupplier,
  rowToSupplierPayment,
  type CloudPurchaseRow,
  type CloudSupplierRow,
} from "../lib/purchaseRecovery";
import { isWalkInSupplierId } from "../lib/walkInSupplier";
import {
  mergeProductFromCloudPull,
  patchProductsWithServerStock,
  type ServerProductStockRow,
} from "../lib/inventoryIntegrity";
import { buyingUnitsToBaseUnits } from "../lib/sellingEngine";

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
  const userId = data.session?.user?.id;
  if (!userId) return null;
  const orgShop = await resolvePrimaryOrganizationForUser(userId);
  if (!orgShop) return null;
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
    cost_price_per_unit_ugx: Math.max(0, Math.floor(p.costPricePerUnitUgx)),
    price_ugx: Math.max(0, Math.floor(p.sellingPricePerUnitUgx)),
    cost_ugx: Math.max(0, Math.floor(p.costPricePerUnitUgx)),
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
    costPricePerUnitUgx: Math.max(0, Math.floor(Number(row.cost_price_per_unit_ugx ?? row.cost_ugx ?? 0))),
    stockOnHand: Number(row.stock_on_hand ?? 0),
    minimumStockAlert: Number(row.minimum_stock_alert ?? row.reorder_level ?? 0),
    category: String(meta.category ?? ""),
    sku: String(row.sku ?? ""),
    expiryDate: expiryRaw != null && String(expiryRaw).trim() ? String(expiryRaw).trim().slice(0, 10) : null,
    medicineStrength:
      strengthRaw != null && String(strengthRaw).trim() ? String(strengthRaw).trim().slice(0, 64) : null,
    medicineForm: formRaw != null && String(formRaw).trim() ? String(formRaw).trim().slice(0, 64) : null,
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
  const inputMode = row.line_input_mode === "money" ? "money" : "quantity";
  const quantity = Number(row.quantity ?? 0);
  const unitPriceUgx = Math.max(0, Math.floor(Number(row.unit_price_ugx ?? 0)));
  const lineTotalUgx = Math.max(0, Math.floor(Number(row.line_total_ugx ?? 0)));
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const line: SaleLine = {
    id: row.id != null ? String(row.id) : undefined,
    updatedAt: meta.updatedAt != null ? String(meta.updatedAt) : undefined,
    productId: String(row.product_id ?? ""),
    name: String(meta.name ?? "Item"),
    inputMode,
    quantity,
    unitPriceUgx,
    unitCostUgx: Math.max(0, Math.floor(Number(meta.unitCostUgx ?? 0))),
    lineTotalUgx,
    estimatedProfitUgx: Math.max(0, Math.floor(Number(meta.estimatedProfitUgx ?? lineTotalUgx))),
    moneyAmountUgx: row.money_amount_ugx != null ? Math.floor(Number(row.money_amount_ugx)) : null,
  };
  return ensureSaleLineId(line);
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
      metadata: { estimatedProfitUgx: sale.estimatedProfitUgx, wakaClient: true },
      created_at: sale.createdAt,
      updated_at: sale.createdAt,
    },
    lines: activeLines.map((line, idx) => ({
      id: line.id,
      product_id: line.productId,
      quantity: line.quantity,
      unit_price_ugx: line.unitPriceUgx,
      line_discount_ugx: 0,
      line_total_ugx: line.lineTotalUgx,
      line_input_mode: line.inputMode,
      money_amount_ugx: line.moneyAmountUgx ?? null,
      metadata: {
        name: line.name,
        unitCostUgx: line.unitCostUgx,
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

async function pushPurchaseToCloud(purchase: Purchase, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(purchase.id)) return false;
  const payload = {
    id: purchase.id,
    supplier_id: purchase.supplierId,
    supplier_name: purchase.supplierName,
    total_cost_ugx: purchase.totalCostUgx,
    amount_paid_ugx: purchase.amountPaidUgx,
    balance_delta_ugx: purchase.balanceDeltaUgx,
    notes: purchase.notes,
    created_at: purchase.createdAt,
    lines: purchase.lines.map((ln) => ({
      productId: ln.productId,
      name: ln.name,
      qtyBuyingUnits: ln.qtyBuyingUnits,
      costPerBuyingUnitUgx: ln.costPerBuyingUnitUgx,
    })),
    metadata: { wakaClient: true },
  };
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
  return result?.ok === true;
}

function markPurchaseSynced(purchaseId: string): void {
  usePosStore.setState((s) => ({
    purchases: s.purchases.map((p) => (p.id === purchaseId ? { ...p, pendingSync: false } : p)),
  }));
}

async function syncPurchaseBundle(purchaseId: string, ctx: ShopCtx): Promise<boolean> {
  const purchase = usePosStore.getState().purchases.find((p) => p.id === purchaseId);
  if (!purchase) return true;

  const purchaseOk = await pushPurchaseToCloud(purchase, ctx);
  if (!purchaseOk) return false;

  for (const ln of purchase.lines) {
    const product = usePosStore.getState().products.find((p) => p.id === ln.productId);
    if (!product) continue;
    const baseIn = buyingUnitsToBaseUnits(product, ln.qtyBuyingUnits);
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
      return syncPurchaseBundle(purchaseId, ctx);
    }
    case "purchase": {
      const purchaseId = String(payload.purchaseId ?? payload.id ?? "");
      if (!purchaseId) return true;
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
  returns: number;
  purchases: number;
  suppliers: number;
  supplierPayments: number;
  deletedProducts: number;
  voidedSales: number;
  expenses: number;
  payloadBytes: number;
  durationMs: number;
};

export type CloudPullCheckpoints = {
  salesAt: string;
  productsAt: string;
  customersAt: string;
  expensesAt: string;
  returnsAt: string;
  purchasesAt: string;
  suppliersAt: string;
  supplierPaymentsAt: string;
};

export type CloudPullResult = {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  returnRecords: ReturnRecord[];
  /** Cloud rows with updated_at for merge (same ids as returnRecords). */
  returnCloudRows: CloudReturnRow[];
  purchases: Purchase[];
  purchaseCloudRows: CloudPurchaseRow[];
  supplierCloudRows: CloudSupplierRow[];
  supplierPayments: SupplierPayment[];
  cashExpenses: CashExpense[];
  deletedProductIds: string[];
  voidedSaleIds: string[];
  stats: CloudPullStats;
  checkpoints?: CloudPullCheckpoints;
};

const FULL_SALES_PAGE = 800;
const FULL_SALES_MAX_PAGES = 20;
const INCREMENTAL_SALES_LIMIT = 500;
const INCREMENTAL_PRODUCTS_LIMIT = 500;
const INCREMENTAL_CUSTOMERS_LIMIT = 500;
const INCREMENTAL_EXPENSES_LIMIT = 200;
const INCREMENTAL_RETURNS_LIMIT = 500;
const INCREMENTAL_PURCHASES_LIMIT = 500;
const INCREMENTAL_SUPPLIERS_LIMIT = 500;
const INCREMENTAL_SUPPLIER_PAYMENTS_LIMIT = 500;
const INCREMENTAL_MAX_PAGES = 40;

const SHOP_PURCHASES_SELECT =
  "id, shop_id, supplier_id, supplier_name, total_cost_ugx, amount_paid_ugx, balance_delta_ugx, notes, lines, created_at, updated_at, metadata";

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
    if (sale) sales.push(sale);
  }
  return { sales, voidedIds };
}

async function pullSalesFull(ctx: ShopCtx): Promise<{ sales: Sale[]; voidedIds: string[]; bytes: number }> {
  const sales: Sale[] = [];
  const voidedIds: string[] = [];
  let bytes = 0;
  let offset = 0;
  for (let page = 0; page < FULL_SALES_MAX_PAGES; page++) {
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
  return { sales, voidedIds, bytes };
}

async function pullSalesIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ sales: Sale[]; voidedIds: string[]; bytes: number; checkpointAt: string }> {
  const sales: Sale[] = [];
  const voidedIds: string[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;
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
    cursor = checkpointAt;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return { sales, voidedIds, bytes, checkpointAt: checkpointAt > since ? checkpointAt : new Date().toISOString() };
}

async function pullProductsFull(ctx: ShopCtx): Promise<{ products: Product[]; deletedIds: string[]; bytes: number }> {
  const { data: productRows, error: pErr } = await supabase!
    .from("products")
    .select("*")
    .eq("shop_id", ctx.shopId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(5000);
  if (pErr) throw pErr;
  const rows = productRows ?? [];
  const products = rows.map((r) => rowToProduct(r as Record<string, unknown>)).filter((p): p is Product => p != null);
  return { products, deletedIds: [], bytes: estimatePayloadBytes(rows) };
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
  const { data: customerRows, error: cErr } = await supabase!
    .from("customers")
    .select("*")
    .eq("shop_id", ctx.shopId)
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (cErr) throw cErr;
  const rows = customerRows ?? [];
  const customers = rows.map((r) => rowToCustomer(r as Record<string, unknown>)).filter((c): c is Customer => c != null);
  return { customers, bytes: estimatePayloadBytes(rows) };
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
  filter: { since?: string; full?: boolean },
): Promise<{ rows: CashExpense[]; bytes: number; checkpointAt: string }> {
  let q = supabase!
    .from("expenses")
    .select(CASH_EXPENSE_SELECT)
    .eq("shop_id", ctx.shopId)
    .eq("expense_type", "cash_drawer");
  if (!filter.full && filter.since) {
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
  const all: CloudReturnRow[] = [];
  let bytes = 0;
  let cursor = new Date(0).toISOString();
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const { rows, bytes: b, checkpointAt } = await pullReturnsPage(ctx, cursor);
    bytes += b;
    if (rows.length === 0) break;
    all.push(...rows);
    if (checkpointAt <= cursor) break;
    cursor = checkpointAt;
    if (rows.length < INCREMENTAL_RETURNS_LIMIT) break;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return { returnRows: all, bytes };
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
  const all: CloudPurchaseRow[] = [];
  let bytes = 0;
  let cursor = new Date(0).toISOString();
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const { rows, bytes: b, checkpointAt } = await pullPurchasesPage(ctx, cursor);
    bytes += b;
    if (rows.length === 0) break;
    all.push(...rows);
    if (checkpointAt <= cursor) break;
    cursor = checkpointAt;
    if (rows.length < INCREMENTAL_PURCHASES_LIMIT) break;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return { purchaseRows: all, bytes };
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
  const all: CloudSupplierRow[] = [];
  let bytes = 0;
  let cursor = new Date(0).toISOString();
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const { rows, bytes: b, checkpointAt } = await pullSuppliersPage(ctx, cursor);
    bytes += b;
    if (rows.length === 0) break;
    all.push(...rows);
    if (checkpointAt <= cursor) break;
    cursor = checkpointAt;
    if (rows.length < INCREMENTAL_SUPPLIERS_LIMIT) break;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return { supplierRows: all, bytes };
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
  const all: SupplierPayment[] = [];
  let bytes = 0;
  let cursor = new Date(0).toISOString();
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const { rows, bytes: b, checkpointAt } = await pullSupplierPaymentsPage(ctx, cursor);
    bytes += b;
    if (rows.length === 0) break;
    all.push(...rows);
    if (checkpointAt <= cursor) break;
    cursor = checkpointAt;
    if (rows.length < INCREMENTAL_SUPPLIER_PAYMENTS_LIMIT) break;
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
  }
  return { supplierPayments: all, bytes };
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

async function pullCashExpensesFull(ctx: ShopCtx): Promise<{ cashExpenses: CashExpense[]; bytes: number }> {
  const all: CashExpense[] = [];
  let bytes = 0;
  for (let page = 0; page < INCREMENTAL_MAX_PAGES; page++) {
    const { rows, bytes: b } = await pullCashExpensesPage(ctx, { full: true });
    bytes += b;
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < INCREMENTAL_EXPENSES_LIMIT) break;
  }
  return { cashExpenses: all, bytes };
}

export async function pullShopDataFromCloud(opts?: {
  mode?: CloudPullMode;
  forceFull?: boolean;
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
  let returnCloudRows: CloudReturnRow[] = [];
  let purchaseCloudRows: CloudPurchaseRow[] = [];
  let supplierCloudRows: CloudSupplierRow[] = [];
  let supplierPayments: SupplierPayment[] = [];
  let expenseCount = 0;
  let returnCount = 0;
  let purchaseCount = 0;
  let supplierCount = 0;
  let supplierPaymentCount = 0;
  let payloadBytes = 0;
  let pullCheckpoints: CloudPullCheckpoints | undefined;

  try {
    if (mode === "full") {
      const p = await pullProductsFull(ctx);
      products = p.products;
      deletedProductIds = p.deletedIds;
      payloadBytes += p.bytes;

      const c = await pullCustomersFull(ctx);
      customers = c.customers;
      payloadBytes += c.bytes;

      const s = await pullSalesFull(ctx);
      sales = s.sales;
      voidedSaleIds = s.voidedIds;
      payloadBytes += s.bytes;

      const exFull = await pullCashExpensesFull(ctx);
      cashExpenses = exFull.cashExpenses;
      expenseCount = exFull.cashExpenses.length;
      payloadBytes += exFull.bytes;

      const retFull = await pullReturnsFull(ctx);
      returnCloudRows = retFull.returnRows;
      returnCount = retFull.returnRows.length;
      payloadBytes += retFull.bytes;

      const purFull = await pullPurchasesFull(ctx);
      purchaseCloudRows = purFull.purchaseRows;
      purchaseCount = purFull.purchaseRows.length;
      payloadBytes += purFull.bytes;

      const supFull = await pullSuppliersFull(ctx);
      supplierCloudRows = supFull.supplierRows;
      supplierCount = supFull.supplierRows.length;
      payloadBytes += supFull.bytes;

      const payFull = await pullSupplierPaymentsFull(ctx);
      supplierPayments = payFull.supplierPayments;
      supplierPaymentCount = payFull.supplierPayments.length;
      payloadBytes += payFull.bytes;
    } else {
      const sinceProducts = cp.lastProductsSyncAt ?? new Date(0).toISOString();
      const sinceCustomers = cp.lastCustomersSyncAt ?? new Date(0).toISOString();
      const sinceSales = cp.lastSalesSyncAt ?? new Date(0).toISOString();
      const sinceExpenses = cp.lastExpensesSyncAt ?? new Date(0).toISOString();
      const sinceReturns = cp.lastReturnsSyncAt ?? new Date(0).toISOString();

      const p = await pullProductsIncremental(ctx, sinceProducts);
      products = p.products;
      deletedProductIds = p.deletedIds;
      payloadBytes += p.bytes;

      const c = await pullCustomersIncremental(ctx, sinceCustomers);
      customers = c.customers;
      payloadBytes += c.bytes;

      const s = await pullSalesIncremental(ctx, sinceSales);
      sales = s.sales;
      voidedSaleIds = s.voidedIds;
      payloadBytes += s.bytes;

      const ex = await pullExpensesIncremental(ctx, sinceExpenses);
      cashExpenses = ex.cashExpenses;
      expenseCount = ex.count;
      payloadBytes += ex.bytes;

      const ret = await pullReturnsIncremental(ctx, sinceReturns);
      returnCloudRows = ret.returnRows;
      returnCount = ret.returnRows.length;
      payloadBytes += ret.bytes;

      const sincePurchases = cp.lastPurchasesSyncAt ?? new Date(0).toISOString();
      const sinceSuppliers = cp.lastSuppliersSyncAt ?? new Date(0).toISOString();
      const sinceSupplierPayments = cp.lastSupplierPaymentsSyncAt ?? new Date(0).toISOString();

      const pur = await pullPurchasesIncremental(ctx, sincePurchases);
      purchaseCloudRows = pur.purchaseRows;
      purchaseCount = pur.purchaseRows.length;
      payloadBytes += pur.bytes;

      const sup = await pullSuppliersIncremental(ctx, sinceSuppliers);
      supplierCloudRows = sup.supplierRows;
      supplierCount = sup.supplierRows.length;
      payloadBytes += sup.bytes;

      const pay = await pullSupplierPaymentsIncremental(ctx, sinceSupplierPayments);
      supplierPayments = pay.supplierPayments;
      supplierPaymentCount = pay.supplierPayments.length;
      payloadBytes += pay.bytes;

      pullCheckpoints = {
        salesAt: s.checkpointAt,
        productsAt: p.checkpointAt,
        customersAt: c.checkpointAt,
        expensesAt: ex.checkpointAt,
        returnsAt: ret.checkpointAt,
        purchasesAt: pur.checkpointAt,
        suppliersAt: sup.checkpointAt,
        supplierPaymentsAt: pay.checkpointAt,
      };
    }
  } catch {
    return null;
  }

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
  writeSyncHealthMeta({ lastSuccessAt: pulledAt, lastPullAt: pulledAt, lastIssueCode: "none", lastIssueAt: null });

  const stats: CloudPullStats = {
    mode,
    products: products.length,
    customers: customers.length,
    sales: sales.length,
    deletedProducts: deletedProductIds.length,
    voidedSales: voidedSaleIds.length,
    expenses: expenseCount,
    returns: returnCount,
    purchases: purchaseCount,
    suppliers: supplierCount,
    supplierPayments: supplierPaymentCount,
    payloadBytes,
    durationMs: Math.round(performance.now() - started),
  };

  const { isDiagnosticsEnabled, recordCloudPullStats } = await import("../lib/stabilityDiagnostics");
  if (isDiagnosticsEnabled()) recordCloudPullStats(stats);

  return {
    products,
    customers,
    sales,
    returnRecords: returnCloudRows.map((r) => r.record),
    returnCloudRows,
    purchases: purchaseCloudRows.map((r) => r.record),
    purchaseCloudRows,
    supplierCloudRows,
    supplierPayments,
    cashExpenses,
    deletedProductIds,
    voidedSaleIds,
    stats,
    checkpoints: pullCheckpoints,
  };
}

/** Merge cloud into local store after disk bootstrap (new device / desktop login). */
export async function pullCloudAndMergeIntoStore(opts?: { forceFull?: boolean }): Promise<boolean> {
  const mergeStarted = Date.now();
  const { applyShopRecoverySignalsForCurrentShop } = await import("../lib/shopRecoverySignals");
  const { applyRestoredSnapshotFromBackup, persistRestoredSnapshotToDisk } = await import(
    "../store/usePosStore",
  );
  if (!hasSupabaseConfig) return false;
  const cloud = await pullShopDataFromCloud({ forceFull: opts?.forceFull });
  if (!cloud) return false;

  const state = usePosStore.getState();
  if (!state._hydrated) return false;

  const hasCloud =
    cloud.products.length > 0 ||
    cloud.sales.length > 0 ||
    cloud.customers.length > 0 ||
    cloud.returnRecords.length > 0 ||
    cloud.purchaseCloudRows.length > 0 ||
    cloud.supplierCloudRows.length > 0 ||
    cloud.supplierPayments.length > 0 ||
    cloud.deletedProductIds.length > 0 ||
    cloud.voidedSaleIds.length > 0;
  const localEmpty =
    state.products.length === 0 && state.sales.length === 0 && state.customers.length === 0;

  if (!hasCloud) {
    if (cloud.stats.mode === "full") markBootstrapSyncComplete();
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
        salesAt: cloud.checkpoints?.salesAt,
        productsAt: cloud.checkpoints?.productsAt,
        customersAt: cloud.checkpoints?.customersAt,
        debtsAt: cloud.checkpoints?.customersAt,
        expensesAt: cloud.checkpoints?.expensesAt,
        returnsAt: cloud.checkpoints?.returnsAt,
        purchasesAt: cloud.checkpoints?.purchasesAt,
        suppliersAt: cloud.checkpoints?.suppliersAt,
        supplierPaymentsAt: cloud.checkpoints?.supplierPaymentsAt,
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
    await applyRestoredSnapshotFromBackup({
      products: cloud.products,
      customers: cloud.customers,
      sales: cloud.sales,
      preferences: state.preferences,
      debtPayments: state.debtPayments,
      dayCloses: state.dayCloses,
      auditLogs: state.auditLogs,
      suppliers: purchaseRecovery.suppliers,
      purchases: purchaseRecovery.purchases,
      supplierPayments: purchaseRecovery.supplierPayments,
      stockMovements: state.stockMovements,
      voidRecords: state.voidRecords,
      returnRecords: mergeReturnRecordsForRecovery([], cloud.returnCloudRows),
      cashExpenses: cloud.cashExpenses.length > 0 ? cloud.cashExpenses : state.cashExpenses,
      archivedSales: state.archivedSales,
      archivedAuditLogs: state.archivedAuditLogs,
      archivedDayCloses: state.archivedDayCloses,
      archivedVoidRecords: state.archivedVoidRecords,
      archivedReturnRecords: state.archivedReturnRecords,
      updatedAt: new Date().toISOString(),
    });
    await persistRestoredSnapshotToDisk();
    markBootstrapSyncComplete();
    await applyShopRecoverySignalsForCurrentShop();
    const { isDiagnosticsEnabled, recordCloudMergeDuration, recordSyncDuration } = await import(
      "../lib/stabilityDiagnostics",
    );
    if (isDiagnosticsEnabled()) {
      recordCloudMergeDuration(Date.now() - mergeStarted);
      recordSyncDuration(cloud.stats.durationMs);
    }
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

  const customers = await mergeByIdChunked(state.customers, cloud.customers, (a, b) => newer(a, b));
  const mergedSales = await mergeByIdChunked(state.sales, cloud.sales, (local, remote) =>
    mergeSaleFromCloudPull(local, remote),
  );
  const sales = mergedSales.filter((s) => !voidedSaleSet.has(s.id));

  const mergedCashExpenses =
    cloud.cashExpenses.length > 0
      ? await mergeByIdChunked(state.cashExpenses, cloud.cashExpenses, (a, b) =>
          newer({ ...a, updatedAt: a.createdAt }, { ...b, updatedAt: b.createdAt }),
        )
      : state.cashExpenses;

  const returnRecords = mergeReturnRecordsForRecovery(state.returnRecords, cloud.returnCloudRows);

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
      cashExpenses: mergedCashExpenses,
      returnRecords,
      purchases: purchaseRecovery.purchases,
      suppliers: purchaseRecovery.suppliers,
      supplierPayments: purchaseRecovery.supplierPayments,
    });

    const next = usePosStore.getState();
    const { flushFullSnapshotPersist } = await import("./incrementalPersist");
    await flushFullSnapshotPersist(next, { skipLastGood: true });
  } finally {
    release();
  }

  for (const id of cloud.deletedProductIds) {
    await markProductDeleted(id);
  }

  if (cloud.stats.mode === "full") {
    markBootstrapSyncComplete();
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
      salesAt: cloud.checkpoints?.salesAt,
      productsAt: cloud.checkpoints?.productsAt,
      customersAt: cloud.checkpoints?.customersAt,
      debtsAt: cloud.checkpoints?.customersAt,
      expensesAt: cloud.checkpoints?.expensesAt,
      returnsAt: cloud.checkpoints?.returnsAt,
      purchasesAt: cloud.checkpoints?.purchasesAt,
      suppliersAt: cloud.checkpoints?.suppliersAt,
      supplierPaymentsAt: cloud.checkpoints?.supplierPaymentsAt,
    });
  }

  await applyShopRecoverySignalsForCurrentShop();
  const { isDiagnosticsEnabled, recordCloudMergeDuration, recordSyncDuration } = await import(
    "../lib/stabilityDiagnostics",
  );
  if (isDiagnosticsEnabled()) {
    recordCloudMergeDuration(Date.now() - mergeStarted);
    recordSyncDuration(cloud.stats.durationMs);
  }
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

  let ok = 0;
  let fail = 0;
  const { sales } = usePosStore.getState();

  for (const s of sales) {
    if (!s.pendingSync) continue;
    if (await pushSaleRowToCloud(s, ctx)) ok += 1;
    else fail += 1;
  }

  return { ok, fail };
}

const PULL_MIN_INTERVAL_MS = 5 * 60_000;

function shouldPullFromCloud(): boolean {
  const last = readSyncHealthMeta().lastPullAt;
  if (!last) return true;
  const age = Date.now() - new Date(last).getTime();
  return age >= PULL_MIN_INTERVAL_MS;
}

/** Push pending sales/queue only (fast, for background sync). */
export async function pushShopPendingToCloud(): Promise<{
  push: { ok: number; fail: number };
  queueFailed: number;
}> {
  let push = { ok: 0, fail: 0 };
  let queueFailed = 0;
  if (getDeviceOnline()) {
    push = await pushAllPendingToCloud();
    const { flushSyncQueue } = await import("./syncEngine");
    const result = await flushSyncQueue();
    queueFailed = result.failed;
    const ctx = await resolveShopCtx();
    if (ctx) {
      const { sendShopPresenceHeartbeat } = await import("../lib/shopPresence");
      void sendShopPresenceHeartbeat(ctx.shopId);
    }
  }
  return { push, queueFailed };
}

/** Pull cloud data, push pending local rows, then drain the offline queue. */
export async function syncShopWithCloud(opts?: {
  pull?: boolean;
  forceFull?: boolean;
}): Promise<{
  pulled: boolean;
  push: { ok: number; fail: number };
  queueFailed: number;
}> {
  if (shouldPausePosBackgroundWork()) {
    return { pulled: false, push: { ok: 0, fail: 0 }, queueFailed: 0 };
  }
  const doPull =
    opts?.pull === false ? false : opts?.pull === true ? true : shouldPullFromCloud();
  const pulled = doPull ? await pullCloudAndMergeIntoStore({ forceFull: opts?.forceFull }) : false;
  const { pullHospitalityStateFromCloud } = await import("./hospitalityCloudSync");
  if (getDeviceOnline()) {
    await pullHospitalityStateFromCloud(opts?.forceFull === true);
  }
  const { push, queueFailed } = await pushShopPendingToCloud();
  if (getDeviceOnline() && push.fail === 0) {
    const { uploadShopCloudSnapshot } = await import("../lib/cloudSnapshotSync");
    const { runWhenIdle } = await import("../lib/uiYield");
    runWhenIdle(() => void uploadShopCloudSnapshot().catch(() => false), isNativeApp() ? 15_000 : 4000);
  }
  return { pulled, push, queueFailed };
}

/** Fire-and-forget cloud sync after local hydrate (does not block UI). */
let backgroundSyncTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleBackgroundCloudSync(opts?: { pull?: boolean; delayMs?: number }): void {
  if (!hasSupabaseConfig) return;
  if (shouldPausePosBackgroundWork()) return;
  if (backgroundSyncTimer != null) return;
  const delay = opts?.delayMs ?? 0;
  backgroundSyncTimer = globalThis.setTimeout(() => {
    backgroundSyncTimer = null;
    void syncShopWithCloud({ pull: opts?.pull }).catch(() => undefined);
  }, delay);
}

export function countUnsyncedSales(): number {
  return usePosStore.getState().sales.filter((s) => s.pendingSync).length;
}

export function countSalesWithSyncErrors(): number {
  return usePosStore.getState().sales.filter((s) => s.lastSyncError).length;
}

export function listSalesWithSyncErrors(limit = 5): Array<{ id: string; error: string; createdAt: string }> {
  return usePosStore
    .getState()
    .sales.filter((s) => s.lastSyncError)
    .slice(0, limit)
    .map((s) => ({ id: s.id, error: s.lastSyncError ?? "unknown", createdAt: s.createdAt }));
}
