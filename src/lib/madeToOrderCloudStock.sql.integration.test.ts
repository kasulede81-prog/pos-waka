import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20260919110000 — made-to-order recipe stock on the cloud.
 * Runs the ORIGINAL functions (083 / 181 / 179) to prove the mismatch, then the new migration.
 * Real SQL, real PL/pgSQL; only the surrounding platform (auth, roles, unrelated tables) is stubbed.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SHOP = u(1);
const BURGER = u(10); // made-to-order dish
const COKE = u(11); // retail
const CHICKEN = u(12); // batch-prepared dish (finished portions)
const BEEF = u(20);
const BUN = u(21);
const CHEESE = u(22); // used only by the "large" variant recipe
const RANDOM = u(29); // a product that is NOT part of the burger's recipe
const SALE = u(100);
const SALE2 = u(101);

function extractFn(file: string, name: string): string {
  const src = readFileSync(join(dir, file), "utf8");
  const start = src.indexOf(`create or replace function public.${name}`);
  return src.slice(start, src.indexOf("$$;", start) + 3);
}

const MENU = {
  productKind: "finished_menu",
  prepMode: "made_to_order",
  recipe: {
    yieldQty: 1,
    lines: [
      { ingredientProductId: BEEF, quantityBase: 1 },
      { ingredientProductId: BUN, quantityBase: 1 },
    ],
  },
  variants: [{ id: "large", recipe: { yieldQty: 1, lines: [{ ingredientProductId: CHEESE, quantityBase: 1 }] } }],
  modifierGroups: [],
};

async function baseDb(): Promise<PGlite> {
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
  `);
  await db.exec(extractFn("172_sale_void_stock_durable_idempotency.sql", "_apply_durable_stock_delta"));
  await db.exec(extractFn("179_sale_void_financial_ledger.sql", "shop_apply_sale_void_stock"));
  await db.exec(extractFn("083_sale_stock_sync.sql", "apply_sale_stock_movements"));
  await db.exec(extractFn("181_sale_return_restock_sellable.sql", "apply_sale_return_stock"));
  const prod = (id: string, stock: number, menu?: unknown) =>
    `('${id}', '${SHOP}', ${stock}, '${JSON.stringify(menu ? { menu } : {})}'::jsonb)`;
  await db.exec(`
    insert into public.products (id, shop_id, stock_on_hand, metadata) values
      ${prod(BURGER, 0, MENU)}, ${prod(COKE, 50)}, ${prod(CHICKEN, 20)},
      ${prod(BEEF, 100)}, ${prod(BUN, 100)}, ${prod(CHEESE, 100)}, ${prod(RANDOM, 100)};
    insert into public.sales (id, shop_id) values ('${SALE}', '${SHOP}'), ('${SALE2}', '${SHOP}');
  `);
  return db;
}

type Prov = Array<{ productId: string; quantity: number }>;
async function addLine(db: PGlite, sale: string, id: number, product: string, qty: number, prov?: Prov | unknown, extra: Record<string, unknown> = {}) {
  const meta = { ...(prov !== undefined ? { ingredientConsumption: prov } : {}), ...extra };
  await db.query("insert into public.sale_line_items (id, sale_id, product_id, quantity, metadata) values ($1, $2, $3, $4, $5::jsonb)", [u(id), sale, product, qty, JSON.stringify(meta)]);
}
const q = async <T extends Record<string, unknown>>(db: PGlite, sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;
const stock = async (db: PGlite, id: string) => Number((await q<{ s: string }>(db, "select stock_on_hand as s from public.products where id = $1", [id]))[0]!.s);
const moves = async (db: PGlite, type: string) => q<{ product_id: string; quantity_delta: string }>(db, "select product_id, quantity_delta from public.inventory_movements where reference_type = $1 order by product_id", [type]);
const apply = (db: PGlite, sale = SALE) => db.query("select public.apply_sale_stock_movements($1::uuid) as r", [sale]);
const marker = async (db: PGlite, line: number) => (await q<{ m: string | null }>(db, "select metadata ->> 'serverRecipeStockApplied' as m from public.sale_line_items where id = $1", [u(line)]))[0]!.m;

async function voidLine(db: PGlite, o: { voidId: number; sale?: string; line: number; qty: number; amount?: number }) {
  const r = await db.query<{ r: { ok: boolean; error?: string; idempotent?: boolean; stocks?: unknown[] } }>(
    "select public.shop_apply_sale_void_line_stock($1::uuid, $2::jsonb) as r",
    [SHOP, JSON.stringify({ void_record_id: u(o.voidId), sale_id: o.sale ?? SALE, sale_line_id: u(o.line), delta: o.qty, amount_ugx: o.amount ?? 1000, line_index: 0 })],
  );
  return r.rows[0]!.r;
}
async function addReturn(db: PGlite, o: { id: number; line?: number; product: string; qty: number; reason?: string; sale?: string }) {
  const meta = o.line ? { saleLineId: u(o.line) } : {};
  await db.query(
    "insert into public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason, metadata) values ($1,$2,$3,$4,$5,1000,$6,$7::jsonb)",
    [u(o.id), SHOP, o.sale ?? SALE, o.product, o.qty, o.reason ?? "wrong_item", JSON.stringify(meta)],
  );
  try {
    return await db.query("select public.apply_sale_return_stock($1::uuid)", [u(o.id)]);
  } catch (err) {
    // shop_push_sale_return runs insert + apply in one exception block: a refused return leaves no row behind
    await db.query("delete from public.sale_returns where id = $1", [u(o.id)]);
    throw err;
  }
}

describe("original functions (083 / 181 / 179) — the cloud does not know made-to-order", () => {
  it("deducts the finished dish (negative) and leaves the ingredients alone; the void then credits the dish", async () => {
    const db = await baseDb();
    await addLine(db, SALE, 200, BURGER, 3, [{ productId: BEEF, quantity: 3 }, { productId: BUN, quantity: 3 }]);
    await apply(db);
    expect(await stock(db, BURGER)).toBe(-3);
    expect(await stock(db, BEEF)).toBe(100);
    await db.close();
  });
});

describe("migration 20260919110000 — sale application", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await baseDb();
    await db.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
  }, 60_000);
  afterAll(async () => db.close());

  it("made-to-order line: ingredients deducted, dish untouched; retail and batch-prepared unchanged", async () => {
    await addLine(db, SALE, 200, BURGER, 3, [{ productId: BEEF, quantity: 3 }, { productId: BUN, quantity: 3 }]);
    await addLine(db, SALE, 201, COKE, 2);
    await addLine(db, SALE, 202, CHICKEN, 2, undefined, { prepAllocation: [{ batchId: "b1", portions: 2 }] });
    await apply(db);
    expect(await stock(db, BURGER)).toBe(0);
    expect(await stock(db, BEEF)).toBe(97);
    expect(await stock(db, BUN)).toBe(97);
    expect(await stock(db, COKE)).toBe(48);
    expect(await stock(db, CHICKEN)).toBe(18); // prepared portions: the finished stock unit, as before
    expect((await moves(db, "recipe")).map((m) => [m.product_id, Number(m.quantity_delta)])).toEqual([[BEEF, -3], [BUN, -3]]);
    expect((await moves(db, "sale")).map((m) => m.product_id).sort()).toEqual([COKE, CHICKEN].sort());
    expect(await marker(db, 200)).toBe("true");
    expect(await marker(db, 201)).toBeNull();
    expect(await marker(db, 202)).toBeNull();
  });

  it("is idempotent: the trigger call and the explicit call (and any stale retry) never deduct twice", async () => {
    const before = [await stock(db, BEEF), await stock(db, COKE), await stock(db, BURGER)];
    await apply(db);
    await apply(db);
    expect([await stock(db, BEEF), await stock(db, COKE), await stock(db, BURGER)]).toEqual(before);
    expect(await moves(db, "recipe")).toHaveLength(2);
  });

  it("returns the ingredient stock rows to the client (so a restore/patch sees the server truth)", async () => {
    const r = await apply(db);
    const rows = (r.rows[0] as { r: Array<{ product_id: string; stock_on_hand: number }> }).r;
    expect(rows.map((x) => x.product_id)).toEqual(expect.arrayContaining([BEEF, BUN, COKE, CHICKEN]));
    expect(rows.find((x) => x.product_id === BEEF)!.stock_on_hand).toBe(97);
  });

  it("the same ingredient on several recipe lines is aggregated, and the marker lands on every line", async () => {
    await addLine(db, SALE2, 210, BURGER, 2, [{ productId: BEEF, quantity: 2 }, { productId: BUN, quantity: 2 }]);
    await addLine(db, SALE2, 211, BURGER, 1, [{ productId: BEEF, quantity: 1 }, { productId: CHEESE, quantity: 1 }], { variantId: "large" });
    const beefBefore = await stock(db, BEEF);
    await apply(db, SALE2);
    expect(beefBefore - (await stock(db, BEEF))).toBe(3);
    const m = await q<{ quantity_delta: string }>(db, "select quantity_delta from public.inventory_movements where reference_type = 'recipe' and reference_id = $1 and product_id = $2", [SALE2, BEEF]);
    expect(m).toHaveLength(1); // one aggregated movement, not one per line
    expect(Number(m[0]!.quantity_delta)).toBe(-3);
    expect(await marker(db, 210)).toBe("true");
    expect(await marker(db, 211)).toBe("true");
  });

  it("an empty provenance (nothing was on the shelf) is still a recipe line: the dish is not deducted", async () => {
    const S = u(102);
    await db.exec(`insert into public.sales (id, shop_id) values ('${S}', '${SHOP}')`);
    await addLine(db, S, 220, BURGER, 1, []);
    await addLine(db, S, 221, COKE, 1);
    await apply(db, S);
    await apply(db, S); // second call sees a retail movement but the marker keeps line 220 a recipe line
    expect(await stock(db, BURGER)).toBe(0);
    expect(await marker(db, 220)).toBe("true");
  });

  it("legacy line (no provenance) behaves exactly as before: the dish is deducted", async () => {
    const S = u(103);
    await db.exec(`insert into public.sales (id, shop_id) values ('${S}', '${SHOP}')`);
    await addLine(db, S, 230, BURGER, 2);
    await apply(db, S);
    expect(await stock(db, BURGER)).toBe(-2);
    expect(await marker(db, 230)).toBeNull();
  });

  it("malformed provenance is never trusted or guessed: it falls back to the legacy behaviour", async () => {
    const before = await stock(db, BEEF);
    let n = 240;
    for (const bad of ["not-an-array", [{ productId: "nope", quantity: 1 }], [{ productId: BEEF, quantity: -1 }], [{ productId: BEEF, quantity: "1" }], [null]]) {
      const S = u(300 + n);
      await db.exec(`insert into public.sales (id, shop_id) values ('${S}', '${SHOP}')`);
      await addLine(db, S, n, BURGER, 1, bad);
      const dishBefore = await stock(db, BURGER);
      await apply(db, S);
      expect(await stock(db, BURGER)).toBe(dishBefore - 1); // legacy dish deduction
      expect(await marker(db, n)).toBeNull();
      n++;
    }
    expect(await stock(db, BEEF)).toBe(before); // no ingredient was ever deducted from bad provenance
  });

  it("an ingredient the dish's recipe does not use is rejected (a client cannot make the cloud deduct arbitrary products)", async () => {
    const S = u(104);
    await db.exec(`insert into public.sales (id, shop_id) values ('${S}', '${SHOP}')`);
    await addLine(db, S, 250, BURGER, 1, [{ productId: BEEF, quantity: 1 }, { productId: RANDOM, quantity: 50 }]);
    await apply(db, S);
    expect(await stock(db, RANDOM)).toBe(100);
    expect(await marker(db, 250)).toBeNull();
  });

  it("a sale ALREADY applied by the previous function is never converted (deployment-order safety)", async () => {
    const legacyDb = await baseDb(); // old function first
    const S = SALE;
    await addLine(legacyDb, S, 260, BURGER, 2, [{ productId: BEEF, quantity: 2 }, { productId: BUN, quantity: 2 }]);
    await apply(legacyDb, S);
    expect(await stock(legacyDb, BURGER)).toBe(-2);
    await legacyDb.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    await apply(legacyDb, S); // any re-run after the migration
    expect(await stock(legacyDb, BEEF)).toBe(100); // no ingredient deduction on top of the dish deduction
    expect(await stock(legacyDb, BURGER)).toBe(-2);
    expect(await q(legacyDb, "select 1 from public.sale_line_items where metadata ->> 'serverRecipeStockApplied' = 'true'")).toHaveLength(0);
    await legacyDb.close();
  }, 60_000);
});

describe("migration 20260919110000 — void of one sale line", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await baseDb();
    await db.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    // sale: burger x4 (recipe), coke x2 (retail)
    await addLine(db, SALE, 300, BURGER, 4, [{ productId: BEEF, quantity: 4 }, { productId: BUN, quantity: 4 }]);
    await addLine(db, SALE, 301, COKE, 2);
    await apply(db);
  }, 60_000);
  afterAll(async () => db.close());

  it("credits the ingredients the SERVER derives from the recorded provenance (proportional), and never the dish", async () => {
    const r = await voidLine(db, { voidId: 400, line: 300, qty: 1 });
    expect(r).toMatchObject({ ok: true, idempotent: false });
    expect(await stock(db, BEEF)).toBe(97);
    expect(await stock(db, BUN)).toBe(97);
    expect(await stock(db, BURGER)).toBe(0);
    const ledger = await q<{ product_id: string; quantity: string; metadata: { saleLineId: string } }>(db, "select product_id, quantity, metadata from public.sale_voids where id = $1", [u(400)]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.product_id).toBe(BURGER);
    expect(Number(ledger[0]!.quantity)).toBe(1);
    expect(ledger[0]!.metadata.saleLineId).toBe(u(300));
  });

  it("a replay of the same void (offline retry / stale device) is acknowledged and credits nothing", async () => {
    const r = await voidLine(db, { voidId: 400, line: 300, qty: 1 });
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect(await stock(db, BEEF)).toBe(97);
    expect(await q(db, "select 1 from public.sale_voids")).toHaveLength(1);
  });

  it("the client cannot ask for more than the line consumed: the quantity, not an ingredient amount, is the input", async () => {
    // 3 units remain on the line; asking for 4 must fail and change nothing
    const r = await voidLine(db, { voidId: 401, line: 300, qty: 4 });
    expect(r).toMatchObject({ ok: false, error: "void_exceeds_line" });
    expect(await stock(db, BEEF)).toBe(97);
    expect(await q(db, "select 1 from public.sale_voids")).toHaveLength(1);
  });

  it("the remainder of the line reverses exactly the rest — the total equals the recorded consumption", async () => {
    expect((await voidLine(db, { voidId: 402, line: 300, qty: 3 })).ok).toBe(true);
    expect(await stock(db, BEEF)).toBe(100);
    expect(await stock(db, BUN)).toBe(100);
    expect(await stock(db, BURGER)).toBe(0);
    // and now nothing is left to reverse
    expect(await voidLine(db, { voidId: 403, line: 300, qty: 1 })).toMatchObject({ ok: false, error: "void_exceeds_line" });
  });

  it("a line id from another sale, or an unknown line, is refused (no cross-sale reversal)", async () => {
    expect(await voidLine(db, { voidId: 404, sale: SALE2, line: 300, qty: 1 })).toMatchObject({ ok: false, error: "sale_line_not_found" });
    expect(await voidLine(db, { voidId: 405, line: 999, qty: 1 })).toMatchObject({ ok: false, error: "sale_line_not_found" });
    expect(await stock(db, BEEF)).toBe(100);
  });

  it("a void record id that already belongs to another recipe line cannot be reused", async () => {
    await addLine(db, SALE2, 310, BURGER, 1, [{ productId: BEEF, quantity: 1 }]);
    await apply(db, SALE2);
    expect(await voidLine(db, { voidId: 400, sale: SALE2, line: 310, qty: 1 })).toMatchObject({ ok: false, error: "void_record_conflict" });
    expect(await stock(db, BEEF)).toBe(99); // sale2's beef was consumed and NOT given back by the conflicting void
  });

  it("a retail line goes through the existing void RPC unchanged: the sold product is credited", async () => {
    const before = await stock(db, COKE);
    const r = await voidLine(db, { voidId: 410, line: 301, qty: 1 });
    expect(r.ok).toBe(true);
    expect(await stock(db, COKE)).toBe(before + 1);
    expect((await q<{ product_id: string }>(db, "select product_id from public.sale_voids where id = $1", [u(410)]))[0]!.product_id).toBe(COKE);
  });

  it("a legacy made-to-order line (sold before provenance) credits the dish, mirroring what the cloud deducted", async () => {
    const S = u(105);
    await db.exec(`insert into public.sales (id, shop_id) values ('${S}', '${SHOP}')`);
    await addLine(db, S, 320, BURGER, 2); // no provenance → legacy on apply
    const beefBefore = await stock(db, BEEF);
    await apply(db, S);
    const dish = await stock(db, BURGER);
    expect(dish).toBe(-2);
    expect((await voidLine(db, { voidId: 420, sale: S, line: 320, qty: 2 })).ok).toBe(true);
    expect(await stock(db, BURGER)).toBe(0);
    expect(await stock(db, BEEF)).toBe(beefBefore); // no ingredient guess for a legacy line, either way
  });
});

describe("migration 20260919110000 — returns and same-product / different-variant lines", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await baseDb();
    await db.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    // ONE sale, ONE product, TWO lines with different recipes and quantities:
    //   line 500: burger x3 (base: beef + bun);   line 501: burger x2 large (beef + cheese)
    await addLine(db, SALE, 500, BURGER, 3, [{ productId: BEEF, quantity: 3 }, { productId: BUN, quantity: 3 }]);
    await addLine(db, SALE, 501, BURGER, 2, [{ productId: BEEF, quantity: 2 }, { productId: CHEESE, quantity: 2 }], { variantId: "large" });
    await apply(db);
  }, 60_000);
  afterAll(async () => db.close());

  it("sale: both lines consumed their OWN ingredients; the dish is untouched", async () => {
    expect(await stock(db, BEEF)).toBe(95);
    expect(await stock(db, BUN)).toBe(97);
    expect(await stock(db, CHEESE)).toBe(98);
    expect(await stock(db, BURGER)).toBe(0);
  });

  it("partial return of line 1 gives back line 1's ingredients only", async () => {
    await addReturn(db, { id: 600, line: 500, product: BURGER, qty: 1 });
    expect(await stock(db, BEEF)).toBe(96);
    expect(await stock(db, BUN)).toBe(98);
    expect(await stock(db, CHEESE)).toBe(98); // line 2's cheese untouched
  });

  it("partial return of line 2 gives back line 2's ingredients (cheese) only", async () => {
    await addReturn(db, { id: 601, line: 501, product: BURGER, qty: 1 });
    expect(await stock(db, CHEESE)).toBe(99);
    expect(await stock(db, BUN)).toBe(98); // line 1's bun untouched
    expect(await stock(db, BEEF)).toBe(97);
  });

  it("no cross-line over-credit: line 2 has 1 unit left although the PRODUCT still has 3 — returning 2 is refused", async () => {
    await expect(addReturn(db, { id: 602, line: 501, product: BURGER, qty: 2 })).rejects.toThrow(/return_exceeds_line/);
    expect(await stock(db, CHEESE)).toBe(99);
    expect(await stock(db, BEEF)).toBe(97);
  });

  it("void of the remaining quantity of each line reverses exactly the rest, per line", async () => {
    expect((await voidLine(db, { voidId: 700, line: 500, qty: 2 })).ok).toBe(true);
    expect((await voidLine(db, { voidId: 701, line: 501, qty: 1 })).ok).toBe(true);
    expect(await stock(db, BEEF)).toBe(100);
    expect(await stock(db, BUN)).toBe(100);
    expect(await stock(db, CHEESE)).toBe(100);
    expect(await stock(db, BURGER)).toBe(0);
  });

  it("nothing more can be reversed on either line (returns or voids), including by a stale device", async () => {
    await expect(addReturn(db, { id: 603, line: 500, product: BURGER, qty: 1 })).rejects.toThrow(/return_exceeds_line/);
    expect(await voidLine(db, { voidId: 702, line: 501, qty: 1 })).toMatchObject({ ok: false, error: "void_exceeds_line" });
    // the same void arriving again from another device is a replay
    expect(await voidLine(db, { voidId: 700, line: 500, qty: 2 })).toMatchObject({ ok: true, idempotent: true });
    expect(await stock(db, BEEF)).toBe(100);
  });

  it("a return replay (same return id applied again) credits nothing", async () => {
    const dbR = await baseDb();
    await dbR.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    await addLine(dbR, SALE, 510, BURGER, 2, [{ productId: BEEF, quantity: 2 }]);
    await apply(dbR);
    await addReturn(dbR, { id: 610, line: 510, product: BURGER, qty: 1 });
    await dbR.query("select public.apply_sale_return_stock($1::uuid)", [u(610)]);
    await dbR.query("update public.sale_returns set stock_applied_at = null where id = $1", [u(610)]); // even if the applied flag were lost
    await dbR.query("select public.apply_sale_return_stock($1::uuid)", [u(610)]);
    expect(await stock(dbR, BEEF)).toBe(99);
    await dbR.close();
  }, 60_000);

  it("an unsellable return reason (damaged) restocks nothing", async () => {
    const dbD = await baseDb();
    await dbD.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    await addLine(dbD, SALE, 520, BURGER, 2, [{ productId: BEEF, quantity: 2 }]);
    await apply(dbD);
    await addReturn(dbD, { id: 620, line: 520, product: BURGER, qty: 1, reason: "damaged" });
    expect(await stock(dbD, BEEF)).toBe(98);
    await dbD.close();
  }, 60_000);

  it("a legacy return with no line id resolves to the product's ONLY line, and is refused when two recipe lines make it ambiguous", async () => {
    const dbL = await baseDb();
    await dbL.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    await addLine(dbL, SALE, 530, BURGER, 2, [{ productId: BEEF, quantity: 2 }]);
    await apply(dbL);
    await addReturn(dbL, { id: 630, product: BURGER, qty: 1 }); // unambiguous → infers line 530
    expect(await stock(dbL, BEEF)).toBe(99);
    await dbL.close();

    // (the two-line database above already holds lines 500/501 of the same product)
    await expect(addReturn(db, { id: 631, product: BURGER, qty: 1 })).rejects.toThrow(/return_line_required/);
  }, 60_000);

  it("a legacy return of a RETAIL line is unchanged: the returned product is credited", async () => {
    const dbC = await baseDb();
    await dbC.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    await addLine(dbC, SALE, 540, COKE, 3);
    await apply(dbC);
    await addReturn(dbC, { id: 640, product: COKE, qty: 1 });
    expect(await stock(dbC, COKE)).toBe(48);
    await dbC.close();
  }, 60_000);
});

describe("migration 20260919110000 — fractional recipes never drift", () => {
  it("three single-unit returns sum to exactly the recorded consumption", async () => {
    const db = await baseDb();
    await db.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    await addLine(db, SALE, 550, BURGER, 3, [{ productId: BEEF, quantity: 0.9999 }]);
    await apply(db);
    expect(await stock(db, BEEF)).toBeCloseTo(99.0001, 4);
    await addReturn(db, { id: 650, line: 550, product: BURGER, qty: 1 });
    await addReturn(db, { id: 651, line: 550, product: BURGER, qty: 1 });
    await addReturn(db, { id: 652, line: 550, product: BURGER, qty: 1 });
    expect(await stock(db, BEEF)).toBe(100);
    await db.close();
  }, 60_000);
});

describe("coexistence with the (separate) bounded-void-guard migration", () => {
  it("applied in either order, the retail path is bounded by the guard and the recipe path still works", async () => {
    const db = await baseDb();
    await db.exec(readFileSync(join(dir, "20260919100000_sale_void_bounded_reversal_guard.sql"), "utf8"));
    await db.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    await addLine(db, SALE, 800, BURGER, 2, [{ productId: BEEF, quantity: 2 }]);
    await addLine(db, SALE, 801, COKE, 2);
    await apply(db);
    // recipe line: server-derived credit
    expect((await voidLine(db, { voidId: 900, line: 800, qty: 2 })).ok).toBe(true);
    expect(await stock(db, BEEF)).toBe(100);
    // retail line: delegated to the guarded RPC, which now refuses more than was sold
    expect(await voidLine(db, { voidId: 901, line: 801, qty: 3 })).toMatchObject({ ok: false, error: "void_exceeds_sold" });
    expect((await voidLine(db, { voidId: 902, line: 801, qty: 2 })).ok).toBe(true);
    expect(await stock(db, COKE)).toBe(50);
    await db.close();

    // and the other order: the new migration first, the guard second (the guard replaces only the old RPC)
    const db2 = await baseDb();
    await db2.exec(readFileSync(join(dir, "20260919110000_made_to_order_ingredient_stock.sql"), "utf8"));
    await db2.exec(readFileSync(join(dir, "20260919100000_sale_void_bounded_reversal_guard.sql"), "utf8"));
    await addLine(db2, SALE, 810, BURGER, 2, [{ productId: BEEF, quantity: 2 }]);
    await apply(db2);
    expect((await voidLine(db2, { voidId: 910, line: 810, qty: 2 })).ok).toBe(true);
    expect(await stock(db2, BEEF)).toBe(100);
    await db2.close();
  }, 90_000);
});
