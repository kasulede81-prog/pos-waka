import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20260918170000 — kitchen ticket push stale-write guards.
 * Runs the ORIGINAL function from migration 127 (to prove the defects) and the fixed one.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const SHOP = "11111111-1111-4111-8111-111111111111";
const TICKET = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

function extractFunction(file: string): string {
  const src = readFileSync(join(dir, file), "utf8");
  const start = src.indexOf("create or replace function public.shop_push_kitchen_ticket");
  const end = src.indexOf("$$;", start) + 3;
  return src.slice(start, end);
}

async function freshDb(functionSql: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create function auth.uid () returns uuid language sql as $$ select '99999999-9999-4999-8999-999999999999'::uuid $$;
    create function public.user_is_cashier_or_above (p uuid) returns boolean language sql as $$ select true $$;
    create table public.kitchen_tickets (
      id uuid primary key, shop_id uuid, table_session_id uuid, sale_id uuid, station_id uuid,
      ticket_number int, status text, fired_at timestamptz, prepared_at timestamptz, served_at timestamptz,
      waiter_label text, table_label text, area_name text, metadata jsonb, created_at timestamptz, updated_at timestamptz
    );
    create table public.kitchen_ticket_items (
      id uuid primary key, ticket_id uuid, product_id uuid, product_name text, quantity numeric, notes text, metadata jsonb
    );
  `);
  await db.exec(functionSql);
  return db;
}

function payload(over: { status: string; updated_at: string; itemStatus: string; quantity?: number }) {
  return {
    id: TICKET,
    table_session_id: "44444444-4444-4444-8444-444444444444",
    sale_id: "55555555-5555-4555-8555-555555555555",
    station_id: "66666666-6666-4666-8666-666666666666",
    ticket_number: 1,
    status: over.status,
    fired_at: "2026-09-18T10:00:00Z",
    updated_at: over.updated_at,
    table_label: "T1",
    metadata: { station_type: "kitchen" },
    items: [{ id: ITEM, product_name: "Burger", quantity: over.quantity ?? 1, item_status: over.itemStatus }],
  };
}

async function push(db: PGlite, p: ReturnType<typeof payload>) {
  const res = await db.query<{ r: { ok: boolean; stale?: boolean; error?: string } }>(
    "select public.shop_push_kitchen_ticket($1::uuid, $2::jsonb) as r",
    [SHOP, JSON.stringify(p)],
  );
  return res.rows[0]!.r;
}

async function state(db: PGlite) {
  const t = await db.query<{ status: string }>("select status from public.kitchen_tickets where id = $1", [TICKET]);
  const i = await db.query<{ quantity: string; metadata: { item_status?: string } }>(
    "select quantity, metadata from public.kitchen_ticket_items where ticket_id = $1",
    [TICKET],
  );
  return { status: t.rows[0]?.status, items: i.rows.map((r) => ({ q: Number(r.quantity), item_status: r.metadata.item_status })) };
}

describe("original function (127) — documents the defects", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb(extractFunction("127_hospitality_kitchen_production.sql"));
  }, 60_000);
  afterAll(async () => db.close());

  it("a stale push keeps the newer header but REPLACES the newer items", async () => {
    await push(db, payload({ status: "queued", updated_at: "2026-09-18T10:01:00Z", itemStatus: "active" }));
    await push(db, payload({ status: "cancelled", updated_at: "2026-09-18T10:03:00Z", itemStatus: "cancelled" }));
    await push(db, payload({ status: "preparing", updated_at: "2026-09-18T10:02:00Z", itemStatus: "active", quantity: 5 }));
    const s = await state(db);
    expect(s.status).toBe("cancelled"); // header guarded...
    expect(s.items[0]).toEqual({ q: 5, item_status: "active" }); // ...but items were overwritten by the stale copy
  });
});

describe("fixed function (20260918170000)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb(extractFunction("20260918170000_hospitality_ticket_stale_guards.sql"));
  }, 60_000);
  afterAll(async () => db.close());

  it("a stale push changes neither header nor items", async () => {
    await push(db, payload({ status: "queued", updated_at: "2026-09-18T10:01:00Z", itemStatus: "active" }));
    await push(db, payload({ status: "cancelled", updated_at: "2026-09-18T10:03:00Z", itemStatus: "cancelled" }));
    const stale = await push(db, payload({ status: "preparing", updated_at: "2026-09-18T10:02:00Z", itemStatus: "active", quantity: 5 }));
    expect(stale.ok).toBe(true);
    expect(stale.stale).toBe(true);
    const s = await state(db);
    expect(s.status).toBe("cancelled");
    expect(s.items[0]).toEqual({ q: 1, item_status: "cancelled" });
  });

  it("a cancelled ticket cannot be reopened, even by a push that looks newer", async () => {
    const r = await push(db, payload({ status: "ready", updated_at: "2026-09-18T10:09:00Z", itemStatus: "active" }));
    expect(r.stale).toBe(true);
    expect((await state(db)).status).toBe("cancelled");
  });

  it("normal forward progress and equal timestamps still apply, items included", async () => {
    await db.exec("truncate public.kitchen_tickets, public.kitchen_ticket_items");
    await push(db, payload({ status: "queued", updated_at: "2026-09-18T10:00:00Z", itemStatus: "active" }));
    await push(db, payload({ status: "preparing", updated_at: "2026-09-18T10:01:00Z", itemStatus: "active", quantity: 2 }));
    expect(await state(db)).toEqual({ status: "preparing", items: [{ q: 2, item_status: "active" }] });
    // same timestamp (two devices in the same second) is not stale
    const tie = await push(db, payload({ status: "ready", updated_at: "2026-09-18T10:01:00Z", itemStatus: "active", quantity: 2 }));
    expect(tie.stale).toBeUndefined();
    expect((await state(db)).status).toBe("ready");
  });

  it("cancelling a live ticket still works and can be repeated", async () => {
    await push(db, payload({ status: "cancelled", updated_at: "2026-09-18T10:05:00Z", itemStatus: "cancelled" }));
    expect((await state(db)).status).toBe("cancelled");
    const again = await push(db, payload({ status: "cancelled", updated_at: "2026-09-18T10:06:00Z", itemStatus: "cancelled" }));
    expect(again.ok).toBe(true);
    expect((await state(db)).status).toBe("cancelled");
  });
});
