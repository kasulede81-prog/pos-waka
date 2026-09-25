import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20260925090000 — shop_push_sale_complete opt-in online oversell guard
 * (audit fix #1). Dependencies of the finalize RPC are stubbed so the test isolates
 * the new pre-flight availability check: enforce_stock rejects atomically and rolls
 * back the whole sale, while offline/queued sales (flag off) stay permissive.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const MIGRATION = "20260925090000_sale_complete_optin_oversell_guard.sql";
const SHOP = "11111111-1111-4111-8111-111111111111";
const PROD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function extractFn(file: string, name: string): string {
  const src = readFileSync(join(dir, file), "utf8");
  const lower = src.toLowerCase();
  const start = lower.indexOf(`create or replace function public.${name.toLowerCase()}`);
  if (start < 0) throw new Error(`function ${name} not found in ${file}`);
  const end = src.indexOf("$function$;", start);
  if (end < 0) throw new Error(`function ${name} body terminator not found in ${file}`);
  return src.slice(start, end + "$function$;".length);
}

/** recipeMode=true makes _wk_recipe_lines classify every line as a recipe line. */
async function freshDb(stock: number, recipeMode = false): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    set check_function_bodies = off;
    create schema if not exists auth;
    create function auth.uid () returns uuid language sql as $$ select '99999999-9999-4999-8999-999999999999'::uuid $$;
    create function public.user_is_cashier_or_above (p uuid) returns boolean language sql as $$ select true $$;
    create function public.staff_v2_validate_sold_by_user_id (p_shop uuid, p_sale jsonb, p_uid uuid) returns uuid language sql as $$ select p_uid $$;
    create function public.validate_sale_push_financials (p_shop uuid, p_sale jsonb, p_lines jsonb) returns jsonb language sql as $$ select jsonb_build_object('ok', true) $$;
    create function public.apply_sale_stock_movements (p_sale uuid) returns jsonb language sql as $$ select '[]'::jsonb $$;
    create function public._wk_recipe_lines (p_sale_id uuid, p_shop uuid, p_has_movements boolean)
      returns table(line_id uuid, product_id uuid, quantity numeric, provenance jsonb) language sql as $$
        select sli.id, sli.product_id, sli.quantity, '[]'::jsonb
        from public.sale_line_items sli
        where ${recipeMode ? "sli.sale_id = p_sale_id" : "false"}
      $$;
    create table public.products (id uuid primary key, shop_id uuid, is_active boolean default true, stock_on_hand numeric default 0, updated_at timestamptz default now());
    create table public.sales (
      id uuid primary key, shop_id uuid, customer_id uuid, status text, payment_status text,
      subtotal_ugx bigint, tax_ugx bigint, discount_ugx bigint, total_ugx bigint,
      cash_amount_ugx bigint, debt_amount_ugx bigint, issue_receipt boolean,
      created_by uuid, sold_by_user_id uuid, completed_at timestamptz, metadata jsonb,
      created_at timestamptz, updated_at timestamptz
    );
    create table public.sale_line_items (
      id uuid primary key default gen_random_uuid(), sale_id uuid, product_id uuid, quantity numeric,
      unit_price_ugx bigint, line_discount_ugx bigint, line_total_ugx bigint, line_input_mode text,
      money_amount_ugx bigint, metadata jsonb
    );
    create table public.sale_payments (
      id uuid primary key default gen_random_uuid(), sale_id uuid, method text, amount_ugx bigint, recorded_by uuid
    );
  `);
  await db.exec(extractFn(MIGRATION, "shop_push_sale_complete"));
  await db.exec(`insert into public.products (id, shop_id, stock_on_hand) values ('${PROD}', '${SHOP}', ${stock});`);
  return db;
}

function payload(qty: number, enforce: boolean | undefined) {
  const total = qty * 1000;
  const sale: Record<string, unknown> = {
    id: crypto.randomUUID(),
    payment_status: "paid",
    subtotal_ugx: total, tax_ugx: 0, discount_ugx: 0, total_ugx: total,
    cash_amount_ugx: total, debt_amount_ugx: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  if (enforce !== undefined) sale.enforce_stock = enforce;
  return {
    saleId: sale.id as string,
    body: {
      sale,
      lines: [{ id: crypto.randomUUID(), product_id: PROD, quantity: qty, unit_price_ugx: 1000, line_discount_ugx: 0, line_total_ugx: total, line_input_mode: "quantity" }],
      payments: [{ method: "cash", amount_ugx: total }],
    },
  };
}

async function push(db: PGlite, body: unknown) {
  const res = await db.query<{ r: { ok: boolean; error?: string; sale_id?: string } }>(
    "select public.shop_push_sale_complete($1::uuid, $2::jsonb) as r",
    [SHOP, JSON.stringify(body)],
  );
  return res.rows[0]!.r;
}
const rowCount = async (db: PGlite, table: string, saleId: string) =>
  Number((await db.query<{ n: string }>(`select count(*) as n from public.${table} where ${table === "sales" ? "id" : "sale_id"} = $1`, [saleId])).rows[0]!.n);

describe("online oversell guard (enforce_stock=true)", () => {
  let db: PGlite;
  beforeAll(async () => { db = await freshDb(2); }, 60_000);
  afterAll(async () => db.close());

  it("rejects an enforced sale beyond available stock and rolls back the whole sale", async () => {
    const p = payload(5, true);
    const r = await push(db, p.body);
    expect(r).toMatchObject({ ok: false, error: "insufficient_stock" });
    // full rollback: nothing persisted
    expect(await rowCount(db, "sales", p.saleId)).toBe(0);
    expect(await rowCount(db, "sale_line_items", p.saleId)).toBe(0);
    expect(await rowCount(db, "sale_payments", p.saleId)).toBe(0);
  });

  it("accepts an enforced sale exactly at available stock", async () => {
    const p = payload(2, true);
    const r = await push(db, p.body);
    expect(r.ok).toBe(true);
    expect(await rowCount(db, "sales", p.saleId)).toBe(1);
  });
});

describe("offline-first preserved (enforce_stock off)", () => {
  it("absent flag: oversell is allowed (permissive), sale persists", async () => {
    const db = await freshDb(2);
    const p = payload(5, undefined);
    const r = await push(db, p.body);
    expect(r.ok).toBe(true);
    expect(await rowCount(db, "sales", p.saleId)).toBe(1);
    await db.close();
  });

  it("explicit false: oversell is allowed (permissive), sale persists", async () => {
    const db = await freshDb(2);
    const p = payload(5, false);
    const r = await push(db, p.body);
    expect(r.ok).toBe(true);
    expect(await rowCount(db, "sales", p.saleId)).toBe(1);
    await db.close();
  });
});

describe("recipe / made-to-order lines are excluded from the guard (hospitality unchanged)", () => {
  it("enforced sale of a recipe line over finished stock is NOT rejected", async () => {
    const db = await freshDb(0, true); // stock 0, but line classified as recipe
    const p = payload(5, true);
    const r = await push(db, p.body);
    expect(r.ok).toBe(true);
    expect(await rowCount(db, "sales", p.saleId)).toBe(1);
    await db.close();
  });
});
