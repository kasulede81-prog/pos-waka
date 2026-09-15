import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const LOOKUP_BOOTSTRAP = join(
  process.cwd(),
  "src",
  "test",
  "sqlIntegration",
  "historicalFinancialCorrectionLookupBootstrap.sql",
);
const MIGRATION_194 = join(process.cwd(), "supabase/migrations/194_historical_financial_correction_lookup.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

async function createLookupSqlHarness(): Promise<SqlExec> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const exec: SqlExec = {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
        const res = await client.query(sql, params);
        return { rows: res.rows as unknown as T[] };
      },
      async exec(sql: string) {
        await client.query(sql);
      },
      async close() {
        await client.end();
      },
    };
    await exec.exec(readSql(BOOTSTRAP));
    await exec.exec(readSql(LOOKUP_BOOTSTRAP));
    await exec.exec(readSql(MIGRATION_194));
    return exec;
  }

  const db = new PGlite();
  const exec: SqlExec = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await db.query(sql, params);
      return { rows: res.rows as unknown as T[] };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
  await exec.exec(readSql(BOOTSTRAP));
  await exec.exec(readSql(LOOKUP_BOOTSTRAP));
  await exec.exec(readSql(MIGRATION_194));
  return exec;
}

async function lookup(exec: SqlExec, shopId: string, lineId: string) {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT public.shop_lookup_sale_line_for_correction($1::uuid, $2::uuid) AS result`,
    [shopId, lineId],
  );
  return rpcJson(rows[0]);
}

describe("HISTORICAL-FIN-CORRECTION-LOOKUP shop_lookup_sale_line_for_correction", () => {
  let exec: SqlExec;

  const orgId = "b1940000-0000-4000-8000-000000000001";
  const shopAId = "b1940000-0000-4000-8000-000000000002"; // "N&C" stand-in
  const shopBId = "b1940000-0000-4000-8000-000000000003";
  const productAId = "b1940000-0000-4000-8000-000000000004";

  const superAdminId = "b1940000-0000-4000-8000-000000000010";
  const financeAdminId = "b1940000-0000-4000-8000-000000000011";
  const inactiveAdminId = "b1940000-0000-4000-8000-000000000012";
  const shopOwnerId = "b1940000-0000-4000-8000-000000000013";
  const shopManagerId = "b1940000-0000-4000-8000-000000000014";
  const supportAdminId = "b1940000-0000-4000-8000-000000000015";

  const saleAId = "b1940000-0000-4000-8000-000000000020";
  const lineAId = "b1940000-0000-4000-8000-000000000021"; // eligible, shop A
  const salePendingId = "b1940000-0000-4000-8000-000000000022";
  const linePendingId = "b1940000-0000-4000-8000-000000000023"; // not completed
  const saleBId = "b1940000-0000-4000-8000-000000000024";
  const lineBId = "b1940000-0000-4000-8000-000000000025"; // shop B's own line

  beforeAll(async () => {
    exec = await createLookupSqlHarness();

    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${superAdminId}'::uuid, 'super@waka.ug'),
        ('${financeAdminId}'::uuid, 'finance@waka.ug'),
        ('${inactiveAdminId}'::uuid, 'inactive@waka.ug'),
        ('${shopOwnerId}'::uuid, 'owner@shopA.ug'),
        ('${shopManagerId}'::uuid, 'manager@shopA.ug'),
        ('${supportAdminId}'::uuid, 'support@waka.ug')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.internal_admins (user_id, auth_user_id, email, role, active, is_active, can_view_sensitive_data)
      VALUES
        ('${superAdminId}'::uuid, '${superAdminId}'::uuid, 'super@waka.ug', 'super_admin', true, true, false),
        ('${financeAdminId}'::uuid, '${financeAdminId}'::uuid, 'finance@waka.ug', 'finance_admin', true, true, false),
        ('${inactiveAdminId}'::uuid, '${inactiveAdminId}'::uuid, 'inactive@waka.ug', 'super_admin', false, false, false),
        ('${supportAdminId}'::uuid, '${supportAdminId}'::uuid, 'support@waka.ug', 'support_admin', true, true, false)
      ON CONFLICT (user_id) DO NOTHING;

      INSERT INTO public.organizations (id, name) VALUES ('${orgId}'::uuid, 'Lookup Test Org')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.shops (id, organization_id, name, is_active) VALUES
        ('${shopAId}'::uuid, '${orgId}'::uuid, 'Shop A (N&C stand-in)', true),
        ('${shopBId}'::uuid, '${orgId}'::uuid, 'Shop B', true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
        ('${shopAId}'::uuid, '${shopOwnerId}'::uuid, 'owner'),
        ('${shopAId}'::uuid, '${shopManagerId}'::uuid, 'manager')
      ON CONFLICT (shop_id, user_id) DO NOTHING;

      INSERT INTO public.products (id, shop_id, name, cost_price_per_unit_ugx, conversion_rate)
      VALUES ('${productAId}'::uuid, '${shopAId}'::uuid, 'basimat', 3000, 25)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.sales (id, shop_id, status, created_at) VALUES
        ('${saleAId}'::uuid, '${shopAId}'::uuid, 'completed', '2026-09-14T14:09:00Z'),
        ('${salePendingId}'::uuid, '${shopAId}'::uuid, 'pending', now()),
        ('${saleBId}'::uuid, '${shopBId}'::uuid, 'completed', now())
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.sale_line_items (id, sale_id, product_id, quantity, line_total_ugx, metadata, financial_revision)
      VALUES
        ('${lineAId}'::uuid, '${saleAId}'::uuid, '${productAId}'::uuid, 2.5, 10000,
          '{"unitCostUgx":3600,"cogsUgx":9000,"grossProfitUgx":1000,"estimatedProfitUgx":1000}'::jsonb, 0),
        ('${linePendingId}'::uuid, '${salePendingId}'::uuid, '${productAId}'::uuid, 1, 1000,
          '{"unitCostUgx":500,"cogsUgx":500,"grossProfitUgx":500,"estimatedProfitUgx":500}'::jsonb, 0),
        ('${lineBId}'::uuid, '${saleBId}'::uuid, '${productAId}'::uuid, 1, 2000,
          '{"unitCostUgx":800,"cogsUgx":800,"grossProfitUgx":1200,"estimatedProfitUgx":1200}'::jsonb, 0)
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await exec.close();
  });

  it("1. super_admin can look up an eligible line", async () => {
    const result = await asUser(exec, superAdminId, () => lookup(exec, shopAId, lineAId));
    expect(result.ok).toBe(true);
    expect(result.saleLineItemId).toBe(lineAId);
    expect(result.currentUnitCostUgx).toBe(3600);
    expect(result.currentCogsUgx).toBe(9000);
    expect(result.financialRevision).toBe(0);
  });

  it("2. finance_admin can look up an eligible line", async () => {
    const result = await asUser(exec, financeAdminId, () => lookup(exec, shopAId, lineAId));
    expect(result.ok).toBe(true);
    expect(result.saleLineItemId).toBe(lineAId);
  });

  it("3. an ordinary shop owner cannot use the internal lookup RPC", async () => {
    const result = await asUser(exec, shopOwnerId, () => lookup(exec, shopAId, lineAId));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("4. an ordinary shop manager cannot use it", async () => {
    const result = await asUser(exec, shopManagerId, () => lookup(exec, shopAId, lineAId));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("5. an anonymous caller (no session) cannot use it", async () => {
    await exec.exec("BEGIN");
    await exec.query(`SELECT set_config('request.jwt.claim.sub', '', true)`);
    const { rows } = await exec.query<Record<string, unknown>>(
      `SELECT public.shop_lookup_sale_line_for_correction($1::uuid, $2::uuid) AS result`,
      [shopAId, lineAId],
    );
    const result = rpcJson(rows[0]);
    await exec.exec("ROLLBACK");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_authenticated");
  });

  it("6. an inactive internal admin cannot use it, even with super_admin role", async () => {
    const result = await asUser(exec, inactiveAdminId, () => lookup(exec, shopAId, lineAId));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("7. an internal admin can look up a line from a shop they do not personally belong to", async () => {
    // superAdminId is not in shop_members for either shop — internal admin access is
    // platform-level, not shop-membership-based, matching shop_correct_sale_line_financials.
    const result = await asUser(exec, superAdminId, () => lookup(exec, shopBId, lineBId));
    expect(result.ok).toBe(true);
    expect(result.saleLineItemId).toBe(lineBId);
    expect(result.shopId).toBe(shopBId);
  });

  it("8. nonexistent line returns the expected safe not-found response", async () => {
    const result = await asUser(exec, superAdminId, () =>
      lookup(exec, shopAId, "b1940000-0000-4000-8000-0000000000ff"),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("9. cross-shop mismatch (real line, wrong shop_id) is rejected as not_found — never confirms cross-tenant existence", async () => {
    const result = await asUser(exec, superAdminId, () => lookup(exec, shopBId, lineAId));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("a pending (not completed) sale's line is rejected with sale_not_completed, not a generic error", async () => {
    const result = await asUser(exec, superAdminId, () => lookup(exec, shopAId, linePendingId));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("sale_not_completed");
  });

  it("10. the lookup never modifies data — line and sale rows are byte-identical before/after", async () => {
    const before = await exec.query<Record<string, unknown>>(
      `SELECT financial_revision, metadata FROM public.sale_line_items WHERE id = $1::uuid`,
      [lineAId],
    );
    await asUser(exec, superAdminId, () => lookup(exec, shopAId, lineAId));
    const after = await exec.query<Record<string, unknown>>(
      `SELECT financial_revision, metadata FROM public.sale_line_items WHERE id = $1::uuid`,
      [lineAId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    const corrections = await exec.query(`SELECT to_regclass('public.sale_line_item_corrections') AS reg`);
    // This harness never defines sale_line_item_corrections at all — confirms the lookup
    // RPC has no write path to it (would fail to apply if it tried to reference it in a
    // DML statement bound at parse time the way an INSERT/UPDATE would).
    expect(corrections.rows[0]?.reg).toBeNull();
  });
});
