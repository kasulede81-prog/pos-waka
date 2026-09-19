/**
 * F3 — Pharmacy batch provenance through the REAL queue and the REAL server SQL.
 *
 * Device A dispenses and its sale is pushed by the real queue functions to real SQL
 * (shop_push_sale_complete, the F1 validator, apply_sale_stock_movements). The line metadata the server holds is
 * read back, Device B is built from those SERVER ROWS through the real decoder, and B's void goes through the
 * real store action, queue and void RPC. Provenance is passive: the server's money, stock and void ledger are
 * identical with and without it, and replays/duplicates change nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import * as syncEngine from "./syncEngine";
import type { Product, Sale, SaleLine, SyncOperation } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { partitionSaleBeforeAdjustment, syncProcessStatus } from "../lib/saleAdjustmentSync";
import { decodeSaleLineFromCloud } from "../lib/saleLineCloudCodec";
import { appendBatchToProduct, computeBatchIntegrity, createBatchOnReceive, getProductBatches } from "../lib/pharmacyBatches";
import { processCloudSyncOperationResult } from "./cloudSync";

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

// Each test builds real SQL servers (PGlite); under the full suite's load that is slow, so give this file real headroom.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const dir = join(process.cwd(), "supabase", "migrations");
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SHOP = u(1);
const USER = "22222222-2222-4222-8222-222222222222";
const PID = "ffffffff-2222-4fff-8fff-ffffffffffff";
const COKE = u(11);
const T = "2026-01-01T00:00:00.000Z";
const KEYS = ["pharmacyBatchOverrideId", "pharmacyBatchNumber", "pharmacyBatchExpiry"] as const;
const L1 = "cccccccc-0000-4000-8000-000000000001";

function fnFrom(file: string, name: string): string {
  const src = readFileSync(join(dir, file), "utf8");
  const start = src.indexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  return src.slice(start, src.indexOf("$$;", src.indexOf("as $$", start)) + 3);
}

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
    [R5, "_wk_try_uuid"], [R5, "_wk_recipe_provenance_struct"], [R5, "recipe_line_provenance"], [R5, "_wk_recipe_lines"], [R5, "_wk_recipe_line_reversed_qty"], [R5, "_wk_recipe_credit"],
    [R5, "apply_sale_stock_movements"],
    ["20260919130000_sale_validation_bill_charges.sql", "validate_sale_push_financials"],
    ["170_sale_complete_already_completed_fence.sql", "shop_push_sale_complete"],
    ["20260916025318_sale_line_void_state_sync.sql", "shop_sync_sale_line_void_state"],
  ] as const) await db.exec(fnFrom(file, name));
  await db.exec(`insert into public.products (id, shop_id, stock_on_hand) values ('${PID}', '${SHOP}', 38), ('${COKE}', '${SHOP}', 100);`);
  return db;
}
const q = async <T extends Record<string, unknown>>(db: PGlite, sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;
const serverStock = async (db: PGlite, id: string) => Number((await q<{ s: string }>(db, "select stock_on_hand as s from public.products where id = $1", [id]))[0]!.s);
const serverLines = (db: PGlite) => q<{ id: string; product_id: string; quantity: string; unit_price_ugx: string; line_total_ugx: string; line_input_mode: string; money_amount_ugx: string | null; metadata: Record<string, unknown> }>(db, "select * from public.sale_line_items order by id");
const serverVoids = (db: PGlite) => q<{ id: string; amount_ugx: string }>(db, "select id, amount_ugx from public.sale_voids order by id");

// ── bridge + queue ─────────────────────────────────────────────────────────────────────────────────────────
let db: PGlite;
let queue: SyncOperation[] = [];
let rpcLog: string[] = [];

function attachServer(server: PGlite) {
  bridge.rpc = async (name: unknown, rawArgs: unknown) => {
    const fn = String(name);
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    rpcLog.push(fn);
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
async function flush() {
  const { saleUploads, other } = partitionSaleBeforeAdjustment([...queue]);
  for (const op of [...saleUploads, ...other]) if (syncProcessStatus(await processCloudSyncOperationResult(op)) === "ack") queue = queue.filter((o) => o.id !== op.id);
}
async function converge(max = 8) {
  for (let i = 0; i < max && queue.length > 0; i++) await flush();
}

// ── the client ─────────────────────────────────────────────────────────────────────────────────────────────
const st = () => usePosStore.getState();
const product = () => st().products.find((p) => p.id === PID)!;
const batchQty = (p: Product) => Object.fromEntries(getProductBatches(p).map((b) => [b.batchNumber, b.quantityRemaining]));
function pharmacyProduct(): Product {
  const p: Product = { id: PID, name: "Amoxicillin", sellingMode: "unit", baseUnit: "capsule", sellingPricePerUnitUgx: 500, costPricePerUnitUgx: 200, stockOnHand: 38, minimumStockAlert: 5, category: "Rx", sku: "", updatedAt: T, version: 1, pharmacyMaster: { batchTracked: true, expiryTracked: true, otcOrPrescription: "otc" } };
  let x = appendBatchToProduct(p, createBatchOnReceive({ batchNumber: "LOT-A", expiryDate: "2027-01-01", quantityBase: 8, unitCostUgx: 200, at: T }));
  x = appendBatchToProduct(x, createBatchOnReceive({ batchNumber: "LOT-B", expiryDate: "2027-06-01", quantityBase: 30, unitCostUgx: 200, at: T }));
  return { ...x, stockOnHand: 38 };
}
const cokeProduct = (): Product => ({ id: COKE, name: "Coke", sellingMode: "unit", baseUnit: "bottle", sellingPricePerUnitUgx: 2_000, costPricePerUnitUgx: 1_200, stockOnHand: 100, minimumStockAlert: 0, category: "Drinks", sku: "", updatedAt: T, version: 1 });
const line = (productId: string, qty: number, price: number, id: string): SaleLine => ({ id, productId, name: productId === PID ? "Amoxicillin" : "Coke", inputMode: "quantity", quantity: qty, unitPriceUgx: price, unitCostUgx: price / 2, lineTotalUgx: price * qty, estimatedProfitUgx: (price / 2) * qty, updatedAt: T });

function seed(products: Product[], sales: Sale[], businessType: "pharmacy" | "kiosk_duka" | "hospitality") {
  usePosStore.setState({
    _hydrated: true, sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" }, products, customers: [], sales, stockMovements: [], archivedStockMovements: [],
    voidRecords: [], archivedVoidRecords: [], returnRecords: [], archivedReturnRecords: [], auditLogs: [], draftLines: [], draftCartDiscountUgx: 0, activePendingSaleId: null, draftInput: null,
    draftPaymentMethod: "cash", pharmacyPrescriptions: [], pharmacyControlledRegister: [],
    preferences: { ...st().preferences, businessType, pharmacyModeEnabled: businessType === "pharmacy", hospitalityModeEnabled: businessType === "hospitality" },
  });
  expect(openTestShift().ok).toBe(true);
}
function dispense(qty: number) {
  seed([pharmacyProduct()], [], "pharmacy");
  usePosStore.setState({ draftLines: [line(PID, qty, 500, L1)] });
  expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash", amountPaidUgx: 500 * qty }).ok).toBe(true);
  return { sale: st().sales[0]!, productAfter: st().products[0]! };
}
/** Device B is built from the rows the SERVER holds, through the real decoder. */
async function deviceBFromServer(saleA: Sale, productAfter: Product, businessType: "pharmacy" | "kiosk_duka" | "hospitality" = "pharmacy") {
  const rows = await serverLines(db);
  const lines = rows.map((r) => decodeSaleLineFromCloud({ id: r.id, product_id: r.product_id, quantity: Number(r.quantity), unit_price_ugx: Number(r.unit_price_ugx), line_total_ugx: Number(r.line_total_ugx), line_input_mode: r.line_input_mode === "money" ? "money" : "quantity", money_amount_ugx: r.money_amount_ugx == null ? null : Number(r.money_amount_ugx), metadata: r.metadata }));
  queue = [];
  seed([productAfter], [{ ...saleA, pendingSync: false, lines }], businessType);
  return lines;
}

beforeEach(async () => {
  queue = [];
  rpcLog = [];
  db = await newServer();
  attachServer(db);
  captureQueue();
}, 60_000);
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

describe("the provenance reaches the canonical SaleLine on the server", () => {
  it("1-4. the real push stores all three values verbatim in the line metadata, and the sale itself is unchanged", async () => {
    const { sale } = dispense(5);
    await converge();
    const [row] = await serverLines(db);
    expect(KEYS.map((k) => row!.metadata[k])).toEqual(KEYS.map((k) => sale.lines[0]![k]));
    expect([row!.metadata.pharmacyBatchNumber, row!.metadata.pharmacyBatchExpiry]).toEqual(["LOT-A", "2027-01-01"]);
    const [srvSale] = await q<{ total_ugx: string; cash_amount_ugx: string; debt_amount_ugx: string; status: string }>(db, "select * from public.sales");
    expect([srvSale!.status, Number(srvSale!.total_ugx), Number(srvSale!.cash_amount_ugx), Number(srvSale!.debt_amount_ugx)]).toEqual(["completed", 2_500, 2_500, 0]);
    expect(await serverStock(db, PID)).toBe(33); // stock deducted once, by the canonical mechanism
  });

  it("the server-side writers that touch line metadata merge, so the provenance survives them (void-state sync)", async () => {
    const { sale, productAfter } = dispense(5);
    await converge();
    await deviceBFromServer(sale, productAfter);
    expect(st().voidSaleLine({ saleId: sale.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    await converge();
    expect(rpcLog).toContain("shop_sync_sale_line_void_state"); // the merge that stamps `voided` on the line
    const [row] = await serverLines(db);
    expect(row!.metadata.voided).toBe(true);
    expect(KEYS.map((k) => row!.metadata[k])).toEqual([sale.lines[0]!.pharmacyBatchOverrideId, "LOT-A", "2027-01-01"]);
  });

  it("5. a sale without provenance (a client from before F3) is stored and behaves exactly as before", async () => {
    const { sale, productAfter } = dispense(5);
    // a pre-F3 client never sent the keys
    queue = [];
    await db.exec("delete from public.sales; delete from public.sale_line_items; delete from public.sale_payments; delete from public.inventory_movements; update public.products set stock_on_hand = 38 where id = '" + PID + "'");
    const legacy: Sale = { ...sale, pendingSync: true, lines: sale.lines.map((l) => ({ ...l, pharmacyBatchOverrideId: undefined, pharmacyBatchNumber: undefined, pharmacyBatchExpiry: undefined })) };
    usePosStore.setState({ sales: [legacy] });
    queue.push({ id: "legacy-push", kind: "pending_sales", payload: { saleId: sale.id }, createdAt: T, attempts: 0, shopId: SHOP } as SyncOperation);
    await converge();
    const [row] = await serverLines(db);
    for (const k of KEYS) expect(row!.metadata).not.toHaveProperty(k);
    expect(await serverStock(db, PID)).toBe(33);
    await deviceBFromServer(legacy, productAfter);
    expect(st().voidSaleLine({ saleId: sale.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(product().stockOnHand).toBe(38);
    expect(batchQty(product())).toEqual({ "LOT-A": 3, "LOT-B": 30 }); // unchanged legacy behaviour: no batch to find
    expect(computeBatchIntegrity(product()).ok).toBe(false);
  });
});

describe("9 + 12. Device B voids through the real queue; replays and a second device change nothing", () => {
  it("B restores the correct batch locally, the server voids the line once and restores stock once", async () => {
    const { sale, productAfter } = dispense(5);
    await converge();
    await deviceBFromServer(sale, productAfter);
    expect(st().voidSaleLine({ saleId: sale.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(batchQty(product())).toEqual({ "LOT-A": 8, "LOT-B": 30 }); // the batch Device B used to miss
    expect(computeBatchIntegrity(product()).ok).toBe(true);
    await converge();
    expect(await serverVoids(db)).toHaveLength(1);
    expect(Number((await serverVoids(db))[0]!.amount_ugx)).toBe(2_500);
    expect(await serverStock(db, PID)).toBe(38);
    expect(queue).toHaveLength(0);
  });

  it("replaying B's queued operations any number of times never restores twice", async () => {
    const { sale, productAfter } = dispense(5);
    await converge();
    await deviceBFromServer(sale, productAfter);
    expect(st().voidSaleLine({ saleId: sale.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    const ops = [...queue];
    await converge();
    const snap = JSON.stringify([await serverVoids(db), await serverStock(db, PID), await q(db, "select reference_type, quantity_delta from public.inventory_movements order by reference_type, quantity_delta")]);
    for (let i = 0; i < 3; i++) for (const op of ops) await processCloudSyncOperationResult(op);
    expect(JSON.stringify([await serverVoids(db), await serverStock(db, PID), await q(db, "select reference_type, quantity_delta from public.inventory_movements order by reference_type, quantity_delta")])).toBe(snap);
  });

  it("Device A voiding the same line after Device B produces the same void: the server still holds one void and one stock restore", async () => {
    const { sale, productAfter } = dispense(5);
    await converge();
    const aSale = st().sales[0]!;
    const aProduct = st().products[0]!;
    await deviceBFromServer(sale, productAfter);
    expect(st().voidSaleLine({ saleId: sale.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    await converge();
    seed([aProduct], [aSale], "pharmacy");
    queue = [];
    expect(st().voidSaleLine({ saleId: sale.id, lineIndex: 0, reason: "other", note: "A" }).ok).toBe(true);
    await converge();
    expect(await serverVoids(db)).toHaveLength(1);
    expect(await serverStock(db, PID)).toBe(38);
  });
});

describe("6 + 7. other business types carry no Pharmacy provenance and are unchanged", () => {
  it.each(["kiosk_duka", "hospitality"] as const)("a %s sale stores no Pharmacy keys and syncs as before", async (businessType) => {
    seed([cokeProduct()], [], businessType);
    usePosStore.setState({ draftLines: [line(COKE, 3, 2_000, L1)] });
    expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);
    await converge();
    const [row] = await serverLines(db);
    for (const k of KEYS) expect(row!.metadata).not.toHaveProperty(k);
    expect(Number(row!.line_total_ugx)).toBe(6_000);
    expect(await serverStock(db, COKE)).toBe(97);
  });
});

describe("the provenance is passive on the server too", () => {
  it("money, stock and movements are identical whether or not the line carries provenance", async () => {
    // Two servers only (the one every test gets, and one more): building a PGlite server is the slow part.
    const run = async (server: PGlite, withProvenance: boolean) => {
      attachServer(server);
      queue = [];
      const { sale } = dispense(5);
      const s: Sale = withProvenance ? sale : { ...sale, lines: sale.lines.map((l) => ({ ...l, pharmacyBatchOverrideId: undefined, pharmacyBatchNumber: undefined, pharmacyBatchExpiry: undefined })) };
      usePosStore.setState({ sales: [s] });
      await converge();
      return JSON.stringify([
        await q(server, "select status, subtotal_ugx, total_ugx, cash_amount_ugx, debt_amount_ugx, payment_status from public.sales"),
        (await serverLines(server)).map((l) => [l.quantity, l.unit_price_ugx, l.line_total_ugx, l.metadata.cogsUgx, l.metadata.unitCostUgx, l.metadata.estimatedProfitUgx]),
        await q(server, "select method, amount_ugx from public.sale_payments"),
        await q(server, "select reference_type, quantity_delta from public.inventory_movements order by reference_type"),
        await serverStock(server, PID),
      ]);
    };
    const withP = await run(db, true);
    const second = await newServer();
    try {
      const withoutP = await run(second, false);
      expect(withP).toBe(withoutP);
    } finally {
      await second.close();
    }
  }, 120_000);
});
