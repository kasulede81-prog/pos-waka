import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * Phase 10 — Final end-to-end loyalty journey (PGlite, real migration files).
 *
 * One continuous production story, asserted step by step:
 *   merchant enables program → configures spend rule → creates a reward →
 *   customer enrolls (consent) → QR identity resolves → sale completes →
 *   points awarded once (replay cannot duplicate) → partial return reverses
 *   proportionally → void reverses a second sale → customer reaches reward
 *   threshold → merchant redeems (atomic, idempotent) → double redeem
 *   blocked → multi-tenant isolation holds → sale/financial rows untouched.
 */

let exec: SqlExec;
let f: LoyaltyFixture;

let accountA: string;
let qrToken: string;
let sale1Id: string;
let sale2Id: string;
let rewardId: string;
const redeemKey = crypto.randomUUID();

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function rpcAs(
  userId: string,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  return asUser(exec, userId, async () => rpcJson((await exec.query(sql, params)).rows[0]));
}

async function balanceOf(accountId: string): Promise<number> {
  const { rows } = await exec.query(
    `SELECT balance_points FROM public.loyalty_accounts WHERE id = $1`,
    [accountId],
  );
  return Number(rows[0].balance_points);
}

describe("E2E journey — merchant setup", () => {
  it("1-2. owner enables loyalty and configures the spend rule (1 pt per 1,000 UGX)", async () => {
    const denied = await rpcAs(
      f.cashierAId,
      `SELECT public.loyalty_update_program($1, true, 1000, 1, 0) AS result`,
      [f.shopAId],
    );
    expect(denied.ok).toBe(false);

    const saved = await rpcAs(
      f.ownerAId,
      `SELECT public.loyalty_update_program($1, true, 1000, 1, 0) AS result`,
      [f.shopAId],
    );
    expect(saved.ok).toBe(true);

    const { rows } = await exec.query(
      `SELECT enabled, earn_unit_ugx, earn_points_per_unit
       FROM public.loyalty_programs WHERE shop_id = $1`,
      [f.shopAId],
    );
    expect(rows[0].enabled).toBe(true);
    expect(Number(rows[0].earn_unit_ugx)).toBe(1000);
  });

  it("3. merchant creates a reward (manager-only), visible to shop members", async () => {
    const { rows } = await asUser(exec, f.ownerAId, async () => {
      return exec.query(
        `INSERT INTO public.loyalty_rewards (shop_id, name, points_required, reward_kind)
         VALUES ($1, 'Free Soda', 15, 'product') RETURNING id`,
        [f.shopAId],
      );
    });
    rewardId = rows[0].id as string;

    await asUser(exec, f.cashierAId, async () => {
      const visible = await exec.query(`SELECT id FROM public.loyalty_rewards WHERE id = $1`, [
        rewardId,
      ]);
      expect(visible.rows).toHaveLength(1);
    });
  });
});

describe("E2E journey — customer identity", () => {
  it("4-5. customer enrolls with consent and receives an opaque QR identity", async () => {
    const enrolled = await rpcAs(
      f.ownerAId,
      `SELECT public.loyalty_enroll_customer($1, $2, true, 'in-store signup', '{}'::jsonb) AS result`,
      [f.shopAId, f.customerAId],
    );
    expect(enrolled.ok).toBe(true);
    accountA = enrolled.account_id as string;

    const { rows } = await exec.query(
      `SELECT qr_token, metadata FROM public.loyalty_accounts WHERE id = $1`,
      [accountA],
    );
    qrToken = rows[0].qr_token as string;
    expect(qrToken).toBeTruthy();
    const metadata = rows[0].metadata as { consent?: { accepted?: boolean } };
    expect(metadata.consent?.accepted).toBe(true);
  });

  it("6. QR token identifies the customer at the counter (no personal data in the code)", async () => {
    const found = await rpcAs(
      f.cashierAId,
      `SELECT public.loyalty_account_by_token($1, $2) AS result`,
      [f.shopAId, qrToken],
    );
    expect(found.ok).toBe(true);
    expect(found.account_id).toBe(accountA);
    expect(found.customer_name).toBe("Customer A");
  });
});

describe("E2E journey — purchase & award", () => {
  it("9-13. completed sale awards 25 pts once: ledger row, balance, rule snapshot", async () => {
    sale1Id = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 25000, now())`,
      [sale1Id, f.shopAId, f.customerAId],
    );

    const { rows } = await exec.query(
      `SELECT kind, points, cause, source_sale_id, rule_snapshot
       FROM public.loyalty_transactions WHERE account_id = $1`,
      [accountA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("earned");
    expect(Number(rows[0].points)).toBe(25);
    expect(rows[0].cause).toBe("sale");
    expect(rows[0].source_sale_id).toBe(sale1Id);
    expect(Number((rows[0].rule_snapshot as { earn_unit_ugx?: number }).earn_unit_ugx)).toBe(1000);

    expect(await balanceOf(accountA)).toBe(25);
  });

  it("15-16. replaying the award (sync retry) cannot duplicate points", async () => {
    const replay = await rpcAs(
      f.cashierAId,
      `SELECT public.loyalty_award_for_sale($1) AS result`,
      [sale1Id],
    );
    expect(replay.ok).toBe(true);
    expect(replay.awarded).toBe(false);
    expect(replay.reason).toBe("already_awarded");
    expect(await balanceOf(accountA)).toBe(25);
  });
});

describe("E2E journey — refund & void", () => {
  it("18. partial return (5,000 of 25,000) reverses 5 pts via the return trigger, linked to the sale", async () => {
    const returnId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason)
       VALUES ($1, $2, $3, $4, 1, 5000, 'other')`,
      [returnId, f.shopAId, sale1Id, f.productAId],
    );

    const { rows } = await exec.query(
      `SELECT t.id, t.kind, t.points, t.reversal_of_id, t.balance_after
       FROM public.loyalty_transactions t
       JOIN public.loyalty_accounts a ON a.id = t.account_id
       WHERE a.id = $1 AND t.source_sale_id = $2
       ORDER BY t.created_at`,
      [accountA, sale1Id],
    );
    expect(rows).toHaveLength(2);
    const earned = rows.find((r) => r.kind === "earned")!;
    const reversal = rows.find((r) => r.kind === "reversed")!;
    expect(Number(reversal.points)).toBe(-5);
    expect(reversal.reversal_of_id).toBe(earned.id);
    expect(Number(reversal.balance_after)).toBe(20);

    // Replaying the reversal RPC is idempotent.
    const again = await rpcAs(
      f.cashierAId,
      `SELECT public.loyalty_reverse_for_return($1) AS result`,
      [returnId],
    );
    expect(again.reversed).toBe(false);
    expect(again.reason).toBe("already_reversed");
    expect(await balanceOf(accountA)).toBe(20);
  });

  it("19. void of a second sale reverses its award completely", async () => {
    sale2Id = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 8000, now())`,
      [sale2Id, f.shopAId, f.customerAId],
    );
    expect(await balanceOf(accountA)).toBe(28);

    const voided = await rpcAs(
      f.ownerAId,
      `SELECT public.loyalty_reverse_for_sale($1) AS result`,
      [sale2Id],
    );
    expect(voided.reversed).toBe(true);
    expect(await balanceOf(accountA)).toBe(20);
  });
});

describe("E2E journey — reward redemption", () => {
  it("20-23. eligible customer redeems: balance drops 15, paired auditable ledger row", async () => {
    const before = await balanceOf(accountA);
    expect(before).toBe(20); // ≥ 15 → eligible

    const redeemed = await rpcAs(
      f.cashierAId,
      `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, null, null) AS result`,
      [f.shopAId, accountA, rewardId, redeemKey],
    );
    expect(redeemed.ok).toBe(true);
    expect(redeemed.already_redeemed).toBe(false);
    expect(Number(redeemed.points_spent)).toBe(15);
    expect(await balanceOf(accountA)).toBe(before - 15);

    const { rows } = await exec.query(
      `SELECT t.kind, t.points, t.cause
       FROM public.loyalty_redemptions r
       JOIN public.loyalty_transactions t ON t.id = r.ledger_transaction_id
       WHERE r.id = $1`,
      [redeemed.redemption_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("redeemed");
    expect(Number(rows[0].points)).toBe(-15);
    expect(rows[0].cause).toBe("redemption");
  });

  it("24. the same redemption intent (same key) can never deduct twice", async () => {
    const replay = await rpcAs(
      f.cashierAId,
      `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, null, null) AS result`,
      [f.shopAId, accountA, rewardId, redeemKey],
    );
    expect(replay.ok).toBe(true);
    expect(replay.already_redeemed).toBe(true);
    expect(await balanceOf(accountA)).toBe(5);
  });

  it("24b. a fresh key with an insufficient balance is refused cleanly", async () => {
    const denied = await rpcAs(
      f.cashierAId,
      `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, null, null) AS result`,
      [f.shopAId, accountA, rewardId, crypto.randomUUID()],
    );
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe("insufficient_points");
    expect(await balanceOf(accountA)).toBe(5);
  });
});

describe("E2E journey — multi-tenant isolation", () => {
  it("merchant B cannot see, resolve, or redeem merchant A's loyalty data", async () => {
    // No shop A customers in shop B's directory.
    const dir = await rpcAs(
      f.outsiderId,
      `SELECT public.loyalty_search_accounts($1, '', 50) AS result`,
      [f.shopBId],
    );
    expect(dir.ok).toBe(true);
    expect(JSON.stringify(dir)).not.toContain(f.customerAId);

    // Shop A's QR token resolves to nothing at shop B.
    const wrongShop = await rpcAs(
      f.outsiderId,
      `SELECT public.loyalty_account_by_token($1, $2) AS result`,
      [f.shopBId, qrToken],
    );
    expect(wrongShop.ok).toBe(false);
    expect(wrongShop.error).toBe("not_found");

    // Shop B owner cannot redeem shop A's reward for shop A's customer.
    const steal = await rpcAs(
      f.outsiderId,
      `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, null, null) AS result`,
      [f.shopAId, accountA, rewardId, crypto.randomUUID()],
    );
    expect(steal.ok).toBe(false);
    expect(steal.error).toBe("forbidden");

    // Shop A's rewards are invisible from shop B.
    await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(`SELECT id FROM public.loyalty_rewards WHERE id = $1`, [
        rewardId,
      ]);
      expect(rows).toHaveLength(0);
    });

    // Shop A customer data untouched by all shop B attempts.
    expect(await balanceOf(accountA)).toBe(5);
  });

  it("membership is shop-scoped: the same phone at another shop is a separate account", async () => {
    await rpcAs(
      f.outsiderId,
      `SELECT public.loyalty_update_program($1, true, 1000, 1, 0) AS result`,
      [f.shopBId],
    );
    const enrolledB = await rpcAs(
      f.outsiderId,
      `SELECT public.loyalty_enroll_customer($1, $2, true, 'in-store signup', '{}'::jsonb) AS result`,
      [f.shopBId, f.customerBId],
    );
    expect(enrolledB.ok).toBe(true);
    expect(enrolledB.account_id).not.toBe(accountA);
  });
});

describe("E2E journey — financial core untouched", () => {
  it("25. loyalty operations never modified the sales record", async () => {
    const { rows } = await exec.query(
      `SELECT total_ugx, status, payment_status FROM public.sales WHERE id = $1`,
      [sale1Id],
    );
    expect(Number(rows[0].total_ugx)).toBe(25000);
    expect(rows[0].status).toBe("completed");
    expect(rows[0].payment_status).toBe("paid");
  });
});
