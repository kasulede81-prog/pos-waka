import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20260919100000 — bounded reversal guard for shop_apply_sale_void_stock.
 * Runs the ORIGINAL function (179) to prove the defects, then the new one.
 *
 * Dry-run to run on production BEFORE applying (read-only; lists (sale, product) pairs whose recorded
 * voids + returns already exceed the quantity sold — historical rows are never re-run by this guard):
 *
 *   select sv.sale_id, sv.product_id,
 *          sum(sv.quantity) as voided,
 *          coalesce((select sum(sr.quantity) from sale_returns sr
 *                    where sr.sale_id = sv.sale_id and sr.product_id = sv.product_id), 0) as returned,
 *          (select sum(sli.quantity) from sale_line_items sli
 *           where sli.sale_id = sv.sale_id and sli.product_id = sv.product_id) as sold
 *   from sale_voids sv group by sv.sale_id, sv.product_id
 *   having sum(sv.quantity) + coalesce((select sum(sr.quantity) from sale_returns sr
 *          where sr.sale_id = sv.sale_id and sr.product_id = sv.product_id), 0)
 *          > coalesce((select sum(sli.quantity) from sale_line_items sli
 *          where sli.sale_id = sv.sale_id and sli.product_id = sv.product_id), 0) + 0.0001;
 */

const dir = join(process.cwd(), "supabase", "migrations");
const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER_SHOP = "22222222-2222-4222-8222-222222222222";
const SALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BURGER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COKE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VOID1 = "00000001-0000-4000-8000-000000000001";
const VOID2 = "00000002-0000-4000-8000-000000000002";
const VOID3 = "00000003-0000-4000-8000-000000000003";

function extractFn(file: string, name: string): string {
  const src = readFileSync(join(dir, file), "utf8");
  const start = src.indexOf(`create or replace function public.${name}`);
  return src.slice(start, src.indexOf("$$;", start) + 3);
}

async function freshDb(voidFunctionSql: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create schema if not exists auth;
    create function auth.uid () returns uuid language sql as $$ select '99999999-9999-4999-8999-999999999999'::uuid $$;
    create function public.user_is_cashier_or_above (p uuid) returns boolean language sql as $$ select true $$;
    create function public.inventory_movement_uuid (s uuid, t text, r uuid, p uuid) returns uuid language sql immutable
      as $$ select md5 (s::text || t || r::text || p::text)::uuid $$;
    create table public.products (id uuid primary key, shop_id uuid, is_active boolean default true, stock_on_hand numeric default 0, updated_at timestamptz default now());
    create table public.sales (id uuid primary key, shop_id uuid, created_at timestamptz default now(), completed_at timestamptz);
    create table public.sale_line_items (id uuid primary key default gen_random_uuid(), sale_id uuid, product_id uuid, quantity numeric);
    create table public.sale_returns (id uuid primary key default gen_random_uuid(), sale_id uuid, product_id uuid, quantity numeric);
    create table public.sale_voids (
      id uuid primary key, shop_id uuid, sale_id uuid, product_id uuid, quantity numeric, amount_ugx bigint, line_index int,
      note text, sale_voided_at timestamptz, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
      metadata jsonb default '{}'::jsonb
    );
    create table public.inventory_movements (
      id uuid primary key, shop_id uuid, product_id uuid, quantity_delta numeric, reason text, reference_type text,
      reference_id uuid, note text, created_by uuid
    );
    create unique index inventory_movements_sale_void_product_unique
      on public.inventory_movements (shop_id, reference_type, reference_id, product_id) where reference_type = 'sale_void';
  `);
  await db.exec(extractFn("172_sale_void_stock_durable_idempotency.sql", "_apply_durable_stock_delta"));
  await db.exec(voidFunctionSql);
  await db.exec(`
    insert into public.products (id, shop_id, stock_on_hand) values ('${BURGER}', '${SHOP}', 0), ('${COKE}', '${SHOP}', 48);
    insert into public.sales (id, shop_id) values ('${SALE}', '${SHOP}'), ('${SALE_B}', '${SHOP}');
    -- SALE sold burger x3 and coke x2; SALE_B sold coke x5
    insert into public.sale_line_items (sale_id, product_id, quantity) values
      ('${SALE}', '${BURGER}', 3), ('${SALE}', '${COKE}', 2), ('${SALE_B}', '${COKE}', 5);
  `);
  return db;
}

type Call = { product_id: string; void_record_id: string; delta: number; sale_id?: string; amount_ugx?: number; line_index?: number };
async function callVoid(db: PGlite, c: Call, shop = SHOP) {
  const res = await db.query<{ r: { ok: boolean; error?: string; idempotent?: boolean } }>(
    "select public.shop_apply_sale_void_stock($1::uuid, $2::jsonb) as r",
    [shop, JSON.stringify(c)],
  );
  return res.rows[0]!.r;
}
const stockOf = async (db: PGlite, id: string) => Number((await db.query<{ s: string }>("select stock_on_hand as s from public.products where id = $1", [id])).rows[0]!.s);
const voids = async (db: PGlite) => (await db.query("select * from public.sale_voids")).rows.length;

describe("original function (179) — trusts the client for everything but the void id", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb(extractFn("179_sale_void_financial_ledger.sql", "shop_apply_sale_void_stock"));
  }, 60_000);
  afterAll(async () => db.close());

  it("accepts a void for a product that is not on the sale, and one far beyond the quantity sold", async () => {
    // SALE_B sold only coke x5: burger is not on it
    expect((await callVoid(db, { product_id: BURGER, void_record_id: VOID1, delta: 1, sale_id: SALE_B, amount_ugx: 1000 })).ok).toBe(true);
    // SALE sold burger x3: voiding 50 is accepted
    expect((await callVoid(db, { product_id: BURGER, void_record_id: VOID2, delta: 50, sale_id: SALE, amount_ugx: 1000 })).ok).toBe(true);
    expect(await stockOf(db, BURGER)).toBe(51);
  });
});

describe("migration 20260919100000 — a new void is bounded by what the sale sold", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb(readFileSync(join(dir, "20260919100000_sale_void_bounded_reversal_guard.sql"), "utf8"));
  }, 60_000);
  afterAll(async () => db.close());

  it("rejects a product that is not on the sale (cross-sale / cross-line) with no ledger row and no stock change", async () => {
    const r = await callVoid(db, { product_id: BURGER, void_record_id: VOID1, delta: 1, sale_id: SALE_B, amount_ugx: 1000 });
    expect(r).toMatchObject({ ok: false, error: "void_product_not_in_sale" });
    expect(await voids(db)).toBe(0);
    expect(await stockOf(db, BURGER)).toBe(0);
  });

  it("rejects a quantity beyond what was sold", async () => {
    const r = await callVoid(db, { product_id: BURGER, void_record_id: VOID1, delta: 4, sale_id: SALE, amount_ugx: 1000 });
    expect(r).toMatchObject({ ok: false, error: "void_exceeds_sold" });
    expect(await voids(db)).toBe(0);
    expect(await stockOf(db, BURGER)).toBe(0);
  });

  it("accepts a partial void, then only the remainder — different records cannot exceed the sold quantity together", async () => {
    expect((await callVoid(db, { product_id: BURGER, void_record_id: VOID1, delta: 2, sale_id: SALE, amount_ugx: 40000 })).ok).toBe(true);
    expect(await stockOf(db, BURGER)).toBe(2);
    expect(await callVoid(db, { product_id: BURGER, void_record_id: VOID2, delta: 2, sale_id: SALE, amount_ugx: 40000 })).toMatchObject({
      ok: false,
      error: "void_exceeds_sold",
    });
    expect((await callVoid(db, { product_id: BURGER, void_record_id: VOID2, delta: 1, sale_id: SALE, amount_ugx: 20000 })).ok).toBe(true);
    expect(await stockOf(db, BURGER)).toBe(3);
  });

  it("an idempotent replay of an already-recorded void is still acknowledged (never re-checked, never re-applied)", async () => {
    const before = await stockOf(db, BURGER);
    const r = await callVoid(db, { product_id: BURGER, void_record_id: VOID1, delta: 2, sale_id: SALE, amount_ugx: 40000 });
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect(await stockOf(db, BURGER)).toBe(before);
  });

  it("returns already reversed count against the same limit (two devices, different records)", async () => {
    await db.exec(`insert into public.sale_returns (sale_id, product_id, quantity) values ('${SALE}', '${COKE}', 1)`);
    // coke sold x2, 1 already returned: a void of 2 exceeds, a void of 1 fits
    expect(await callVoid(db, { product_id: COKE, void_record_id: VOID3, delta: 2, sale_id: SALE, amount_ugx: 4000 })).toMatchObject({
      ok: false,
      error: "void_exceeds_sold",
    });
    expect((await callVoid(db, { product_id: COKE, void_record_id: VOID3, delta: 1, sale_id: SALE, amount_ugx: 2000 })).ok).toBe(true);
  });

  it("legacy stock-only calls (no sale id) and sales with no server line items behave exactly as before", async () => {
    expect((await callVoid(db, { product_id: COKE, void_record_id: "00000009-0000-4000-8000-000000000009", delta: 1 })).ok).toBe(true);
    await db.exec(`insert into public.sales (id, shop_id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${SHOP}')`);
    const r = await callVoid(db, {
      product_id: COKE,
      void_record_id: "0000000a-0000-4000-8000-00000000000a",
      delta: 1,
      sale_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      amount_ugx: 2000,
    });
    expect(r.ok).toBe(true); // nothing on the server to check against → unchanged behaviour
  });

  it("still enforces the shop boundary and the delta > 0 rule", async () => {
    expect(await callVoid(db, { product_id: COKE, void_record_id: VOID3, delta: 1 }, OTHER_SHOP)).toMatchObject({ ok: false, error: "shop_mismatch" });
    expect(await callVoid(db, { product_id: COKE, void_record_id: "0000000b-0000-4000-8000-00000000000b", delta: -1 })).toMatchObject({
      ok: false,
      error: "invalid_delta",
    });
  });
});
