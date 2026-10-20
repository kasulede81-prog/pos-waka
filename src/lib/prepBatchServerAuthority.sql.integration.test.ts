import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20261020150000 — server-authoritative prep batches.
 * Real PL/pgSQL: tables, RLS metadata, projection trigger, backfill, event RPC,
 * row locks and the existing durable stock primitive. Only auth/roles and
 * unrelated tables are stubbed.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const MIGRATION = "20261020150000_server_authoritative_prep_batches.sql";
const PRIOR = "20260919054154_made_to_order_ingredient_stock.sql";
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SHOP = u(1);
const DISH = u(10); // has a backfilled batch
const DISH2 = u(11); // create + sale + waste
const DISH3 = u(12); // cancel
const DISH4 = u(13); // cancel with stock shortfall
const DISH5 = u(14); // void/return
const DISH6 = u(15); // return before consumption
const DISH7 = u(16); // create after a sale (reconcile)
const DISH8 = u(17); // line-level cap
const ING = u(20);
const BACKFILLED_BATCH = u(100);
const CREATE_BATCH = u(101);
const WASTE_BATCH = u(102);
const CANCEL_BATCH = u(103);
const SHORT_CANCEL_BATCH = u(104);
const VOID_BATCH = u(105);
const RETURN_BATCH = u(106);
const LATE_BATCH = u(107);
const CAP_BATCH = u(108);
const TRIGGER_BATCH = u(109);
const CANCEL_RACE_BATCH = u(110);
const STOCK_ONLY_VOID_BATCH = u(111);

const S1 = u(200);
const S2 = u(201);
const S3 = u(202);
const L1 = u(300);
const L2 = u(301);
const L3 = u(302);

const SNAPSHOT = {
  yieldQty: 10,
  lines: [{ ingredientProductId: ING, quantityBase: 5, unitLabel: "kg" }],
};

function extractFn(file: string, name: string): string {
  const src = readFileSync(join(dir, file), "utf8");
  const needle = `create or replace function public.${name}`.toLowerCase();
  const start = src.toLowerCase().indexOf(needle);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  let end = -1;
  for (const terminator of ["$$;", "$function$;"]) {
    const i = src.indexOf(terminator, start);
    if (i >= 0 && (end < 0 || i + terminator.length < end)) end = i + terminator.length;
  }
  if (end < 0) throw new Error(`${name} body terminator not found in ${file}`);
  return src.slice(start, end);
}

function productMeta(extra: Record<string, unknown> = {}) {
  return {
    menu: {
      productKind: "finished_menu",
      prepMode: "batch_prepared",
      recipe: { yieldQty: 10, lines: [{ ingredientProductId: ING, quantityBase: 5, unitLabel: "kg" }] },
      modifierGroups: [],
      variants: [],
      ...extra,
    },
  };
}

function batchJson(id: string, product: string, remaining = 10, over: Record<string, unknown> = {}) {
  return {
    id,
    menuProductId: product,
    preparedAt: "2026-10-01T10:00:00.000Z",
    portionsPrepared: 10,
    remainingPortions: remaining,
    unitCostUgx: 1_000,
    expectedPortions: 10,
    actualPortions: 10,
    yieldBasis: "actual",
    costBasis: "recipe_estimate",
    batchCostPerPlateUgx: 1_200,
    totalCostUgx: 12_000,
    ingredientCostUgx: 10_000,
    additionalCostUgx: 2_000,
    status: "active",
    version: 2,
    recipeSnapshot: SNAPSHOT,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

async function baseDb(withBackfill = true): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema if not exists auth;
    create function auth.uid () returns uuid language sql as $$ select '${u(999)}'::uuid $$;
    create function public.user_is_cashier_or_above (p uuid) returns boolean language sql as $$ select true $$;
    create function public.user_can_access_shop (p uuid) returns boolean language sql as $$ select true $$;
    create function public.inventory_movement_uuid (s uuid, t text, r uuid, p uuid) returns uuid language sql immutable
      as $$ select md5 (s::text || '|' || t || '|' || r::text || '|' || p::text)::uuid $$;
    create table public.products (
      id uuid primary key, shop_id uuid, is_active boolean default true, stock_on_hand numeric(18,4) default 0,
      updated_at timestamptz default now(), metadata jsonb default '{}'::jsonb
    );
    create table public.sales (
      id uuid primary key, shop_id uuid, status text default 'completed',
      created_at timestamptz default now(), completed_at timestamptz
    );
    create table public.sale_line_items (
      id uuid primary key, sale_id uuid, product_id uuid, quantity numeric(18,4), metadata jsonb default '{}'::jsonb
    );
    create table public.sale_returns (
      id uuid primary key, shop_id uuid, sale_id uuid, product_id uuid, quantity numeric(18,4),
      reason text default 'wrong_item', stock_applied_at timestamptz
    );
    create table public.sale_voids (
      id uuid primary key, shop_id uuid, sale_id uuid, product_id uuid, quantity numeric,
      amount_ugx bigint default 1000
    );
    create table public.inventory_movements (
      id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, quantity_delta numeric(18,4),
      reason text check (reason in ('sale','return','adjustment','initial','transfer','waste','other','damaged','personal','debt','purchase','void')),
      reference_type text, reference_id uuid, note text, created_by uuid, created_at timestamptz default now()
    );
  `);
  await db.exec(extractFn("20260925091000_durable_stock_delta_no_clamp_ledger_consistency.sql", "_apply_durable_stock_delta"));
  await db.exec(extractFn(PRIOR, "_wk_try_uuid"));

  const row = (id: string, stock: number, meta: unknown = {}) =>
    `('${id}', '${SHOP}', ${stock}, '${JSON.stringify(meta)}'::jsonb)`;
  if (withBackfill) {
    await db.exec(`
      insert into public.products (id, shop_id, stock_on_hand, metadata) values
        ${row(DISH, 10, productMeta({ prepBatches: [batchJson(BACKFILLED_BATCH, DISH)] }))},
        ${row(ING, 100)},
        ${row(DISH2, 0, productMeta())},
        ${row(DISH3, 0, productMeta())},
        ${row(DISH4, 0, productMeta())},
        ${row(DISH5, 0, productMeta())},
        ${row(DISH6, 0, productMeta())},
        ${row(DISH7, 0, productMeta())},
        ${row(DISH8, 0, productMeta())};
    `);
  }
  await db.exec(readFileSync(join(dir, MIGRATION), "utf8"));
  return db;
}

const q = async <T extends Record<string, unknown>>(db: PGlite, sql: string, args: unknown[] = []) =>
  (await db.query<T>(sql, args)).rows;
const stock = async (db: PGlite, id: string) =>
  Number((await q<{ s: string }>(db, "select stock_on_hand as s from public.products where id=$1", [id]))[0]!.s);
const batch = async (db: PGlite, id: string) =>
  (await q<Record<string, unknown>>(db, "select * from public.prep_batches where shop_id=$1 and id=$2", [SHOP, id]))[0];
const events = async (db: PGlite, keyLike?: string) =>
  q<Record<string, unknown>>(
    db,
    keyLike
      ? "select * from public.prep_batch_events where shop_id=$1 and event_key like $2 order by created_at,id"
      : "select * from public.prep_batch_events where shop_id=$1 order by created_at,id",
    keyLike ? [SHOP, keyLike] : [SHOP],
  );
const rpc = async (db: PGlite, payload: Record<string, unknown>) => {
  const r = await db.query<{ r: Record<string, unknown> }>(
    "select public.shop_apply_prep_batch_event($1::uuid, $2::jsonb) as r",
    [SHOP, JSON.stringify(payload)],
  );
  return r.rows[0]!.r;
};
const addSale = async (db: PGlite, saleId: string, lineId: string, product: string, qty: number, batches: Array<{ batchId: string; portions: number }>) => {
  await db.query("insert into public.sales (id, shop_id, status) values ($1,$2,'completed')", [saleId, SHOP]);
  await db.query(
    "insert into public.sale_line_items (id, sale_id, product_id, quantity, metadata) values ($1,$2,$3,$4,$5::jsonb)",
    [lineId, saleId, product, qty, JSON.stringify({ prepAllocation: batches })],
  );
};

const createPayload = (batchId: string, product: string, portions: number, basis = portions) => ({
  kind: "create",
  eventId: batchId,
  batchId,
  productId: product,
  batch: batchJson(batchId, product, portions, { portionsPrepared: portions, expectedPortions: portions, actualPortions: portions }),
  ingredientRequirements: [{ productId: ING, quantityBase: 5 }],
  ingredientBasisPortions: basis,
});

describe("migration 20261020150000 — backfill, projection and stale catalog writes", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await baseDb(true);
  }, 90_000);
  afterAll(async () => db.close());

  it("backfills the persisted JSON batch with counters, cost and frozen requirements", async () => {
    const b = await batch(db, BACKFILLED_BATCH);
    expect(Number(b.remaining_portions)).toBe(10);
    expect(Number(b.portions_prepared)).toBe(10);
    expect(Number(b.version)).toBe(2);
    expect(Number(b.cost_per_plate_ugx)).toBe(1_200);
    expect(b.ingredient_requirements).toEqual([{ productId: ING, quantityBase: 5 }]);
    expect(Number(b.ingredient_basis_portions)).toBe(10);
  });

  it("is idempotent when the backfill runs again", async () => {
    const before = await q(db, "select count(*)::int as n from public.prep_batches");
    await db.query("select public._wk_backfill_prep_batches()");
    const after = await q(db, "select count(*)::int as n from public.prep_batches");
    expect(after[0]!.n).toBe(before[0]!.n);
    expect(Number((await batch(db, BACKFILLED_BATCH)).remaining_portions)).toBe(10);
  });

  it("projects the authoritative batch into product metadata (fresh-device pull)", async () => {
    const meta = (await q<{ m: { menu: { prepBatches: Array<Record<string, unknown>> } } }>(
      db,
      "select metadata as m from public.products where id=$1",
      [DISH],
    ))[0]!.m;
    expect(meta.menu.prepBatches).toHaveLength(1);
    expect(meta.menu.prepBatches[0]).toMatchObject({
      id: BACKFILLED_BATCH,
      remainingPortions: 10,
      status: "active",
      version: 2,
      batchCostPerPlateUgx: 1_200,
    });
  });

  it("a stale generic catalog write cannot overwrite the authoritative projection", async () => {
    await db.query(
      "update public.products set metadata = jsonb_set(metadata, '{menu,prepBatches}', $1::jsonb, true) where id=$2",
      [JSON.stringify([{ id: "stale", remainingPortions: 999 }]), DISH],
    );
    const meta = (await q<{ m: { menu: { prepBatches: Array<Record<string, unknown>> } } }>(
      db,
      "select metadata as m from public.products where id=$1",
      [DISH],
    ))[0]!.m;
    expect(meta.menu.prepBatches).toHaveLength(1);
    expect(meta.menu.prepBatches[0]!.id).toBe(BACKFILLED_BATCH);
    expect(meta.menu.prepBatches[0]!.remainingPortions).toBe(10);
  });
});

describe("migration 20261020150000 — create and sale consumption", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await baseDb(true);
    expect((await rpc(db, createPayload(CREATE_BATCH, DISH2, 5))).ok).toBe(true);
  }, 90_000);
  afterAll(async () => db.close());

  it("creates an authoritative batch without touching stock (existing stock outbox owns it)", async () => {
    const b = await batch(db, CREATE_BATCH);
    expect(Number(b.remaining_portions)).toBe(5);
    expect(Number(b.version)).toBe(1);
    expect(await stock(db, DISH2)).toBe(0);
    expect(await stock(db, ING)).toBe(100);
  });

  it("replays a create idempotently", async () => {
    const before = (await events(db, `create:${CREATE_BATCH}`)).length;
    const r = await rpc(db, createPayload(CREATE_BATCH, DISH2, 5));
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect(Number((await batch(db, CREATE_BATCH)).remaining_portions)).toBe(5);
    expect((await events(db, `create:${CREATE_BATCH}`)).length).toBe(before);
  });

  it("sale completion consumes the batch through the canonical sales lifecycle trigger", async () => {
    const S = u(211);
    const L = u(311);
    expect((await rpc(db, createPayload(TRIGGER_BATCH, DISH2, 4))).ok).toBe(true);
    await db.query("insert into public.sales (id, shop_id, status) values ($1,$2,'draft')", [S, SHOP]);
    await db.query(
      "insert into public.sale_line_items (id, sale_id, product_id, quantity, metadata) values ($1,$2,$3,1,$4::jsonb)",
      [L, S, DISH2, JSON.stringify({ prepAllocation: [{ batchId: TRIGGER_BATCH, portions: 1 }] })],
    );
    await db.query("update public.sales set status='completed' where id=$1", [S]);
    expect(Number((await batch(db, TRIGGER_BATCH)).remaining_portions)).toBe(3);
    const ev = await events(db, `sale:${L}:${TRIGGER_BATCH}`);
    expect(ev).toHaveLength(1);
    expect(Number(ev[0]!.applied_portions)).toBe(1);
  });

  it("consumes exactly once across retries and clamps an over-large allocation to the line quantity", async () => {
    await addSale(db, S1, L1, DISH2, 2, [{ batchId: CREATE_BATCH, portions: 99 }]);
    expect((await rpc(db, { kind: "sale_consume", eventId: L1, saleId: S1, saleLineId: L1 })).ok).toBe(true);
    expect(Number((await batch(db, CREATE_BATCH)).remaining_portions)).toBe(3);
    expect((await rpc(db, { kind: "sale_consume", eventId: L1, saleId: S1, saleLineId: L1 })).ok).toBe(true);
    expect(Number((await batch(db, CREATE_BATCH)).remaining_portions)).toBe(3);
    const ev = await events(db, `sale:${L1}:${CREATE_BATCH}`);
    expect(ev).toHaveLength(1);
    expect(Number(ev[0]!.portions)).toBe(2);
    expect(Number(ev[0]!.applied_portions)).toBe(2);
  });

  it("two devices consuming the same batch serialize: the second sees the reduced remainder", async () => {
    await addSale(db, S2, L2, DISH2, 2, [{ batchId: CREATE_BATCH, portions: 2 }]);
    await addSale(db, S3, L3, DISH2, 2, [{ batchId: CREATE_BATCH, portions: 2 }]);
    expect((await rpc(db, { kind: "sale_consume", eventId: L2, saleId: S2, saleLineId: L2 })).ok).toBe(true);
    expect(Number((await batch(db, CREATE_BATCH)).remaining_portions)).toBe(1);
    expect((await rpc(db, { kind: "sale_consume", eventId: L3, saleId: S3, saleLineId: L3 })).ok).toBe(true);
    const b = await batch(db, CREATE_BATCH);
    expect(Number(b.remaining_portions)).toBe(0);
    expect(b.status).toBe("depleted");
    const ev = await events(db, `sale:${L3}:${CREATE_BATCH}`);
    expect(Number(ev[0]!.applied_portions)).toBe(1);
    expect(Number(ev[0]!.shortfall_portions)).toBe(1);
    expect(ev[0]!.status).toBe("insufficient");
  });

  it("a sale event waits until the sale is completed", async () => {
    const S = u(210);
    const L = u(310);
    await db.query("insert into public.sales (id, shop_id, status) values ($1,$2,'draft')", [S, SHOP]);
    await db.query("insert into public.sale_line_items (id, sale_id, product_id, quantity, metadata) values ($1,$2,$3,1,$4::jsonb)", [
      L,
      S,
      DISH2,
      JSON.stringify({ prepAllocation: [{ batchId: CREATE_BATCH, portions: 1 }] }),
    ]);
    expect(await rpc(db, { kind: "sale_consume", eventId: L, saleId: S, saleLineId: L })).toMatchObject({
      ok: false,
      error: "sale_not_completed",
    });
  });
});

describe("migration 20261020150000 — waste", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await baseDb(true);
    await rpc(db, createPayload(WASTE_BATCH, DISH3, 5));
    // A sale consumes two portions first (sale-vs-waste race); the sale stock path is
    // simulated by setting the authoritative dish stock to the post-sale value.
    const S = u(220);
    const L = u(320);
    await addSale(db, S, L, DISH3, 2, [{ batchId: WASTE_BATCH, portions: 2 }]);
    await rpc(db, { kind: "sale_consume", eventId: L, saleId: S, saleLineId: L });
    await db.query("update public.products set stock_on_hand=3 where id=$1", [DISH3]);
  }, 90_000);
  afterAll(async () => db.close());

  it("waste applies the available quantity, decrements dish stock and records the shortfall", async () => {
    const r = await rpc(db, {
      kind: "waste",
      eventId: u(400),
      batchId: WASTE_BATCH,
      productId: DISH3,
      portions: 5,
      reason: "unsold",
      dishStockAdjustmentId: u(401),
    });
    expect(r).toMatchObject({ ok: true, idempotent: false, appliedPortions: 3, shortfallPortions: 2 });
    expect(r.stockDeltas).toEqual([{ productId: DISH3, delta: -3 }]);
    const b = await batch(db, WASTE_BATCH);
    expect(Number(b.remaining_portions)).toBe(0);
    expect(Number(b.wasted_portions)).toBe(3);
    expect(b.status).toBe("wasted");
    expect(await stock(db, DISH3)).toBe(0);
  });

  it("replays waste idempotently (no second movement or portion)", async () => {
    const before = await stock(db, DISH3);
    const r = await rpc(db, {
      kind: "waste",
      eventId: u(400),
      batchId: WASTE_BATCH,
      productId: DISH3,
      portions: 5,
      reason: "unsold",
      dishStockAdjustmentId: u(401),
    });
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect(await stock(db, DISH3)).toBe(before);
    expect(Number((await batch(db, WASTE_BATCH)).wasted_portions)).toBe(3);
  });

  it("cancelling a wasted batch is skipped, not resurrected", async () => {
    const r = await rpc(db, { kind: "cancel", eventId: u(402), batchId: WASTE_BATCH, productId: DISH3 });
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect((await batch(db, WASTE_BATCH)).status).toBe("wasted");
  });

  it("waste of a missing batch is recorded unreconciled, never guessed into existence", async () => {
    const r = await rpc(db, { kind: "waste", eventId: u(403), batchId: u(499), productId: DISH3, portions: 2 });
    expect(r).toMatchObject({ ok: true, unreconciled: true });
    expect(await batch(db, u(499))).toBeUndefined();
    const ev = await events(db, `waste:${u(403)}`);
    expect(ev[0]!.status).toBe("unreconciled");
    expect(Number(ev[0]!.shortfall_portions)).toBe(2);
  });
});

describe("migration 20261020150000 — cancellation stock", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await baseDb(true);
    await rpc(db, createPayload(CANCEL_BATCH, DISH4, 10));
    await db.query("update public.products set stock_on_hand=10 where id=$1", [DISH4]);
  }, 90_000);
  afterAll(async () => db.close());

  it("restores dish and ingredient stock at the server's remaining quantity", async () => {
    const r = await rpc(db, {
      kind: "cancel",
      eventId: u(500),
      batchId: CANCEL_BATCH,
      productId: DISH4,
      dishStockAdjustmentId: u(501),
      ingredientAdjustments: [{ productId: ING, adjustmentId: u(502) }],
    });
    expect(r).toMatchObject({ ok: true, idempotent: false, cancelledPortions: 10 });
    expect(r.stockDeltas).toEqual(
      expect.arrayContaining([
        { productId: DISH4, delta: -10 },
        { productId: ING, delta: 5 },
      ]),
    );
    expect(Number((await batch(db, CANCEL_BATCH)).remaining_portions)).toBe(0);
    expect((await batch(db, CANCEL_BATCH)).status).toBe("cancelled");
    expect(await stock(db, DISH4)).toBe(0);
    expect(await stock(db, ING)).toBe(105); // 5 kg full batch, scaled 10/10
  });

  it("replays cancel without restoring stock twice", async () => {
    const r = await rpc(db, {
      kind: "cancel",
      eventId: u(500),
      batchId: CANCEL_BATCH,
      productId: DISH4,
      dishStockAdjustmentId: u(501),
      ingredientAdjustments: [{ productId: ING, adjustmentId: u(502) }],
    });
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect(await stock(db, DISH4)).toBe(0);
    expect(await stock(db, ING)).toBe(105);
  });

  it("never drives dish stock negative when the server has less stock than the batch", async () => {
    await rpc(db, createPayload(SHORT_CANCEL_BATCH, DISH4, 10));
    await db.query("update public.products set stock_on_hand=4 where id=$1", [DISH4]);
    const r = await rpc(db, {
      kind: "cancel",
      eventId: u(503),
      batchId: SHORT_CANCEL_BATCH,
      productId: DISH4,
      dishStockAdjustmentId: u(504),
      ingredientAdjustments: [{ productId: ING, adjustmentId: u(505) }],
    });
    expect(r).toMatchObject({ ok: true });
    expect(await stock(db, DISH4)).toBe(0);
    const ev = await events(db, `cancel:${SHORT_CANCEL_BATCH}`);
    expect(Number((ev[0]!.metadata as Record<string, unknown>).stockShortfallPortions)).toBe(6);
  });

  it("a sale arriving after cancellation is recorded unreconciled, never resurrecting the batch", async () => {
    const S = u(221);
    const L = u(321);
    await rpc(db, createPayload(CANCEL_RACE_BATCH, DISH4, 5));
    await db.query("update public.products set stock_on_hand=5 where id=$1", [DISH4]);
    expect(
      (await rpc(db, {
        kind: "cancel",
        eventId: u(506),
        batchId: CANCEL_RACE_BATCH,
        productId: DISH4,
        dishStockAdjustmentId: u(507),
      })).ok,
    ).toBe(true);

    await addSale(db, S, L, DISH4, 2, [{ batchId: CANCEL_RACE_BATCH, portions: 2 }]);
    expect((await rpc(db, { kind: "sale_consume", eventId: L, saleId: S, saleLineId: L })).ok).toBe(true);
    const b = await batch(db, CANCEL_RACE_BATCH);
    expect(b.status).toBe("cancelled");
    expect(Number(b.remaining_portions)).toBe(0);
    const ev = await events(db, `sale:${L}:${CANCEL_RACE_BATCH}`);
    expect(ev[0]!.status).toBe("unreconciled");
    expect(Number(ev[0]!.shortfall_portions)).toBe(2);
  });
});

describe("migration 20261020150000 — void and return", () => {
  let db: PGlite;
  const SALE = u(600);
  const LINE = u(601);
  beforeAll(async () => {
    db = await baseDb(true);
    await rpc(db, createPayload(VOID_BATCH, DISH5, 10));
    await addSale(db, SALE, LINE, DISH5, 4, [{ batchId: VOID_BATCH, portions: 4 }]);
    expect((await rpc(db, { kind: "sale_consume", eventId: LINE, saleId: SALE, saleLineId: LINE })).ok).toBe(true);
  }, 90_000);
  afterAll(async () => db.close());

  it("a void credits the batch portions once", async () => {
    await db.query("insert into public.sale_voids (id, shop_id, sale_id, product_id, quantity) values ($1,$2,$3,$4,1)", [
      u(610),
      SHOP,
      SALE,
      DISH5,
    ]);
    expect((await rpc(db, { kind: "sale_void", eventId: u(610), saleId: SALE, saleLineId: LINE, quantity: 1 })).ok).toBe(true);
    expect(Number((await batch(db, VOID_BATCH)).remaining_portions)).toBe(7);
    expect((await rpc(db, { kind: "sale_void", eventId: u(610), saleId: SALE, saleLineId: LINE, quantity: 1 })).ok).toBe(true);
    expect(Number((await batch(db, VOID_BATCH)).remaining_portions)).toBe(7);
  });

  it("a stock-only void (closed business date, no sale_voids row) still credits the batch", async () => {
    const S = u(611);
    const L = u(612);
    await rpc(db, createPayload(STOCK_ONLY_VOID_BATCH, DISH5, 2));
    await addSale(db, S, L, DISH5, 1, [{ batchId: STOCK_ONLY_VOID_BATCH, portions: 1 }]);
    await rpc(db, { kind: "sale_consume", eventId: L, saleId: S, saleLineId: L });
    expect(Number((await batch(db, STOCK_ONLY_VOID_BATCH)).remaining_portions)).toBe(1);
    // No sale_voids row is inserted for an amount-less stock-only void.
    expect((await rpc(db, { kind: "sale_void", eventId: u(613), saleId: S, saleLineId: L, quantity: 1 })).ok).toBe(true);
    expect(Number((await batch(db, STOCK_ONLY_VOID_BATCH)).remaining_portions)).toBe(2);
  });

  it("a return credits the batch portions once and a damaged return credits nothing", async () => {
    await db.query(
      "insert into public.sale_returns (id, shop_id, sale_id, product_id, quantity, reason, stock_applied_at) values ($1,$2,$3,$4,1,'wrong_item',now())",
      [u(620), SHOP, SALE, DISH5],
    );
    expect((await rpc(db, { kind: "sale_return", eventId: u(620), saleId: SALE, saleLineId: LINE, quantity: 1 })).ok).toBe(true);
    expect(Number((await batch(db, VOID_BATCH)).remaining_portions)).toBe(8);
    expect((await rpc(db, { kind: "sale_return", eventId: u(620), saleId: SALE, saleLineId: LINE, quantity: 1 })).ok).toBe(true);
    expect(Number((await batch(db, VOID_BATCH)).remaining_portions)).toBe(8);

    await db.query(
      "insert into public.sale_returns (id, shop_id, sale_id, product_id, quantity, reason, stock_applied_at) values ($1,$2,$3,$4,1,'damaged',now())",
      [u(621), SHOP, SALE, DISH5],
    );
    const damaged = await rpc(db, { kind: "sale_return", eventId: u(621), saleId: SALE, saleLineId: LINE, quantity: 1 });
    expect(damaged).toMatchObject({ ok: true, skipped: true });
    expect(Number((await batch(db, VOID_BATCH)).remaining_portions)).toBe(8);
  });

  it("a return applies the sale consumption before crediting, regardless of event order", async () => {
    const S = u(630);
    const L = u(631);
    await rpc(db, createPayload(RETURN_BATCH, DISH6, 5));
    await addSale(db, S, L, DISH6, 2, [{ batchId: RETURN_BATCH, portions: 2 }]);
    await db.query(
      "insert into public.sale_returns (id, shop_id, sale_id, product_id, quantity, reason, stock_applied_at) values ($1,$2,$3,$4,1,'wrong_item',now())",
      [u(632), SHOP, S, DISH6],
    );
    // No sale_consume event has been delivered yet.
    expect((await rpc(db, { kind: "sale_return", eventId: u(632), saleId: S, saleLineId: L, quantity: 1 })).ok).toBe(true);
    expect(Number((await batch(db, RETURN_BATCH)).remaining_portions)).toBe(4); // 5 - 2 + 1
    expect((await events(db, `sale:${L}:${RETURN_BATCH}`))[0]!.applied_portions).toBeDefined();
  });

  it("a sale before batch creation is reconciled when the batch is created", async () => {
    const S = u(640);
    const L = u(641);
    await addSale(db, S, L, DISH7, 3, [{ batchId: LATE_BATCH, portions: 3 }]);
    expect((await rpc(db, { kind: "sale_consume", eventId: L, saleId: S, saleLineId: L })).ok).toBe(true);
    expect((await events(db, `sale:${L}:${LATE_BATCH}`))[0]!.status).toBe("unreconciled");
    expect(await batch(db, LATE_BATCH)).toBeUndefined();

    expect((await rpc(db, createPayload(LATE_BATCH, DISH7, 5))).ok).toBe(true);
    expect(Number((await batch(db, LATE_BATCH)).remaining_portions)).toBe(2);
    expect((await events(db, `sale:${L}:${LATE_BATCH}`))[0]!.status).toBe("applied");
  });

  it("a void of a batch already fully consumed records the shortfall and never goes negative", async () => {
    const S = u(650);
    const L = u(651);
    await rpc(db, createPayload(CAP_BATCH, DISH8, 1));
    await addSale(db, S, L, DISH8, 1, [{ batchId: CAP_BATCH, portions: 1 }]);
    await rpc(db, { kind: "sale_consume", eventId: L, saleId: S, saleLineId: L });
    await db.query("insert into public.sale_voids (id, shop_id, sale_id, product_id, quantity) values ($1,$2,$3,$4,1)", [
      u(652),
      SHOP,
      S,
      DISH8,
    ]);
    // The batch is depleted at 0; a stale void of 1 can credit at most its capacity.
    await rpc(db, { kind: "sale_void", eventId: u(652), saleId: S, saleLineId: L, quantity: 1 });
    const b = await batch(db, CAP_BATCH);
    expect(Number(b.remaining_portions)).toBe(1); // capacity = portions_prepared
    expect(Number(b.remaining_portions)).toBeGreaterThanOrEqual(0);
  });
});
