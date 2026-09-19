import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20260919120000 — pin the search_path of four pure helper functions.
 * Real SQL: the four functions are created exactly as their migrations define them, evaluated over a
 * battery of inputs, hardened, and evaluated again — the answers must be identical.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";

function extractFn(file: string, name: string): string {
  const src = readFileSync(join(dir, file), "utf8");
  const start = src.indexOf(`create or replace function public.${name}`);
  return src.slice(start, src.indexOf("$$;", start) + 3);
}

const FUNCTIONS: Array<[string, string]> = [
  ["20260919090000_hospitality_floor_tombstone_guard.sql", "hospitality_status_rank"],
  ["20260919110000_made_to_order_ingredient_stock.sql", "_wk_try_uuid"],
  ["20260919110000_made_to_order_ingredient_stock.sql", "_wk_recipe_provenance_struct"],
  ["20260919110000_made_to_order_ingredient_stock.sql", "_wk_recipe_credit"],
];

const BATTERY = `
  select jsonb_build_object(
    'rank', (select jsonb_agg(public.hospitality_status_rank(s)) from unnest(array['pending','confirmed','cancelled','no_show','seated','completed','waiting','weird',null]) s),
    'uuid_ok', public._wk_try_uuid('${U1}'),
    'uuid_bad', public._wk_try_uuid('nope'),
    'uuid_null', public._wk_try_uuid(null),
    'credit', jsonb_build_array(
      public._wk_recipe_credit(3, 3, 0, 1), public._wk_recipe_credit(3, 3, 1, 1), public._wk_recipe_credit(3, 3, 2, 1),
      public._wk_recipe_credit(0.9999, 3, 0, 1) + public._wk_recipe_credit(0.9999, 3, 1, 1) + public._wk_recipe_credit(0.9999, 3, 2, 1),
      public._wk_recipe_credit(10, 4, 1, 100), public._wk_recipe_credit(2.5, 7, 3, 2)),
    'struct_aggregated', public._wk_recipe_provenance_struct('{"ingredientConsumption":[{"productId":"${U1}","quantity":2},{"productId":"${U2}","quantity":1},{"productId":"${U1}","quantity":1}]}'::jsonb),
    'struct_empty', public._wk_recipe_provenance_struct('{"ingredientConsumption":[]}'::jsonb),
    'struct_absent', public._wk_recipe_provenance_struct('{}'::jsonb),
    'struct_not_array', public._wk_recipe_provenance_struct('{"ingredientConsumption":"x"}'::jsonb),
    'struct_bad_id', public._wk_recipe_provenance_struct('{"ingredientConsumption":[{"productId":"nope","quantity":1}]}'::jsonb),
    'struct_bad_qty', public._wk_recipe_provenance_struct('{"ingredientConsumption":[{"productId":"${U1}","quantity":-1}]}'::jsonb),
    'struct_string_qty', public._wk_recipe_provenance_struct('{"ingredientConsumption":[{"productId":"${U1}","quantity":"1"}]}'::jsonb),
    'struct_null_entry', public._wk_recipe_provenance_struct('{"ingredientConsumption":[null]}'::jsonb)
  ) as r
`;

const config = async (db: PGlite) =>
  (
    await db.query<{ proname: string; cfg: string[] | null }>(
      `select p.proname, p.proconfig as cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('hospitality_status_rank','_wk_try_uuid','_wk_recipe_credit','_wk_recipe_provenance_struct') order by 1`,
    )
  ).rows;

describe("migration 20260919120000 — helper search_path", () => {
  let db: PGlite;
  let before: unknown;
  beforeAll(async () => {
    db = new PGlite();
    for (const [file, name] of FUNCTIONS) await db.exec(extractFn(file, name));
    before = (await db.query<{ r: unknown }>(BATTERY)).rows[0]!.r;
  }, 60_000);
  afterAll(async () => db.close());

  it("before: the four functions carry no search_path (the advisor finding)", async () => {
    const rows = await config(db);
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.cfg).toBeNull();
  });

  it("the migration pins pg_catalog on each, and touches nothing else", async () => {
    await db.exec(readFileSync(join(dir, "20260919120000_hospitality_helper_search_path.sql"), "utf8"));
    for (const r of await config(db)) expect(r.cfg).toEqual(["search_path=pg_catalog"]);
    const volatility = await db.query<{ proname: string; provolatile: string; prosecdef: boolean }>(
      `select proname, provolatile, prosecdef from pg_proc where proname in ('hospitality_status_rank','_wk_try_uuid','_wk_recipe_credit','_wk_recipe_provenance_struct') order by 1`,
    );
    for (const v of volatility.rows) expect([v.provolatile, v.prosecdef]).toEqual(["i", false]); // still immutable, still not security definer
  });

  it("every answer is IDENTICAL before and after (ranks, uuid casts, credit arithmetic, provenance parsing)", async () => {
    const after = (await db.query<{ r: unknown }>(BATTERY)).rows[0]!.r;
    expect(after).toEqual(before);
    // and the battery really exercised the behaviour that matters
    const a = after as Record<string, unknown>;
    expect(a.rank).toEqual([0, 1, 2, 2, 3, 4, 0, 0, 0]);
    expect(a.uuid_ok).toBe(U1);
    expect(a.uuid_bad).toBeNull();
    expect(a.struct_aggregated).toEqual([{ productId: U1, quantity: 3 }, { productId: U2, quantity: 1 }]);
    expect(a.struct_empty).toEqual([]);
    for (const k of ["struct_absent", "struct_not_array", "struct_bad_id", "struct_bad_qty", "struct_string_qty", "struct_null_entry"]) expect(a[k]).toBeNull();
  });

  it("is idempotent: running it again changes nothing", async () => {
    await db.exec(readFileSync(join(dir, "20260919120000_hospitality_helper_search_path.sql"), "utf8"));
    for (const r of await config(db)) expect(r.cfg).toEqual(["search_path=pg_catalog"]);
    expect((await db.query<{ r: unknown }>(BATTERY)).rows[0]!.r).toEqual(before);
  });

  it("works with a hostile caller search_path (nothing is resolved through it)", async () => {
    await db.exec("create schema evil; set search_path = evil, public;");
    expect((await db.query<{ r: unknown }>(BATTERY)).rows[0]!.r).toEqual(before);
    await db.exec("set search_path = public;");
  });
});
