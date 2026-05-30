import type { Customer, Product, ReturnRecord, Sale, SaleLine, SellingMode, SupplierPayment } from "../types";
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

type ShopCtx = { shopId: string; userId: string };

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01";
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function resolveShopCtx(): Promise<ShopCtx | null> {
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

function productToRow(p: Product, shopId: string) {
  return {
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
    stock_on_hand: Number(p.stockOnHand) || 0,
    reorder_level: Number(p.minimumStockAlert) || 0,
    minimum_stock_alert: Number(p.minimumStockAlert) || 0,
    sku: productSku(p),
    is_active: true,
    metadata: {
      category: p.category ?? "",
      version: p.version,
      quickPresetsMoneyUgx: p.quickPresetsMoneyUgx ?? [],
      quickPresetsQty: p.quickPresetsQty ?? [],
      wakaClient: true,
    },
    updated_at: p.updatedAt || new Date().toISOString(),
  };
}

function rowToProduct(row: Record<string, unknown>): Product | null {
  const id = String(row.id ?? "");
  if (!isUuid(id)) return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const sellingMode = (row.selling_mode as SellingMode) || "unit";
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
  return {
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
}

function rowToSale(row: Record<string, unknown>, lines: SaleLine[]): Sale | null {
  const id = String(row.id ?? "");
  if (!isUuid(id)) return null;
  const status = String(row.status ?? "completed");
  if (status === "void" || status === "refunded") return null;
  return {
    id,
    lines,
    subtotalUgx: Math.max(0, Math.floor(Number(row.subtotal_ugx ?? row.total_ugx ?? 0))),
    totalUgx: Math.max(0, Math.floor(Number(row.total_ugx ?? 0))),
    cashPaidUgx: Math.max(0, Math.floor(Number(row.cash_amount_ugx ?? 0))),
    debtUgx: Math.max(0, Math.floor(Number(row.debt_amount_ugx ?? 0))),
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
  const { error } = await supabase.from("products").upsert(productToRow(product, ctx.shopId), { onConflict: "id" });
  return !error;
}

export async function pushCustomerToCloud(customer: Customer, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(customer.id)) return false;
  const { error } = await supabase.from("customers").upsert(customerToRow(customer, ctx.shopId), { onConflict: "id" });
  return !error;
}

export async function pushSaleToCloud(sale: Sale, ctx: ShopCtx): Promise<boolean> {
  if (!supabase || !isUuid(sale.id)) {
    markSaleSyncState(sale.id, false, "invalid_sale_id");
    return false;
  }

  for (const line of sale.lines) {
    if (!isUuid(line.productId)) continue;
    const p = usePosStore.getState().products.find((x) => x.id === line.productId);
    if (p) {
      const ok = await pushProductToCloud(p, ctx);
      if (!ok) {
        markSaleSyncState(sale.id, false, "product_push_failed");
        return false;
      }
    }
  }

  const saleRow = {
    id: sale.id,
    shop_id: ctx.shopId,
    customer_id: sale.customerId && isUuid(sale.customerId) ? sale.customerId : null,
    status: "draft" as const,
    payment_status: sale.debtUgx > 0 ? "partial" : "paid",
    subtotal_ugx: sale.subtotalUgx,
    tax_ugx: 0,
    discount_ugx: 0,
    total_ugx: sale.totalUgx,
    cash_amount_ugx: sale.cashPaidUgx,
    debt_amount_ugx: sale.debtUgx,
    issue_receipt: false,
    created_by: sale.soldByUserId && isUuid(sale.soldByUserId) ? sale.soldByUserId : ctx.userId,
    completed_at: null,
    metadata: { estimatedProfitUgx: sale.estimatedProfitUgx, wakaClient: true },
    created_at: sale.createdAt,
    updated_at: sale.createdAt,
  };

  const { error: saleErr } = await supabase.from("sales").upsert(saleRow, { onConflict: "id" });
  if (saleErr) {
    markSaleSyncState(sale.id, false, "sale_upsert_failed");
    return false;
  }

  await supabase.from("sale_line_items").delete().eq("sale_id", sale.id);

  const lineRows = sale.lines.map((line, idx) => ({
    id: crypto.randomUUID(),
    sale_id: sale.id,
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
  }));

  if (lineRows.length > 0) {
    const { error: linesErr } = await supabase.from("sale_line_items").insert(lineRows);
    if (linesErr) {
      markSaleSyncState(sale.id, false, "sale_lines_failed");
      return false;
    }
  }

  await supabase.from("sale_payments").delete().eq("sale_id", sale.id);
  if (sale.cashPaidUgx > 0) {
    const { error: payErr } = await supabase.from("sale_payments").insert({
      id: crypto.randomUUID(),
      sale_id: sale.id,
      method: "cash",
      amount_ugx: sale.cashPaidUgx,
      recorded_by: ctx.userId,
    });
    if (payErr) {
      markSaleSyncState(sale.id, false, "sale_payment_failed");
      return false;
    }
  }

  const { error: completeErr } = await supabase
    .from("sales")
    .update({
      status: "completed",
      completed_at: sale.createdAt,
      payment_status: sale.debtUgx > 0 ? "partial" : "paid",
    })
    .eq("id", sale.id)
    .eq("shop_id", ctx.shopId);
  if (completeErr) {
    markSaleSyncState(sale.id, false, "sale_complete_failed");
    return false;
  }

  markSaleSyncState(sale.id, true, null);
  return true;
}

async function pushReturnToCloud(returnRow: ReturnRecord, ctx: ShopCtx): Promise<boolean> {
  if (!supabase) return false;
  const payload = {
    id: returnRow.id,
    shop_id: ctx.shopId,
    sale_id: returnRow.saleId ?? null,
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
  const { error } = await supabase.from("sale_returns").upsert(payload, { onConflict: "id" });
  if (!error) return true;
  if (isMissingTableError(error)) return true;
  return false;
}

async function pushSupplierPaymentToCloud(payment: SupplierPayment, ctx: ShopCtx): Promise<boolean> {
  if (!supabase) return false;
  const payload = {
    id: payment.id,
    shop_id: ctx.shopId,
    supplier_id: payment.supplierId,
    amount_ugx: payment.amountUgx,
    created_at: payment.createdAt,
    recorded_by: ctx.userId,
    metadata: { wakaClient: true },
  };
  const { error } = await supabase.from("supplier_payments").upsert(payload, { onConflict: "id" });
  if (!error) return true;
  if (isMissingTableError(error)) return true;
  return false;
}

/** Push one sale to Supabase as soon as possible (after checkout). */
export async function syncSaleImmediately(saleId: string): Promise<boolean> {
  if (!hasSupabaseConfig) return false;
  if (!getDeviceOnline()) return false;
  const sale = usePosStore.getState().sales.find((s) => s.id === saleId);
  if (!sale) return false;
  const ctx = await resolveShopCtx();
  if (!ctx) return false;
  return pushSaleToCloud(sale, ctx);
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
      const product = usePosStore.getState().products.find((p) => p.id === productId);
      if (!product) return true;
      return pushProductToCloud(product, ctx);
    }
    case "pending_stock_updates":
    case "stock_move": {
      const productId = String(payload.productId ?? payload.id ?? "");
      const product = usePosStore.getState().products.find((p) => p.id === productId);
      if (!product) return true;
      return pushProductToCloud(product, ctx);
    }
    case "pending_sales":
    case "sale": {
      if (payload.kind === "day_close") return true;
      const saleId = String(payload.saleId ?? "");
      const sale = usePosStore.getState().sales.find((s) => s.id === saleId);
      if (!sale) return true;
      return pushSaleToCloud(sale, ctx);
    }
    case "pending_returns": {
      const returnId = String(payload.returnId ?? "");
      const row = usePosStore.getState().returnRecords.find((r) => r.id === returnId);
      if (!row) return true;
      if (row.saleId) {
        const sale = usePosStore.getState().sales.find((s) => s.id === row.saleId);
        if (sale) {
          const synced = await pushSaleToCloud(sale, ctx);
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
    case "customer": {
      const customerId = String(payload.id ?? "");
      const customer = usePosStore.getState().customers.find((c) => c.id === customerId);
      if (!customer) return true;
      return pushCustomerToCloud(customer, ctx);
    }
    default:
      return true;
  }
}

export type CloudPullMode = "full" | "incremental";

export type CloudPullStats = {
  mode: CloudPullMode;
  products: number;
  customers: number;
  sales: number;
  deletedProducts: number;
  voidedSales: number;
  expenses: number;
  payloadBytes: number;
  durationMs: number;
};

export type CloudPullResult = {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  deletedProductIds: string[];
  voidedSaleIds: string[];
  stats: CloudPullStats;
};

const FULL_SALES_PAGE = 800;
const FULL_SALES_MAX_PAGES = 20;
const INCREMENTAL_SALES_LIMIT = 500;
const INCREMENTAL_PRODUCTS_LIMIT = 500;
const INCREMENTAL_CUSTOMERS_LIMIT = 500;
const INCREMENTAL_EXPENSES_LIMIT = 200;

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

async function pullSalesIncremental(ctx: ShopCtx, since: string): Promise<{ sales: Sale[]; voidedIds: string[]; bytes: number }> {
  const { data: saleRows, error: sErr } = await supabase!
    .from("sales")
    .select("*, sale_line_items(*)")
    .eq("shop_id", ctx.shopId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(INCREMENTAL_SALES_LIMIT);
  if (sErr) throw sErr;
  const batch = (saleRows ?? []) as Record<string, unknown>[];
  const parsed = parseSaleRows(batch);
  return { sales: parsed.sales, voidedIds: parsed.voidedIds, bytes: estimatePayloadBytes(batch) };
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
): Promise<{ products: Product[]; deletedIds: string[]; bytes: number }> {
  const { data: productRows, error: pErr } = await supabase!
    .from("products")
    .select("*")
    .eq("shop_id", ctx.shopId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(INCREMENTAL_PRODUCTS_LIMIT);
  if (pErr) throw pErr;
  const rows = productRows ?? [];
  const products: Product[] = [];
  const deletedIds: string[] = [];
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
  return { products, deletedIds, bytes: estimatePayloadBytes(rows) };
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

async function pullCustomersIncremental(ctx: ShopCtx, since: string): Promise<{ customers: Customer[]; bytes: number }> {
  const { data: customerRows, error: cErr } = await supabase!
    .from("customers")
    .select("*")
    .eq("shop_id", ctx.shopId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(INCREMENTAL_CUSTOMERS_LIMIT);
  if (cErr) throw cErr;
  const rows = customerRows ?? [];
  const customers = rows.map((r) => rowToCustomer(r as Record<string, unknown>)).filter((c): c is Customer => c != null);
  return { customers, bytes: estimatePayloadBytes(rows) };
}

/** Expenses use created_at (no updated_at column). Count only for checkpoint/diagnostics. */
async function pullExpensesIncremental(ctx: ShopCtx, since: string): Promise<{ count: number; bytes: number }> {
  try {
    const { data, error } = await supabase!
      .from("expenses")
      .select("id, created_at")
      .eq("shop_id", ctx.shopId)
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(INCREMENTAL_EXPENSES_LIMIT);
    if (error) {
      if (isMissingTableError(error)) return { count: 0, bytes: 0 };
      throw error;
    }
    const rows = data ?? [];
    return { count: rows.length, bytes: estimatePayloadBytes(rows) };
  } catch {
    return { count: 0, bytes: 0 };
  }
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
  let expenseCount = 0;
  let payloadBytes = 0;

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
    } else {
      const sinceProducts = cp.lastProductsSyncAt ?? new Date(0).toISOString();
      const sinceCustomers = cp.lastCustomersSyncAt ?? new Date(0).toISOString();
      const sinceSales = cp.lastSalesSyncAt ?? new Date(0).toISOString();
      const sinceExpenses = cp.lastExpensesSyncAt ?? new Date(0).toISOString();

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
      expenseCount = ex.count;
      payloadBytes += ex.bytes;
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
    payloadBytes,
    durationMs: Math.round(performance.now() - started),
  };

  const { isDiagnosticsEnabled, recordCloudPullStats } = await import("../lib/stabilityDiagnostics");
  if (isDiagnosticsEnabled()) recordCloudPullStats(stats);

  return { products, customers, sales, deletedProductIds, voidedSaleIds, stats };
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
      });
    }
    const { isDiagnosticsEnabled, recordSyncDuration } = await import("../lib/stabilityDiagnostics");
    if (isDiagnosticsEnabled()) recordSyncDuration(cloud.stats.durationMs);
    return true;
  }

  if (localEmpty && hasCloud) {
    await applyRestoredSnapshotFromBackup({
      products: cloud.products,
      customers: cloud.customers,
      sales: cloud.sales,
      preferences: state.preferences,
      debtPayments: state.debtPayments,
      dayCloses: state.dayCloses,
      auditLogs: state.auditLogs,
      suppliers: state.suppliers,
      purchases: state.purchases,
      supplierPayments: state.supplierPayments,
      stockMovements: state.stockMovements,
      voidRecords: state.voidRecords,
      returnRecords: state.returnRecords,
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
      (a, b) => newer(a, b),
      tombstoneIds,
    )
  ).filter((p) => !deletedProductSet.has(p.id));

  const customers = await mergeByIdChunked(state.customers, cloud.customers, (a, b) => newer(a, b));
  const mergedSales = await mergeByIdChunked(state.sales, cloud.sales, (a, b) =>
    newer({ ...a, updatedAt: a.createdAt }, { ...b, updatedAt: b.createdAt }),
  );
  const sales = mergedSales.filter((s) => !voidedSaleSet.has(s.id));

  const { suspendStorePersist } = await import("../store/usePosStore");
  const release = suspendStorePersist();
  try {
    const { yieldUiTick } = await import("../lib/uiYield");
    await yieldUiTick();
    usePosStore.setState({ products, customers });
    if (sales.length > 200) {
      await yieldUiTick();
    }
    usePosStore.setState({ sales });

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
      expenses: cloud.stats.expenses > 0,
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
    if (await pushSaleToCloud(s, ctx)) ok += 1;
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
  backgroundSyncTimer = window.setTimeout(() => {
    backgroundSyncTimer = null;
    void syncShopWithCloud({ pull: opts?.pull }).catch(() => undefined);
  }, delay);
}

export function countUnsyncedSales(): number {
  return usePosStore.getState().sales.filter((s) => s.pendingSync).length;
}
