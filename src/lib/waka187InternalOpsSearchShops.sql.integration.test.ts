/**
 * Migration 187 — internal_ops_search_shops.
 * Catalog + fixture only. Does not apply 187 to production.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  applyWakaInternalOpsSearchShops,
  asUser,
  createWakaSecuritySqlHarness,
  INTERNAL_OPS_SEARCH_FIXTURE as F,
  seedInternalOpsSearchShopsCatalog,
} from "../test/sqlIntegration/wakaSecurityHotfixPgHarness";

const MIGRATION_187 = join(
  process.cwd(),
  "supabase",
  "migrations",
  "187_internal_ops_search_shops.sql",
);

const FN = "public.internal_ops_search_shops(text,integer,integer)";

describe("internal ops search shops (migration 187)", () => {
  let exec: SqlExec;

  beforeAll(async () => {
    exec = await createWakaSecuritySqlHarness();
    await seedInternalOpsSearchShopsCatalog(exec);
    await applyWakaInternalOpsSearchShops(exec);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function search(query: string, limit = 25, offset = 0) {
    return asUser(exec, F.staffId, () =>
      exec.query<{ id: string; name: string; shop_number: string | null }>(
        `SELECT id::text AS id, name, shop_number FROM public.internal_ops_search_shops($1, $2, $3)`,
        [query, limit, offset],
      ),
    );
  }

  async function searchExpectError(userId: string, query = "ab") {
    return asUser(exec, userId, () =>
      exec.query(`SELECT id FROM public.internal_ops_search_shops($1, 10, 0)`, [query]),
    );
  }

  async function hasExec(role: string): Promise<boolean> {
    const { rows } = await exec.query<{ ok: boolean }>(
      `SELECT has_function_privilege($1, $2::text, 'EXECUTE') AS ok`,
      [role, FN],
    );
    return Boolean(rows[0]?.ok);
  }

  it("migration 187 is STABLE DEFINER, staff-gated, and not granted to anon", () => {
    const sql = readFileSync(MIGRATION_187, "utf8");
    expect(sql).toMatch(/create or replace function public\.internal_ops_search_shops/i);
    expect(sql).toMatch(/\bstable\b/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public, auth/i);
    expect(sql).toMatch(/is_waka_internal_staff/i);
    expect(sql).toMatch(/raise exception 'Forbidden'/i);
    expect(sql).toContain("revoke all on function public.internal_ops_search_shops (text, int, int) from public");
    expect(sql).toContain("revoke all on function public.internal_ops_search_shops (text, int, int) from anon");
    expect(sql).toContain(
      "grant execute on function public.internal_ops_search_shops (text, int, int) to authenticated",
    );
    expect(sql).not.toMatch(/grant execute on function public\.internal_ops_search_shops[^;]+ to anon/i);
    expect(sql).not.toMatch(/create extension/i);
    expect(sql).not.toMatch(/create (unique )?index/i);
    expect(sql).not.toMatch(/internal_resolve_owner_(email|full_name)/i);
  });

  it("authenticated has EXECUTE; anon and public do not", async () => {
    expect(await hasExec("authenticated")).toBe(true);
    expect(await hasExec("anon")).toBe(false);
    expect(await hasExec("public")).toBe(false);
  });

  it("internal staff is allowed", async () => {
    const { rows } = await search("");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("unauthorized caller is denied", async () => {
    await expect(searchExpectError(F.outsiderId)).rejects.toThrow(/Forbidden/i);
  });

  it("unauthenticated caller is denied", async () => {
    await expect(
      exec.query(`SELECT id FROM public.internal_ops_search_shops('ab', 10, 0)`),
    ).rejects.toThrow(/Forbidden/i);
  });

  it("anon cannot execute the RPC", async () => {
    await exec.exec("SET ROLE anon");
    try {
      await expect(
        exec.query(`SELECT id FROM public.internal_ops_search_shops('ab', 10, 0)`),
      ).rejects.toThrow();
    } finally {
      await exec.exec("RESET ROLE");
    }
  });

  it("authenticated internal staff can execute the RPC", async () => {
    await exec.exec("BEGIN");
    try {
      await exec.exec("SET LOCAL ROLE authenticated");
      await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [F.staffId]);
      const { rows } = await exec.query<{ id: string }>(
        `SELECT id::text AS id FROM public.internal_ops_search_shops($1, 10, 0)`,
        [""],
      );
      expect(rows.length).toBeGreaterThan(0);
      await exec.exec("COMMIT");
    } catch (err) {
      await exec.exec("ROLLBACK");
      throw err;
    }
  });

  it("empty query returns paginated newest shops and not the old target", async () => {
    const { rows } = await search("", 25, 0);
    expect(rows).toHaveLength(26);
    expect(rows.some((r) => r.id === F.oldShopId)).toBe(false);
    expect(rows[0]?.name).toMatch(/Newest Window Shop/);
  });

  it("short invalid query returns no results", async () => {
    const { rows } = await search("z");
    expect(rows).toEqual([]);
  });

  it("finds a shop older than the newest 100 by name", async () => {
    const { rows } = await search("Zebra Hidden");
    expect(rows.map((r) => r.id)).toEqual([F.oldShopId]);
  });

  it("UUID lookup works for a shop outside the newest 100", async () => {
    const { rows } = await search(F.oldShopId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(F.oldShopId);
  });

  it("shop number lookup is exact", async () => {
    const { rows } = await search("a9001");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shop_number).toBe(F.oldShopNumber);
  });

  it("matches owner email", async () => {
    const { rows } = await search(F.ownerEmail);
    expect(rows.map((r) => r.id)).toEqual([F.oldShopId]);
  });

  it("matches owner full name", async () => {
    const { rows } = await search("Nakato Hidden");
    expect(rows.map((r) => r.id)).toEqual([F.oldShopId]);
  });

  it("paginates without overlapping pages", async () => {
    const first = await search("", 10, 0);
    const second = await search("", 10, 10);
    const firstIds = first.rows.slice(0, 10).map((r) => r.id);
    const secondIds = second.rows.slice(0, 10).map((r) => r.id);
    expect(firstIds).toHaveLength(10);
    expect(secondIds).toHaveLength(10);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(20);
  });

  it("clamps requested limit to 50 and returns has_more (+1)", async () => {
    const { rows } = await search("", 999, 0);
    expect(rows).toHaveLength(51);
  });

  it("clamps offset to 500", async () => {
    const clamped = await search("", 10, 500);
    const over = await search("", 10, 999);
    expect(clamped.rows).toEqual([]);
    expect(over.rows).toEqual([]);
    const mid = await search("", 10, 100);
    expect(mid.rows.length).toBeGreaterThan(0);
  });

  it("has_more is visible as an extra row", async () => {
    const { rows } = await search("", 25, 0);
    expect(rows.length).toBe(26);
  });

  it("returns one row per shop with no duplicates", async () => {
    const { rows } = await search("Zebra Hidden Mart");
    expect(rows).toHaveLength(1);
    const browse = await search("", 50, 0);
    const ids = browse.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
