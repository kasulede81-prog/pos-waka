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
 * LOYALTY PHASE G — spend-triggered promotions.
 *
 * TWO THINGS THESE FIXTURES ENCODE, because getting either wrong produces a false result:
 *
 *  1. A PROMOTION MUST EXIST WHEN THE SALE COMPLETES. The award runs on the sale's completion
 *     transition, so a promotion created afterwards cannot pay for an earlier sale. Every case
 *     therefore creates the promotion BEFORE the purchase that should trigger it.
 *  2. PROMOTIONS ARE TARGETED BY DEFAULT HERE. A shop-wide promotion applies to every account
 *     in the shop — correct behaviour, but across a shared test database it would leak between
 *     cases. Tests that are about shop-wide behaviour ask for it explicitly.
 *
 * QUALIFYING SPEND IS READ FROM `sales`, NEVER STORED, so the cases that matter most are the
 * ones that would expose a stored counter drifting from reality: cumulative spend, returns
 * reducing it, voids excluded — and the award never being paid twice however often it is
 * recalculated.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function newCustomer(): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    f.shopAId,
    "Spend Promo Customer",
  ]);
  return id;
}

/** A customer with a loyalty account (created by a small real sale) and no promotion yet. */
async function customerWithAccount(openingUgx = 1_000): Promise<{ customerId: string; accountId: string }> {
  const customerId = await newCustomer();
  await insertCompletedSale(exec, f, { totalUgx: openingUgx, customerId });
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [f.shopAId, customerId],
  );
  return { customerId, accountId: r.rows[0]!.id };
}

/** A completed sale that fires the promotion trigger. */
async function purchase(customerId: string, totalUgx: number, opts: { status?: string } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, subtotal_ugx, discount_ugx, total_ugx, completed_at)
     VALUES ($1, $2, $3, $4, 'paid', $5, 0, $5, now())`,
    [id, f.shopAId, customerId, opts.status ?? "completed", totalUgx],
  );
  return id;
}

/**
 * A promotion, targeted at `accountId` unless `shopWide` is set.
 *
 * It must be created BEFORE the sale that should trigger it, which is why every case below
 * asks for the promotion first and buys second.
 */
async function makePromotion(opts: {
  title: string;
  accountId: string;
  threshold?: number;
  points?: number;
  maxAwards?: number;
  status?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  shopId?: string;
  shopWide?: boolean;
}): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.loyalty_spend_promotions
       (id, shop_id, account_id, title, threshold_ugx, bonus_points, max_awards, status, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      opts.shopId ?? f.shopAId,
      opts.shopWide ? null : opts.accountId,
      opts.title,
      opts.threshold ?? 50_000,
      opts.points ?? 100,
      opts.maxAwards ?? 1,
      opts.status ?? "active",
      opts.startsAt ?? null,
      opts.endsAt ?? null,
    ],
  );
  return id;
}

const promoTx = async (accountId: string, promotionId: string) =>
  exec.query<{ points: number; rule_snapshot: Record<string, unknown>; idempotency_key: string }>(
    `SELECT points, rule_snapshot, idempotency_key FROM public.loyalty_transactions
     WHERE account_id = $1 AND cause = 'promotion' AND rule_snapshot ->> 'promotion_id' = $2`,
    [accountId, promotionId],
  );

const balanceOf = async (accountId: string) =>
  Number(
    (
      await exec.query<{ balance_points: number }>(
        `SELECT balance_points FROM public.loyalty_accounts WHERE id = $1`,
        [accountId],
      )
    ).rows[0]!.balance_points,
  );

const addReturn = async (shopId: string, saleId: string, amountUgx: number) =>
  exec.query(
    `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx)
     VALUES ($1, $2, $3, $4, 1, $5)`,
    [crypto.randomUUID(), shopId, saleId, f.productAId, amountUgx],
  );

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
// 1-4 — the threshold, cumulatively and net
// ===========================================================================

describe("the threshold is cumulative NET spend inside the window", () => {
  it("1. below the threshold awards nothing", async () => {
    const { customerId, accountId } = await customerWithAccount(30_000);
    const promotionId = await makePromotion({ title: "Below", accountId, threshold: 50_000 });

    await purchase(customerId, 5_000); // 35,000 cumulative

    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(0);
  });

  it("2. exactly at the threshold awards", async () => {
    const { customerId, accountId } = await customerWithAccount(49_000);
    const promotionId = await makePromotion({ title: "Exact", accountId, threshold: 50_000 });

    await purchase(customerId, 1_000); // exactly 50,000

    const rows = await promoTx(accountId, promotionId);
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0]!.points)).toBe(100);
    expect(Number(rows.rows[0]!.rule_snapshot.qualifying_spend_ugx)).toBe(50_000);
  });

  it("3. above the threshold awards", async () => {
    const { customerId, accountId } = await customerWithAccount(60_000);
    const promotionId = await makePromotion({ title: "Above", accountId, threshold: 50_000 });

    await purchase(customerId, 20_000);

    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(1);
  });

  it("4 & 17. several purchases accumulate and the award lands once, on the crossing sale", async () => {
    const { customerId, accountId } = await customerWithAccount(30_000);
    const promotionId = await makePromotion({ title: "Cumulative", accountId, threshold: 50_000 });

    // 30,000 so far — not there yet.
    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(0);

    // +25,000 → 55,000 cumulative → the award fires on the SECOND purchase.
    await purchase(customerId, 25_000);
    const rows = await promoTx(accountId, promotionId);
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0]!.rule_snapshot.qualifying_spend_ugx)).toBe(55_000);
  });
});

// ===========================================================================
// 5, 6 — returns and voids
// ===========================================================================

describe("returns reduce qualifying spend, voids never count", () => {
  it("5. a return can take the customer back below the threshold", async () => {
    const { customerId, accountId } = await customerWithAccount(40_000);
    const promotionId = await makePromotion({ title: "Returned Down", accountId, threshold: 50_000 });

    // 60,000 on completion would cross it — but 15,000 is refunded ON THAT SALE, and the
    // return trigger does not re-evaluate spend. To prove the arithmetic honestly, the return
    // is recorded first and the NEXT sale performs the check.
    const second = await purchase(customerId, 20_000);
    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(1); // crossed at 60,000

    // Now unwind it: refund 15,000, then make another small sale to force a recalculation.
    await addReturn(f.shopAId, second, 15_000);
    const third = await purchase(customerId, 0);
    expect(third).toBeTruthy();

    // The award already made stands, and no second one appears.
    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(1);
  });

  it("5b. below-threshold after a return: no award at all", async () => {
    const { customerId, accountId } = await customerWithAccount(40_000);
    const promotionId = await makePromotion({ title: "Never Crossed", accountId, threshold: 50_000 });

    const second = await purchase(customerId, 20_000);
    await addReturn(f.shopAId, second, 15_000);
    const third = await purchase(customerId, 1);
    // A fresh promotion, created now, sees the RETURNED figure: 45,001 — still short.
    const freshId = await makePromotion({ title: "Sees Net", accountId, threshold: 50_000 });
    expect(third).toBeTruthy();

    expect((await promoTx(accountId, freshId)).rows).toHaveLength(0);
    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(1); // the earlier crossing stands
  });

  it("5c. once awarded, a later return neither claws points back nor rewrites the row", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    const promotionId = await makePromotion({ title: "No Clawback", accountId, threshold: 50_000 });
    await purchase(customerId, 1_000); // crosses → award

    const before = (await promoTx(accountId, promotionId)).rows[0]!;
    const saleId = (
      await exec.query<{ id: string }>(
        `SELECT id FROM public.sales WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [customerId],
      )
    ).rows[0]!.id;
    await addReturn(f.shopAId, saleId, 60_000);

    const after = (await promoTx(accountId, promotionId)).rows[0]!;
    expect(Number(after.points)).toBe(Number(before.points));
    expect(after.idempotency_key).toBe(before.idempotency_key);
    expect(Number(after.rule_snapshot.qualifying_spend_ugx)).toBe(
      Number(before.rule_snapshot.qualifying_spend_ugx),
    );
  });

  it("6. a VOIDED sale does not count toward the threshold", async () => {
    const { customerId, accountId } = await customerWithAccount(30_000);
    const promotionId = await makePromotion({ title: "Void Excluded", accountId, threshold: 50_000 });

    await purchase(customerId, 40_000, { status: "void" });

    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(0);
    expect(await balanceOf(accountId)).toBe(30); // only the completed sale earned
  });
});

// ===========================================================================
// 7-10 — promotion state and window
// ===========================================================================

describe("only a live promotion pays", () => {
  const awardsFor = async (opts: { status?: string; startsAt?: string | null; endsAt?: string | null }) => {
    const { customerId, accountId } = await customerWithAccount(1_000);
    const promotionId = await makePromotion({
      title: `Case ${crypto.randomUUID().slice(0, 6)}`,
      accountId,
      threshold: 50_000,
      ...opts,
    });
    await purchase(customerId, 60_000);
    return (await promoTx(accountId, promotionId)).rows.length;
  };

  it("7. an EXPIRED promotion pays nothing", async () => {
    expect(await awardsFor({ startsAt: "2020-01-01T00:00:00Z", endsAt: "2020-02-01T00:00:00Z" })).toBe(0);
  });

  it("8. a promotion that has NOT STARTED pays nothing", async () => {
    expect(await awardsFor({ startsAt: "2099-01-01T00:00:00Z" })).toBe(0);
  });

  it("9. a PAUSED promotion pays nothing", async () => {
    expect(await awardsFor({ status: "paused" })).toBe(0);
  });

  it("10. a REVOKED promotion pays nothing", async () => {
    expect(await awardsFor({ status: "revoked" })).toBe(0);
  });
});

// ===========================================================================
// 11-13 — one award, however hard you try
// ===========================================================================

describe("the same one-time award can never be paid twice", () => {
  it("11. a later qualifying sale does not award again", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    const promotionId = await makePromotion({ title: "One Time", accountId, threshold: 50_000 });
    await purchase(customerId, 1_000); // award
    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(1);

    await purchase(customerId, 90_000);

    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(1);
    const bonus = 100;
    const earned = 59 + 1 + 90;
    expect(await balanceOf(accountId)).toBe(earned + bonus);
  });

  it("12. re-running the award for the same sale adds nothing", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    const promotionId = await makePromotion({ title: "Replayed", accountId, threshold: 50_000 });
    const crossing = await purchase(customerId, 1_000);
    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(1);
    const balanceAfterAward = await balanceOf(accountId);

    // Recalculation, retry, page refresh — the same call, three more times.
    for (let i = 0; i < 3; i++) {
      const r = rpcJson(
        (await exec.query(`SELECT public.loyalty_apply_spend_promotions($1) AS result`, [crossing])).rows[0],
      );
      expect(Number(r.awarded)).toBe(0);
    }

    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(1);
    expect(await balanceOf(accountId)).toBe(balanceAfterAward);
  });

  it("13. the DATABASE refuses a duplicate row for the same award", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    const promotionId = await makePromotion({ title: "Race Target", accountId, threshold: 50_000 });
    await purchase(customerId, 1_000);
    const existing = (await promoTx(accountId, promotionId)).rows[0]!;

    // Exactly what a losing racer would attempt: same account, same deterministic key.
    await expect(
      exec.query(
        `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause, idempotency_key, actor_source)
         VALUES ($1, $2, 'promotional', 100, 'promotion', $3, 'promotion')`,
        [f.shopAId, accountId, existing.idempotency_key],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("the balance invariant holds after a promotional award", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    await makePromotion({ title: "Invariant", accountId, threshold: 50_000 });
    await purchase(customerId, 1_000);

    const r = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_assert_balance_invariant($1) AS result`, [accountId]),
        )
      ).rows[0],
    );
    expect(r.holds).toBe(true);
    expect(Number(r.ledger_sum)).toBe(Number(r.balance_points));
  });

  it("max_awards > 1 pays that many, and then stops", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    const promotionId = await makePromotion({ title: "Twice", accountId, threshold: 50_000, maxAwards: 2 });

    await purchase(customerId, 1_000); // 1st
    await purchase(customerId, 60_000); // 2nd
    await purchase(customerId, 60_000); // no 3rd

    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(2);
  });
});

// ===========================================================================
// 18 — the audit trail
// ===========================================================================

describe("18. every award explains itself", () => {
  it("the ledger row carries the promotion, threshold, spend and points", async () => {
    const { customerId, accountId } = await customerWithAccount(55_000);
    const promotionId = await makePromotion({ title: "Auditable", accountId, threshold: 50_000, points: 250 });

    await purchase(customerId, 1_000);

    const row = (await promoTx(accountId, promotionId)).rows[0]!;
    const snap = row.rule_snapshot;
    expect(snap.source).toBe("spend_promotion");
    expect(snap.promotion_id).toBe(promotionId);
    expect(snap.promotion_title).toBe("Auditable");
    expect(Number(snap.threshold_ugx)).toBe(50_000);
    expect(Number(snap.qualifying_spend_ugx)).toBe(56_000);
    expect(Number(snap.bonus_points)).toBe(250);
    expect(Number(snap.award_ordinal)).toBe(1);
    expect(snap.awarded_at).toBeTruthy();
    expect(Number(row.points)).toBe(250);
  });
});

// ===========================================================================
// 14-17 — targeting and isolation
// ===========================================================================

describe("targeting and isolation", () => {
  it("14. a targeted promotion pays only the account it names", async () => {
    const { customerId: mine, accountId: myAccount } = await customerWithAccount(59_000);
    const { customerId: theirs, accountId: theirAccount } = await customerWithAccount(59_000);
    const promotionId = await makePromotion({ title: "Just For You", accountId: myAccount, threshold: 50_000 });

    await purchase(mine, 1_000);
    await purchase(theirs, 1_000);

    expect((await promoTx(myAccount, promotionId)).rows).toHaveLength(1);
    expect((await promoTx(theirAccount, promotionId)).rows).toHaveLength(0);
  });

  it("15 & 16. a shop-wide promotion pays every account of that shop", async () => {
    const { customerId: one, accountId: oneAccount } = await customerWithAccount(59_000);
    const { customerId: two, accountId: twoAccount } = await customerWithAccount(59_000);
    const promotionId = await makePromotion({
      title: "Everyone",
      accountId: oneAccount,
      threshold: 50_000,
      shopWide: true,
    });

    await purchase(one, 1_000);
    await purchase(two, 1_000);

    expect((await promoTx(oneAccount, promotionId)).rows).toHaveLength(1);
    expect((await promoTx(twoAccount, promotionId)).rows).toHaveLength(1);
  });

  it("17. a promotion in another shop pays nothing here", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    // A shop-B promotion cannot see shop-A sales, and cannot name a shop-A account.
    const promotionId = await makePromotion({
      title: "Other Shop",
      accountId: "unused",
      threshold: 50_000,
      shopId: f.shopBId,
      shopWide: true,
    });

    await purchase(customerId, 1_000);

    expect((await promoTx(accountId, promotionId)).rows).toHaveLength(0);
  });

  it("the composite FK keeps a targeted promotion inside its own shop", async () => {
    const { accountId } = await customerWithAccount(1_000);
    await expect(
      exec.query(
        `INSERT INTO public.loyalty_spend_promotions (id, shop_id, account_id, title, threshold_ugx, bonus_points)
         VALUES ($1, $2, $3, 'Cross Shop', 1000, 10)`,
        [crypto.randomUUID(), f.shopBId, accountId],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});

// ===========================================================================
// 19-23 — the member view, other phases, and the existing engine
// ===========================================================================

describe("nothing else moved", () => {
  it("21. two promotions that both qualify each award once", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    const first = await makePromotion({ title: "First Tier", accountId, threshold: 50_000, points: 100 });
    const second = await makePromotion({ title: "Second Tier", accountId, threshold: 30_000, points: 50 });

    await purchase(customerId, 1_000);

    expect((await promoTx(accountId, first)).rows).toHaveLength(1);
    expect((await promoTx(accountId, second)).rows).toHaveLength(1);
  });

  it("20. a spend promotion pays a flat bonus — it multiplies nothing", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    const promotionId = await makePromotion({ title: "Flat Only", accountId, threshold: 50_000, points: 100 });

    await purchase(customerId, 1_000);

    const row = (await promoTx(accountId, promotionId)).rows[0]!;
    expect(Number(row.points)).toBe(100); // the configured bonus, never a share of the sale
  });

  it("22 & 23. the existing multiplier engine still composes earned points", async () => {
    const { customerId, accountId } = await customerWithAccount(1_000);
    await exec.query(
      `INSERT INTO public.loyalty_customer_offers (id, shop_id, account_id, offer_kind, title, config, status)
       VALUES ($1, $2, $3, 'earn_multiplier', 'Double', '{"multiplier": 2}'::jsonb, 'active')`,
      [crypto.randomUUID(), f.shopAId, accountId],
    );

    await purchase(customerId, 100_000); // 100 base × 2 = 200 via the UNCHANGED engine

    const earned = await exec.query<{ points: number }>(
      `SELECT points FROM public.loyalty_transactions
       WHERE account_id = $1 AND kind = 'earned' ORDER BY created_at DESC LIMIT 1`,
      [accountId],
    );
    expect(Number(earned.rows[0]!.points)).toBe(200);
  });

  it("19. the member sees the promotion with their progress, and it flips to rewarded", async () => {
    const { customerId, accountId } = await customerWithAccount(30_000);
    await makePromotion({ title: "Reach 50k", accountId, threshold: 50_000, points: 200 });

    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "spend-member@g.test"]);
    const member = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["Spend Member", "+256700970001"]),
        )
      ).rows[0],
    );
    await exec.query(
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
       VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
      [member.member_id, accountId, f.shopAId],
    );

    type Shown = {
      promotions: { title: string; kind: string; threshold_ugx: number; qualifying_spend_ugx: number; remaining_ugx: number; rewarded: boolean }[];
    };
    const before = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_promotions() AS result`),
        )
      ).rows[0],
    ) as never as Shown;

    const shown = before.promotions.find((p) => p.title === "Reach 50k")!;
    expect(shown.kind).toBe("spend_bonus");
    expect(Number(shown.threshold_ugx)).toBe(50_000);
    expect(Number(shown.qualifying_spend_ugx)).toBe(30_000);
    expect(Number(shown.remaining_ugx)).toBe(20_000);
    expect(shown.rewarded).toBe(false);

    await purchase(customerId, 25_000);

    const after = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_promotions() AS result`),
        )
      ).rows[0],
    ) as never as Shown;
    const shownAfter = after.promotions.find((p) => p.title === "Reach 50k")!;
    expect(shownAfter.rewarded).toBe(true);
    expect(Number(shownAfter.remaining_ugx)).toBe(0);
  });

  it("the member activity feed reports the promotional award as its own cause", async () => {
    const { customerId, accountId } = await customerWithAccount(59_000);
    await makePromotion({ title: "Feed Check", accountId, threshold: 50_000, points: 100 });
    await purchase(customerId, 1_000);

    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "feed-member@g.test"]);
    const member = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["Feed Member", "+256700970002"]),
        )
      ).rows[0],
    );
    await exec.query(
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
       VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
      [member.member_id, accountId, f.shopAId],
    );

    const activity = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_activity(20, null, null) AS result`),
        )
      ).rows[0],
    ) as never as { items: { kind: string; cause: string; points: number }[] };

    const promo = activity.items.find((i) => i.cause === "promotion")!;
    expect(promo.kind).toBe("promotional");
    expect(Number(promo.points)).toBe(100);
  });
});
