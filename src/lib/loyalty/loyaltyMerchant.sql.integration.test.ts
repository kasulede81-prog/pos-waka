import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  enableProgram,
  insertCompletedSale,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * Phase 04 — Merchant UI RPC integration tests (PGlite, real migration
 * files applied). Covers: `loyalty_shop_overview` (access, isolation,
 * aggregates, recent activity), `loyalty_update_program` (manager upsert,
 * cashier forbidden, validation), and `loyalty_search_accounts`
 * (name/phone search, cross-shop isolation).
 */

let exec: SqlExec;
let f: LoyaltyFixture;

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  // Program + one awarded member in Shop A before any user-context test.
  await enableProgram(exec, f.shopAId);
  await insertCompletedSale(exec, f, { totalUgx: 20_000, customerId: f.customerAId });
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function overviewAs(userId: string, shopId: string) {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(`SELECT public.loyalty_shop_overview($1) AS result`, [shopId]);
    return rpcJson(rows[0]);
  });
}

describe("loyalty_shop_overview", () => {
  it("returns aggregates to a shop member", async () => {
    const result = await overviewAs(f.ownerAId, f.shopAId);
    expect(result.ok).toBe(true);
    expect(Number(result.members_total)).toBe(1);
    expect(Number(result.members_active)).toBe(1);
    expect(Number(result.points_issued)).toBe(20);
    expect(Number(result.points_redeemed)).toBe(0);
    expect(result.program).toBeTruthy();
    expect((result.program as Record<string, unknown>).enabled).toBe(true);
  });

  it("denies a user who has no access to the shop", async () => {
    const result = await overviewAs(f.outsiderId, f.shopAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("includes recent activity with the customer name", async () => {
    const result = await overviewAs(f.ownerAId, f.shopAId);
    const activity = result.recent_activity as Record<string, unknown>[];
    expect(Array.isArray(activity)).toBe(true);
    expect(activity.length).toBeGreaterThan(0);
    expect(activity[0].customer_name).toBe("Customer A");
    expect(activity[0].kind).toBe("earned");
  });

  it("returns null program for a shop without configuration", async () => {
    const result = await overviewAs(f.outsiderId, f.shopBId);
    expect(result.ok).toBe(true);
    expect(result.program).toBeNull();
    expect(Number(result.members_total)).toBe(0);
  });
});

describe("loyalty_update_program", () => {
  it("lets the owner create and update the program", async () => {
    // Shop B's owner (outsiderId) configures Shop B's program.
    const create = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_update_program($1, true, 2000, 2, 5000) AS result`,
        [f.shopBId],
      );
      return rpcJson(rows[0]);
    });
    expect(create.ok).toBe(true);

    const { rows } = await exec.query(
      `SELECT earn_unit_ugx, earn_points_per_unit, min_eligible_spend_ugx, enabled
       FROM public.loyalty_programs WHERE shop_id = $1`,
      [f.shopBId],
    );
    expect(Number(rows[0].earn_unit_ugx)).toBe(2000);
    expect(Number(rows[0].earn_points_per_unit)).toBe(2);
    expect(Number(rows[0].min_eligible_spend_ugx)).toBe(5000);
    expect(rows[0].enabled).toBe(true);

    const update = await asUser(exec, f.outsiderId, async () => {
      const { rows: r2 } = await exec.query(
        `SELECT public.loyalty_update_program($1, false, 1000, 1, 0) AS result`,
        [f.shopBId],
      );
      return rpcJson(r2[0]);
    });
    expect(update.ok).toBe(true);
    const { rows: r3 } = await exec.query(
      `SELECT enabled, earn_unit_ugx FROM public.loyalty_programs WHERE shop_id = $1`,
      [f.shopBId],
    );
    expect(r3[0].enabled).toBe(false);
    expect(Number(r3[0].earn_unit_ugx)).toBe(1000);
  });

  it("rejects cashiers (manager-only configuration)", async () => {
    const result = await asUser(exec, f.cashierAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_update_program($1, true, 1000, 1, 0) AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("rejects a user outside the shop", async () => {
    const result = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_update_program($1, true, 1000, 1, 0) AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("validates the spend rule inputs", async () => {
    for (const [unit, perUnit, minSpend, expected] of [
      [0, 1, 0, "invalid_earn_unit"],
      [1000, 0, 0, "invalid_points_per_unit"],
      [1000, 1, -5, "invalid_min_spend"],
    ] as const) {
      const result = await asUser(exec, f.ownerAId, async () => {
        const { rows } = await exec.query(
          `SELECT public.loyalty_update_program($1, true, $2, $3, $4) AS result`,
          [f.shopAId, unit, perUnit, minSpend],
        );
        return rpcJson(rows[0]);
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe(expected);
    }
  });
});

describe("loyalty_search_accounts", () => {
  it("finds members by name fragment", async () => {
    const result = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_search_accounts($1, 'Custom', 50) AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(true);
    const accounts = result.accounts as Record<string, unknown>[];
    expect(accounts).toHaveLength(1);
    expect(accounts[0].customer_name).toBe("Customer A");
    expect(Number(accounts[0].balance_points)).toBe(20);
    expect(accounts[0].customer_phone).toBe("+256700000001");
  });

  it("finds members by phone fragment and returns everything on empty query", async () => {
    const byPhone = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_search_accounts($1, '700000001', 50) AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect((byPhone.accounts as unknown[]).length).toBe(1);

    const all = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_search_accounts($1, NULL, 50) AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect((all.accounts as unknown[]).length).toBe(1);
  });

  it("does not leak members across shops", async () => {
    const outsiderSearch = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_search_accounts($1, NULL, 50) AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(outsiderSearch.ok).toBe(false);
    expect(outsiderSearch.error).toBe("forbidden");
  });

  it("returns an empty list for a shop with no members", async () => {
    const result = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_search_accounts($1, NULL, 50) AS result`,
        [f.shopBId],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(true);
    expect(result.accounts).toEqual([]);
  });
});
