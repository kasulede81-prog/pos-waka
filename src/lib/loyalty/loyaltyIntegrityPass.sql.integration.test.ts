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
 * LOYALTY PHASE 0 — the integrity pass.
 *
 * Four issues the architecture audit raised are corrected by
 * `20260930090000_loyalty_integrity_pass.sql`; this file is the regression net for
 * each, and it pins the exact semantics of the two settled WITHOUT a code change so
 * they cannot be silently re-interpreted later.
 *
 *   1. a return reverses the ORIGINAL award, and a rate edit cannot move it
 *   2. min_eligible_spend_ugx is a DEDUCTIBLE, not a gate (intentional)
 *   3. the ledger refuses UPDATE from any non-owner role
 *   4. the balance invariant can be asserted, and the checker detects real drift
 *   5. a failed award is recorded and retryable instead of lost in a warning
 *
 * EVERY TEST USES ITS OWN CUSTOMER. Balances accumulate per loyalty account, so
 * sharing a customer between cases would make each assertion depend on the ones
 * before it.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
}, T);

afterAll(async () => {
  await exec?.close();
});

/** A customer of shop A, used by exactly one test. */
async function newCustomer(shopId: string = f.shopAId): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.customers (id, shop_id, name, phone_e164) VALUES ($1, $2, $3, $4)`,
    [id, shopId, "Test Customer", null],
  );
  return id;
}

/** The shop's program, reset to a known rule for the duration of one test. */
async function enable(
  shopId: string = f.shopAId,
  opts: { earnUnitUgx?: number; earnPointsPerUnit?: number; minEligibleSpendUgx?: number } = {},
): Promise<void> {
  await exec.query(`DELETE FROM public.loyalty_programs WHERE shop_id = $1`, [shopId]);
  await enableProgram(exec, shopId, opts);
  await exec.query(`UPDATE public.loyalty_programs SET enabled = true WHERE shop_id = $1`, [shopId]);
}

async function balanceOf(shopId: string, customerId: string): Promise<number> {
  const r = await exec.query<{ balance_points: number }>(
    `SELECT balance_points FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, customerId],
  );
  return Number(r.rows[0]?.balance_points ?? 0);
}

async function accountIdOf(shopId: string, customerId: string): Promise<string> {
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, customerId],
  );
  return r.rows[0]!.id;
}

async function addReturn(saleId: string, shopId: string, refundUgx: number, productId: string): Promise<string> {
  const id = crypto.randomUUID();
  // `product_id` and `quantity` are NOT NULL on sale_returns: a return is a
  // line-level event (migration 062), not a bare amount.
  await exec.query(
    `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, shopId, saleId, productId, 1, refundUgx],
  );
  return id;
}

const reverseReturn = (returnId: string) =>
  exec.query(`SELECT public.loyalty_reverse_for_return($1) AS result`, [returnId]);

// ===========================================================================
// 1. Return reversal is proportional to the ORIGINAL award
// ===========================================================================

describe("1. a return reverses the ORIGINAL award, not the current earn rate", () => {
  /**
   * NOTE ON HOW REVERSALS HAPPEN. Inserting a `sale_returns` row fires
   * `trg_loyalty_sale_returns`, which performs the reversal — `loyalty_reverse_for_return`
   * is trigger-only and revoked from every client role. These tests therefore assert on
   * what the TRIGGER did (the ledger row and the balance), and call the RPC explicitly
   * only where the point is idempotency.
   */
  const reversalRowFor = async (returnId: string) => {
    const r = await exec.query<{ points: number; rule_snapshot: Record<string, unknown> }>(
      `SELECT points, rule_snapshot FROM public.loyalty_transactions
       WHERE source_return_id = $1 AND kind = 'reversed'`,
      [returnId],
    );
    return r.rows[0];
  };

  it("a rate change between sale and return cannot move the clawback", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 100_000, customerId });
    expect(await balanceOf(f.shopAId, customerId)).toBe(100); // 100,000 / 1,000

    // The merchant now makes a unit FIVE TIMES cheaper.
    await exec.query(`UPDATE public.loyalty_programs SET earn_unit_ugx = 200 WHERE shop_id = $1`, [f.shopAId]);

    // A quarter of the sale comes back. Proportional to the original award that is
    // 25 points. The OLD code recomputed at the new rate: 25,000 / 200 = 125 points,
    // which is more than the sale ever awarded.
    const returnId = await addReturn(saleId, f.shopAId, 25_000, f.productAId);

    expect(Number((await reversalRowFor(returnId))!.points)).toBe(-25);
    expect(await balanceOf(f.shopAId, customerId)).toBe(75);
  });

  it("a full return reverses exactly the original award", async () => {
    await enable(undefined, { earnUnitUgx: 1000, earnPointsPerUnit: 1 });
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 47_500, customerId });
    expect(await balanceOf(f.shopAId, customerId)).toBe(47); // floor(47500/1000)

    const returnId = await addReturn(saleId, f.shopAId, 47_500, f.productAId);
    expect(Number((await reversalRowFor(returnId))!.points)).toBe(-47);
    expect(await balanceOf(f.shopAId, customerId)).toBe(0);
  });

  it("successive partial returns sum to the original award and never exceed it", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 100_000, customerId });
    expect(await balanceOf(f.shopAId, customerId)).toBe(100);

    for (const refund of [40_000, 40_000, 40_000]) {
      await addReturn(saleId, f.shopAId, refund, f.productAId);
    }

    // 40 + 40 + 40 = 120 points requested against a 100-point award: the outstanding
    // cap holds the total at exactly the original award, never beyond it.
    const total = await exec.query<{ reversed: number }>(
      `SELECT coalesce(-sum(points), 0)::int AS reversed FROM public.loyalty_transactions
       WHERE source_sale_id = $1 AND kind = 'reversed'`,
      [saleId],
    );
    expect(Number(total.rows[0]!.reversed)).toBe(100);
    expect(await balanceOf(f.shopAId, customerId)).toBe(0);
  });

  it("preserves the ORIGINAL rule snapshot on the reversal row, for audit", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 50_000, customerId });
    // The rule is edited AFTER the award, so the snapshot is the only surviving
    // record of what actually happened.
    await exec.query(`UPDATE public.loyalty_programs SET earn_unit_ugx = 250 WHERE shop_id = $1`, [f.shopAId]);

    const returnId = await addReturn(saleId, f.shopAId, 10_000, f.productAId);
    const snap = (await reversalRowFor(returnId))!.rule_snapshot;

    expect(snap.reversal_basis).toBe("proportional_to_original_award");
    expect(Number(snap.earned_points)).toBe(50);
    expect(Number(snap.sale_total_ugx)).toBe(50_000);
    expect(Number(snap.refund_amount_ugx)).toBe(10_000);
    // The rule that ACTUALLY awarded the points — not the edited one.
    expect(Number((snap.original_rule_snapshot as Record<string, unknown>).earn_unit_ugx)).toBe(1000);
  });

  it("refuses an explicit second reversal of the same return", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 20_000, customerId });
    const returnId = await addReturn(saleId, f.shopAId, 5_000, f.productAId);

    // The trigger already reversed it; the RPC is idempotent on top of that.
    const again = rpcJson((await reverseReturn(returnId)).rows[0]);
    expect(again.ok).toBe(true);
    expect(again.reversed).toBe(false);
    expect(again.reason).toBe("already_reversed");
    expect(await balanceOf(f.shopAId, customerId)).toBe(15);
  });

  it("never drives the balance negative (Decision 013)", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId });
    // Spend the points elsewhere first, so the award is no longer on the account.
    const accountId = await accountIdOf(f.shopAId, customerId);
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause, actor_source)
       VALUES ($1, $2, 'redeemed', -10, 'redemption', 'staff')`,
      [f.shopAId, accountId],
    );
    expect(await balanceOf(f.shopAId, customerId)).toBe(0);

    const returnId = await addReturn(saleId, f.shopAId, 10_000, f.productAId);
    expect(await reversalRowFor(returnId)).toBeUndefined();
    expect(await balanceOf(f.shopAId, customerId)).toBe(0);
  });
});

// ===========================================================================
// 2. min_eligible_spend_ugx is a DEDUCTIBLE — pinned as intentional
// ===========================================================================

describe("2. min_eligible_spend_ugx is a deductible, not a gate (intentional)", () => {
  it("deducts the threshold instead of gating on it", async () => {
    await enable(undefined, { earnUnitUgx: 1000, earnPointsPerUnit: 1, minEligibleSpendUgx: 5000 });
    const customerId = await newCustomer();

    // At or below the threshold: nothing.
    const below = await insertCompletedSale(exec, f, { totalUgx: 4_000, customerId });
    expect(await earnedPoints(below)).toBe(0);

    // Exactly at the threshold: eligible spend is zero, so still nothing.
    const exact = await insertCompletedSale(exec, f, { totalUgx: 5_000, customerId });
    expect(await earnedPoints(exact)).toBe(0);

    // ABOVE the threshold: points on the amount ABOVE it, not on the whole sale.
    // A pass/fail "minimum spend" would award 6 here; the deductible awards 1.
    const above = await insertCompletedSale(exec, f, { totalUgx: 6_000, customerId });
    expect(await earnedPoints(above)).toBe(1);

    // And the threshold is not a cap: the excess keeps earning.
    const large = await insertCompletedSale(exec, f, { totalUgx: 25_000, customerId });
    expect(await earnedPoints(large)).toBe(20); // (25,000 - 5,000) / 1,000
  });

  it("documents the semantics on the column itself", async () => {
    const r = await exec.query<{ description: string | null }>(
      `SELECT col_description('public.loyalty_programs'::regclass, ordinal_position) AS description
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'loyalty_programs'
         AND column_name = 'min_eligible_spend_ugx'`,
    );
    expect(r.rows[0]?.description ?? "").toMatch(/DEDUCTIBLE threshold, NOT a gate/);
  });

  async function earnedPoints(saleId: string): Promise<number> {
    const r = await exec.query<{ points: number }>(
      `SELECT points FROM public.loyalty_transactions WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );
    return Number(r.rows[0]?.points ?? 0);
  }
});

// ===========================================================================
// 3. The ledger refuses UPDATE from non-owner roles
// ===========================================================================

describe("3. loyalty_transactions is append-only for every non-owner role", () => {
  it("a privileged non-owner role WITH the update grant is still refused", async () => {
    // Model the threat: a role that holds UPDATE (service_role in the production
    // posture) but is not the table owner. Grants alone cannot stop this, which is
    // exactly why the guard exists.
    const privileged = await createLoyaltySqlHarness({ productionGrants: true });
    try {
      const pf = await seedLoyaltyFixture(privileged);
      await enableProgram(privileged, pf.shopAId);
      await privileged.exec("GRANT SELECT, UPDATE ON public.loyalty_transactions TO service_role");
      // The harness FORCEs RLS on the ledger, so a policy is needed to reach a row at
      // all. Production's service_role holds BYPASSRLS — this policy is what makes the
      // harness equivalent to that, so the GUARD is what gets exercised rather than
      // default-deny.
      await privileged.exec(
        `CREATE POLICY tmp_p0_service_role_select ON public.loyalty_transactions
           FOR SELECT TO service_role USING (true)`,
      );
      await privileged.exec(
        `CREATE POLICY tmp_p0_service_role_update ON public.loyalty_transactions
           FOR UPDATE TO service_role USING (true) WITH CHECK (true)`,
      );
      const saleId = await insertCompletedSale(privileged, pf, { totalUgx: 10_000, customerId: pf.customerAId });

      await privileged.exec("BEGIN");
      await privileged.exec("SET LOCAL ROLE service_role");
      await expect(
        privileged.query(`UPDATE public.loyalty_transactions SET points = 999999 WHERE source_sale_id = $1`, [
          saleId,
        ]),
      ).rejects.toThrow(/append-only/i);
      await privileged.exec("ROLLBACK");

      // The row is untouched.
      const after = await privileged.query<{ points: number }>(
        `SELECT points FROM public.loyalty_transactions WHERE source_sale_id = $1 AND kind = 'earned'`,
        [saleId],
      );
      expect(Number(after.rows[0]!.points)).toBe(10);
    } finally {
      await privileged.close();
    }
  });

  it("the browser was already refused, by grant, and still is", async () => {
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`UPDATE public.loyalty_transactions SET points = 999999`);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the owner keeps its controlled write path — the expiry engine still works", async () => {
    // Backdating `expires_at` as the owner is how the C3 expiry engine is exercised.
    // The guard must not block legitimate controlled maintenance.
    await enable();
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 5_000, customerId });
    const earned = await exec.query<{ id: string }>(
      `SELECT id FROM public.loyalty_transactions WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );
    await exec.query(
      `UPDATE public.loyalty_transactions SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [earned.rows[0]!.id],
    );
    const check = await exec.query<{ expires_at: string | null }>(
      `SELECT expires_at FROM public.loyalty_transactions WHERE id = $1`,
      [earned.rows[0]!.id],
    );
    expect(check.rows[0]!.expires_at).not.toBeNull();
  });

  it("the reversal path still writes, because it INSERTs rather than updating", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId });
    const returnId = await addReturn(saleId, f.shopAId, 10_000, f.productAId);

    // The guard blocks UPDATE, not INSERT: the reversal lands as a new ledger row.
    const r = await exec.query<{ points: number }>(
      `SELECT points FROM public.loyalty_transactions WHERE source_return_id = $1 AND kind = 'reversed'`,
      [returnId],
    );
    expect(Number(r.rows[0]!.points)).toBe(-10);
    expect(await balanceOf(f.shopAId, customerId)).toBe(0);
  });
});

// ===========================================================================
// 4. The balance invariant can be asserted
// ===========================================================================

describe("4. the balance invariant", () => {
  const invariant = (accountId: string) =>
    asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_assert_balance_invariant($1) AS result`, [accountId]),
    );

  it("holds after earning, and after a partial return", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 60_000, customerId });
    const accountId = await accountIdOf(f.shopAId, customerId);

    let r = rpcJson((await invariant(accountId)).rows[0]);
    expect(r.ok).toBe(true);
    expect(r.holds).toBe(true);
    expect(Number(r.ledger_sum)).toBe(60);

    // The return trigger performs the reversal; the invariant must still hold after it.
    const returnId = await addReturn(saleId, f.shopAId, 20_000, f.productAId);
    const reversed = await exec.query<{ points: number }>(
      `SELECT points FROM public.loyalty_transactions WHERE source_return_id = $1 AND kind = 'reversed'`,
      [returnId],
    );
    expect(Number(reversed.rows[0]!.points)).toBe(-20);

    r = rpcJson((await invariant(accountId)).rows[0]);
    expect(r.holds).toBe(true);
    expect(Number(r.balance_points)).toBe(40);
    expect(Number(r.ledger_sum)).toBe(40);
    expect(Number(r.ledger_positive_sum)).toBe(60);
    expect(Number(r.ledger_negative_sum)).toBe(20);
  });

  it("DETECTS real drift rather than always reporting success", async () => {
    // The checker is only worth anything if it can fail. Editing the cached counter
    // out of band — the audit's own tamper path — must be caught.
    await enable();
    const customerId = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 30_000, customerId });
    const accountId = await accountIdOf(f.shopAId, customerId);

    await exec.query(`UPDATE public.loyalty_accounts SET balance_points = 999 WHERE id = $1`, [accountId]);
    const r = rpcJson((await invariant(accountId)).rows[0]);

    expect(r.holds).toBe(false);
    expect(Number(r.balance_points)).toBe(999);
    expect(Number(r.ledger_sum)).toBe(30);
  });

  it("refuses a caller with no access to the account's shop", async () => {
    await enable();
    const customerId = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId });
    const accountId = await accountIdOf(f.shopAId, customerId);

    const r = rpcJson(
      (
        await asUser(exec, f.outsiderId, async () =>
          exec.query(`SELECT public.loyalty_assert_balance_invariant($1) AS result`, [accountId]),
        )
      ).rows[0],
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });
});

// ===========================================================================
// 5. A failed award is recorded and retryable
// ===========================================================================

describe("5. a failed award is recorded instead of vanishing into a warning", () => {
  /** Break a function the award depends on, complete a sale, then restore it. */
  async function completeSaleWithBrokenAward(totalUgx: number, customerId: string): Promise<string> {
    await exec.exec(
      `ALTER FUNCTION public.loyalty_apply_pending_reversals(uuid) RENAME TO loyalty_apply_pending_reversals_p0bak`,
    );
    try {
      return await insertCompletedSale(exec, f, { totalUgx, customerId });
    } finally {
      await exec.exec(
        `ALTER FUNCTION loyalty_apply_pending_reversals_p0bak(uuid) RENAME TO loyalty_apply_pending_reversals`,
      );
    }
  }

  it("records the failure AND lets the sale stand (Decision 013 preserved)", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await completeSaleWithBrokenAward(12_000, customerId);

    const sale = await exec.query<{ status: string }>(`SELECT status FROM public.sales WHERE id = $1`, [saleId]);
    expect(sale.rows[0]!.status).toBe("completed");

    const failure = await exec.query<{ operation: string; attempts: number; resolved_at: string | null }>(
      `SELECT operation, attempts, resolved_at FROM public.loyalty_award_failures WHERE sale_id = $1`,
      [saleId],
    );
    expect(failure.rows).toHaveLength(1);
    expect(failure.rows[0]!.operation).toBe("award");
    expect(failure.rows[0]!.resolved_at).toBeNull();

    // The discrepancy is real: no points were awarded.
    const earned = await exec.query(
      `SELECT 1 FROM public.loyalty_transactions WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );
    expect(earned.rows).toHaveLength(0);
  });

  it("a manager retry awards the points and closes the record", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await completeSaleWithBrokenAward(12_000, customerId);

    const retry = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_retry_failed_awards($1) AS result`, [f.shopAId]),
        )
      ).rows[0],
    );
    expect(retry.ok).toBe(true);
    expect(Number(retry.resolved)).toBeGreaterThanOrEqual(1);
    expect(Number(retry.still_failing)).toBe(0);

    const earned = await exec.query<{ points: number }>(
      `SELECT points FROM public.loyalty_transactions WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );
    expect(Number(earned.rows[0]!.points)).toBe(12);
    expect(await balanceOf(f.shopAId, customerId)).toBe(12);

    const failure = await exec.query<{ resolved_at: string | null }>(
      `SELECT resolved_at FROM public.loyalty_award_failures WHERE sale_id = $1`,
      [saleId],
    );
    expect(failure.rows[0]!.resolved_at).not.toBeNull();
  });

  it("a retry can never pay twice, because the award is idempotent", async () => {
    await enable();
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 9_000, customerId });
    expect(await balanceOf(f.shopAId, customerId)).toBe(9);

    // A stale "unresolved" record for a sale that in fact succeeded.
    await exec.query(
      `INSERT INTO public.loyalty_award_failures (shop_id, sale_id, operation, error_message)
       VALUES ($1, $2, 'award', 'simulated stale record')`,
      [f.shopAId, saleId],
    );

    const retry = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_retry_failed_awards($1) AS result`, [f.shopAId]),
        )
      ).rows[0],
    );
    expect(retry.ok).toBe(true);

    // No second award: the ledger unique index refuses it and the RPC reports it as
    // resolved rather than as a failure.
    expect(await balanceOf(f.shopAId, customerId)).toBe(9);
  });

  it("refuses a caller who cannot manage the shop", async () => {
    const r = rpcJson(
      (
        await asUser(exec, f.cashierAId, async () =>
          exec.query(`SELECT public.loyalty_retry_failed_awards($1) AS result`, [f.shopAId]),
        )
      ).rows[0],
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });

  it("a merchant sees only their own shop's failures", async () => {
    // A failure row for shop B, created as the owner.
    const saleB = await insertCompletedSale(exec, { ...f, shopAId: f.shopBId } as LoyaltyFixture, {
      totalUgx: 5_000,
      customerId: f.customerBId,
    });
    await exec.query(
      `INSERT INTO public.loyalty_award_failures (shop_id, sale_id, operation, error_message)
       VALUES ($1, $2, 'award', 'shop B failure')`,
      [f.shopBId, saleB],
    );

    const visible = await asUser(exec, f.ownerAId, async () =>
      exec.query<{ shop_id: string }>(`SELECT shop_id FROM public.loyalty_award_failures`),
    );
    expect(visible.rows.length).toBeGreaterThan(0);
    expect(visible.rows.every((row) => row.shop_id === f.shopAId)).toBe(true);
  });
});
