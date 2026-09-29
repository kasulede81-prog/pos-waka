import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * WPL backfill against a database that ALREADY HAS loyalty programmes.
 *
 * WHY THIS FILE EXISTS — a production escape
 * ------------------------------------------
 * The first production attempt of `20260928120000_loyalty_program_public_code.sql` FAILED:
 *
 *   ERROR: check constraint "loyalty_programs_public_code_shape_chk" of relation
 *          "loyalty_programs" is violated by some row (SQLSTATE 23514)
 *
 * The migration added the public_code shape CHECK *before* the backfill. A PostgreSQL CHECK rejects
 * a row whose expression is FALSE, and `is_waka_loyalty_program_code` returns false — not NULL — for
 * a NULL input, because it coalesces to '' first. So every pre-existing row (public_code still NULL)
 * violated the constraint and the whole migration rolled back.
 *
 * The ordinary harness could never have caught it: `createLoyaltySqlHarness` applies the migrations
 * to an EMPTY `loyalty_programs` table and the fixtures are seeded afterwards, so the constraint was
 * always validated against zero rows. Production has three. This file builds the database the way
 * production actually is — migrations applied up to the WPL one, rows present, THEN the migration —
 * so the ordering is pinned by a test rather than by hope.
 *
 * The sibling file `loyaltyProgramCode.sql.integration.test.ts` keeps covering the other direction:
 * a fresh, empty database. Both shapes matter; only the pair covers what production does.
 */

const MIGRATION_120000 = "20260928120000_loyalty_program_public_code.sql";
const WPL_MIGRATIONS = [
  MIGRATION_120000,
  "20260928121000_loyalty_program_code_resolution.sql",
  "20260928122000_loyalty_program_code_admin_merchant.sql",
];

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "loyaltyBootstrap.sql");
const readSql = (p: string) => readFileSync(p, "utf8");
const migrationPath = (name: string) => join(process.cwd(), "supabase", "migrations", name);

/** Everything the real chain applies BEFORE the WPL migrations, in order. */
const PRE_WPL_MIGRATIONS = MIGRATIONS.filter((m) => !WPL_MIGRATIONS.some((w) => m.endsWith(w)));

let db: PGlite;
let orgId = "";
let shopIds: string[] = [];

/** Three shops whose programmes already exist — the shape production had. */
const SEEDED = 3;

async function rows<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const r = await db.query<T>(sql, params as never[]);
  return r.rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readSql(BOOTSTRAP));
  // Apply the chain only up to, but NOT including, the WPL migrations — the state a real
  // deployment is in immediately before the WPL push.
  for (const m of PRE_WPL_MIGRATIONS) await db.exec(readSql(m));

  orgId = crypto.randomUUID();
  await db.exec(`INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'Backfill Org');`);

  shopIds = [];
  const base = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < SEEDED; i += 1) {
    const shopId = crypto.randomUUID();
    shopIds.push(shopId);
    await db.exec(`INSERT INTO public.shops (id, organization_id, name, shop_number)
                   VALUES ('${shopId}', '${orgId}', 'Backfill Shop ${i + 1}', 'BF-${i + 1}');`);
    // Distinct created_at so the backfill's registration-order row_number() is deterministic.
    await db.query(
      `INSERT INTO public.loyalty_programs (shop_id, enabled, created_at) VALUES ($1, true, $2)`,
      [shopId, new Date(base + i * 86_400_000).toISOString()],
    );
  }
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("pre-existing loyalty_programs rows (the production shape)", () => {
  it("the WPL migration applies cleanly to a table that ALREADY holds rows", async () => {
    // This is the assertion that failed in production. Before the fix it throws 23514.
    // PGlite's exec() resolves to a result array, not undefined — asserting it RESOLVED at all is
    // the point: before the fix this rejected with 23514 / an immutability RAISE.
    await expect(db.exec(readSql(migrationPath(MIGRATION_120000)))).resolves.toBeDefined();
  }, 60_000);

  it("every pre-existing row received a valid, non-null code", async () => {
    const r = await rows<{ shop_id: string; public_code: string | null }>(
      `SELECT shop_id, public_code FROM public.loyalty_programs WHERE shop_id = ANY($1::uuid[])`,
      [shopIds],
    );
    expect(r).toHaveLength(SEEDED);
    for (const row of r) {
      expect(row.public_code, `shop ${row.shop_id} was left with no code`).toBeTruthy();
      expect(row.public_code).toMatch(/^WPL[0-9]{4}[0-9]{3,9}$/);
    }
  });

  it("codes are unique, sequential, and follow registration order", async () => {
    const r = await rows<{ public_code: string }>(
      `SELECT public_code FROM public.loyalty_programs WHERE shop_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
      [shopIds],
    );
    const codes = r.map((x) => x.public_code);
    expect(new Set(codes).size).toBe(SEEDED);

    // The oldest programme takes 001 — the same convention 055 used for A001.
    const year = (await rows<{ y: number }>(
      `SELECT extract(year from (now() at time zone 'Africa/Kampala'))::int AS y`,
    ))[0]!.y;
    expect(codes[0]).toBe(`WPL${year}001`);
    for (let i = 1; i < codes.length; i += 1) {
      expect(Number(codes[i]!.slice(7))).toBe(Number(codes[i - 1]!.slice(7)) + 1);
    }
  });

  it("public_code is NOT NULL, and the shape CHECK is present and STRICT", async () => {
    const col = await rows<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='loyalty_programs' AND column_name='public_code'`,
    );
    expect(col[0]?.is_nullable).toBe("NO");

    const chk = await rows<{ def: string; validated: boolean }>(
      `SELECT pg_get_constraintdef(oid) AS def, convalidated AS validated
       FROM pg_constraint WHERE conname = 'loyalty_programs_public_code_shape_chk'`,
    );
    expect(chk).toHaveLength(1);
    // Enforced normally — not disabled, not NOT VALID.
    expect(chk[0]?.validated).toBe(true);
    expect(chk[0]?.def).toMatch(/is_waka_loyalty_program_code/);

    // And it genuinely rejects a bad value.
    const shopId = crypto.randomUUID();
    await db.exec(`INSERT INTO public.shops (id, organization_id, name, shop_number)
                   VALUES ('${shopId}', '${orgId}', 'Bad Code Shop', 'BF-BAD')`);
    await expect(
      db.query(`INSERT INTO public.loyalty_programs (shop_id, enabled, public_code)
                VALUES ($1, true, 'NOT-A-CODE')`, [shopId]),
    ).rejects.toThrow(/public_code_shape_chk|check constraint/i);
  }, 60_000);

  it("the counter sits AFTER the backfilled codes", async () => {
    const year = (await rows<{ y: number }>(
      `SELECT extract(year from (now() at time zone 'Africa/Kampala'))::int AS y`,
    ))[0]!.y;
    const c = await rows<{ next_seq: number }>(
      `SELECT next_seq FROM public.waka_loyalty_program_counter WHERE year = $1`,
      [year],
    );
    // 3 codes issued → the next number handed out must be 4.
    expect(c[0]?.next_seq).toBe(SEEDED + 1);
  });

  it("a subsequent allocation produces the next code, with no collision", async () => {
    const year = (await rows<{ y: number }>(
      `SELECT extract(year from (now() at time zone 'Africa/Kampala'))::int AS y`,
    ))[0]!.y;
    const next = await rows<{ c: string }>(
      `SELECT public.next_waka_loyalty_program_code($1) AS c`,
      [year],
    );
    expect(next[0]?.c).toBe(`WPL${year}${String(SEEDED + 1).padStart(3, "0")}`);

    const existing = await rows<{ public_code: string }>(
      `SELECT public_code FROM public.loyalty_programs WHERE public_code = $1`,
      [next[0]!.c],
    );
    expect(existing, "the allocator handed out a code that already exists").toHaveLength(0);
  });

  it("an assigned code cannot be changed", async () => {
    await expect(
      db.query(`UPDATE public.loyalty_programs SET public_code = 'WPL2099001' WHERE shop_id = $1`, [
        shopIds[0],
      ]),
    ).rejects.toThrow(/immutable/i);

    // Re-asserting the same value is not a change and stays allowed, so ordinary programme saves
    // (which rewrite the row) keep working.
    const before = await rows<{ public_code: string }>(
      `SELECT public_code FROM public.loyalty_programs WHERE shop_id = $1`,
      [shopIds[0]],
    );
    await expect(
      db.query(`UPDATE public.loyalty_programs SET public_code = $1, enabled = true WHERE shop_id = $2`, [
        before[0]!.public_code,
        shopIds[0],
      ]),
    ).resolves.toBeTruthy();
  }, 60_000);

  it("re-applying the migration is a no-op: codes and counter are untouched", async () => {
    const before = await rows<{ shop_id: string; public_code: string }>(
      `SELECT shop_id, public_code FROM public.loyalty_programs WHERE shop_id = ANY($1::uuid[]) ORDER BY public_code`,
      [shopIds],
    );
    const year = (await rows<{ y: number }>(
      `SELECT extract(year from (now() at time zone 'Africa/Kampala'))::int AS y`,
    ))[0]!.y;

    // PGlite's exec() resolves to a result array, not undefined — asserting it RESOLVED at all is
    // the point: before the fix this rejected with 23514 / an immutability RAISE.
    await expect(db.exec(readSql(migrationPath(MIGRATION_120000)))).resolves.toBeDefined();

    const after = await rows<{ shop_id: string; public_code: string }>(
      `SELECT shop_id, public_code FROM public.loyalty_programs WHERE shop_id = ANY($1::uuid[]) ORDER BY public_code`,
      [shopIds],
    );
    expect(after).toEqual(before);

    const c = await rows<{ next_seq: number }>(
      `SELECT next_seq FROM public.waka_loyalty_program_counter WHERE year = $1`,
      [year],
    );
    // Re-running must not advance the counter: the resync takes greatest(current, max+1).
    expect(c[0]?.next_seq).toBe(SEEDED + 2);
  }, 60_000);
});
