import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

/**
 * P1 defect regression test — WAKA POS financial transaction laboratory,
 * Phase 3 (non-divisible pack cost).
 *
 * ROOT CAUSE: packCostUnitsDepleted (the FIFO pack-slot allocation counter)
 * is computed correctly client-side after every sale, but stock deduction
 * for a completed sale is authoritative server-side via
 * apply_sale_stock_movements, which only ever touches stock_on_hand.
 * Nothing in the sale-completion flow pushed the client's locally-advanced
 * counter to Supabase, so it silently reset to 0 on every device
 * restart/cloud-restore/additional staff device — confirmed live on
 * production shop N&C trading center (two real 5-egg sales, 10 units total,
 * left server-side packCostUnitsDepleted at 0).
 *
 * FIX: shop_sync_product_pack_slot_state
 * (20260916015249_product_pack_slot_state_sync.sql) — a small, additive RPC
 * the client now calls after every sale push, for each line whose product
 * uses pack-slot allocation, to sync just that counter. Uses GREATEST()
 * against the stored value so replaying the same push (or an
 * out-of-order/duplicate push from another device) can only advance the
 * counter forward, never regress it — this is the idempotency property
 * these tests exercise.
 */

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const PACK_SLOT_BOOTSTRAP = join(
  process.cwd(),
  "src",
  "test",
  "sqlIntegration",
  "productPackSlotStateSyncBootstrap.sql",
);
const MIGRATION = join(process.cwd(), "supabase/migrations/20260916015249_product_pack_slot_state_sync.sql");

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
    await exec.exec(readSql(PACK_SLOT_BOOTSTRAP));
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
  await exec.exec(readSql(PACK_SLOT_BOOTSTRAP));
  await exec.exec(readSql(MIGRATION));
  return exec;
}

async function syncPackSlotState(exec: SqlExec, shopId: string, productId: string, depleted: number) {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT public.shop_sync_product_pack_slot_state($1::uuid, $2::uuid, $3::numeric) AS result`,
    [shopId, productId, depleted],
  );
  return rpcJson(rows[0]);
}

async function currentDepleted(exec: SqlExec, productId: string): Promise<number | null> {
  const { rows } = await exec.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM public.products WHERE id = $1::uuid`,
    [productId],
  );
  const raw = rows[0]?.metadata?.packCostUnitsDepleted;
  return raw == null ? null : Number(raw);
}

describe("PACK-SLOT-STATE-SYNC shop_sync_product_pack_slot_state", () => {
  let exec: SqlExec;

  const orgId = "b1950000-0000-4000-8000-000000000001";
  const shopAId = "b1950000-0000-4000-8000-000000000002"; // "N&C" stand-in
  const shopBId = "b1950000-0000-4000-8000-000000000003";
  const eggsProductId = "b1950000-0000-4000-8000-000000000004"; // buyingPackCostUgx 10000/30

  const cashierId = "b1950000-0000-4000-8000-000000000010";
  const viewerId = "b1950000-0000-4000-8000-000000000011";
  const outsiderId = "b1950000-0000-4000-8000-000000000012"; // no shop membership at all

  beforeAll(async () => {
    exec = await createHarness();

    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${cashierId}'::uuid, 'cashier@shopA.ug'),
        ('${viewerId}'::uuid, 'viewer@shopA.ug'),
        ('${outsiderId}'::uuid, 'outsider@nowhere.ug')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.organizations (id, name) VALUES ('${orgId}'::uuid, 'Pack Slot Test Org')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.shops (id, organization_id, name, is_active) VALUES
        ('${shopAId}'::uuid, '${orgId}'::uuid, 'Shop A (N&C stand-in)', true),
        ('${shopBId}'::uuid, '${orgId}'::uuid, 'Shop B', true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
        ('${shopAId}'::uuid, '${cashierId}'::uuid, 'cashier'),
        ('${shopAId}'::uuid, '${viewerId}'::uuid, 'viewer')
      ON CONFLICT (shop_id, user_id) DO NOTHING;

      INSERT INTO public.products (id, shop_id, name, cost_price_per_unit_ugx, metadata)
      VALUES ('${eggsProductId}'::uuid, '${shopAId}'::uuid, 'eggs nzungu', 333,
        '{"exactCostPricePerUnitUgx":333.3333333333333,"buyingPackCostUgx":10000,"packCostUnitsDepleted":0}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await exec.close();
  });

  it("1. cashier can advance packCostUnitsDepleted from 0 to 5 (first sale of the pack)", async () => {
    const result = await asUser(exec, cashierId, () => syncPackSlotState(exec, shopAId, eggsProductId, 5));
    expect(result.ok).toBe(true);
    expect(Number(result.pack_cost_units_depleted)).toBe(5);
    expect(await currentDepleted(exec, eggsProductId)).toBe(5);
  });

  it("2. a second sale advances it further, from 5 to 10", async () => {
    const result = await asUser(exec, cashierId, () => syncPackSlotState(exec, shopAId, eggsProductId, 10));
    expect(result.ok).toBe(true);
    expect(Number(result.pack_cost_units_depleted)).toBe(10);
    expect(await currentDepleted(exec, eggsProductId)).toBe(10);
  });

  it("3. IDEMPOTENCY — replaying the same push again is a safe no-op (still 10, not 20)", async () => {
    const result = await asUser(exec, cashierId, () => syncPackSlotState(exec, shopAId, eggsProductId, 10));
    expect(result.ok).toBe(true);
    expect(Number(result.pack_cost_units_depleted)).toBe(10);
    expect(await currentDepleted(exec, eggsProductId)).toBe(10);
  });

  it("4. an out-of-order/stale push (a lower value from a lagging device) never regresses the counter", async () => {
    const result = await asUser(exec, cashierId, () => syncPackSlotState(exec, shopAId, eggsProductId, 3));
    expect(result.ok).toBe(true);
    // GREATEST(10, 3) = 10 — the earlier, more-advanced value wins.
    expect(Number(result.pack_cost_units_depleted)).toBe(10);
    expect(await currentDepleted(exec, eggsProductId)).toBe(10);
  });

  it("5. a viewer (still cashier-or-above tier) can also push this — it is routine operational sync, not a sensitive financial correction", async () => {
    const result = await asUser(exec, viewerId, () => syncPackSlotState(exec, shopAId, eggsProductId, 12));
    expect(result.ok).toBe(true);
    expect(Number(result.pack_cost_units_depleted)).toBe(12);
  });

  it("6. a user with no membership in the shop is forbidden", async () => {
    const result = await asUser(exec, outsiderId, () => syncPackSlotState(exec, shopAId, eggsProductId, 20));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
    // Unaffected by the rejected call.
    expect(await currentDepleted(exec, eggsProductId)).toBe(12);
  });

  it("7. cross-shop: a shop A member has no membership in shop B, so the auth gate rejects before any product lookup happens", async () => {
    const result = await asUser(exec, cashierId, () => syncPackSlotState(exec, shopBId, eggsProductId, 5));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("8. unauthenticated call is rejected", async () => {
    const { rows } = await exec.query<Record<string, unknown>>(
      `SELECT public.shop_sync_product_pack_slot_state($1::uuid, $2::uuid, $3::numeric) AS result`,
      [shopAId, eggsProductId, 5],
    );
    const result = rpcJson(rows[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_authenticated");
  });

  it("9. rejects a negative value (invalid_arguments) rather than silently accepting it", async () => {
    const result = await asUser(exec, cashierId, () => syncPackSlotState(exec, shopAId, eggsProductId, -1));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_arguments");
  });
});
