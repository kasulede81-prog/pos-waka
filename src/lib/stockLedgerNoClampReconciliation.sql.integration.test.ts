import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20260925091000 — _apply_durable_stock_delta no-clamp ledger consistency
 * (audit fix #2). Proves stock_on_hand stays mathematically equal to
 * (initial + sum of recorded movement deltas), including the oversold -> void edge
 * that the old greatest(...,0) clamp silently distorted.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const MIGRATION = "20260925091000_durable_stock_delta_no_clamp_ledger_consistency.sql";
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

async function freshDb(initialStock: number): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create function auth.uid () returns uuid language sql as $$ select '99999999-9999-4999-8999-999999999999'::uuid $$;
    create function public.inventory_movement_uuid (s uuid, t text, r uuid, p uuid) returns uuid language sql immutable
      as $$ select md5 (s::text || t || r::text || p::text)::uuid $$;
    create table public.products (id uuid primary key, shop_id uuid, is_active boolean default true, stock_on_hand numeric default 0, updated_at timestamptz default now());
    create table public.inventory_movements (
      id uuid primary key, shop_id uuid, product_id uuid, quantity_delta numeric, reason text, reference_type text,
      reference_id uuid, note text, created_by uuid
    );
    create unique index inventory_movements_ref_unique
      on public.inventory_movements (shop_id, reference_type, reference_id, product_id);
  `);
  await db.exec(extractFn(MIGRATION, "_apply_durable_stock_delta"));
  await db.exec(`insert into public.products (id, shop_id, stock_on_hand) values ('${PROD}', '${SHOP}', ${initialStock});`);
  return db;
}

type Delta = { reference_type: string; reference_id: string; delta: number; reason: string; note: string };
async function applyDelta(db: PGlite, d: Delta) {
  const res = await db.query<{ r: { ok: boolean; idempotent?: boolean; stock_on_hand?: number; error?: string } }>(
    "select public._apply_durable_stock_delta($1::uuid,$2::uuid,$3::text,$4::uuid,$5::numeric,$6::text,$7::text) as r",
    [SHOP, PROD, d.reference_type, d.reference_id, d.delta, d.reason, d.note],
  );
  return res.rows[0]!.r;
}
const stockOf = async (db: PGlite) =>
  Number((await db.query<{ s: string }>("select stock_on_hand as s from public.products where id=$1", [PROD])).rows[0]!.s);
const ledgerSum = async (db: PGlite) =>
  Number((await db.query<{ s: string }>("select coalesce(sum(quantity_delta),0) as s from public.inventory_movements where product_id=$1", [PROD])).rows[0]!.s);

describe("no-clamp ledger consistency", () => {
  let db: PGlite;
  beforeAll(async () => { db = await freshDb(-3); }, 60_000);
  afterAll(async () => db.close());

  it("oversold -> void restock lands at -1, NOT clamped to 0, and matches the ledger", async () => {
    const r = await applyDelta(db, { reference_type: "sale_void", reference_id: "00000001-0000-4000-8000-000000000001", delta: 2, reason: "void", note: "x" });
    expect(r.ok).toBe(true);
    expect(Number(r.stock_on_hand)).toBe(-1);
    expect(await stockOf(db)).toBe(-1);
    // initial(-3) + ledger(+2) == stock(-1)
    expect(-3 + (await ledgerSum(db))).toBe(await stockOf(db));
  });

  it("is idempotent on replay of the same reversal (no double restock)", async () => {
    const before = await stockOf(db);
    const r = await applyDelta(db, { reference_type: "sale_void", reference_id: "00000001-0000-4000-8000-000000000001", delta: 2, reason: "void", note: "x" });
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect(await stockOf(db)).toBe(before);
  });
});

describe("negative adjustment beyond stock stays ledger-consistent (no clamp)", () => {
  let db: PGlite;
  beforeAll(async () => { db = await freshDb(0); }, 60_000);
  afterAll(async () => db.close());

  it("stock 0, adjustment -5 -> stock -5 and movement -5 (old code clamped to 0, dropping 5 units of ledger truth)", async () => {
    const r = await applyDelta(db, { reference_type: "adjustment", reference_id: "00000002-0000-4000-8000-000000000002", delta: -5, reason: "adjustment", note: "shrinkage" });
    expect(r.ok).toBe(true);
    expect(Number(r.stock_on_hand)).toBe(-5);
    expect(await ledgerSum(db)).toBe(-5);
    expect(0 + (await ledgerSum(db))).toBe(await stockOf(db));
  });
});
