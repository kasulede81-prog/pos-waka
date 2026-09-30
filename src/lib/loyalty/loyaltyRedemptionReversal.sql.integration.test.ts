import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
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
 * LOYALTY PHASE D — redemption reversal.
 *
 * THE HISTORICAL-SNAPSHOT TESTS ARE THE POINT. A reversal must credit what the redemption
 * actually cost, so the tests re-price the reward, re-write the earn rule and move the
 * account balance between the redemption and the reversal, then assert the credited amount
 * is unchanged. A reversal that read `points_required` would pass a naive happy-path test
 * and fail every one of these.
 *
 * THE DOUBLE-CREDIT TESTS ARE THE OTHER HALF. Two merchants clicking "reverse" at once must
 * produce ONE credit. The status check alone cannot promise that — the unique index is the
 * guarantee — so the tests attack that directly rather than around it.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function newCustomer(): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    f.shopAId,
    "Reversal Customer",
  ]);
  return id;
}

/** A funded, redeemable reward. Returns the reward id. */
async function makeReward(points: number, name = "Free Coke"): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, reward_kind, active)
     VALUES ($1, $2, $3, $4, 'custom', true)`,
    [id, f.shopAId, name, points],
  );
  return id;
}

/** Earn `points` by completing a sale, and return the account id. */
async function fundedAccount(customerId: string, points: number): Promise<string> {
  await insertCompletedSale(exec, f, { totalUgx: points * 1_000, customerId });
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [f.shopAId, customerId],
  );
  return r.rows[0]!.id;
}

async function redeem(asUserId: string, accountId: string, rewardId: string, key: string) {
  const r = await asUser(exec, asUserId, async () =>
    exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
      f.shopAId,
      accountId,
      rewardId,
      key,
    ]),
  );
  return rpcJson(r.rows[0]);
}

async function reverse(asUserId: string, redemptionId: string, note?: string) {
  const r = await asUser(exec, asUserId, async () =>
    exec.query(`SELECT public.loyalty_reverse_redemption($1, $2, $3) AS result`, [
      f.shopAId,
      redemptionId,
      note ?? null,
    ]),
  );
  return rpcJson(r.rows[0]);
}

async function redemptionRow(id: string) {
  const r = await exec.query<{
    id: string;
    status: string;
    points_spent: number;
    reward_id: string;
    account_id: string;
    ledger_transaction_id: string;
    note: string | null;
  }>(`SELECT * FROM public.loyalty_redemptions WHERE id = $1`, [id]);
  return r.rows[0]!;
}

async function accountState(accountId: string) {
  const r = await exec.query<{
    balance_points: number;
    lifetime_earned_points: number;
    lifetime_redeemed_points: number;
  }>(
    `SELECT balance_points, lifetime_earned_points, lifetime_redeemed_points
     FROM public.loyalty_accounts WHERE id = $1`,
    [accountId],
  );
  return r.rows[0]!;
}

const invariant = (accountId: string) =>
  asUser(exec, f.ownerAId, async () =>
    exec.query(`SELECT public.loyalty_assert_balance_invariant($1) AS result`, [accountId]),
  );

/** Redeem, then hand back both ids. */
async function setUpRedemption(points = 500, funded = 1_000) {
  const customerId = await newCustomer();
  const accountId = await fundedAccount(customerId, funded);
  const rewardId = await makeReward(points);
  const redeemed = await redeem(f.ownerAId, accountId, rewardId, `key-${crypto.randomUUID()}`);
  expect(redeemed.ok, JSON.stringify(redeemed)).toBe(true);
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_redemptions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [accountId],
  );
  return { customerId, accountId, rewardId, redemptionId: r.rows[0]!.id };
}

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
  await enableProgram(exec, f.shopBId);
}, T);

afterAll(async () => {
  await exec?.close();
});

// ===========================================================================
// 1, 2, 9, 10, 11 — the reversal itself
// ===========================================================================

describe("1-2, 9-11. a reversal credits the historical amount as a new ledger row", () => {
  it("1. a redemption creates the ledger state it always did", async () => {
    const { accountId, redemptionId } = await setUpRedemption(500, 1_000);
    const rd = await redemptionRow(redemptionId);
    expect(rd.status).toBe("completed");
    expect(Number(rd.points_spent)).toBe(500);

    const ledger = await exec.query<{ kind: string; points: number; cause: string }>(
      `SELECT kind, points, cause FROM public.loyalty_transactions WHERE id = $1`,
      [rd.ledger_transaction_id],
    );
    expect(ledger.rows[0]).toMatchObject({ kind: "redeemed", cause: "redemption" });
    expect(Number(ledger.rows[0]!.points)).toBe(-500);
    expect((await accountState(accountId)).balance_points).toBe(500);
  });

  it("2 & 10 & 11. an authorized merchant reverses it, and the points come back exactly", async () => {
    const { accountId, redemptionId } = await setUpRedemption(500, 1_000);
    const before = await accountState(accountId);
    expect(before.balance_points).toBe(500);

    const r = await reverse(f.ownerAId, redemptionId, "customer changed their mind");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(Number(r.points_restored)).toBe(500);
    expect(Number(r.balance_points)).toBe(1_000);

    // A NEW ledger row exists…
    const reversal = await exec.query<{
      kind: string;
      points: number;
      cause: string;
      reversal_of_id: string;
      note: string;
    }>(
      `SELECT kind, points, cause, reversal_of_id, note FROM public.loyalty_transactions WHERE id = $1`,
      [r.transaction_id],
    );
    expect(reversal.rows[0]).toMatchObject({ kind: "adjusted", cause: "redemption_reversal" });
    expect(Number(reversal.rows[0]!.points)).toBe(500);
    expect(reversal.rows[0]!.note).toBe("customer changed their mind");

    // …linked to the original, which is untouched (9).
    const original = await exec.query<{ points: number; kind: string }>(
      `SELECT points, kind FROM public.loyalty_transactions WHERE id = $1`,
      [(await redemptionRow(redemptionId)).ledger_transaction_id],
    );
    expect(original.rows[0]).toMatchObject({ kind: "redeemed" });
    expect(Number(original.rows[0]!.points)).toBe(-500);
    expect(reversal.rows[0]!.reversal_of_id).toBe((await redemptionRow(redemptionId)).ledger_transaction_id);
  });

  it("7 & 3p. the redemption is voided, and keeps its historical point cost", async () => {
    const { redemptionId } = await setUpRedemption(500, 1_000);
    expect((await reverse(f.ownerAId, redemptionId)).ok).toBe(true);

    const rd = await redemptionRow(redemptionId);
    expect(rd.status).toBe("void");
    // 3p — the historical cost is still there: this is what makes the audit readable.
    expect(Number(rd.points_spent)).toBe(500);
    expect(rd.ledger_transaction_id).not.toBeNull();
    expect(rd.reward_id).toBeTruthy();
  });
});

// ===========================================================================
// 12, 13, 14, 15 — the historical snapshot rule
// ===========================================================================

describe("12-15. nothing about TODAY may change what a reversal is worth", () => {
  it("12 & 13. re-pricing the reward does not change the reversal", async () => {
    const { accountId, rewardId, redemptionId } = await setUpRedemption(500, 1_000);
    // The merchant now charges 800 for the same reward.
    await exec.query(`UPDATE public.loyalty_rewards SET points_required = 800 WHERE id = $1`, [rewardId]);

    const r = await reverse(f.ownerAId, redemptionId);
    expect(Number(r.points_restored)).toBe(500); // NOT 800
    expect((await accountState(accountId)).balance_points).toBe(1_000);
  });

  it("13b. retiring or re-kinding the reward does not change the reversal", async () => {
    const { accountId, rewardId, redemptionId } = await setUpRedemption(300, 1_000);
    await exec.query(
      `UPDATE public.loyalty_rewards SET active = false, reward_kind = 'voucher', name = 'Renamed' WHERE id = $1`,
      [rewardId],
    );

    const r = await reverse(f.ownerAId, redemptionId);
    expect(Number(r.points_restored)).toBe(300);
    expect((await accountState(accountId)).balance_points).toBe(1_000);
  });

  it("14. changing the earn rule does not change the reversal", async () => {
    const { accountId, redemptionId } = await setUpRedemption(500, 1_000);
    await exec.query(
      `UPDATE public.loyalty_programs SET earn_unit_ugx = 200, earn_points_per_unit = 5 WHERE shop_id = $1`,
      [f.shopAId],
    );

    const r = await reverse(f.ownerAId, redemptionId);
    expect(Number(r.points_restored)).toBe(500);
    expect((await accountState(accountId)).balance_points).toBe(1_000);

    await exec.query(`UPDATE public.loyalty_programs SET earn_unit_ugx = 1000, earn_points_per_unit = 1 WHERE shop_id = $1`, [
      f.shopAId,
    ]);
  });

  it("15 & 11b. later activity is preserved: the reversal is ADDITIVE", async () => {
    const { customerId, accountId, redemptionId } = await setUpRedemption(500, 1_000);
    expect((await accountState(accountId)).balance_points).toBe(500);

    // The customer earns 200 more afterwards (the brief's own example).
    await insertCompletedSale(exec, f, { totalUgx: 200_000, customerId });
    expect((await accountState(accountId)).balance_points).toBe(700);

    const r = await reverse(f.ownerAId, redemptionId);
    // 700 + 500 = 1,200 — NOT a reset to the historical 1,000.
    expect(Number(r.balance_points)).toBe(1_200);
    expect((await accountState(accountId)).balance_points).toBe(1_200);
  });
});

// ===========================================================================
// 3, 4, 5, 6, 19 — authorization and linkage
// ===========================================================================

describe("3-6, 19. who may reverse, and whose redemption", () => {
  it("3. a loyalty member cannot reverse a redemption", async () => {
    const { redemptionId } = await setUpRedemption(500, 1_000);
    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "member-d@test.local"]);
    await asUser(exec, userId, async () =>
      exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["Member D", "+256700920001"]),
    );

    const r = await reverse(userId, redemptionId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    expect((await redemptionRow(redemptionId)).status).toBe("completed");
  });

  it("4. anonymous access is refused by grant", async () => {
    const { redemptionId } = await setUpRedemption(500, 1_000);
    await expect(
      asAnon(exec, async () =>
        exec.query(`SELECT public.loyalty_reverse_redemption($1, $2) AS result`, [f.shopAId, redemptionId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("5. another merchant cannot reverse this shop's redemption, even knowing the id", async () => {
    const { redemptionId, accountId } = await setUpRedemption(500, 1_000);
    // `outsiderId` owns shop B: authorized for their own shop, not for shop A.
    const r = await reverse(f.outsiderId, redemptionId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    expect((await redemptionRow(redemptionId)).status).toBe("completed");
    expect((await accountState(accountId)).balance_points).toBe(500); // nothing credited
  });

  it("5b. a shop A manager may reverse (least privilege matches redemption)", async () => {
    const { redemptionId, accountId } = await setUpRedemption(500, 1_000);
    // `cashierAId` is the cashier — the same role that may redeem.
    const r = await reverse(f.cashierAId, redemptionId);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await accountState(accountId)).balance_points).toBe(1_000);
  });

  it("6. a nonexistent redemption is rejected", async () => {
    const r = await reverse(f.ownerAId, crypto.randomUUID());
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_found");
  });

  it("19. a shop id from another shop does not reach a redemption", async () => {
    const { redemptionId } = await setUpRedemption(500, 1_000);
    // The owner asks through shop B, which they do not control and which holds no such row.
    const r = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_reverse_redemption($1, $2) AS result`, [f.shopBId, redemptionId]),
        )
      ).rows[0],
    );
    expect(r.ok).toBe(false);
    expect(["forbidden", "not_found"]).toContain(String(r.error));
    expect((await redemptionRow(redemptionId)).status).toBe("completed");
  });
});

// ===========================================================================
// 8, 18, 16 — double reversal and concurrency
// ===========================================================================

describe("8, 16, 18. a redemption can be reversed exactly once", () => {
  it("8. a second attempt is refused and credits nothing", async () => {
    const { accountId, redemptionId } = await setUpRedemption(500, 1_000);
    expect((await reverse(f.ownerAId, redemptionId)).ok).toBe(true);
    const afterFirst = await accountState(accountId);
    expect(afterFirst.balance_points).toBe(1_000);

    const second = await reverse(f.ownerAId, redemptionId);
    expect(second.ok).toBe(false);
    expect(second.error).toBe("already_reversed");

    const afterSecond = await accountState(accountId);
    expect(afterSecond.balance_points).toBe(afterFirst.balance_points);
    // Exactly one reversal row exists for the original.
    const reversals = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.loyalty_transactions
       WHERE reversal_of_id = $1 AND cause = 'redemption_reversal'`,
      [(await redemptionRow(redemptionId)).ledger_transaction_id],
    );
    expect(Number(reversals.rows[0]!.n)).toBe(1);
  });

  it("18. the DATABASE refuses a second reversal row even if the status check is bypassed", async () => {
    // The status check is not the guarantee — this index is. Simulate two callers that both
    // saw `completed` by inserting the row directly, as the loser of the race would.
    const { accountId, redemptionId } = await setUpRedemption(500, 1_000);
    const rd = await redemptionRow(redemptionId);
    const insert = () =>
      exec.query(
        `INSERT INTO public.loyalty_transactions
           (shop_id, account_id, kind, points, cause, reversal_of_id, idempotency_key, actor_source)
         VALUES ($1, $2, 'adjusted', 500, 'redemption_reversal', $3, $4, 'staff')`,
        [f.shopAId, accountId, rd.ledger_transaction_id, `race-${crypto.randomUUID()}`],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key|unique/i);
  });

  it("18b. repeated sequential attempts cannot accumulate credits", async () => {
    const { accountId, redemptionId } = await setUpRedemption(400, 1_000);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await reverse(f.ownerAId, redemptionId));

    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => r.error === "already_reversed").length).toBe(3);
    expect((await accountState(accountId)).balance_points).toBe(1_000);
  });

  it("17 & 16. the balance invariant holds after a reversal", async () => {
    const { accountId, redemptionId } = await setUpRedemption(500, 1_000);
    expect((await reverse(f.ownerAId, redemptionId)).ok).toBe(true);

    const r = rpcJson((await invariant(accountId)).rows[0]);
    expect(r.ok).toBe(true);
    expect(r.holds).toBe(true);
    expect(Number(r.balance_points)).toBe(1_000);
    expect(Number(r.ledger_sum)).toBe(1_000);
  });
});

// ===========================================================================
// 20 — lifetime counters
// ===========================================================================

describe("20. lifetime counters follow the documented invariant", () => {
  it("a reversal does NOT inflate lifetime earned, and un-counts the redemption", async () => {
    const { accountId, redemptionId } = await setUpRedemption(500, 1_000);
    const before = await accountState(accountId);
    expect(before).toMatchObject({
      balance_points: 500,
      lifetime_earned_points: 1_000,
      lifetime_redeemed_points: 500,
    });

    expect((await reverse(f.ownerAId, redemptionId)).ok).toBe(true);
    const after = await accountState(accountId);
    expect(after.lifetime_earned_points).toBe(1_000); // NOT 1,500
    expect(after.lifetime_redeemed_points).toBe(0); // the redemption is un-counted
    // The invariant the whole ledger rests on.
    expect(after.balance_points).toBe(after.lifetime_earned_points - after.lifetime_redeemed_points);
  });
});

// ===========================================================================
// 21, 22, 23 — the phases that read this data
// ===========================================================================

describe("21-23. Phases A, B and C stay correct", () => {
  it("21. member activity shows the reversal as its own event", async () => {
    const { redemptionId, customerId, accountId } = await setUpRedemption(500, 1_000);
    // Link a member to the account so the member-side projection can see it.
    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "act-d@test.local"]);
    const member = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["Act D", "+256700920002"]),
        )
      ).rows[0],
    );
    await exec.query(
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
       VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
      [member.member_id, accountId, f.shopAId],
    );
    expect(customerId).toBeTruthy();

    expect((await reverse(f.ownerAId, redemptionId)).ok).toBe(true);

    const activity = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_activity(20, null, null) AS result`),
        )
      ).rows[0],
    ) as never as { items: { kind: string; cause: string; points: number }[] };

    const causes = activity.items.map((i) => i.cause);
    expect(causes).toContain("redemption");
    expect(causes).toContain("redemption_reversal");
    // The member can tell the two apart, and the credit is positive.
    const reversal = activity.items.find((i) => i.cause === "redemption_reversal")!;
    expect(Number(reversal.points)).toBe(500);
  });

  it("22. member rewards: the restored points are spendable and the limit frees up", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward(500, "One Only");
    await exec.query(
      `UPDATE public.loyalty_rewards SET max_redemptions_per_account = 1 WHERE id = $1`,
      [rewardId],
    );

    const first = await redeem(f.ownerAId, accountId, rewardId, `limit-${crypto.randomUUID()}`);
    expect(first.ok).toBe(true);
    const redemptionId = (
      await exec.query<{ id: string }>(
        `SELECT id FROM public.loyalty_redemptions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [accountId],
      )
    ).rows[0]!.id;

    expect((await reverse(f.ownerAId, redemptionId)).ok).toBe(true);

    // The limit counts COMPLETED redemptions, so voiding one frees the slot…
    const row = await exec.query<{ points_required: number }>(
      `SELECT points_required FROM public.loyalty_rewards WHERE id = $1`,
      [rewardId],
    );
    expect(Number(row.rows[0]!.points_required)).toBe(500);
    expect((await accountState(accountId)).balance_points).toBe(1_000);

    // …and the restored points can actually be spent again. This is the assertion that
    // fails if the reversal leaves the earn lots consumed without creating a new lot.
    const second = await redeem(f.ownerAId, accountId, rewardId, `limit-again-${crypto.randomUUID()}`);
    expect(second.ok, JSON.stringify(second)).toBe(true);
  });

  it("23. Customer 360 shows the voided redemption and the corrected figures", async () => {
    const { customerId, accountId, redemptionId } = await setUpRedemption(500, 1_000);
    expect((await reverse(f.ownerAId, redemptionId)).ok).toBe(true);
    expect(accountId).toBeTruthy();

    const profile = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.shop_customer_360($1, $2, 10) AS result`, [f.shopAId, customerId]),
        )
      ).rows[0],
    ) as never as {
      loyalty: { balance_points: number; lifetime_redeemed_points: number };
      rewards: { redemption_count: number; points_redeemed: number; items: { id: string; times_redeemed: number }[] };
      recent_redemptions: { status: string; points_spent: number }[];
    };

    // The balance and the counters agree with the account.
    expect(Number(profile.loyalty.balance_points)).toBe(1_000);
    expect(Number(profile.loyalty.lifetime_redeemed_points)).toBe(0);
    // The voided redemption is still VISIBLE, with its historical cost.
    const shown = profile.recent_redemptions.find((r) => r.status === "void");
    expect(shown, "the voided redemption must remain visible").toBeDefined();
    expect(Number(shown!.points_spent)).toBe(500);
    // …but it no longer counts as a completed redemption or as redeemed points.
    expect(Number(profile.rewards.redemption_count)).toBe(0);
    expect(Number(profile.rewards.points_redeemed)).toBe(0);
  });
});

// ===========================================================================
// 24, 25, 26 — payload safety and immutability
// ===========================================================================

describe("24-26. safety and immutability", () => {
  it("24. no QR or public-card token is involved anywhere", async () => {
    const { accountId, redemptionId } = await setUpRedemption(500, 1_000);
    const r = await reverse(f.ownerAId, redemptionId);
    const payload = JSON.stringify(r);
    expect(payload).not.toContain("qr_token");
    expect(payload).not.toContain("public_card_token");

    const who = await exec.query<{ qr_token: string | null }>(
      `SELECT qr_token FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(who.rows[0]!.qr_token).toBeTruthy();
    expect(payload).not.toContain(who.rows[0]!.qr_token!);
  });

  it("25. the original reward and customer remain auditable", async () => {
    const { accountId, rewardId, redemptionId } = await setUpRedemption(500, 1_000);
    const r = await reverse(f.ownerAId, redemptionId);

    const summary = await exec.query<{
      reward_name: string;
      customer_name: string;
      points_spent: number;
    }>(
      `SELECT rw.name AS reward_name, c.name AS customer_name, rd.points_spent
       FROM public.loyalty_redemptions rd
       JOIN public.loyalty_rewards rw ON rw.id = rd.reward_id
       JOIN public.loyalty_accounts a ON a.id = rd.account_id
       JOIN public.customers c ON c.id = a.customer_id
       WHERE rd.id = $1`,
      [redemptionId],
    );
    expect(summary.rows[0]!.reward_name).toBe("Free Coke");
    expect(summary.rows[0]!.customer_name).toBe("Reversal Customer");
    expect(Number(summary.rows[0]!.points_spent)).toBe(500);
    expect(accountId).toBeTruthy();

    // The reversal snapshot records which reward and which price, for the audit trail.
    const snapshot = await exec.query<{ rule_snapshot: Record<string, unknown> }>(
      `SELECT rule_snapshot FROM public.loyalty_transactions WHERE id = $1`,
      [r.transaction_id],
    );
    expect(snapshot.rows[0]!.rule_snapshot.reward_id).toBe(rewardId);
    expect(Number(snapshot.rows[0]!.rule_snapshot.points_restored)).toBe(500);
    expect(snapshot.rows[0]!.rule_snapshot.reversal_basis).toBe("historical_redemption_snapshot");
  });

  it("26. neither the original nor the reversal can be rewritten through the normal path", async () => {
    const { redemptionId, accountId } = await setUpRedemption(500, 1_000);
    const r = await reverse(f.ownerAId, redemptionId);
    expect(r.ok, JSON.stringify(r)).toBe(true); // the reversal exists to be attacked

    // The Phase 0 append-only guard still refuses a browser UPDATE…
    await expect(
      asUser(exec, f.ownerAId, async () => {
        await exec.query(`UPDATE public.loyalty_transactions SET points = 9999 WHERE id = $1`, [
          (await redemptionRow(redemptionId)).ledger_transaction_id,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);

    // …and a REVERSAL row specifically is refused by the database when a privileged
    // non-owner — service_role, which holds BYPASSRLS — tries to rewrite it. The row must
    // exist for the guard to fire, so one is written first.
    const nonOwner = await createLoyaltySqlHarness({ productionGrants: true });
    try {
      const rf = await seedLoyaltyFixture(nonOwner);
      await enableProgram(nonOwner, rf.shopAId);
      // A customer with a loyalty account, so a reversal row can reference one.
      const accountId = crypto.randomUUID();
      await nonOwner.query(
        `INSERT INTO public.loyalty_accounts (id, shop_id, customer_id) VALUES ($1, $2, $3)`,
        [accountId, rf.shopAId, rf.customerAId],
      );

      const reversalId = crypto.randomUUID();
      await nonOwner.query(
        `INSERT INTO public.loyalty_transactions (id, shop_id, account_id, kind, points, cause, actor_source)
         VALUES ($1, $2, $3, 'adjusted', 10, 'redemption_reversal', 'staff')`,
        [reversalId, rf.shopAId, accountId],
      );
      const seeded = await nonOwner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.loyalty_transactions WHERE id = $1`,
        [reversalId],
      );
      expect(Number(seeded.rows[0]!.n)).toBe(1); // the premise: a row exists to attack

      await nonOwner.exec("GRANT SELECT, UPDATE ON public.loyalty_transactions TO service_role");
      await nonOwner.exec(
        `CREATE POLICY tmp_pd_select ON public.loyalty_transactions FOR SELECT TO service_role USING (true)`,
      );
      await nonOwner.exec(
        `CREATE POLICY tmp_pd_update ON public.loyalty_transactions FOR UPDATE TO service_role USING (true) WITH CHECK (true)`,
      );
      await nonOwner.exec("BEGIN");
      await nonOwner.exec("SET LOCAL ROLE service_role");
      await expect(
        nonOwner.query(`UPDATE public.loyalty_transactions SET points = 1 WHERE id = $1`, [reversalId]),
      ).rejects.toThrow(/append-only/i);
      await nonOwner.exec("ROLLBACK");
    } finally {
      await nonOwner.close();
    }
    expect(accountId).toBeTruthy();
    expect((await redemptionRow(redemptionId)).status).toBe("void");
    expect((await accountState(accountId)).balance_points).toBe(1_000);
  });

  it("the reversal row cannot be made negative, whatever a caller tries", async () => {
    // The CHECK ties the amount to the cause, so the counter arithmetic can never be
    // reached with a negative "reversal".
    await expect(
      exec.query(
        `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause, actor_source)
         VALUES ($1, $2, 'adjusted', -100, 'redemption_reversal', 'staff')`,
        [f.shopAId, (await setUpRedemption(100, 1_000)).accountId],
      ),
    ).rejects.toThrow(/check constraint|violates/i);
  });
});
