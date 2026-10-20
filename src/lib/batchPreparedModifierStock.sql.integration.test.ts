import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20261020120000 — ingredient-based modifiers on batch-prepared dishes.
 *
 * Real SQL/PL-pgSQL: the canonical sale application, line-bound void RPC and return application are
 * exercised together with the made-to-order helpers, the bounded void guard and the durable stock
 * delta. Only auth, roles and unrelated tables are stubbed.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const MIGRATION = "20261020120000_batch_prepared_modifier_ingredient_stock.sql";
const R5 = "20260919054154_made_to_order_ingredient_stock.sql";
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SHOP = u(1);
const DISH = u(10); // batch-prepared finished dish
const RETAIL = u(11);
const MTO = u(12); // made-to-order dish
const BASE = u(20); // batch recipe ingredient
const MOD = u(21); // modifier ingredient
const MOD2 = u(22); // second modifier ingredient
const MTO_ING = u(23);

const MENU_BATCH = {
  productKind: "finished_menu",
  prepMode: "batch_prepared",
  recipe: { yieldQty: 20, lines: [{ ingredientProductId: BASE, quantityBase: 5 }] },
  modifierGroups: [
    {
      id: "extras",
      label: "Extras",
      required: false,
      selectionMode: "multiple",
      options: [
        { id: "cheese", label: "Extra cheese", ingredientProductId: MOD, ingredientQtyBase: 0.05 },
        { id: "sauce", label: "Extra sauce", ingredientProductId: MOD2, ingredientQtyBase: 0.02 },
      ],
    },
  ],
};
const MENU_MTO = {
  productKind: "finished_menu",
  prepMode: "made_to_order",
  recipe: { yieldQty: 1, lines: [{ ingredientProductId: MTO_ING, quantityBase: 1 }] },
  modifierGroups: [],
};

function extractFn(file: string, name: string): string {
  const src = readFileSync(join(dir, file), "utf8");
  const needle = `create or replace function public.${name}`.toLowerCase();
  const start = src.toLowerCase().indexOf(needle);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  // Files use either `$$;` or `$function$;` as the body terminator.
  let end = -1;
  for (const terminator of ["$$;", "$function$;"]) {
    const i = src.indexOf(terminator, start);
    if (i >= 0 && (end < 0 || i + terminator.length < end)) end = i + terminator.length;
  }
  if (end < 0) throw new Error(`${name} body terminator not found in ${file}`);
  return src.slice(start, end);
}

async function baseDb(opts: { legacyServer?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema if not exists auth;
    create function auth.uid () returns uuid language sql as $$ select '99999999-9999-4999-8999-999999999999'::uuid $$;
    create function public.user_is_cashier_or_above (p uuid) returns boolean language sql as $$ select true $$;
    create function public.inventory_movement_uuid (s uuid, t text, r uuid, p uuid) returns uuid language sql immutable
      as $$ select md5 (s::text || '|' || t || '|' || r::text || '|' || p::text)::uuid $$;
    create table public.products (
      id uuid primary key, shop_id uuid, is_active boolean default true, stock_on_hand numeric(18,4) default 0,
      updated_at timestamptz default now(), metadata jsonb default '{}'::jsonb
    );
    create table public.sales (id uuid primary key, shop_id uuid, status text default 'completed', created_at timestamptz default now(), completed_at timestamptz);
    create table public.sale_line_items (
      id uuid primary key, sale_id uuid, product_id uuid, quantity numeric(18,4), metadata jsonb default '{}'::jsonb
    );
    create table public.sale_returns (
      id uuid primary key, shop_id uuid, sale_id uuid, product_id uuid, quantity numeric(18,4), refund_amount_ugx bigint,
      reason text default 'wrong_item', note text, created_by uuid, created_at timestamptz default now(),
      updated_at timestamptz default now(), metadata jsonb default '{}'::jsonb, stock_applied_at timestamptz
    );
    create table public.sale_voids (
      id uuid primary key, shop_id uuid, sale_id uuid, product_id uuid, quantity numeric, amount_ugx bigint check (amount_ugx > 0),
      line_index int, note text, sale_voided_at timestamptz, created_by uuid, created_at timestamptz default now(),
      updated_at timestamptz default now(), metadata jsonb default '{}'::jsonb
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

  // Durable reversal primitive (latest: no clamp) + bounded void guard.
  await db.exec(extractFn("20260925091000_durable_stock_delta_no_clamp_ledger_consistency.sql", "_apply_durable_stock_delta"));
  await db.exec(extractFn("20260919054011_sale_void_bounded_reversal_guard.sql", "shop_apply_sale_void_stock"));

  // Made-to-order helpers (and, for the legacy deployment-order test, the previous main functions).
  for (const [file, name] of [
    [R5, "_wk_try_uuid"],
    [R5, "_wk_recipe_provenance_struct"],
    [R5, "recipe_line_provenance"],
    [R5, "_wk_recipe_lines"],
    [R5, "_wk_recipe_line_reversed_qty"],
    [R5, "_wk_recipe_credit"],
    ...(opts.legacyServer
      ? ([
          [R5, "apply_sale_stock_movements"],
          [R5, "shop_apply_sale_void_line_stock"],
          [R5, "apply_sale_return_stock"],
        ] as const)
      : []),
  ] as const) {
    await db.exec(extractFn(file, name));
  }
  if (!opts.legacyServer) {
    await db.exec(readFileSync(join(dir, MIGRATION), "utf8"));
  }

  const row = (id: string, stock: number, menu?: unknown) =>
    `('${id}', '${SHOP}', ${stock}, '${JSON.stringify(menu ? { menu } : {})}'::jsonb)`;
  await db.exec(`
    insert into public.products (id, shop_id, stock_on_hand, metadata) values
      ${row(DISH, 100, MENU_BATCH)}, ${row(RETAIL, 50)}, ${row(MTO, 0, MENU_MTO)},
      ${row(BASE, 100)}, ${row(MOD, 10)}, ${row(MOD2, 10)}, ${row(MTO_ING, 100)};
  `);
  return db;
}

type Prov = Array<{ productId: string; quantity: number }>;

async function addSale(db: PGlite, saleId: string) {
  await db.query("insert into public.sales (id, shop_id) values ($1, $2)", [saleId, SHOP]);
}

async function addLine(
  db: PGlite,
  sale: string,
  id: number,
  product: string,
  qty: number,
  extra: Record<string, unknown> = {},
) {
  await db.query(
    "insert into public.sale_line_items (id, sale_id, product_id, quantity, metadata) values ($1,$2,$3,$4,$5::jsonb)",
    [u(id), sale, product, qty, JSON.stringify(extra)],
  );
}

async function batchLine(
  db: PGlite,
  sale: string,
  id: number,
  qty: number,
  prov: Prov,
  extra: Record<string, unknown> = {},
) {
  await addLine(db, sale, id, DISH, qty, {
    prepAllocation: [{ batchId: "b1", portions: qty }],
    ingredientConsumption: prov,
    ...extra,
  });
}

const q = async <T extends Record<string, unknown>>(db: PGlite, sql: string, args: unknown[] = []) =>
  (await db.query<T>(sql, args)).rows;
const stock = async (db: PGlite, id: string) =>
  Number((await q<{ s: string }>(db, "select stock_on_hand as s from public.products where id = $1", [id]))[0]!.s);
const moves = async (db: PGlite, type: string) =>
  q<{ product_id: string; quantity_delta: string; reference_id: string }>(
    db,
    "select product_id, quantity_delta, reference_id from public.inventory_movements where reference_type = $1 order by product_id",
    [type],
  );
const apply = (db: PGlite, sale: string) =>
  db.query<{ r: { ok: boolean; error?: string; stocks?: unknown[] } }>(
    "select public.apply_sale_stock_movements($1::uuid) as r",
    [sale],
  );
const lineMarker = async (db: PGlite, line: number, key: string) =>
  (await q<{ m: string | null }>(db, "select metadata ->> $2 as m from public.sale_line_items where id = $1", [u(line), key]))[0]!.m;

async function voidLine(
  db: PGlite,
  o: { voidId: number; sale: string; line: number; qty: number; amount?: number },
) {
  const r = await db.query<{ r: { ok: boolean; error?: string; idempotent?: boolean; stocks?: unknown[] } }>(
    "select public.shop_apply_sale_void_line_stock($1::uuid, $2::jsonb) as r",
    [
      SHOP,
      JSON.stringify({
        void_record_id: u(o.voidId),
        sale_id: o.sale,
        sale_line_id: u(o.line),
        delta: o.qty,
        amount_ugx: o.amount ?? 1_000,
        line_index: 0,
      }),
    ],
  );
  return r.rows[0]!.r;
}

async function addReturn(
  db: PGlite,
  o: { id: number; sale: string; line?: number; product: string; qty: number; reason?: string },
) {
  const meta = o.line ? { saleLineId: u(o.line) } : {};
  await db.query(
    "insert into public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason, metadata) values ($1,$2,$3,$4,$5,1000,$6,$7::jsonb)",
    [u(o.id), SHOP, o.sale, o.product, o.qty, o.reason ?? "wrong_item", JSON.stringify(meta)],
  );
  try {
    return await db.query("select public.apply_sale_return_stock($1::uuid)", [u(o.id)]);
  } catch (err) {
    await db.query("delete from public.sale_returns where id = $1", [u(o.id)]);
    throw err;
  }
}

describe("migration 20261020120000 — batch-prepared modifier sale application", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await baseDb();
  }, 90_000);
  afterAll(async () => db.close());

  it("deducts the prepared portion and modifier ingredient once, never the batch recipe", async () => {
    const S = u(100);
    await addSale(db, S);
    await batchLine(db, S, 200, 2, [{ productId: MOD, quantity: 0.1 }]);
    await addLine(db, S, 201, RETAIL, 1);

    const before = { dish: await stock(db, DISH), base: await stock(db, BASE), mod: await stock(db, MOD), retail: await stock(db, RETAIL) };
    await apply(db, S);

    expect(await stock(db, DISH)).toBe(before.dish - 2);
    expect(await stock(db, MOD)).toBeCloseTo(before.mod - 0.1, 4);
    expect(await stock(db, BASE)).toBe(before.base); // never consumed again at sale
    expect(await stock(db, RETAIL)).toBe(before.retail - 1);

    expect((await moves(db, "sale")).map((m) => [m.product_id, Number(m.quantity_delta)])).toEqual(
      expect.arrayContaining([
        [DISH, -2],
        [RETAIL, -1],
      ]),
    );
    expect((await moves(db, "batch_modifier")).map((m) => [m.product_id, Number(m.quantity_delta)])).toEqual([[MOD, -0.1]]);
    expect(await moves(db, "recipe")).toHaveLength(0); // base recipe untouched
    expect(await lineMarker(db, 200, "serverBatchModifierStockApplied")).toBe("true");
    expect(await lineMarker(db, 200, "serverRecipeStockApplied")).toBeNull();
  });

  it("is idempotent across repeated application (trigger + explicit + stale retry)", async () => {
    const S = u(100);
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD), base: await stock(db, BASE) };
    await apply(db, S);
    await apply(db, S);
    expect([await stock(db, DISH), await stock(db, MOD), await stock(db, BASE)]).toEqual([
      before.dish,
      before.mod,
      before.base,
    ]);
    expect(await moves(db, "batch_modifier")).toHaveLength(1);
  });

  it("aggregates the same modifier ingredient across several batch lines", async () => {
    const S = u(101);
    await addSale(db, S);
    await batchLine(db, S, 210, 1, [{ productId: MOD, quantity: 0.05 }]);
    await batchLine(db, S, 211, 1, [
      { productId: MOD, quantity: 0.05 },
      { productId: MOD2, quantity: 0.02 },
    ]);
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD), mod2: await stock(db, MOD2) };
    await apply(db, S);

    expect(await stock(db, DISH)).toBe(before.dish - 2);
    expect(await stock(db, MOD)).toBeCloseTo(before.mod - 0.1, 4);
    expect(await stock(db, MOD2)).toBeCloseTo(before.mod2 - 0.02, 4);
    const modMoves = (await moves(db, "batch_modifier")).filter((m) => m.reference_id === S);
    expect(modMoves.map((m) => [m.product_id, Number(m.quantity_delta)])).toEqual(
      expect.arrayContaining([
        [MOD, -0.1],
        [MOD2, -0.02],
      ]),
    );
    expect(await lineMarker(db, 210, "serverBatchModifierStockApplied")).toBe("true");
    expect(await lineMarker(db, 211, "serverBatchModifierStockApplied")).toBe("true");
  });

  it("rejects base-recipe provenance and safely falls back to the finished-product model", async () => {
    const S = u(102);
    await addSale(db, S);
    await batchLine(db, S, 220, 2, [{ productId: BASE, quantity: 5 }]);
    const before = { dish: await stock(db, DISH), base: await stock(db, BASE) };
    await apply(db, S);

    expect(await stock(db, DISH)).toBe(before.dish - 2); // identical to a plain batch line
    expect(await stock(db, BASE)).toBe(before.base);
    expect(await lineMarker(db, 220, "serverBatchModifierStockApplied")).toBeNull();
    expect((await moves(db, "batch_modifier")).some((m) => m.reference_id === S)).toBe(false);
  });

  it("rejects malformed provenance instead of guessing", async () => {
    const S = u(103);
    await addSale(db, S);
    await batchLine(db, S, 230, 1, [{ productId: MOD, quantity: -1 }]);
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD) };
    await apply(db, S);
    expect(await stock(db, DISH)).toBe(before.dish - 1);
    expect(await stock(db, MOD)).toBe(before.mod);
    expect(await lineMarker(db, 230, "serverBatchModifierStockApplied")).toBeNull();
  });

  it("an empty provenance still marks the line so a later reversal uses the combined model", async () => {
    const S = u(104);
    await addSale(db, S);
    await batchLine(db, S, 240, 1, []);
    const dishBefore = await stock(db, DISH);
    await apply(db, S);
    expect(await stock(db, DISH)).toBe(dishBefore - 1);
    expect(await lineMarker(db, 240, "serverBatchModifierStockApplied")).toBe("true");
    expect((await moves(db, "batch_modifier")).some((m) => m.reference_id === S)).toBe(false);
  });

  it("leaves a made-to-order recipe line on its original model", async () => {
    const S = u(105);
    await addSale(db, S);
    await addLine(db, S, 250, MTO, 2, { ingredientConsumption: [{ productId: MTO_ING, quantity: 2 }] });
    const before = { dish: await stock(db, MTO), ing: await stock(db, MTO_ING) };
    await apply(db, S);

    expect(await stock(db, MTO)).toBe(before.dish); // no finished dish
    expect(await stock(db, MTO_ING)).toBe(before.ing - 2);
    expect((await moves(db, "recipe")).some((m) => m.reference_id === S && m.product_id === MTO_ING)).toBe(true);
    expect(await lineMarker(db, 250, "serverRecipeStockApplied")).toBe("true");
    expect(await lineMarker(db, 250, "serverBatchModifierStockApplied")).toBeNull();
  });
});

describe("migration 20261020120000 — deployment-order safety", () => {
  it("a sale already applied by the previous function is never converted", async () => {
    const legacy = await baseDb({ legacyServer: true });
    const S = u(300);
    await addSale(legacy, S);
    // A batch line as the PREVIOUS client sent it: prepAllocation but no ingredientConsumption.
    await addLine(legacy, S, 300, DISH, 2, { prepAllocation: [{ batchId: "b1", portions: 2 }] });
    await legacy.query("select public.apply_sale_stock_movements($1::uuid)", [S]);
    expect(await stock(legacy, DISH)).toBe(98);
    expect(await stock(legacy, MOD)).toBe(10);
    expect(await lineMarker(legacy, 300, "serverBatchModifierStockApplied")).toBeNull();

    // Deploy the new migration and replay the same sale.
    await legacy.exec(readFileSync(join(dir, MIGRATION), "utf8"));
    await legacy.query("select public.apply_sale_stock_movements($1::uuid)", [S]);
    expect(await stock(legacy, DISH)).toBe(98); // no second deduction
    expect(await stock(legacy, MOD)).toBe(10); // no retroactive modifier deduction
    expect(await moves(legacy, "batch_modifier")).toHaveLength(0);
    await legacy.close();
  }, 90_000);

  it("a batch line the previous function marked as made-to-order is not reclassified", async () => {
    const legacy = await baseDb({ legacyServer: true });
    const S = u(301);
    await addSale(legacy, S);
    await batchLine(legacy, S, 310, 2, [{ productId: MOD, quantity: 0.1 }]);
    // The previous function classifies any valid provenance as made-to-order.
    await legacy.query("select public.apply_sale_stock_movements($1::uuid)", [S]);
    expect(await stock(legacy, DISH)).toBe(100); // dish not deducted by the old model
    expect(await stock(legacy, MOD)).toBe(9.9);
    expect(await lineMarker(legacy, 310, "serverRecipeStockApplied")).toBe("true");

    await legacy.exec(readFileSync(join(dir, MIGRATION), "utf8"));
    const dishBefore = await stock(legacy, DISH);
    const modBefore = await stock(legacy, MOD);
    await legacy.query("select public.apply_sale_stock_movements($1::uuid)", [S]);
    expect(await stock(legacy, DISH)).toBe(dishBefore);
    expect(await stock(legacy, MOD)).toBe(modBefore);
    expect(await lineMarker(legacy, 310, "serverBatchModifierStockApplied")).toBeNull();
    await legacy.close();
  }, 90_000);
});

describe("migration 20261020120000 — batch-prepared modifier voids", () => {
  let db: PGlite;
  const S = u(400);
  beforeAll(async () => {
    db = await baseDb();
    await addSale(db, S);
    await batchLine(db, S, 400, 4, [{ productId: MOD, quantity: 0.2 }]);
    await apply(db, S);
  }, 90_000);
  afterAll(async () => db.close());

  it("credits the prepared portion and the modifier ingredient proportionally", async () => {
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD), base: await stock(db, BASE) };
    const r = await voidLine(db, { voidId: 500, sale: S, line: 400, qty: 1 });
    expect(r).toMatchObject({ ok: true, idempotent: false });
    expect(await stock(db, DISH)).toBe(before.dish + 1);
    expect(await stock(db, MOD)).toBeCloseTo(before.mod + 0.05, 4);
    expect(await stock(db, BASE)).toBe(before.base);
    const ledger = await q<{ product_id: string; metadata: { saleLineId: string } }>(
      db,
      "select product_id, metadata from public.sale_voids where id = $1",
      [u(500)],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.product_id).toBe(DISH);
    expect(ledger[0]!.metadata.saleLineId).toBe(u(400));
  });

  it("acknowledges a replay and credits nothing", async () => {
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD) };
    const r = await voidLine(db, { voidId: 500, sale: S, line: 400, qty: 1 });
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect([await stock(db, DISH), await stock(db, MOD)]).toEqual([before.dish, before.mod]);
    expect(await q(db, "select 1 from public.sale_voids where sale_id = $1", [S])).toHaveLength(1);
  });

  it("cannot reverse more than the line consumed", async () => {
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD) };
    const r = await voidLine(db, { voidId: 501, sale: S, line: 400, qty: 4 });
    expect(r).toMatchObject({ ok: false, error: "void_exceeds_line" });
    expect([await stock(db, DISH), await stock(db, MOD)]).toEqual([before.dish, before.mod]);
  });

  it("the remainder reverses exactly the rest (modifier included)", async () => {
    expect((await voidLine(db, { voidId: 502, sale: S, line: 400, qty: 3 })).ok).toBe(true);
    expect(await stock(db, DISH)).toBe(100);
    expect(await stock(db, MOD)).toBe(10);
    expect(await stock(db, BASE)).toBe(100);
    expect(await voidLine(db, { voidId: 503, sale: S, line: 400, qty: 1 })).toMatchObject({
      ok: false,
      error: "void_exceeds_line",
    });
  });

  it("a plain batch line (no marker) still uses the previous void model", async () => {
    const S2 = u(401);
    await addSale(db, S2);
    await addLine(db, S2, 410, DISH, 2, { prepAllocation: [{ batchId: "b1", portions: 2 }] });
    await apply(db, S2);
    const dishBefore = await stock(db, DISH);
    const modBefore = await stock(db, MOD);
    const r = await voidLine(db, { voidId: 510, sale: S2, line: 410, qty: 2 });
    expect(r.ok).toBe(true);
    expect(await stock(db, DISH)).toBe(dishBefore + 2);
    expect(await stock(db, MOD)).toBe(modBefore);
  });
});

describe("migration 20261020120000 — batch-prepared modifier returns", () => {
  let db: PGlite;
  const S = u(600);
  beforeAll(async () => {
    db = await baseDb();
    await addSale(db, S);
    await batchLine(db, S, 600, 4, [{ productId: MOD, quantity: 0.2 }]);
    await apply(db, S);
  }, 90_000);
  afterAll(async () => db.close());

  it("credits the prepared portion and the modifier ingredient proportionally", async () => {
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD), base: await stock(db, BASE) };
    await addReturn(db, { id: 700, sale: S, line: 600, product: DISH, qty: 1 });
    expect(await stock(db, DISH)).toBe(before.dish + 1);
    expect(await stock(db, MOD)).toBeCloseTo(before.mod + 0.05, 4);
    expect(await stock(db, BASE)).toBe(before.base);
  });

  it("a replay (even with stock_applied_at lost) credits nothing", async () => {
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD) };
    await db.query("update public.sale_returns set stock_applied_at = null where id = $1", [u(700)]);
    await db.query("select public.apply_sale_return_stock($1::uuid)", [u(700)]);
    expect([await stock(db, DISH), await stock(db, MOD)]).toEqual([before.dish, before.mod]);
  });

  it("bounded: returning more than the line has left is refused", async () => {
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD) };
    await expect(addReturn(db, { id: 701, sale: S, line: 600, product: DISH, qty: 4 })).rejects.toThrow(/return_exceeds_line/);
    expect([await stock(db, DISH), await stock(db, MOD)]).toEqual([before.dish, before.mod]);
  });

  it("the remainder returns exactly the rest", async () => {
    await addReturn(db, { id: 702, sale: S, line: 600, product: DISH, qty: 3 });
    expect(await stock(db, DISH)).toBe(100);
    expect(await stock(db, MOD)).toBe(10);
    expect(await stock(db, BASE)).toBe(100);
  });

  it("an unsellable reason restocks neither the portion nor the ingredient", async () => {
    const S2 = u(601);
    await addSale(db, S2);
    await batchLine(db, S2, 610, 2, [{ productId: MOD, quantity: 0.1 }]);
    await apply(db, S2);
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD) };
    await addReturn(db, { id: 710, sale: S2, line: 610, product: DISH, qty: 1, reason: "damaged" });
    expect([await stock(db, DISH), await stock(db, MOD)]).toEqual([before.dish, before.mod]);
  });

  it("a legacy return without a line id resolves the only line", async () => {
    const S2 = u(602);
    await addSale(db, S2);
    await batchLine(db, S2, 620, 2, [{ productId: MOD, quantity: 0.1 }]);
    await apply(db, S2);
    const before = { dish: await stock(db, DISH), mod: await stock(db, MOD) };
    await addReturn(db, { id: 720, sale: S2, product: DISH, qty: 1 });
    expect(await stock(db, DISH)).toBe(before.dish + 1);
    expect(await stock(db, MOD)).toBeCloseTo(before.mod + 0.05, 4);
  });

  it("an ambiguous legacy return across two batch lines is refused", async () => {
    const S2 = u(603);
    await addSale(db, S2);
    await batchLine(db, S2, 630, 1, [{ productId: MOD, quantity: 0.05 }]);
    await batchLine(db, S2, 631, 1, [{ productId: MOD, quantity: 0.05 }]);
    await apply(db, S2);
    await expect(addReturn(db, { id: 730, sale: S2, product: DISH, qty: 1 })).rejects.toThrow(/return_line_required/);
  });

  it("fractional modifier quantities never drift across single-unit returns", async () => {
    const S2 = u(604);
    await addSale(db, S2);
    await batchLine(db, S2, 640, 3, [{ productId: MOD, quantity: 0.9999 }]);
    const modBefore = await stock(db, MOD);
    await apply(db, S2);
    expect(await stock(db, MOD)).toBeCloseTo(modBefore - 0.9999, 4);
    for (const id of [740, 741, 742]) {
      await addReturn(db, { id, sale: S2, line: 640, product: DISH, qty: 1 });
    }
    expect(await stock(db, MOD)).toBeCloseTo(modBefore, 4);
  });
});
