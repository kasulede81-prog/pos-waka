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
 * Phase 08 — Rewards & redemption integration tests (PGlite, real migration
 * files applied). Covers: catalog RLS (managers write, members read, anon
 * denied), the atomic idempotent `loyalty_redeem_reward` RPC (happy path
 * deducts exactly once, replay returns the original redemption, per-account
 * caps, inactive rewards, insufficient balance, cross-shop isolation), and
 * the ledger balance invariant after redemption.
 */

let exec: SqlExec;
let f: LoyaltyFixture;

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
  // Customer A earns 20 points (20,000 UGX at unit 1,000 = 20 pts).
  await insertCompletedSale(exec, f, { totalUgx: 20_000, customerId: f.customerAId });
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function accountIdFor(customerId: string): Promise<string> {
  const { rows } = await exec.query(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [f.shopAId, customerId],
  );
  return rows[0].id as string;
}

async function balanceOf(accountId: string): Promise<number> {
  const { rows } = await exec.query(
    `SELECT balance_points FROM public.loyalty_accounts WHERE id = $1`,
    [accountId],
  );
  return Number(rows[0].balance_points);
}

async function createRewardAs(
  userId: string,
  opts: { name: string; points: number; maxPerAccount?: number | null; active?: boolean },
): Promise<unknown> {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(
      `INSERT INTO public.loyalty_rewards
         (shop_id, name, points_required, reward_kind, max_redemptions_per_account, active)
       VALUES ($1, $2, $3, 'custom', $4, $5)
       RETURNING id`,
      [f.shopAId, opts.name, opts.points, opts.maxPerAccount ?? null, opts.active ?? true],
    );
    return rows[0].id;
  });
}

async function redeem(
  userId: string,
  accountId: string,
  rewardId: string,
  key: string,
): Promise<Record<string, unknown>> {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, null, null) AS result`,
      [f.shopAId, accountId, rewardId, key],
    );
    return rpcJson(rows[0]);
  });
}

describe("reward catalog RLS", () => {
  it("manager can create, cashier cannot, members can read, shop B cannot", async () => {
    const rewardId = await createRewardAs(f.ownerAId, { name: "RLS reward", points: 5 });

    await expect(
      asUser(exec, f.cashierAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_rewards (shop_id, name, points_required)
           VALUES ($1, 'nope', 5)`,
          [f.shopAId],
        );
      }),
    ).rejects.toThrow();

    await asUser(exec, f.cashierAId, async () => {
      const { rows } = await exec.query(
        `SELECT id FROM public.loyalty_rewards WHERE id = $1`,
        [rewardId],
      );
      expect(rows).toHaveLength(1);
    });

    await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT id FROM public.loyalty_rewards WHERE id = $1`,
        [rewardId],
      );
      expect(rows).toHaveLength(0);
    });
  });
});

describe("loyalty_redeem_reward", () => {
  let accountA: string;
  let reward10: string; // costs 10 pts, unlimited
  let capped: string; // costs 5 pts, max 1 per account

  beforeAll(async () => {
    accountA = await accountIdFor(f.customerAId);
    reward10 = (await createRewardAs(f.ownerAId, {
      name: "10-pt reward",
      points: 10,
    })) as string;
    capped = (await createRewardAs(f.ownerAId, {
      name: "Capped reward",
      points: 5,
      maxPerAccount: 1,
    })) as string;
  });

  it("happy path: deducts balance, writes redemption + negative ledger row, links them", async () => {
    const before = await balanceOf(accountA);
    const result = await redeem(f.cashierAId, accountA, reward10, crypto.randomUUID());
    expect(result.ok).toBe(true);
    expect(result.already_redeemed).toBe(false);
    expect(Number(result.points_spent)).toBe(10);

    expect(await balanceOf(accountA)).toBe(before - 10);

    const { rows } = await exec.query(
      `SELECT r.id, r.points_spent, r.ledger_transaction_id, t.kind, t.points
       FROM public.loyalty_redemptions r
       JOIN public.loyalty_transactions t ON t.id = r.ledger_transaction_id
       WHERE r.id = $1`,
      [result.redemption_id],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].points_spent)).toBe(10);
    expect(rows[0].kind).toBe("redeemed");
    expect(Number(rows[0].points)).toBe(-10);
  });

  it("idempotent replay with the same key returns the original redemption without a second deduction", async () => {
    const key = crypto.randomUUID();
    const first = await redeem(f.cashierAId, accountA, reward10, key);
    expect(first.ok).toBe(true);
    const balanceAfterFirst = await balanceOf(accountA);

    const replay = await redeem(f.cashierAId, accountA, reward10, key);
    expect(replay.ok).toBe(true);
    expect(replay.already_redeemed).toBe(true);
    expect(replay.redemption_id).toBe(first.redemption_id);

    expect(await balanceOf(accountA)).toBe(balanceAfterFirst);

    const { rows } = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_redemptions
       WHERE account_id = $1 AND idempotency_key = $2`,
      [accountA, key],
    );
    expect(rows[0].n).toBe(1);
  });

  it("enforces per-account redemption caps", async () => {
    // Top up: earlier tests spent the seed balance.
    await insertCompletedSale(exec, f, { totalUgx: 5_000, customerId: f.customerAId });
    const first = await redeem(f.cashierAId, accountA, capped, crypto.randomUUID());
    expect(first.ok).toBe(true);

    const second = await redeem(f.cashierAId, accountA, capped, crypto.randomUUID());
    expect(second.ok).toBe(false);
    expect(second.error).toBe("redemption_limit_reached");
  });

  it("rejects redemption when the balance is insufficient", async () => {
    const expensive = (await createRewardAs(f.ownerAId, {
      name: "Expensive",
      points: 100_000,
    })) as string;
    const result = await redeem(f.cashierAId, accountA, expensive, crypto.randomUUID());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("insufficient_points");
    expect(Number(result.balance)).toBe(await balanceOf(accountA));
    expect(Number(result.required)).toBe(100_000);
  });

  it("rejects inactive rewards without touching the balance", async () => {
    const inactive = (await createRewardAs(f.ownerAId, {
      name: "Inactive",
      points: 1,
      active: false,
    })) as string;
    const before = await balanceOf(accountA);
    const result = await redeem(f.cashierAId, accountA, inactive, crypto.randomUUID());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("reward_inactive");
    expect(await balanceOf(accountA)).toBe(before);
  });

  it("rejects users from another shop (forbidden)", async () => {
    const result = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_redeem_reward($1, $2, $3, $4, null, null) AS result`,
        [f.shopAId, accountA, reward10, crypto.randomUUID()],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("keeps the balance invariant: balance = earned - redeemed", async () => {
    const { rows } = await exec.query(
      `SELECT a.balance_points,
              coalesce(sum(t.points) FILTER (WHERE t.points > 0), 0) AS earned,
              coalesce(-sum(t.points) FILTER (WHERE t.points < 0), 0) AS redeemed
       FROM public.loyalty_accounts a
       LEFT JOIN public.loyalty_transactions t ON t.account_id = a.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [accountA],
    );
    expect(Number(rows[0].balance_points)).toBe(
      Number(rows[0].earned) - Number(rows[0].redeemed),
    );
  });
});
