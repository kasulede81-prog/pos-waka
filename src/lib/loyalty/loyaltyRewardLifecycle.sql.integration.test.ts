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
 * LOYALTY PHASE F — reward lifecycle.
 *
 * THE REFUSALS ARE THE FEATURE. Deleting a reward is only allowed when it destroys nothing,
 * so most of this file is about what CANNOT be removed: a reward with a redemption, with an
 * assignment, with an offer naming it, or belonging to somebody else's shop. Each of those is
 * a historical record that the catalogue does not get to overwrite.
 *
 * The other half is proving that withdrawal (`active = false`) — the reversible archive —
 * changes nothing about history: the redemption, its points, its Phase E benefit snapshot,
 * its applied sale, the member's own view of what they redeemed, and Customer 360 all survive
 * it intact.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function newCustomer(): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    f.shopAId,
    "Lifecycle Customer",
  ]);
  return id;
}

async function fundedAccount(customerId: string, points: number, shopId = f.shopAId): Promise<string> {
  await insertCompletedSale(exec, { ...f, shopAId: shopId } as LoyaltyFixture, {
    totalUgx: points * 1_000,
    customerId,
  });
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, customerId],
  );
  return r.rows[0]!.id;
}

async function makeReward(opts: {
  name: string;
  points?: number;
  benefitKind?: "none" | "fixed_discount";
  amountUgx?: number | null;
  shopId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.loyalty_rewards
       (id, shop_id, name, points_required, reward_kind, active, benefit_kind, benefit_amount_ugx)
     VALUES ($1, $2, $3, $4, 'custom', true, $5, $6)`,
    [id, opts.shopId ?? f.shopAId, opts.name, opts.points ?? 100, opts.benefitKind ?? "none", opts.amountUgx ?? null],
  );
  return id;
}

const remove = async (asUserId: string, rewardId: string, shopId: string = f.shopAId) =>
  rpcJson(
    (
      await asUser(exec, asUserId, async () =>
        exec.query(`SELECT public.loyalty_delete_unused_reward($1, $2) AS result`, [shopId, rewardId]),
      )
    ).rows[0],
  );

const rewardExists = async (rewardId: string): Promise<boolean> => {
  const r = await exec.query(`SELECT 1 FROM public.loyalty_rewards WHERE id = $1`, [rewardId]);
  return r.rows.length > 0;
};

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
// The one removal that is safe
// ===========================================================================

describe("a reward with nothing behind it can be removed", () => {
  it("deletes an unused reward", async () => {
    const rewardId = await makeReward({ name: "Mistake", points: 50 });
    const r = await remove(f.ownerAId, rewardId);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await rewardExists(rewardId)).toBe(false);
  });

  it("deletes an unused reward that was withdrawn first", async () => {
    const rewardId = await makeReward({ name: "Never Used", points: 50 });
    await exec.query(`UPDATE public.loyalty_rewards SET active = false WHERE id = $1`, [rewardId]);
    expect((await remove(f.ownerAId, rewardId)).ok).toBe(true);
    expect(await rewardExists(rewardId)).toBe(false);
  });

  it("a manager may remove it; a cashier may not", async () => {
    const forManager = await makeReward({ name: "By Manager", points: 50 });
    expect((await remove(f.ownerAId, forManager)).ok).toBe(true);

    const forCashier = await makeReward({ name: "By Cashier", points: 50 });
    const refused = await remove(f.cashierAId, forCashier);
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("forbidden");
    expect(await rewardExists(forCashier)).toBe(true);
  });

  it("anonymous access is refused by grant", async () => {
    const rewardId = await makeReward({ name: "Anon Target", points: 50 });
    await expect(
      asAnon(exec, async () =>
        exec.query(`SELECT public.loyalty_delete_unused_reward($1, $2) AS result`, [f.shopAId, rewardId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

// ===========================================================================
// The refusals — history is not negotiable
// ===========================================================================

describe("history can never be destroyed to tidy a catalogue", () => {
  it("refuses a reward that has been REDEEMED, and says why", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({ name: "Redeemed Once", points: 100 });

    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
        f.shopAId,
        accountId,
        rewardId,
        `lifecycle-${crypto.randomUUID()}`,
      ]),
    );

    const r = await remove(f.ownerAId, rewardId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("reward_has_history");
    expect(Number(r.redemptions)).toBe(1);
    // The reward is still there, and so is the redemption.
    expect(await rewardExists(rewardId)).toBe(true);
    const rd = await exec.query(`SELECT 1 FROM public.loyalty_redemptions WHERE reward_id = $1`, [rewardId]);
    expect(rd.rows.length).toBe(1);
  });

  it("refuses a reward that has an ASSIGNMENT", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 100);
    const rewardId = await makeReward({ name: "Personally Granted", points: 50 });

    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_assign_reward($1, $2, $3) AS result`, [
        f.shopAId,
        accountId,
        rewardId,
      ]),
    );

    const r = await remove(f.ownerAId, rewardId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("reward_has_history");
    expect(Number(r.assignments)).toBe(1);
    expect(await rewardExists(rewardId)).toBe(true);
  });

  it("refuses a reward an OFFER still names", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 100);
    const rewardId = await makeReward({ name: "Granted By Offer", points: 50, benefitKind: "fixed_discount", amountUgx: 500 });

    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_create_customer_offer($1, $2, $3, $4, $5) AS result`, [
        f.shopAId,
        accountId,
        "reward_grant",
        "Offer Granting It",
        JSON.stringify({ reward_ids: [rewardId] }),
      ]),
    );

    const r = await remove(f.ownerAId, rewardId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("reward_has_history");
    expect(Number(r.offers)).toBe(1);
    expect(await rewardExists(rewardId)).toBe(true);
  });

  it("the same REDEEMED reward survives withdrawal — the archive, not the delete", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({ name: "Withdrawn", points: 100 });

    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
        f.shopAId,
        accountId,
        rewardId,
        `withdraw-${crypto.randomUUID()}`,
      ]),
    );

    // Withdraw it through the EXISTING merchant write path (no new mechanism).
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`UPDATE public.loyalty_rewards SET active = false WHERE id = $1`, [rewardId]),
    );

    // Every historical trace is intact.
    const rd = await exec.query<{ points_spent: number; status: string }>(
      `SELECT points_spent, status FROM public.loyalty_redemptions WHERE reward_id = $1`,
      [rewardId],
    );
    expect(rd.rows).toHaveLength(1);
    expect(Number(rd.rows[0]!.points_spent)).toBe(100);
    expect(rd.rows[0]!.status).toBe("completed");
    expect((await exec.query(`SELECT 1 FROM public.loyalty_rewards WHERE id = $1`, [rewardId])).rows).toHaveLength(1);
  });

  it("still refuses to delete it afterwards — withdrawal does not unlock deletion", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({ name: "Withdrawn Then Targeted", points: 100 });
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
        f.shopAId,
        accountId,
        rewardId,
        `withdraw2-${crypto.randomUUID()}`,
      ]),
    );
    await exec.query(`UPDATE public.loyalty_rewards SET active = false WHERE id = $1`, [rewardId]);
    expect((await remove(f.ownerAId, rewardId)).error).toBe("reward_has_history");
  });
});

// ===========================================================================
// Cross-shop isolation
// ===========================================================================

describe("SECURITY: lifecycle is confined to the merchant that owns the reward", () => {
  it("another shop cannot remove this shop's reward, even unused", async () => {
    const rewardId = await makeReward({ name: "A Shop Reward", points: 50 });
    // `outsiderId` owns shop B: authorized there, not here.
    const r = await remove(f.outsiderId, rewardId, f.shopBId);
    expect(r.ok).toBe(false);
    expect(["forbidden", "not_found"]).toContain(String(r.error));
    expect(await rewardExists(rewardId)).toBe(true);
  });

  it("the right shop id with the wrong owner is refused", async () => {
    const rewardId = await makeReward({ name: "Owned By A", points: 50 });
    const r = await remove(f.outsiderId, rewardId, f.shopAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    expect(await rewardExists(rewardId)).toBe(true);
  });

  it("a member cannot remove a reward", async () => {
    const rewardId = await makeReward({ name: "Member Target", points: 50 });
    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "f-member@test.local"]);
    await asUser(exec, userId, async () =>
      exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["F Member", "+256700950001"]),
    );

    const r = await remove(userId, rewardId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    expect(await rewardExists(rewardId)).toBe(true);
  });

  it("a nonexistent reward is refused", async () => {
    const r = await remove(f.ownerAId, crypto.randomUUID());
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_found");
  });
});

// ===========================================================================
// What the other phases still see afterwards
// ===========================================================================

describe("Phase B-E keep working through a lifecycle change", () => {
  it("a withdrawn monetary reward keeps its benefit snapshot, application and Customer 360 row", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({
      name: "Monetary Withdrawn",
      points: 500,
      benefitKind: "fixed_discount",
      amountUgx: 5_000,
    });

    const redeemed = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
            f.shopAId,
            accountId,
            rewardId,
            `monetary-lifecycle-${crypto.randomUUID()}`,
          ]),
        )
      ).rows[0],
    );
    expect(redeemed.ok).toBe(true);

    const saleId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, subtotal_ugx, discount_ugx, total_ugx, completed_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 20_000, 5_000, 15_000, now())`,
      [saleId, f.shopAId, customerId],
    );
    const redemptionId = (
      await exec.query<{ id: string }>(
        `SELECT id FROM public.loyalty_redemptions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [accountId],
      )
    ).rows[0]!.id;

    const applied = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_apply_redemption_to_sale($1, $2, $3) AS result`, [
            f.shopAId,
            redemptionId,
            saleId,
          ]),
        )
      ).rows[0],
    );
    expect(applied.ok, JSON.stringify(applied)).toBe(true);

    // NOW withdraw the reward.
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`UPDATE public.loyalty_rewards SET active = false WHERE id = $1`, [rewardId]),
    );

    // The snapshot and the applied amount are untouched.
    const rd = await exec.query<{
      benefit_kind: string;
      benefit_amount_ugx: number;
      applied_amount_ugx: number;
      sale_id: string;
      points_spent: number;
    }>(
      `SELECT benefit_kind, benefit_amount_ugx, applied_amount_ugx, sale_id, points_spent
       FROM public.loyalty_redemptions WHERE id = $1`,
      [redemptionId],
    );
    expect(rd.rows[0]).toMatchObject({ benefit_kind: "fixed_discount" });
    expect(Number(rd.rows[0]!.benefit_amount_ugx)).toBe(5_000);
    expect(Number(rd.rows[0]!.applied_amount_ugx)).toBe(5_000);
    expect(rd.rows[0]!.sale_id).toBe(saleId);
    expect(Number(rd.rows[0]!.points_spent)).toBe(500);

    // Customer 360 still explains it.
    const profile = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.shop_customer_360($1, $2, 10) AS result`, [f.shopAId, customerId]),
        )
      ).rows[0],
    ) as never as { recent_redemptions: { benefit_amount_ugx: number | null; applied_amount_ugx: number | null }[] };
    const shown = profile.recent_redemptions[0]!;
    expect(Number(shown.benefit_amount_ugx)).toBe(5_000);
    expect(Number(shown.applied_amount_ugx)).toBe(5_000);
  });

  it("a withdrawn reward leaves the MEMBER catalogue", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({ name: "Soon Withdrawn", points: 100 });

    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "f-member2@test.local"]);
    const member = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["F Member2", "+256700950002"]),
        )
      ).rows[0],
    );
    await exec.query(
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
       VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
      [member.member_id, accountId, f.shopAId],
    );

    const before = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_rewards(100) AS result`),
        )
      ).rows[0],
    ) as never as { rewards: { id: string }[] };
    expect(before.rewards.some((r) => r.id === rewardId)).toBe(true);

    await exec.query(`UPDATE public.loyalty_rewards SET active = false WHERE id = $1`, [rewardId]);

    const after = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_rewards(100) AS result`),
        )
      ).rows[0],
    ) as never as { rewards: { id: string }[] };
    expect(after.rewards.some((r) => r.id === rewardId)).toBe(false);
  });

  it("Phase D still reverses a redemption of a withdrawn reward", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({ name: "Withdrawn But Reversible", points: 500 });

    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
        f.shopAId,
        accountId,
        rewardId,
        `phaseD-lifecycle-${crypto.randomUUID()}`,
      ]),
    );
    const redemptionId = (
      await exec.query<{ id: string }>(
        `SELECT id FROM public.loyalty_redemptions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [accountId],
      )
    ).rows[0]!.id;

    await exec.query(`UPDATE public.loyalty_rewards SET active = false WHERE id = $1`, [rewardId]);

    const reversed = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_reverse_redemption($1, $2) AS result`, [f.shopAId, redemptionId]),
        )
      ).rows[0],
    );
    expect(reversed.ok, JSON.stringify(reversed)).toBe(true);

    const balance = await exec.query<{ balance_points: number }>(
      `SELECT balance_points FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(Number(balance.rows[0]!.balance_points)).toBe(1_000); // points returned
  });

  it("product rewards are untouched by any of this", async () => {
    await exec.query(`UPDATE public.products SET stock_on_hand = 5 WHERE id = $1`, [f.productAId]);
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({ name: "Product Lifecycle", points: 100 });
    await exec.query(`UPDATE public.loyalty_rewards SET product_id = $2, reward_kind = 'product' WHERE id = $1`, [
      rewardId,
      f.productAId,
    ]);

    const r = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
            f.shopAId,
            accountId,
            rewardId,
            `product-lifecycle-${crypto.randomUUID()}`,
          ]),
        )
      ).rows[0],
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // And it now has history, so it cannot be removed either.
    expect((await remove(f.ownerAId, rewardId)).error).toBe("reward_has_history");
  });
});
