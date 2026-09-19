/**
 * F2 — a bill that is voided before its FIRST cloud acknowledgement.
 *
 * Root cause (proven): a whole-bill void leaves the sale `saleVoidedAt && pendingSync`, and the queue routed
 * any such sale to shop_patch_hospitality_sale_metadata, which only patches a sale the server has already
 * COMPLETED. For a sale that never reached the server it answered `sale_not_found_or_not_completed`, forever:
 * the original completion was never uploaded, so the sale (and its void adjustments, which wait for it) stayed
 * local. Behind that sat a second defect in the same path: the completion payload dropped voided lines while
 * its header was still the original one, so even a correctly routed completion was rejected by the server
 * (`subtotal_mismatch`) — the same happened to a RETAIL line voided before its first ack.
 *
 * This suite drives the REAL store actions, the REAL queue routing/partition/processing functions and the REAL
 * server SQL (shop_push_sale_complete, the F1 validator, apply_sale_stock_movements, both void RPCs, the
 * metadata patch) through a supabase.rpc bridge; only auth/roles/unrelated tables are stubbed and faults
 * (offline, rejections) are injected at the RPC boundary.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import * as syncEngine from "./syncEngine";
import type { PharmacyPrescription, Product, Sale, SaleLine, SyncOperation } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "../lib/hospitality";
import { isBlockedBusinessSyncError, partitionSaleBeforeAdjustment, syncProcessStatus } from "../lib/saleAdjustmentSync";
import { saleUploadRpcForLocalSale } from "../lib/cancelPendingSaleAck";
import { appendBatchToProduct, computeBatchIntegrity, createBatchOnReceive, getProductBatches } from "../lib/pharmacyBatches";
import { buildSalePushPayload, processCloudSyncOperationResult, pushSaleToCloud } from "./cloudSync";

// ── the supabase bridge ────────────────────────────────────────────────────────────────────────────────────
const bridge = vi.hoisted(() => ({
  rpc: (async () => ({ data: null, error: null })) as (name: unknown, args?: unknown) => Promise<unknown>,
}));
vi.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (name: unknown, args?: unknown) => bridge.rpc(name, args),
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "maybeSingle"]) q[m] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "unmocked" } }).then(resolve);
      return q;
    },
    auth: { getSession: async () => ({ data: { session: { user: { id: "22222222-2222-4222-8222-222222222222" } } } }) },
  },
}));
vi.mock("../lib/organizationDeletionState", () => ({ assertOrganizationOperationsAllowed: async () => undefined }));

const dir = join(process.cwd(), "supabase", "migrations");
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SHOP = u(1);
const USER = "22222222-2222-4222-8222-222222222222";
const COKE = u(11); // retail, 2,000
const WATER = u(13); // retail, 5,000
const BURGER = u(10); // made-to-order, 20,000
const CHICKEN = u(12); // batch-prepared, 10,000
const BEEF = u(20);
const BUN = u(21);
const SAUCE = u(22);
const CH_A = u(23);
const CH_B = u(24);
const RX_PRODUCT = "ffffffff-2222-4fff-8fff-ffffffffffff";
const OPENING: Record<string, number> = { [COKE]: 100, [WATER]: 100, [BURGER]: 0, [CHICKEN]: 20, [BEEF]: 100, [BUN]: 100, [SAUCE]: 100, [RX_PRODUCT]: 38 };

// ── the server: real SQL ───────────────────────────────────────────────────────────────────────────────────
function fnFrom(file: string, name: string): string {
  const src = readFileSync(join(dir, file), "utf8");
  const start = src.indexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  return src.slice(start, src.indexOf("$$;", src.indexOf("as $$", start)) + 3);
}
const MENU_BURGER = { productKind: "finished_menu", prepMode: "made_to_order", recipe: { yieldQty: 1, lines: [{ ingredientProductId: BEEF, quantityBase: 1 }, { ingredientProductId: BUN, quantityBase: 1 }, { ingredientProductId: SAUCE, quantityBase: 1 }] } };
const MENU_CHICKEN = { productKind: "finished_menu", prepMode: "batch_prepared", recipe: { yieldQty: 20, lines: [{ ingredientProductId: CH_A, quantityBase: 40 }, { ingredientProductId: CH_B, quantityBase: 20 }] } };

async function newServer(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema if not exists auth;
    create function auth.uid () returns uuid language sql as $$ select '${USER}'::uuid $$;
    create function public.user_is_cashier_or_above (p uuid) returns boolean language sql as $$ select true $$;
    create function public.staff_v2_validate_sold_by_user_id (p_shop_id uuid, p_sale jsonb, p_uid uuid) returns uuid language sql as $$ select p_uid $$;
    create function public.inventory_movement_uuid (s uuid, t text, r uuid, p uuid) returns uuid language sql immutable
      as $$ select md5 (s::text || '|' || t || '|' || r::text || '|' || p::text)::uuid $$;
    create table public.products (id uuid primary key, shop_id uuid, is_active boolean default true, stock_on_hand numeric(18,4) default 0, updated_at timestamptz default now(), metadata jsonb default '{}'::jsonb);
    create table public.sales (
      id uuid primary key, shop_id uuid, customer_id uuid, status text default 'draft', payment_status text, subtotal_ugx bigint default 0, tax_ugx bigint default 0,
      discount_ugx bigint default 0, total_ugx bigint default 0, cash_amount_ugx bigint default 0, debt_amount_ugx bigint default 0, issue_receipt boolean default false,
      created_by uuid, sold_by_user_id uuid, completed_at timestamptz, metadata jsonb default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table public.sale_line_items (
      id uuid primary key, sale_id uuid, product_id uuid, quantity numeric(18,4), unit_price_ugx bigint, line_discount_ugx bigint, line_total_ugx bigint,
      line_input_mode text, money_amount_ugx bigint, metadata jsonb default '{}'::jsonb
    );
    create table public.sale_payments (id uuid primary key default gen_random_uuid(), sale_id uuid, method text, amount_ugx bigint, recorded_by uuid);
    create table public.sale_returns (
      id uuid primary key default gen_random_uuid(), shop_id uuid, sale_id uuid, product_id uuid, quantity numeric(18,4), refund_amount_ugx bigint,
      reason text, note text, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb default '{}'::jsonb, stock_applied_at timestamptz
    );
    create table public.sale_voids (
      id uuid primary key, shop_id uuid, sale_id uuid, product_id uuid, quantity numeric, amount_ugx bigint check (amount_ugx > 0), line_index int, note text,
      sale_voided_at timestamptz, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb default '{}'::jsonb
    );
    create table public.inventory_movements (
      id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, quantity_delta numeric(18,4),
      reason text check (reason in ('sale','return','adjustment','initial','transfer','waste','other','damaged','personal','debt','purchase','void')),
      reference_type text, reference_id uuid, note text, created_by uuid, created_at timestamptz default now()
    );
    create unique index inventory_movements_sale_product_unique on public.inventory_movements (shop_id, reference_type, reference_id, product_id) where reference_type = 'sale' and reference_id is not null;
    create unique index inventory_movements_sale_void_product_unique on public.inventory_movements (shop_id, reference_type, reference_id, product_id) where reference_type = 'sale_void' and reference_id is not null;
    create unique index inventory_movements_sale_recipe_unique on public.inventory_movements (shop_id, reference_type, reference_id, product_id) where reference_type = 'recipe' and reference_id is not null;
  `);
  const R5 = "20260919110000_made_to_order_ingredient_stock.sql";
  for (const [file, name] of [
    ["172_sale_void_stock_durable_idempotency.sql", "_apply_durable_stock_delta"],
    ["20260919100000_sale_void_bounded_reversal_guard.sql", "shop_apply_sale_void_stock"],
    [R5, "_wk_try_uuid"],
    [R5, "_wk_recipe_provenance_struct"],
    [R5, "recipe_line_provenance"],
    [R5, "_wk_recipe_lines"],
    [R5, "_wk_recipe_line_reversed_qty"],
    [R5, "_wk_recipe_credit"],
    [R5, "apply_sale_stock_movements"],
    [R5, "shop_apply_sale_void_line_stock"],
    ["20260919130000_sale_validation_bill_charges.sql", "validate_sale_push_financials"],
    ["170_sale_complete_already_completed_fence.sql", "shop_push_sale_complete"],
    ["129_hospitality_restaurant_billing_sync.sql", "shop_patch_hospitality_sale_metadata"],
    ["20260916025318_sale_line_void_state_sync.sql", "shop_sync_sale_line_void_state"],
  ] as const) {
    await db.exec(fnFrom(file, name));
  }
  const row = (id: string, stock: number, meta: unknown = {}) => `('${id}', '${SHOP}', ${stock}, '${JSON.stringify(meta)}'::jsonb)`;
  await db.exec(`
    insert into public.products (id, shop_id, stock_on_hand, metadata) values
      ${row(COKE, OPENING[COKE]!)}, ${row(WATER, OPENING[WATER]!)}, ${row(BURGER, 0, { menu: MENU_BURGER })}, ${row(CHICKEN, OPENING[CHICKEN]!, { menu: MENU_CHICKEN })},
      ${row(BEEF, 100)}, ${row(BUN, 100)}, ${row(SAUCE, 100)}, ${row(RX_PRODUCT, 38)};
  `);
  return db;
}

const q = async <T extends Record<string, unknown>>(db: PGlite, sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;
const serverStock = async (db: PGlite, id: string) => Number((await q<{ s: string }>(db, "select stock_on_hand as s from public.products where id = $1", [id]))[0]!.s);
const serverSales = (db: PGlite) => q<{ id: string; status: string; total_ugx: string; subtotal_ugx: string; cash_amount_ugx: string; debt_amount_ugx: string; metadata: Record<string, unknown> }>(db, "select * from public.sales");
const serverLines = (db: PGlite) => q<{ id: string; product_id: string; line_total_ugx: string; quantity: string; metadata: Record<string, unknown> }>(db, "select * from public.sale_line_items order by id");
const serverPayments = (db: PGlite) => q<{ amount_ugx: string }>(db, "select * from public.sale_payments");
const serverVoids = (db: PGlite) => q<{ id: string; amount_ugx: string; product_id: string }>(db, "select * from public.sale_voids order by id");
const moves = (db: PGlite, type: string) => q<{ product_id: string; quantity_delta: string }>(db, "select product_id, quantity_delta from public.inventory_movements where reference_type = $1 order by product_id, id", [type]);

// ── rpc bridge + fault injection + the client queue ─────────────────────────────────────────────────────────
type Fault = { rpc: string; kind: "network" | "reject"; error?: string; left: number };
let db: PGlite;
let faults: Fault[] = [];
let rpcLog: string[] = [];
let queue: SyncOperation[] = [];

function attachServer(server: PGlite) {
  bridge.rpc = async (name: unknown, rawArgs: unknown) => {
    const fn = String(name);
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    rpcLog.push(fn);
    const fault = faults.find((f) => f.rpc === fn && f.left > 0);
    if (fault) {
      fault.left -= 1;
      return fault.kind === "network" ? { data: null, error: { code: "network", message: "offline" } } : { data: { ok: false, error: fault.error }, error: null };
    }
    const keys = Object.keys(args);
    const cast = (v: unknown) => (typeof v === "object" && v !== null ? "jsonb" : typeof v === "number" ? "numeric" : typeof v === "boolean" ? "boolean" : /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(v)) ? "uuid" : "text");
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}::${cast(args[k])}`).join(", ")}) as r`;
    try {
      const res = await server.query<{ r: unknown }>(sql, keys.map((k) => (typeof args[k] === "object" && args[k] !== null ? JSON.stringify(args[k]) : args[k])));
      return { data: res.rows[0]!.r, error: null };
    } catch (e) {
      return { data: null, error: { code: /does not exist/.test(String(e)) ? "42883" : "XX000", message: String(e) } };
    }
  };
}

/** The sale-related operations the real store enqueues (everything else is irrelevant to this path). */
function captureQueue() {
  vi.spyOn(syncEngine, "enqueueSync").mockImplementation(async (op) => {
    const keep = op.kind === "pending_sales" || op.kind === "sale" || (op.kind === "pending_stock_updates" && (op.payload as { referenceType?: string })?.referenceType === "sale_void");
    if (!keep) return;
    const full = { ...op, attempts: op.attempts ?? 0, shopId: op.shopId ?? SHOP } as SyncOperation;
    const i = queue.findIndex((o) => o.id === full.id);
    if (i >= 0) queue[i] = full;
    else queue.push(full);
  });
}

/** One engine pass: sale uploads first (the real partition), then the adjustments; "ack" removes the row. */
async function flush(): Promise<string[]> {
  const { saleUploads, other } = partitionSaleBeforeAdjustment([...queue]);
  const trace: string[] = [];
  for (const op of [...saleUploads, ...other]) {
    const status = syncProcessStatus(await processCloudSyncOperationResult(op));
    trace.push(`${op.kind}:${status}`);
    if (status === "ack") queue = queue.filter((o) => o.id !== op.id);
  }
  return trace;
}
async function converge(maxPasses = 8) {
  for (let i = 0; i < maxPasses && queue.length > 0; i++) await flush();
}
const fail = (rpc: string, times: number, kind: Fault["kind"] = "network", error?: string) => faults.push({ rpc, kind, error, left: times });
const clearFaults = () => {
  faults = [];
};

// ── the client: real store actions ─────────────────────────────────────────────────────────────────────────
function base(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return { sellingMode: "unit", baseUnit: "pcs", sellingPricePerUnitUgx: 10_000, costPricePerUnitUgx: 3_000, stockOnHand: 100, minimumStockAlert: 0, category: "Food", sku: "", updatedAt: "2026-09-17T08:00:00.000Z", version: 1, ...partial };
}
const ing = (id: string, cost: number) => base({ id, name: id, costPricePerUnitUgx: cost, baseUnit: "u", menu: { productKind: "ingredient" } });
const menuProduct = (id: string, name: string, price: number, menu: Product["menu"], extra: Partial<Product> = {}) => base({ id, name, sellingPricePerUnitUgx: price, costPricePerUnitUgx: 0, stockOnHand: 0, menu, ...extra });
const clientProducts = (): Product[] => [
  base({ id: COKE, name: "Coke", sellingPricePerUnitUgx: 2_000, costPricePerUnitUgx: 1_200, stockOnHand: OPENING[COKE]!, baseUnit: "bottle", category: "Drinks" }),
  base({ id: WATER, name: "Water", sellingPricePerUnitUgx: 5_000, costPricePerUnitUgx: 2_000, stockOnHand: OPENING[WATER]!, baseUnit: "bottle", category: "Drinks" }),
  ing(BEEF, 8_000), ing(BUN, 1_000), ing(SAUCE, 500), ing(CH_A, 1_000), ing(CH_B, 500),
  menuProduct(BURGER, "Burger", 20_000, { ...MENU_BURGER, modifierGroups: [], variants: [] } as Product["menu"]),
  menuProduct(CHICKEN, "Prepared Chicken", 10_000, { ...MENU_CHICKEN, modifierGroups: [], variants: [] } as Product["menu"], { baseUnit: "portion" }),
];
const st = () => usePosStore.getState();
const product = (id: string) => st().products.find((p) => p.id === id)!;
const sale = () => st().sales.find((s) => s.status === "completed")!;
const line = (p: Product, quantity: number, id: string): SaleLine => ({
  id, productId: p.id, name: p.name, inputMode: "quantity", quantity, unitPriceUgx: p.sellingPricePerUnitUgx, unitCostUgx: p.costPricePerUnitUgx,
  lineTotalUgx: p.sellingPricePerUnitUgx * quantity, estimatedProfitUgx: (p.sellingPricePerUnitUgx - p.costPricePerUnitUgx) * quantity, updatedAt: "2026-09-17T08:05:00.000Z",
});

function seedClient(products: Product[] = clientProducts(), prefs: Record<string, unknown> = {}) {
  usePosStore.setState({
    _hydrated: true, sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" }, products, customers: [], sales: [], stockMovements: [], archivedStockMovements: [],
    voidRecords: [], archivedVoidRecords: [], returnRecords: [], archivedReturnRecords: [], auditLogs: [], archivedAuditLogs: [], draftLines: [], draftCartDiscountUgx: 0,
    activePendingSaleId: null, draftInput: null, draftSaleCustomerId: "", draftSaleCustomerName: "", draftSaleCustomerPhone: "", draftPaymentMethod: "cash",
    pharmacyPrescriptions: [], pharmacyControlledRegister: [],
    preferences: { ...st().preferences, ...prefs },
  });
  expect(openTestShift().ok).toBe(true);
}

/** A settled hospitality table bill through the real table actions, with a 10% service charge (F1 charges). */
function settleTableBill(lines: Array<[string, number]>, payAmount: number) {
  seedClient(clientProducts(), { businessType: "hospitality", hospitalityModeEnabled: true, hospitalityFloor: defaultHospitalityFloor(), hospitalityServiceChargePercent: 10, hospitalityTaxEnabled: false });
  if (lines.some(([id]) => id === CHICKEN)) expect(st().prepareMenuBatch({ productId: CHICKEN, portions: 20, batchId: "b1" }).ok).toBe(true);
  const opened = st().openTable({ tableId: st().preferences.hospitalityFloor!.tables[0]!.id, guestCount: 2 });
  expect(opened.ok).toBe(true);
  const sessionId = (opened as { sessionId: string }).sessionId;
  for (const [id, qty] of lines) expect(st().addHospitalityDraftLine({ product: product(id), quantity: qty }).ok).toBe(true);
  st().saveTableBill();
  expect(st().recordTableBillPayment({ method: "cash", amountUgx: payAmount }).ok).toBe(true);
  expect(st().finalizeTableBill().ok).toBe(true);
  return { sessionId, original: sale() };
}
const SIMPLE_BILL: Array<[string, number]> = [[COKE, 10], [WATER, 4]]; // 20,000 + 20,000 = 40,000 (+ 10% service = 44,000)
const MIXED_BILL: Array<[string, number]> = [[BURGER, 3], [COKE, 2], [CHICKEN, 2]]; // 60,000 + 4,000 + 20,000 = 84,000 (+ 10% = 92,400)

function voidTheBill(sessionId: string) {
  expect(st().voidSettledTableBill({ sessionId, reason: "wrong table", managerPin: "" }).ok).toBe(true);
}

/** What the server must hold once the sale and its void have both arrived. */
async function expectCanonicalAfterVoid(original: Sale, opts: { voidedAll: boolean } = { voidedAll: true }) {
  const sales = await serverSales(db);
  expect(sales).toHaveLength(1); // exactly one canonical Sale — never a second one
  const s = sales[0]!;
  const orig = original.cloudCompleteFinancials!;
  expect(s.status).toBe("completed");
  expect([Number(s.total_ugx), Number(s.subtotal_ugx), Number(s.cash_amount_ugx), Number(s.debt_amount_ugx)]).toEqual([orig.totalUgx, orig.subtotalUgx, orig.cashPaidUgx, orig.debtUgx]); // ORIGINAL values
  const lines = await serverLines(db);
  expect(lines.map((l) => Number(l.line_total_ugx)).sort((a, b) => a - b)).toEqual(original.lines.map((l) => l.lineTotalUgx).sort((a, b) => a - b)); // original line totals
  expect(lines.reduce((n, l) => n + Number(l.line_total_ugx), 0)).toBe(orig.subtotalUgx);
  const payments = await serverPayments(db);
  expect(payments.reduce((n, p) => n + Number(p.amount_ugx), 0)).toBe(orig.cashPaidUgx); // money counted once
  expect(payments.length).toBeLessThanOrEqual(1);
  // the void is attached to THAT sale, once per void record, for exactly what was voided
  const voids = await serverVoids(db);
  const localVoids = st().voidRecords;
  expect(voids).toHaveLength(localVoids.length);
  expect(voids.reduce((n, v) => n + Number(v.amount_ugx), 0)).toBe(localVoids.reduce((n, v) => n + v.amountUgx, 0));
  for (const v of await q<{ sale_id: string }>(db, "select sale_id from public.sale_voids")) expect(v.sale_id).toBe(original.id);
  // one sale movement and at most one void movement per product: nothing double counted
  for (const type of ["sale", "sale_void"]) {
    const perProduct = new Map<string, number>();
    for (const m of await moves(db, type)) perProduct.set(m.product_id, (perProduct.get(m.product_id) ?? 0) + 1);
    for (const n of perProduct.values()) expect(n).toBe(1);
  }
  if (opts.voidedAll) for (const id of Object.keys(OPENING)) expect(await serverStock(db, id)).toBe(OPENING[id]!); // stock fully reversed by the canonical void mechanism
  // the local sale is acknowledged and the queue is empty
  expect(sale().pendingSync).toBe(false);
  expect(queue).toHaveLength(0);
}

beforeEach(async () => {
  faults = [];
  rpcLog = [];
  queue = [];
  db = await newServer();
  attachServer(db);
  captureQueue();
}, 60_000);
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

// ── routing and payload (the unit-level facts) ─────────────────────────────────────────────────────────────
describe("routing and payload", () => {
  it("the routing predicate is unchanged: a voided, unsynced sale still goes to the metadata patch first", () => {
    const { original } = settleTableBill(SIMPLE_BILL, 44_000);
    expect(saleUploadRpcForLocalSale(original)).toBe("shop_push_sale_complete");
    const voided = { ...original, saleVoidedAt: "2026-09-19T09:00:00.000Z", pendingSync: true };
    expect(saleUploadRpcForLocalSale(voided)).toBe("shop_patch_hospitality_sale_metadata");
    expect(saleUploadRpcForLocalSale({ ...voided, pendingSync: false })).toBe("shop_push_sale_complete");
  });

  it("the completion payload of a voided sale is the ORIGINAL sale: original header AND every original line", () => {
    const { sessionId, original } = settleTableBill(SIMPLE_BILL, 44_000);
    voidTheBill(sessionId);
    const voided = sale();
    expect(voided.lines.every((l) => l.voided)).toBe(true);
    const p = buildSalePushPayload(voided, { shopId: SHOP, userId: USER });
    const o = buildSalePushPayload(original, { shopId: SHOP, userId: USER });
    expect(p.lines).toHaveLength(original.lines.length);
    expect(p.lines.map((l) => l.line_total_ugx)).toEqual(o.lines.map((l) => l.line_total_ugx));
    expect(p.lines.map((l) => (l.metadata as { lineIndex: number }).lineIndex)).toEqual(original.lines.map((_l, i) => i));
    expect([p.sale.subtotal_ugx, p.sale.total_ugx, p.sale.cash_amount_ugx, p.sale.debt_amount_ugx]).toEqual([o.sale.subtotal_ugx, o.sale.total_ugx, o.sale.cash_amount_ugx, o.sale.debt_amount_ugx]);
    expect(p.payments).toEqual(o.payments);
    expect(p.sale.total_ugx).toBe(44_000); // F1: includes the service charge
  });
});

// ── 1. normal sync ─────────────────────────────────────────────────────────────────────────────────────────
describe("1. offline finalize -> reconnect -> normal sale sync", () => {
  it("uploads the sale once, deducts stock once, and never touches the void path", async () => {
    const { original } = settleTableBill(SIMPLE_BILL, 44_000);
    expect(original.totalUgx).toBe(44_000);
    await converge();
    const sales = await serverSales(db);
    expect(sales).toHaveLength(1);
    expect(Number(sales[0]!.total_ugx)).toBe(44_000);
    expect(await serverStock(db, COKE)).toBe(90);
    expect(await serverStock(db, WATER)).toBe(96);
    expect(rpcLog).toContain("shop_push_sale_complete");
    expect(rpcLog).not.toContain("shop_patch_hospitality_sale_metadata"); // no void, no patch
    expect(rpcLog).not.toContain("shop_apply_sale_void_stock");
    expect((await moves(db, "sale")).length).toBe(2); // one movement per product, however many times the queue pushed
    expect(sale().pendingSync).toBe(false);
    expect(queue).toHaveLength(0);
  });
});

// ── 2-8. the defect ────────────────────────────────────────────────────────────────────────────────────────
describe("offline finalize -> void -> reconnect (the F2 defect)", () => {
  it("2 + 13. the original sale (with its F1 service charge) is uploaded FIRST, then the void; final state is exact", async () => {
    const { sessionId, original } = settleTableBill(SIMPLE_BILL, 44_000);
    voidTheBill(sessionId);
    expect(sale().pendingSync).toBe(true);
    const kinds = queue.map((o) => o.kind);
    expect(kinds).toContain("pending_sales");
    expect(kinds).toContain("sale"); // the whole-bill void queued a sale upload of its own
    expect(queue.filter((o) => o.kind === "pending_stock_updates")).toHaveLength(st().voidRecords.length); // one cloud void per void record
    expect(await serverSales(db)).toHaveLength(0);

    const trace = await flush();
    // every sale upload acknowledges (original first, void patch after); the void adjustments come after them
    const uploads = trace.filter((t) => t.startsWith("pending_sales") || t.startsWith("sale:"));
    expect(uploads.length).toBeGreaterThanOrEqual(2);
    expect(uploads.every((t) => t.endsWith(":ack"))).toBe(true);
    const firstComplete = rpcLog.indexOf("shop_push_sale_complete");
    const firstVoid = rpcLog.indexOf("shop_apply_sale_void_stock");
    expect(firstComplete).toBeGreaterThan(-1);
    expect(firstVoid).toBeGreaterThan(firstComplete); // the void is never applied before the sale exists
    await converge();
    await expectCanonicalAfterVoid(original);
    expect(original.totalUgx).toBe(44_000);
    const s = (await serverSales(db))[0]!;
    expect(s.metadata.saleVoidedAt).toBeTruthy(); // the void metadata reached the sale
    expect(s.metadata.serviceChargeUgx).toBe(4_000);
  });

  it("3. the first upload fails -> nothing is lost, the void keeps waiting, and a retry completes everything", async () => {
    const { sessionId, original } = settleTableBill(SIMPLE_BILL, 44_000);
    voidTheBill(sessionId);
    const queued = queue.length;
    fail("shop_push_sale_complete", 1000); // the completion keeps failing (offline)
    const t1 = await flush();
    expect(await serverSales(db)).toHaveLength(0);
    expect(t1.some((t) => t.endsWith(":ack") && (t.startsWith("pending_sales") || t.startsWith("sale:")))).toBe(false);
    expect(t1.filter((t) => t.startsWith("pending_stock_updates")).every((t) => t.endsWith(":wait"))).toBe(true); // the void does NOT pretend to succeed
    expect(queue).toHaveLength(queued); // nothing discarded
    expect(sale().pendingSync).toBe(true);
    expect(rpcLog).not.toContain("shop_apply_sale_void_stock");
    clearFaults(); // back online
    await converge();
    await expectCanonicalAfterVoid(original);
  });

  it("4. the original succeeds, the void fails transiently -> the sale is kept, the void is retried and applied once", async () => {
    const { sessionId, original } = settleTableBill(SIMPLE_BILL, 44_000);
    voidTheBill(sessionId);
    fail("shop_apply_sale_void_stock", 3);
    await flush();
    expect(await serverSales(db)).toHaveLength(1); // the original is safely on the server
    expect(await serverStock(db, COKE)).toBe(90); // ...and its deduction applied
    expect((await serverVoids(db)).length).toBe(0); // ...while the void has not landed yet
    expect(queue.some((o) => o.kind === "pending_stock_updates")).toBe(true);
    await converge();
    await expectCanonicalAfterVoid(original);
  });

  it("5. repeated retries converge to the same final state and change nothing once converged", async () => {
    const { sessionId, original } = settleTableBill(SIMPLE_BILL, 44_000);
    voidTheBill(sessionId);
    await converge();
    await expectCanonicalAfterVoid(original);
    const snapshot = JSON.stringify([await serverSales(db), await serverLines(db), await serverVoids(db), await moves(db, "sale"), await moves(db, "sale_void")]);
    // replay every operation again, as a stale retry would
    const replay = [
      { id: "replay-1", kind: "pending_sales", payload: { saleId: original.id }, createdAt: "2026-09-19T10:00:00.000Z", attempts: 0, shopId: SHOP },
      { id: "replay-2", kind: "sale", payload: { saleId: original.id }, createdAt: "2026-09-19T10:00:01.000Z", attempts: 0, shopId: SHOP },
    ] as SyncOperation[];
    for (let i = 0; i < 3; i++) for (const op of replay) expect(syncProcessStatus(await processCloudSyncOperationResult(op))).toBe("ack");
    expect(JSON.stringify([await serverSales(db), await serverLines(db), await serverVoids(db), await moves(db, "sale"), await moves(db, "sale_void")])).toBe(snapshot);
  });

  it("6. the void operation itself is retried (transient failures at every step) and still lands exactly once", async () => {
    const { sessionId, original } = settleTableBill(SIMPLE_BILL, 44_000);
    voidTheBill(sessionId);
    fail("shop_patch_hospitality_sale_metadata", 1);
    fail("shop_apply_sale_void_stock", 2);
    fail("shop_sync_sale_line_void_state", 1);
    await converge(12);
    await expectCanonicalAfterVoid(original);
  });

  it("7 + 8. never a duplicate Sale, never a void applied twice — even with a doubled queue and duplicated void ops", async () => {
    const { sessionId, original } = settleTableBill(SIMPLE_BILL, 44_000);
    voidTheBill(sessionId);
    queue = [...queue, ...queue.map((o) => ({ ...o, id: `${o.id}-dup` }))]; // every operation twice
    await converge();
    await expectCanonicalAfterVoid(original);
    expect(await q(db, "select id from public.sales")).toHaveLength(1);
    expect((await serverVoids(db)).length).toBe(st().voidRecords.length);
  });
});

// ── 9. the ordinary path is unchanged ──────────────────────────────────────────────────────────────────────
describe("9. a bill voided AFTER its cloud acknowledgement uses the existing path", () => {
  it("no second completion and no fallback: the patch succeeds directly, then the void applies", async () => {
    const { sessionId, original } = settleTableBill(SIMPLE_BILL, 44_000);
    await converge(); // acknowledged
    expect(sale().pendingSync).toBe(false);
    rpcLog = [];
    voidTheBill(sessionId);
    await converge();
    expect(rpcLog).not.toContain("shop_push_sale_complete");
    expect(rpcLog).toContain("shop_patch_hospitality_sale_metadata"); // the plain patch, accepted straight away
    expect(rpcLog).toContain("shop_apply_sale_void_stock");
    await expectCanonicalAfterVoid(original);
  });
});

// ── 10. Retail ─────────────────────────────────────────────────────────────────────────────────────────────
describe("10. Retail void behaviour", () => {
  function retailSale() {
    seedClient();
    usePosStore.setState({ draftLines: [line(product(COKE), 10, u(201)), line(product(WATER), 4, u(202))] });
    expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);
    return sale();
  }
  const voidLine0 = () => expect(st().voidSaleLine({ saleId: sale().id, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);

  it("a line voided before the first ack now uploads the ORIGINAL sale (it used to be rejected with subtotal_mismatch), then the void", async () => {
    const original = retailSale();
    voidLine0();
    expect(saleUploadRpcForLocalSale(sale())).toBe("shop_push_sale_complete"); // Retail routing untouched
    await converge();
    expect(rpcLog).not.toContain("shop_patch_hospitality_sale_metadata");
    const sales = await serverSales(db);
    expect(sales).toHaveLength(1);
    expect(Number(sales[0]!.total_ugx)).toBe(original.totalUgx === 40_000 ? 40_000 : original.cloudCompleteFinancials!.totalUgx);
    expect((await serverLines(db)).map((l) => Number(l.line_total_ugx)).sort((a, b) => a - b)).toEqual([20_000, 20_000]);
    const voids = await serverVoids(db);
    expect(voids).toHaveLength(1);
    expect(Number(voids[0]!.amount_ugx)).toBe(20_000);
    expect(voids[0]!.product_id).toBe(COKE);
    expect(await serverStock(db, COKE)).toBe(100); // 10 sold, 10 voided
    expect(await serverStock(db, WATER)).toBe(96); // the other line stands
    expect(sale().pendingSync).toBe(false);
    expect(queue).toHaveLength(0);
  });

  it("a line voided after the ack: only the void RPC runs (no completion, no patch)", async () => {
    retailSale();
    await converge();
    rpcLog = [];
    voidLine0();
    await converge();
    expect(rpcLog).not.toContain("shop_push_sale_complete");
    expect(rpcLog).not.toContain("shop_patch_hospitality_sale_metadata");
    expect(rpcLog).toContain("shop_apply_sale_void_stock");
    expect((await serverVoids(db)).length).toBe(1);
    expect(await serverStock(db, COKE)).toBe(100);
  });
});

// ── 11. Pharmacy ───────────────────────────────────────────────────────────────────────────────────────────
describe("11. Pharmacy void behaviour", () => {
  const RECEIVED_AT = "2026-01-01T00:00:00.000Z";
  function rxProduct(): Product {
    const p: Product = { id: RX_PRODUCT, name: "Amoxicillin 500mg (batch-tracked)", sellingMode: "unit", baseUnit: "capsule", sellingPricePerUnitUgx: 500, costPricePerUnitUgx: 200, stockOnHand: 38, minimumStockAlert: 5, category: "Antibiotics", sku: "", updatedAt: RECEIVED_AT, version: 1, pharmacyMaster: { batchTracked: true, expiryTracked: true, otcOrPrescription: "prescription" } };
    let x = appendBatchToProduct(p, createBatchOnReceive({ batchNumber: "A", expiryDate: "2027-01-01", quantityBase: 8, unitCostUgx: 200, at: RECEIVED_AT }));
    x = appendBatchToProduct(x, createBatchOnReceive({ batchNumber: "B", expiryDate: "2027-06-01", quantityBase: 30, unitCostUgx: 200, at: RECEIVED_AT }));
    return { ...x, stockOnHand: 38 };
  }
  const rx = (): PharmacyPrescription => ({
    id: "11111111-2222-4111-8111-111111111111", prescriptionNumber: "RX-1", type: "paper_rx", status: "verified", priority: "normal", patientId: null, patientName: "Test Patient", patientPhone: null, doctorName: "Dr Test",
    diagnosis: null, notes: null, prescriptionDate: "2026-06-01", refillCount: 0, refillsUsed: 0, lastRefillAt: null, nextRefillEligibleAt: null,
    lines: [{ id: "22222222-2222-4222-8222-222222222222", productId: RX_PRODUCT, productName: "Amoxicillin", strength: "500mg", form: "capsule", quantityPrescribed: 20, quantityDispensed: 0, directions: "1 capsule 3x/day" }],
    saleId: null, verifiedAt: "2026-06-01T08:00:00.000Z", verifiedByUserId: "owner-1", verifiedByName: "Owner", dispensedAt: null, dispensedByUserId: null, dispensedByName: null,
    controlledMedicinesApproved: false, controlledApprovalReason: null, createdAt: "2026-06-01T08:00:00.000Z", updatedAt: "2026-06-01T08:00:00.000Z", version: 1, pendingSync: true,
  });

  it("dispense 5 from batch A, void the line before the first ack: the batch restore is the store's, the sale syncs whole, the void applies once", async () => {
    seedClient([rxProduct()], { businessType: "pharmacy", pharmacyModeEnabled: true });
    usePosStore.setState({ pharmacyPrescriptions: [rx()], activePharmacyPrescriptionId: "11111111-2222-4111-8111-111111111111", pharmacyDispenseMode: "prescription", draftLines: [{ ...line(product(RX_PRODUCT), 5, u(301)) }] });
    expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash", amountPaidUgx: 2_500 }).ok).toBe(true);
    const original = sale();
    expect(product(RX_PRODUCT).stockOnHand).toBe(33);
    expect(getProductBatches(product(RX_PRODUCT)).find((b) => b.batchNumber === "A")!.quantityRemaining).toBe(3);
    expect(st().voidSaleLine({ saleId: original.id, lineIndex: 0, reason: "other", note: "test" }).ok).toBe(true);
    // unchanged local behaviour: stock and the specific batches restored, integrity holds
    expect(product(RX_PRODUCT).stockOnHand).toBe(38);
    const batches = getProductBatches(product(RX_PRODUCT));
    expect([batches.find((b) => b.batchNumber === "A")!.quantityRemaining, batches.find((b) => b.batchNumber === "B")!.quantityRemaining]).toEqual([8, 30]);
    expect(computeBatchIntegrity(product(RX_PRODUCT)).ok).toBe(true);
    await converge();
    const sales = await serverSales(db);
    expect(sales).toHaveLength(1);
    expect(Number(sales[0]!.total_ugx)).toBe(2_500);
    expect(await serverLines(db)).toHaveLength(1);
    expect((await serverVoids(db)).length).toBe(1);
    expect(await serverStock(db, RX_PRODUCT)).toBe(38);
    expect(sale().pendingSync).toBe(false);
  });
});

// ── 12. credit / debt ──────────────────────────────────────────────────────────────────────────────────────
describe("12. credit sale, voided before the first ack", () => {
  it("the server keeps the ORIGINAL sale (cash + debt); the void ledger reverses it; the customer debt returns to zero locally", async () => {
    seedClient();
    usePosStore.setState({ draftLines: [line(product(COKE), 10, u(211)), line(product(WATER), 4, u(212))] });
    const r = st().finalizeDraftSale({ debtUgx: 25_000, paymentMethod: "cash", customerName: "Debtor One", customerPhone: "0700000001" });
    expect(r.ok).toBe(true);
    const original = sale();
    expect([original.cashPaidUgx, original.debtUgx]).toEqual([15_000, 25_000]);
    expect(st().customers.find((c) => c.name === "Debtor One")!.debtBalanceUgx).toBe(25_000);
    expect(st().voidSaleLine({ saleId: original.id, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);
    expect(st().voidSaleLine({ saleId: original.id, lineIndex: 1, reason: "wrong_item" }).ok).toBe(true);
    expect(st().customers.find((c) => c.name === "Debtor One")!.debtBalanceUgx).toBe(0);
    await converge();
    const s = (await serverSales(db))[0]!;
    expect([Number(s.total_ugx), Number(s.cash_amount_ugx), Number(s.debt_amount_ugx)]).toEqual([40_000, 15_000, 25_000]);
    expect((await serverPayments(db)).reduce((n, p) => n + Number(p.amount_ugx), 0)).toBe(15_000);
    expect((await serverVoids(db)).reduce((n, v) => n + Number(v.amount_ugx), 0)).toBe(40_000);
    expect(await serverStock(db, COKE)).toBe(100);
    expect(await serverStock(db, WATER)).toBe(100);
  });
});

// ── 14. modifiers / recipes / prep provenance ──────────────────────────────────────────────────────────────
describe("14. a mixed bill (made-to-order recipe + batch-prepared portions + retail) voided before the first ack", () => {
  it("the original lines carry their provenance to the server and the canonical void mechanism reverses each by its own model", async () => {
    const { sessionId, original } = settleTableBill(MIXED_BILL, 92_400);
    expect(original.totalUgx).toBe(92_400);
    const burger = original.lines.find((l) => l.productId === BURGER)!;
    const chicken = original.lines.find((l) => l.productId === CHICKEN)!;
    expect(burger.ingredientConsumption?.length).toBeGreaterThan(0);
    expect(chicken.prepAllocation?.length).toBeGreaterThan(0);
    voidTheBill(sessionId);
    await converge(12);
    const lines = await serverLines(db);
    const sLine = (pid: string) => lines.find((l) => l.product_id === pid)!;
    expect(sLine(BURGER).metadata.ingredientConsumption).toEqual(burger.ingredientConsumption); // made-to-order provenance travelled
    expect(sLine(CHICKEN).metadata.prepAllocation).toEqual(chicken.prepAllocation); // batch-prepared provenance travelled
    await expectCanonicalAfterVoid(original);
    expect(await serverStock(db, BEEF)).toBe(100); // ingredients of the made-to-order burger are back...
    expect(await serverStock(db, BURGER)).toBe(0); // ...and no phantom dish stock was created
    expect(await serverStock(db, CHICKEN)).toBe(20); // prepared portions back
  });
});

// ── 15. stale device ───────────────────────────────────────────────────────────────────────────────────────
describe("15. a stale device cannot overwrite the canonical Sale", () => {
  it("a second completion with different lines/totals for the same sale id is acknowledged and applies nothing", async () => {
    const { original } = settleTableBill(SIMPLE_BILL, 44_000);
    await converge();
    const before = JSON.stringify([await serverSales(db), await serverLines(db), await serverPayments(db), await moves(db, "sale")]);
    const stockBefore = [await serverStock(db, COKE), await serverStock(db, WATER)];
    const stale: Sale = { ...original, totalUgx: 1, subtotalUgx: 1, cashPaidUgx: 1, cloudCompleteFinancials: { subtotalUgx: 1, totalUgx: 1, cashPaidUgx: 1, debtUgx: 0, discountTotalUgx: 0 }, lines: original.lines.slice(0, 1), pendingSync: true };
    expect(await pushSaleToCloud(stale, { shopId: SHOP, userId: USER })).toBe(true);
    expect(JSON.stringify([await serverSales(db), await serverLines(db), await serverPayments(db), await moves(db, "sale")])).toBe(before);
    expect([await serverStock(db, COKE), await serverStock(db, WATER)]).toEqual(stockBefore);
  });
});

// ── 16. a permanent failure stays recoverable ──────────────────────────────────────────────────────────────
describe("16. a permanent validation failure leaves the operation recoverable", () => {
  it("nothing is discarded, the void keeps waiting, the error is not treated as a permanent block, and it converges once the cause is gone", async () => {
    const { sessionId, original } = settleTableBill(SIMPLE_BILL, 44_000);
    voidTheBill(sessionId);
    const queued = queue.length;
    fail("shop_push_sale_complete", 1000, "reject", "sale_total_mismatch");
    for (let i = 0; i < 4; i++) await flush();
    expect(await serverSales(db)).toHaveLength(0);
    expect(queue).toHaveLength(queued); // every operation still queued
    expect(sale().pendingSync).toBe(true);
    expect(sale().lastSyncError).toBe("sale_total_mismatch");
    expect(isBlockedBusinessSyncError("sale_total_mismatch")).toBe(false); // recoverable: it keeps retrying
    expect(rpcLog).not.toContain("shop_apply_sale_void_stock"); // the void never ran against a sale the server does not have
    clearFaults();
    await converge();
    await expectCanonicalAfterVoid(original);
  });
});
