/**
 * Migration 188 — internal_ops shop returns / voids / cash expenses.
 * Catalog + fixture only. Does not apply 188 to production.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  applyWakaInternalOpsShopLedgers,
  asUser,
  createWakaSecuritySqlHarness,
  INTERNAL_OPS_SHOP_LEDGER_FIXTURE as F,
  seedInternalOpsShopLedgersCatalog,
} from "../test/sqlIntegration/wakaSecurityHotfixPgHarness";

const MIGRATION_188 = join(
  process.cwd(),
  "supabase",
  "migrations",
  "188_internal_ops_shop_sale_returns_voids_expenses.sql",
);

const RETURNS_FN = "public.internal_ops_shop_sale_returns(uuid,integer,integer)";
const VOIDS_FN = "public.internal_ops_shop_sale_voids(uuid,integer,integer)";
const EXPENSES_FN = "public.internal_ops_shop_cash_expenses(uuid,integer,integer)";

describe("internal ops shop ledgers (migration 188)", () => {
  let exec: SqlExec;

  beforeAll(async () => {
    exec = await createWakaSecuritySqlHarness();
    await seedInternalOpsShopLedgersCatalog(exec);
    await applyWakaInternalOpsShopLedgers(exec);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function asStaff<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return asUser(exec, F.staffId, () => exec.query<T>(sql, params));
  }

  async function expectForbidden(userId: string, sql: string, params: unknown[]) {
    return asUser(exec, userId, () => exec.query(sql, params));
  }

  async function hasExec(role: string, fn: string): Promise<boolean> {
    const { rows } = await exec.query<{ ok: boolean }>(
      `SELECT has_function_privilege($1, $2::text, 'EXECUTE') AS ok`,
      [role, fn],
    );
    return Boolean(rows[0]?.ok);
  }

  async function columnKeys(sql: string, params: unknown[]): Promise<string[]> {
    const { rows } = await asStaff<{ k: string }>(
      `SELECT DISTINCT jsonb_object_keys(to_jsonb(t)) AS k FROM (${sql} LIMIT 1) t`,
      params,
    );
    return rows.map((r) => r.k).sort();
  }

  it("migration 188 is STABLE DEFINER, staff-gated, and not granted to anon", () => {
    const sql = readFileSync(MIGRATION_188, "utf8");
    for (const name of [
      "internal_ops_shop_sale_returns",
      "internal_ops_shop_sale_voids",
      "internal_ops_shop_cash_expenses",
    ]) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${name}`, "i"));
      expect(sql).toContain(`revoke all on function public.${name} (uuid, int, int) from public`);
      expect(sql).toContain(`revoke all on function public.${name} (uuid, int, int) from anon`);
      expect(sql).toContain(`grant execute on function public.${name} (uuid, int, int) to authenticated`);
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${name}[^;]+ to anon`, "i"));
    }
    expect(sql).toMatch(/\bstable\b/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public/i);
    expect(sql).toMatch(/is_waka_internal_staff/i);
    expect(sql).toMatch(/raise exception 'Forbidden'/i);
    expect(sql).toMatch(/r\.shop_id = p_shop_id/);
    expect(sql).toMatch(/sv\.shop_id = p_shop_id/);
    expect(sql).toMatch(/e\.shop_id = p_shop_id/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/create (unique )?index/i);
    expect(sql).not.toMatch(/\binsert into\b/i);
    expect(sql).not.toMatch(/\bupdate\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\bmetadata\b/i);
    expect(sql).not.toMatch(/attachment_path/i);
    expect(sql).not.toMatch(/pin_hash/i);
  });

  it("authenticated has EXECUTE; anon and public do not", async () => {
    for (const fn of [RETURNS_FN, VOIDS_FN, EXPENSES_FN]) {
      expect(await hasExec("authenticated", fn)).toBe(true);
      expect(await hasExec("anon", fn)).toBe(false);
      expect(await hasExec("public", fn)).toBe(false);
    }
  });

  it("internal staff is allowed", async () => {
    const { rows } = await asStaff(
      `SELECT id::text AS id FROM public.internal_ops_shop_sale_returns($1, 10, 0)`,
      [F.shopAId],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("authenticated non-staff is denied", async () => {
    await expect(
      expectForbidden(
        F.outsiderId,
        `SELECT id FROM public.internal_ops_shop_sale_returns($1, 10, 0)`,
        [F.shopAId],
      ),
    ).rejects.toThrow(/Forbidden/i);
  });

  it("shop owner who is not internal staff is denied", async () => {
    await expect(
      expectForbidden(
        F.ownerId,
        `SELECT id FROM public.internal_ops_shop_sale_returns($1, 10, 0)`,
        [F.shopAId],
      ),
    ).rejects.toThrow(/Forbidden/i);
    await expect(
      expectForbidden(F.ownerId, `SELECT id FROM public.internal_ops_shop_sale_voids($1, 10, 0)`, [F.shopAId]),
    ).rejects.toThrow(/Forbidden/i);
    await expect(
      expectForbidden(
        F.ownerId,
        `SELECT id FROM public.internal_ops_shop_cash_expenses($1, 10, 0)`,
        [F.shopAId],
      ),
    ).rejects.toThrow(/Forbidden/i);
  });

  it("unauthenticated caller is denied", async () => {
    await expect(
      exec.query(`SELECT id FROM public.internal_ops_shop_sale_returns($1, 10, 0)`, [F.shopAId]),
    ).rejects.toThrow(/Forbidden/i);
  });

  it("anon cannot execute the RPCs", async () => {
    await exec.exec("SET ROLE anon");
    try {
      await expect(
        exec.query(`SELECT id FROM public.internal_ops_shop_sale_returns($1, 10, 0)`, [F.shopAId]),
      ).rejects.toThrow();
      await expect(
        exec.query(`SELECT id FROM public.internal_ops_shop_sale_voids($1, 10, 0)`, [F.shopAId]),
      ).rejects.toThrow();
      await expect(
        exec.query(`SELECT id FROM public.internal_ops_shop_cash_expenses($1, 10, 0)`, [F.shopAId]),
      ).rejects.toThrow();
    } finally {
      await exec.exec("RESET ROLE");
    }
  });

  it("staff querying shop A never receives shop B rows", async () => {
    const returns = await asStaff<{ id: string; shop_id: string }>(
      `SELECT id::text AS id, shop_id::text AS shop_id FROM public.internal_ops_shop_sale_returns($1, 50, 0)`,
      [F.shopAId],
    );
    const voids = await asStaff<{ id: string; shop_id: string }>(
      `SELECT id::text AS id, shop_id::text AS shop_id FROM public.internal_ops_shop_sale_voids($1, 50, 0)`,
      [F.shopAId],
    );
    const expenses = await asStaff<{ id: string; shop_id: string }>(
      `SELECT id::text AS id, shop_id::text AS shop_id FROM public.internal_ops_shop_cash_expenses($1, 50, 0)`,
      [F.shopAId],
    );
    for (const row of [...returns.rows, ...voids.rows, ...expenses.rows]) {
      expect(row.shop_id).toBe(F.shopAId);
      expect(row.id).not.toContain("000000000101");
    }
  });

  it("returns are shop-scoped and include product_name", async () => {
    const { rows } = await asStaff<{ product_name: string; shop_id: string }>(
      `SELECT product_name, shop_id::text AS shop_id FROM public.internal_ops_shop_sale_returns($1, 5, 0)`,
      [F.shopAId],
    );
    expect(rows[0]?.product_name).toBe("Soda 500ml");
    expect(rows.every((r) => r.shop_id === F.shopAId)).toBe(true);
  });

  it("voids are shop-scoped", async () => {
    const { rows } = await asStaff<{ shop_id: string }>(
      `SELECT shop_id::text AS shop_id FROM public.internal_ops_shop_sale_voids($1, 50, 0)`,
      [F.shopAId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.shop_id === F.shopAId)).toBe(true);
  });

  it("expenses exclude deleted rows and non-cash-drawer types", async () => {
    const { rows } = await asStaff<{ category: string; description: string | null }>(
      `SELECT category, description FROM public.internal_ops_shop_cash_expenses($1, 50, 0)`,
      [F.shopAId],
    );
    expect(rows).toHaveLength(8);
    expect(rows.some((r) => r.category === "deleted" || r.category === "legacy")).toBe(false);
    expect(rows.some((r) => r.description === "should be excluded")).toBe(false);
    expect(rows.every((r) => r.category === "transport")).toBe(true);
  });

  it("empty shop returns no rows", async () => {
    const returns = await asStaff(`SELECT id FROM public.internal_ops_shop_sale_returns($1, 25, 0)`, [
      F.emptyShopId,
    ]);
    const voids = await asStaff(`SELECT id FROM public.internal_ops_shop_sale_voids($1, 25, 0)`, [F.emptyShopId]);
    const expenses = await asStaff(`SELECT id FROM public.internal_ops_shop_cash_expenses($1, 25, 0)`, [
      F.emptyShopId,
    ]);
    expect(returns.rows).toEqual([]);
    expect(voids.rows).toEqual([]);
    expect(expenses.rows).toEqual([]);
  });

  it("pagination limit 5 returns 6 internally with no overlapping pages", async () => {
    const first = await asStaff<{ id: string }>(
      `SELECT id::text AS id FROM public.internal_ops_shop_sale_returns($1, 5, 0)`,
      [F.shopAId],
    );
    const second = await asStaff<{ id: string }>(
      `SELECT id::text AS id FROM public.internal_ops_shop_sale_returns($1, 5, 5)`,
      [F.shopAId],
    );
    expect(first.rows).toHaveLength(6);
    const firstIds = first.rows.slice(0, 5).map((r) => r.id);
    const secondIds = second.rows.slice(0, 5).map((r) => r.id);
    expect(firstIds).toHaveLength(5);
    expect(secondIds).toHaveLength(5);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(10);
  });

  it("clamps requested limit to 50 and returns has_more (+1)", async () => {
    const { rows } = await asStaff(
      `SELECT id FROM public.internal_ops_shop_sale_returns($1, 999, 0)`,
      [F.shopAId],
    );
    expect(rows).toHaveLength(51);
  });

  it("clamps offset to 500", async () => {
    const clamped = await asStaff(`SELECT id FROM public.internal_ops_shop_sale_returns($1, 10, 500)`, [
      F.shopAId,
    ]);
    const over = await asStaff(`SELECT id FROM public.internal_ops_shop_sale_returns($1, 10, 999)`, [F.shopAId]);
    expect(clamped.rows).toEqual([]);
    expect(over.rows).toEqual([]);
    const mid = await asStaff(`SELECT id FROM public.internal_ops_shop_sale_returns($1, 10, 10)`, [F.shopAId]);
    expect(mid.rows.length).toBeGreaterThan(0);
  });

  it("orders returns deterministically by created_at desc, id desc", async () => {
    const { rows } = await asStaff<{ id: string }>(
      `SELECT id::text AS id FROM public.internal_ops_shop_sale_returns($1, 3, 0)`,
      [F.shopAId],
    );
    expect(rows.map((r) => r.id).slice(0, 3)).toEqual([
      "a1881000-0000-4000-8000-000000000060",
      "a1881000-0000-4000-8000-000000000059",
      "a1881000-0000-4000-8000-000000000058",
    ]);
  });

  it("does not return metadata or other unapproved columns", async () => {
    const returnKeys = await columnKeys(
      `SELECT * FROM public.internal_ops_shop_sale_returns($1, 1, 0)`,
      [F.shopAId],
    );
    const voidKeys = await columnKeys(`SELECT * FROM public.internal_ops_shop_sale_voids($1, 1, 0)`, [F.shopAId]);
    const expenseKeys = await columnKeys(
      `SELECT * FROM public.internal_ops_shop_cash_expenses($1, 1, 0)`,
      [F.shopAId],
    );
    for (const keys of [returnKeys, voidKeys, expenseKeys]) {
      expect(keys).not.toContain("metadata");
      expect(keys).not.toContain("note");
      expect(keys).not.toContain("attachment_path");
      expect(keys).not.toContain("created_by");
    }
    expect(returnKeys).toEqual([
      "created_at",
      "id",
      "product_id",
      "product_name",
      "quantity",
      "reason",
      "refund_amount_ugx",
      "sale_id",
      "shop_id",
      "stock_applied_at",
    ]);
    expect(expenseKeys).toEqual([
      "amount_ugx",
      "category",
      "created_at",
      "description",
      "id",
      "paid_on",
      "recorded_by_label",
      "shop_id",
    ]);
  });
});
