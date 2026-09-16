import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

/**
 * P1 defect regression test — WAKA POS financial transaction laboratory,
 * Phase 7 (void).
 *
 * ROOT CAUSE: voiding a sale line sets `voided: true` correctly in local
 * client state (usePosStore.ts voidSaleLine), and shop_apply_sale_void_stock
 * correctly restores stock + records the sale_voids ledger server-side, but
 * nothing pushed the voided flag itself onto sale_line_items.metadata —
 * confirmed live on production shop N&C trading center: a voided line's
 * server-side row (cogsUgx/grossProfitUgx/metadata) was byte-identical to
 * before the void. A device that never had this line locally (a different
 * staff device, or this device after a full cloud restore) would pull it
 * without the flag and wrongly re-include its revenue/COGS/profit in its own
 * reports, since the canonical `.voided` exclusion filter
 * (saleFinancialEngine.ts) only ever sees what's actually stored.
 *
 * FIX: shop_sync_sale_line_void_state
 * (20260916025318_sale_line_void_state_sync.sql) — a small, additive,
 * idempotent RPC the client now calls right after
 * shop_apply_sale_void_stock succeeds, to sync just `voided`/`voidedAt`
 * (never any financial value) onto the server's sale_line_items row.
 */

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const VOID_STATE_BOOTSTRAP = join(
  process.cwd(),
  "src",
  "test",
  "sqlIntegration",
  "saleLineVoidStateSyncBootstrap.sql",
);
const MIGRATION = join(process.cwd(), "supabase/migrations/20260916025318_sale_line_void_state_sync.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

async function createHarness(): Promise<SqlExec> {
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
    await exec.exec(readSql(VOID_STATE_BOOTSTRAP));
    await exec.exec(readSql(MIGRATION));
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
  await exec.exec(readSql(VOID_STATE_BOOTSTRAP));
  await exec.exec(readSql(MIGRATION));
  return exec;
}

async function syncVoidState(exec: SqlExec, shopId: string, lineId: string, voidedAt?: string) {
  const { rows } = await exec.query<Record<string, unknown>>(
    voidedAt
      ? `SELECT public.shop_sync_sale_line_void_state($1::uuid, $2::uuid, $3::timestamptz) AS result`
      : `SELECT public.shop_sync_sale_line_void_state($1::uuid, $2::uuid) AS result`,
    voidedAt ? [shopId, lineId, voidedAt] : [shopId, lineId],
  );
  return rpcJson(rows[0]);
}

async function lineMetadata(exec: SqlExec, lineId: string): Promise<Record<string, unknown>> {
  const { rows } = await exec.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM public.sale_line_items WHERE id = $1::uuid`,
    [lineId],
  );
  return rows[0]?.metadata ?? {};
}

describe("SALE-LINE-VOID-STATE-SYNC shop_sync_sale_line_void_state", () => {
  let exec: SqlExec;

  const orgId = "b1960000-0000-4000-8000-000000000001";
  const shopAId = "b1960000-0000-4000-8000-000000000002"; // "N&C" stand-in
  const shopBId = "b1960000-0000-4000-8000-000000000003";
  const productId = "b1960000-0000-4000-8000-000000000004";
  const saleId = "b1960000-0000-4000-8000-000000000005";
  const lineId = "b1960000-0000-4000-8000-000000000006";

  const cashierId = "b1960000-0000-4000-8000-000000000010";
  const outsiderId = "b1960000-0000-4000-8000-000000000011";

  beforeAll(async () => {
    exec = await createHarness();

    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${cashierId}'::uuid, 'cashier@shopA.ug'),
        ('${outsiderId}'::uuid, 'outsider@nowhere.ug')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.organizations (id, name) VALUES ('${orgId}'::uuid, 'Void State Test Org')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.shops (id, organization_id, name, is_active) VALUES
        ('${shopAId}'::uuid, '${orgId}'::uuid, 'Shop A (N&C stand-in)', true),
        ('${shopBId}'::uuid, '${orgId}'::uuid, 'Shop B', true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
        ('${shopAId}'::uuid, '${cashierId}'::uuid, 'cashier')
      ON CONFLICT (shop_id, user_id) DO NOTHING;

      INSERT INTO public.products (id, shop_id, name, cost_price_per_unit_ugx)
      VALUES ('${productId}'::uuid, '${shopAId}'::uuid, 'Coca cola', 875)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.sales (id, shop_id, status) VALUES ('${saleId}'::uuid, '${shopAId}'::uuid, 'completed')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.sale_line_items (id, sale_id, product_id, quantity, line_total_ugx, metadata)
      VALUES ('${lineId}'::uuid, '${saleId}'::uuid, '${productId}'::uuid, 1, 1000,
        '{"name":"Coca cola","cogsUgx":875,"unitCostUgx":875,"netRevenueUgx":1000,"grossProfitUgx":125,"estimatedProfitUgx":125}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await exec.close();
  });

  it("1. cashier can mark the line voided — voided:true set, financial fields untouched", async () => {
    const result = await asUser(exec, cashierId, () => syncVoidState(exec, shopAId, lineId, "2026-09-16T02:41:23.916Z"));
    expect(result.ok).toBe(true);
    const meta = await lineMetadata(exec, lineId);
    expect(meta.voided).toBe(true);
    // Compare by instant, not string literal — the test DB may render the
    // offset in local time (e.g. +01:00) while still being the same UTC
    // instant as the +00:00 timestamp that was passed in.
    expect(new Date(meta.voidedAt as string).getTime()).toBe(new Date("2026-09-16T02:41:23.916Z").getTime());
    // Financial snapshot must remain exactly as originally recorded — this
    // RPC never touches cogsUgx/grossProfitUgx/revenue.
    expect(meta.cogsUgx).toBe(875);
    expect(meta.grossProfitUgx).toBe(125);
    expect(meta.netRevenueUgx).toBe(1000);
  });

  it("2. IDEMPOTENCY — calling it again (replay) is a safe no-op, still voided:true", async () => {
    const result = await asUser(exec, cashierId, () => syncVoidState(exec, shopAId, lineId, "2026-09-16T02:41:23.916Z"));
    expect(result.ok).toBe(true);
    const meta = await lineMetadata(exec, lineId);
    expect(meta.voided).toBe(true);
  });

  it("3. a user with no membership in the shop is forbidden", async () => {
    const result = await asUser(exec, outsiderId, () => syncVoidState(exec, shopAId, lineId));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("4. cross-shop: a shop A member cannot sync void state for a line under shop B", async () => {
    const result = await asUser(exec, cashierId, () => syncVoidState(exec, shopBId, lineId));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("5. unauthenticated call is rejected", async () => {
    const { rows } = await exec.query<Record<string, unknown>>(
      `SELECT public.shop_sync_sale_line_void_state($1::uuid, $2::uuid) AS result`,
      [shopAId, lineId],
    );
    const result = rpcJson(rows[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_authenticated");
  });

  it("6. a non-existent line id returns line_not_found, not a crash", async () => {
    const result = await asUser(exec, cashierId, () =>
      syncVoidState(exec, shopAId, "b1960000-0000-4000-8000-000000000099"),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("line_not_found");
  });
});
