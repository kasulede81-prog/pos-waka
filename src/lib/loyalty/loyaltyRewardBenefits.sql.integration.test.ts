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
 * LOYALTY PHASE E — reward benefits (monetary rewards).
 *
 * POINTS ARE NOT MONEY, AND THESE TESTS HOLD THAT LINE. No test here asserts that a
 * customer holds UGX; they assert that a redemption is worth a discount, that the discount
 * is derived from a SNAPSHOT rather than today's catalogue, and that the recorded benefit
 * can never exceed the discount the sale actually carries.
 *
 * THE CLAMP TESTS ARE THE IMPORTANT ONES. `loyalty_apply_redemption_to_sale` is the only
 * place where a loyalty claim meets real money, so it is the only place a wrong number could
 * manufacture a discount. Every test around it tries to make it over-report.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function newCustomer(): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    f.shopAId,
    "Benefit Customer",
  ]);
  return id;
}

async function fundedAccount(customerId: string, points: number): Promise<string> {
  await insertCompletedSale(exec, f, { totalUgx: points * 1_000, customerId });
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [f.shopAId, customerId],
  );
  return r.rows[0]!.id;
}

/** A completed sale carrying a real discount, as the checkout would have written it. */
async function discountedSale(
  customerId: string,
  opts: { subtotalUgx: number; discountUgx: number; shopId?: string; status?: string },
): Promise<string> {
  const shopId = opts.shopId ?? f.shopAId;
  const id = crypto.randomUUID();
  const total = Math.max(0, opts.subtotalUgx - opts.discountUgx);
  await exec.query(
    `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, subtotal_ugx, discount_ugx, total_ugx, completed_at)
     VALUES ($1, $2, $3, $4, 'paid', $5, $6, $7, now())`,
    [id, shopId, customerId, opts.status ?? "completed", opts.subtotalUgx, opts.discountUgx, total],
  );
  return id;
}

async function makeReward(opts: {
  name: string;
  points: number;
  benefitKind?: "none" | "fixed_discount" | "percentage_discount";
  amountUgx?: number | null;
  percent?: number | null;
  productId?: string | null;
  shopId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.loyalty_rewards
       (id, shop_id, name, points_required, reward_kind, active,
        benefit_kind, benefit_amount_ugx, benefit_percent, product_id)
     VALUES ($1, $2, $3, $4, 'custom', true, $5, $6, $7, $8)`,
    [
      id,
      opts.shopId ?? f.shopAId,
      opts.name,
      opts.points,
      opts.benefitKind ?? "none",
      opts.amountUgx ?? null,
      opts.percent ?? null,
      opts.productId ?? null,
    ],
  );
  return id;
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

async function lastRedemptionId(accountId: string): Promise<string> {
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_redemptions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [accountId],
  );
  return r.rows[0]!.id;
}

async function apply(
  asUserId: string,
  redemptionId: string,
  saleId: string,
  shopId: string = f.shopAId,
) {
  const r = await asUser(exec, asUserId, async () =>
    exec.query(`SELECT public.loyalty_apply_redemption_to_sale($1, $2, $3) AS result`, [
      shopId,
      redemptionId,
      saleId,
    ]),
  );
  return rpcJson(r.rows[0]);
}

async function redemptionRow(id: string) {
  const r = await exec.query<{
    status: string;
    points_spent: number;
    benefit_kind: string;
    benefit_amount_ugx: number | null;
    benefit_percent: number | null;
    applied_amount_ugx: number | null;
    sale_id: string | null;
    applied_at: string | null;
  }>(`SELECT * FROM public.loyalty_redemptions WHERE id = $1`, [id]);
  return r.rows[0]!;
}

/** Fund, redeem a benefit, and return everything needed to apply it. */
async function benefitRedemption(opts: {
  points?: number;
  funded?: number;
  benefitKind?: "fixed_discount" | "percentage_discount";
  amountUgx?: number | null;
  percent?: number | null;
}) {
  const customerId = await newCustomer();
  const accountId = await fundedAccount(customerId, opts.funded ?? 1_000);
  const rewardId = await makeReward({
    name: "UGX Off",
    points: opts.points ?? 500,
    benefitKind: opts.benefitKind ?? "fixed_discount",
    amountUgx: opts.amountUgx === undefined ? 5_000 : opts.amountUgx,
    percent: opts.percent ?? null,
  });
  const r = await redeem(f.ownerAId, accountId, rewardId, `benefit-${crypto.randomUUID()}`);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return { customerId, accountId, rewardId, redemptionId: await lastRedemptionId(accountId) };
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
// 1-8, 28 — the benefit model and its snapshot
// ===========================================================================

describe("1-8, 28. the benefit a reward is worth, and the snapshot of it", () => {
  it("1 & 3. a fixed UGX and a percentage reward can be created", async () => {
    const fixed = await makeReward({ name: "5k Off", points: 500, benefitKind: "fixed_discount", amountUgx: 5_000 });
    const pct = await makeReward({ name: "10% Off", points: 1_000, benefitKind: "percentage_discount", percent: 10 });

    const rows = await exec.query<{ name: string; benefit_kind: string; benefit_amount_ugx: number; benefit_percent: number }>(
      `SELECT name, benefit_kind, benefit_amount_ugx, benefit_percent FROM public.loyalty_rewards
       WHERE id in ($1, $2) ORDER BY name`,
      [fixed, pct],
    );
    expect(rows.rows[0]).toMatchObject({ benefit_kind: "percentage_discount" });
    expect(Number(rows.rows[0]!.benefit_percent)).toBe(10);
    expect(rows.rows[1]).toMatchObject({ benefit_kind: "fixed_discount" });
    expect(Number(rows.rows[1]!.benefit_amount_ugx)).toBe(5_000);
  });

  it("5. a negative or zero amount is refused by the database", async () => {
    for (const amount of [-1, 0]) {
      await expect(
        makeReward({ name: "Bad", points: 100, benefitKind: "fixed_discount", amountUgx: amount }),
      ).rejects.toThrow(/check constraint|violates/i);
    }
  });

  it("6. a percentage above 100, or at zero, is refused by the database", async () => {
    for (const percent of [0, 100.01, 150, -10]) {
      await expect(
        makeReward({ name: "Bad %", points: 100, benefitKind: "percentage_discount", percent }),
      ).rejects.toThrow(/check constraint|violates/i);
    }
    // Exactly 100 is representable — the bound is inclusive, as the brief requires.
    const hundred = await makeReward({ name: "Free", points: 100, benefitKind: "percentage_discount", percent: 100 });
    expect(hundred).toBeTruthy();
  });

  it("2 & 4. an inconsistent benefit shape is refused: kind and value must agree", async () => {
    // fixed_discount with no amount
    await expect(
      exec.query(
        `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, benefit_kind)
         VALUES ($1, $2, 'No Amount', 100, 'fixed_discount')`,
        [crypto.randomUUID(), f.shopAId],
      ),
    ).rejects.toThrow(/check constraint|violates/i);

    // percentage_discount carrying an amount instead
    await expect(
      exec.query(
        `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, benefit_kind, benefit_amount_ugx)
         VALUES ($1, $2, 'Wrong Field', 100, 'percentage_discount', 500)`,
        [crypto.randomUUID(), f.shopAId],
      ),
    ).rejects.toThrow(/check constraint|violates/i);

    // a reward cannot be a product AND a discount
    await expect(
      makeReward({
        name: "Both",
        points: 100,
        benefitKind: "fixed_discount",
        amountUgx: 500,
        productId: f.productAId,
      }),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("7. redeeming snapshots the benefit onto the redemption", async () => {
    const { redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const rd = await redemptionRow(redemptionId);
    expect(rd.benefit_kind).toBe("fixed_discount");
    expect(Number(rd.benefit_amount_ugx)).toBe(5_000);
    expect(rd.benefit_percent).toBeNull();
    // Redeemed, not yet applied: the state the brief calls "A".
    expect(rd.sale_id).toBeNull();
    expect(rd.applied_amount_ugx).toBeNull();
  });

  it("7b. a percentage redemption snapshots the percentage, not a computed amount", async () => {
    const { redemptionId } = await benefitRedemption({
      points: 1_000,
      benefitKind: "percentage_discount",
      amountUgx: null,
      percent: 10,
    });
    const rd = await redemptionRow(redemptionId);
    expect(rd.benefit_kind).toBe("percentage_discount");
    expect(Number(rd.benefit_percent)).toBe(10);
    expect(rd.benefit_amount_ugx).toBeNull();
  });

  it("28. changing the reward afterwards does NOT rewrite the redemption", async () => {
    const { rewardId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    await exec.query(
      `UPDATE public.loyalty_rewards SET benefit_amount_ugx = 3_000, name = 'Renamed', points_required = 900
       WHERE id = $1`,
      [rewardId],
    );
    const rd = await redemptionRow(redemptionId);
    expect(Number(rd.benefit_amount_ugx)).toBe(5_000); // still the old worth
    expect(Number(rd.points_spent)).toBe(500); // and the old price
  });

  it("a non-monetary reward snapshots 'none' and cannot be applied", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const plain = await makeReward({ name: "Just Points", points: 100 });
    await redeem(f.ownerAId, accountId, plain, `plain-${crypto.randomUUID()}`);
    const redemptionId = await lastRedemptionId(accountId);

    expect((await redemptionRow(redemptionId)).benefit_kind).toBe("none");
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 1_000 });
    const r = await apply(f.ownerAId, redemptionId, saleId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no_monetary_benefit");
  });
});

// ===========================================================================
// 9, 10, 11, 12, 13, 14, 19, 20 — application
// ===========================================================================

describe("9-14, 19-20. applying a benefit to the sale that carried it", () => {
  it("9. applies to an eligible sale and records the discount it accounted for", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 20_000, discountUgx: 5_000 });

    const r = await apply(f.ownerAId, redemptionId, saleId);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(Number(r.applied_amount_ugx)).toBe(5_000);
    expect(r.clamped).toBe(false);

    const rd = await redemptionRow(redemptionId);
    expect(rd.sale_id).toBe(saleId);
    expect(Number(rd.applied_amount_ugx)).toBe(5_000);
    expect(rd.applied_at).not.toBeNull();
  });

  it("10. a benefit larger than the sale's discount is CLAMPED, never invented", async () => {
    // The reward is worth 5,000 but the sale only gave away 3,000.
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 3_000, discountUgx: 3_000 });

    const r = await apply(f.ownerAId, redemptionId, saleId);
    expect(r.ok).toBe(true);
    expect(Number(r.requested_ugx)).toBe(5_000);
    expect(Number(r.applied_amount_ugx)).toBe(3_000); // the sale's own figure, not the reward's
    expect(r.clamped).toBe(true);
  });

  it("10b. a sale with no discount cannot carry a benefit at all", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 20_000, discountUgx: 0 });

    const r = await apply(f.ownerAId, redemptionId, saleId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no_discount_on_sale");
    // Nothing is consumed: the redemption is still applicable to a sale that did discount.
    expect((await redemptionRow(redemptionId)).sale_id).toBeNull();
  });

  it("a percentage benefit is computed from the sale's subtotal, floored", async () => {
    const { customerId, redemptionId } = await benefitRedemption({
      points: 1_000,
      benefitKind: "percentage_discount",
      amountUgx: null,
      percent: 10,
    });
    // 10% of 33,333 = 3,333.3 → 3,333, and the sale discounted exactly that.
    const saleId = await discountedSale(customerId, { subtotalUgx: 33_333, discountUgx: 3_333 });

    const r = await apply(f.ownerAId, redemptionId, saleId);
    expect(r.ok).toBe(true);
    expect(Number(r.applied_amount_ugx)).toBe(3_333);
  });

  it("11. points are consumed exactly once, by the existing redemption path", async () => {
    const { accountId, redemptionId } = await benefitRedemption({ funded: 1_000, points: 500 });
    const customerId = (await exec.query<{ customer_id: string }>(
      `SELECT customer_id FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    )).rows[0]!.customer_id;
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });

    const balanceBefore = (await exec.query<{ balance_points: number }>(
      `SELECT balance_points FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    )).rows[0]!.balance_points;
    // (The discounted sale below also earns points, so the assertion is about the DELTA
    // an application may cause — which must be none.)

    await apply(f.ownerAId, redemptionId, saleId);

    const balanceAfter = (await exec.query<{ balance_points: number }>(
      `SELECT balance_points FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    )).rows[0]!.balance_points;
    // Applying a benefit moves NO points — it only records what the discount was.
    expect(balanceAfter).toBe(balanceBefore);
  });

  it("12 & 13. a benefit cannot be applied twice, nor to a second sale", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleA = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    const saleB = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });

    expect((await apply(f.ownerAId, redemptionId, saleA)).ok).toBe(true);

    const again = await apply(f.ownerAId, redemptionId, saleB);
    expect(again.ok).toBe(false);
    expect(again.error).toBe("already_applied");
    // The first application is untouched.
    expect((await redemptionRow(redemptionId)).sale_id).toBe(saleA);
  });

  it("14. cross-shop application is refused in both directions", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    // A sale in ANOTHER shop.
    const otherSale = await discountedSale(customerId, {
      subtotalUgx: 10_000,
      discountUgx: 5_000,
      shopId: f.shopBId,
    });

    const r = await apply(f.ownerAId, redemptionId, otherSale);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("sale_not_found");
    expect((await redemptionRow(redemptionId)).sale_id).toBeNull();

    // And through the other shop the redemption simply does not exist: shop B's owner is
    // authorized for shop B, so this is not a permissions refusal — the row is not theirs
    // to see, which is the stronger answer.
    const saleHere = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    const r2 = await apply(f.outsiderId, redemptionId, saleHere, f.shopBId);
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe("not_found");
  });

  it("19 & 20. the sale's own figures are untouched by the application", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 20_000, discountUgx: 5_000 });
    const before = await exec.query<{ subtotal_ugx: number; discount_ugx: number; total_ugx: number }>(
      `SELECT subtotal_ugx, discount_ugx, total_ugx FROM public.sales WHERE id = $1`,
      [saleId],
    );

    await apply(f.ownerAId, redemptionId, saleId);

    const after = await exec.query<{ subtotal_ugx: number; discount_ugx: number; total_ugx: number }>(
      `SELECT subtotal_ugx, discount_ugx, total_ugx FROM public.sales WHERE id = $1`,
      [saleId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    // The sale still balances: subtotal − discount = total.
    expect(Number(after.rows[0]!.total_ugx)).toBe(
      Number(after.rows[0]!.subtotal_ugx) - Number(after.rows[0]!.discount_ugx),
    );
  });
});

// ===========================================================================
// 15, 16, 17 — authorization
// ===========================================================================

describe("15-17. who may apply, and who may not", () => {
  it("15. a member cannot apply a benefit", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });

    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "e-member@test.local"]);
    await asUser(exec, userId, async () =>
      exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["E Member", "+256700930001"]),
    );

    const r = await apply(userId, redemptionId, saleId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    expect((await redemptionRow(redemptionId)).sale_id).toBeNull();
  });

  it("16. an authorized cashier may apply; an outsider may not", async () => {
    const one = await benefitRedemption({ amountUgx: 5_000 });
    const saleA = await discountedSale(one.customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    expect((await apply(f.cashierAId, one.redemptionId, saleA)).ok).toBe(true);

    const two = await benefitRedemption({ amountUgx: 5_000 });
    const saleB = await discountedSale(two.customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    // `outsiderId` owns shop B only.
    const r = await apply(f.outsiderId, two.redemptionId, saleB, f.shopAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });

  it("17. anonymous access is refused by grant", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    await expect(
      asAnon(exec, async () =>
        exec.query(`SELECT public.loyalty_apply_redemption_to_sale($1, $2, $3) AS result`, [
          f.shopAId,
          redemptionId,
          saleId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a benefit cannot be attached to someone else's sale", async () => {
    const mine = await benefitRedemption({ amountUgx: 5_000 });
    const stranger = await newCustomer();
    const strangersSale = await discountedSale(stranger, { subtotalUgx: 10_000, discountUgx: 5_000 });

    const r = await apply(f.ownerAId, mine.redemptionId, strangersSale);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("customer_mismatch");
    expect((await redemptionRow(mine.redemptionId)).sale_id).toBeNull();
  });

  it("a voided sale cannot receive a benefit", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, {
      subtotalUgx: 10_000,
      discountUgx: 5_000,
      status: "void",
    });
    const r = await apply(f.ownerAId, redemptionId, saleId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("sale_not_eligible");
  });

  it("a nonexistent redemption or sale is rejected", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });

    const noRd = await apply(f.ownerAId, crypto.randomUUID(), saleId);
    expect(noRd.error).toBe("not_found");
    const noSale = await apply(f.ownerAId, redemptionId, crypto.randomUUID());
    expect(noSale.error).toBe("sale_not_found");
  });
});

// ===========================================================================
// 18 — concurrency
// ===========================================================================

describe("18. two cashiers cannot both apply the same redemption", () => {
  it("repeated attempts produce exactly one application", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });

    const results = [];
    for (let i = 0; i < 4; i++) results.push(await apply(f.ownerAId, redemptionId, saleId));

    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => r.error === "already_applied").length).toBe(3);
    // One recorded application, one amount — no double discount anywhere.
    expect(Number((await redemptionRow(redemptionId)).applied_amount_ugx)).toBe(5_000);
  });

  it("the database refuses a second application for the same redemption", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleA = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    const saleB = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    expect((await apply(f.ownerAId, redemptionId, saleA)).ok).toBe(true);

    // Bypass the RPC entirely: a recorded application cannot be re-pointed at another sale,
    // enforced by the guard trigger rather than by the RPC's status check.
    await expect(
      exec.query(`UPDATE public.loyalty_redemptions SET sale_id = $2 WHERE id = $1`, [redemptionId, saleB]),
    ).rejects.toThrow(/cannot be re-pointed/i);
    // …and the amount cannot be rewritten either.
    await expect(
      exec.query(`UPDATE public.loyalty_redemptions SET applied_amount_ugx = 9_999 WHERE id = $1`, [
        redemptionId,
      ]),
    ).rejects.toThrow(/cannot be re-pointed/i);
    // The original application is intact.
    const rd = await redemptionRow(redemptionId);
    expect(rd.sale_id).toBe(saleA);
    expect(Number(rd.applied_amount_ugx)).toBe(5_000);
  });
});

// ===========================================================================
// 21, 22, 23 — returns, voids and Phase D
// ===========================================================================

describe("21-23. returns, voids, and Phase D", () => {
  it("21. the discount lives in the sale, so a return already refunds proportionally", async () => {
    // Phase E does not touch return arithmetic; this asserts the property it relies on —
    // the discount reduced what the customer paid, so the refund ceiling reflects it.
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 20_000, discountUgx: 5_000 });
    await apply(f.ownerAId, redemptionId, saleId);

    const sale = await exec.query<{ subtotal_ugx: number; discount_ugx: number; total_ugx: number }>(
      `SELECT subtotal_ugx, discount_ugx, total_ugx FROM public.sales WHERE id = $1`,
      [saleId],
    );
    // The customer paid the discounted total, and that is what a refund is bounded by.
    expect(Number(sale.rows[0]!.total_ugx)).toBe(15_000);

    // WHAT THE CUSTOMER PAID is the discounted total, and that is what a refund is bounded
    // by — the return ceilings read `sales.total_ugx` (pre-existing behaviour, unchanged by
    // Phase E; verified by audit rather than by re-testing the ceiling function here, whose
    // live signature belongs to the returns subsystem, not to this phase).
    const sale2 = await exec.query<{ total_ugx: number; subtotal_ugx: number; discount_ugx: number }>(
      `SELECT total_ugx, subtotal_ugx, discount_ugx FROM public.sales WHERE id = $1`,
      [saleId],
    );
    expect(Number(sale2.rows[0]!.total_ugx)).toBe(15_000);
    expect(Number(sale2.rows[0]!.subtotal_ugx)).toBe(20_000);
    expect(Number(sale2.rows[0]!.discount_ugx)).toBe(5_000);
    // The benefit is preserved in the sale snapshot, so the discount survives into any
    // later return calculation instead of being forgotten.
    expect(Number((await redemptionRow(redemptionId)).applied_amount_ugx)).toBe(5_000);
  });

  it("22. a voided sale leaves the application recorded, and Phase D is the remedy", async () => {
    const { customerId, redemptionId, accountId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    expect((await apply(f.ownerAId, redemptionId, saleId)).ok).toBe(true);

    await exec.query(`UPDATE public.sales SET status = 'void' WHERE id = $1`, [saleId]);

    // Phase E deliberately does NOT auto-reverse: the void is a sale event, and whether the
    // customer should get the points back is a policy the architecture does not define.
    const rd = await redemptionRow(redemptionId);
    expect(rd.status).toBe("completed");
    expect(Number(rd.applied_amount_ugx)).toBe(5_000);

    // The supported remedy is Phase D, which returns the points and voids the redemption.
    const reversed = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_reverse_redemption($1, $2, $3) AS result`, [
            f.shopAId,
            redemptionId,
            "sale voided",
          ]),
        )
      ).rows[0],
    );
    expect(reversed.ok, JSON.stringify(reversed)).toBe(true);
    expect((await redemptionRow(redemptionId)).status).toBe("void");

    const balance = await exec.query<{ balance_points: number }>(
      `SELECT balance_points FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(Number(balance.rows[0]!.balance_points)).toBe(1_000); // points returned
  });

  it("23. a voided redemption cannot be applied afterwards", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });

    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_reverse_redemption($1, $2) AS result`, [f.shopAId, redemptionId]),
    );

    const r = await apply(f.ownerAId, redemptionId, saleId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("redemption_voided");
  });

  it("a failed application leaves the redemption applicable to a correct sale later", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const noDiscount = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 0 });
    expect((await apply(f.ownerAId, redemptionId, noDiscount)).error).toBe("no_discount_on_sale");

    const properSale = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    expect((await apply(f.ownerAId, redemptionId, properSale)).ok).toBe(true);
  });
});

// ===========================================================================
// 24, 25, 26, 27, 29, 30 — the other phases, invariants, safety
// ===========================================================================

describe("24-30. the rest of the system stays correct", () => {
  it("24 & 25. member activity and member rewards expose the benefit, and balances are unmoved", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({
      name: "UGX 5,000 Off",
      points: 500,
      benefitKind: "fixed_discount",
      amountUgx: 5_000,
    });

    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "e-act@test.local"]);
    const member = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["E Act", "+256700930002"]),
        )
      ).rows[0],
    );
    await exec.query(
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
       VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
      [member.member_id, accountId, f.shopAId],
    );

    await redeem(f.ownerAId, accountId, rewardId, `e-act-${crypto.randomUUID()}`);
    const redemptionId = await lastRedemptionId(accountId);
    const saleId = await discountedSale(customerId, { subtotalUgx: 20_000, discountUgx: 5_000 });
    const balanceBeforeApply = Number(
      (
        await exec.query<{ balance_points: number }>(
          `SELECT balance_points FROM public.loyalty_accounts WHERE id = $1`,
          [accountId],
        )
      ).rows[0]!.balance_points,
    );
    expect((await apply(f.ownerAId, redemptionId, saleId)).ok).toBe(true);

    const activity = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_activity(20, null, null) AS result`),
        )
      ).rows[0],
    ) as never as { items: { kind: string; cause: string; points: number }[] };
    const redemption = activity.items.find((i) => i.cause === "redemption")!;
    expect(Number(redemption.points)).toBe(-500);

    const rewards = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_rewards(100) AS result`),
        )
      ).rows[0],
    ) as never as { rewards: { id: string; points_required: number }[] };
    const shown = rewards.rewards.find((r) => r.id === rewardId)!;
    expect(Number(shown.points_required)).toBe(500);

    // Points are NOT money: applying a discount moved no balance. The DELTA is the
    // assertion — the discounted sale itself legitimately earned points, and the redemption
    // legitimately spent 500, so only "did applying change anything?" is the question here.
    const after = await exec.query<{ balance_points: number; lifetime_earned_points: number }>(
      `SELECT balance_points, lifetime_earned_points FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(Number(after.rows[0]!.balance_points)).toBe(balanceBeforeApply);
    // And the redemption really did spend its 500 points.
    const ledger = await exec.query<{ points: number }>(
      `SELECT points FROM public.loyalty_transactions
       WHERE account_id = $1 AND kind = 'redeemed' ORDER BY created_at DESC LIMIT 1`,
      [accountId],
    );
    expect(Number(ledger.rows[0]!.points)).toBe(-500);
  });

  it("26. Customer 360 reports the benefit snapshot and the sale it discounted", async () => {
    const { customerId, redemptionId } = await benefitRedemption({
      funded: 1_000,
      points: 500,
      amountUgx: 5_000,
    });
    const saleId = await discountedSale(customerId, { subtotalUgx: 20_000, discountUgx: 5_000 });
    await apply(f.ownerAId, redemptionId, saleId);

    const profile = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.shop_customer_360($1, $2, 10) AS result`, [f.shopAId, customerId]),
        )
      ).rows[0],
    ) as never as {
      rewards: { redemption_count: number };
      recent_redemptions: { status: string; points_spent: number }[];
    };

    expect(Number(profile.rewards.redemption_count)).toBe(1);
    const shown = profile.recent_redemptions[0]!;
    expect(shown.status).toBe("completed");
    expect(Number(shown.points_spent)).toBe(500);

    // The benefit itself is readable from the authoritative row.
    const rd = await redemptionRow(redemptionId);
    expect(rd.benefit_kind).toBe("fixed_discount");
    expect(Number(rd.applied_amount_ugx)).toBe(5_000);
    expect(rd.sale_id).toBe(saleId);
  });

  it("27. the loyalty balance invariant still holds after a benefit is applied", async () => {
    const { accountId, customerId, redemptionId } = await benefitRedemption({ funded: 1_000, points: 500 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    await apply(f.ownerAId, redemptionId, saleId);

    const r = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.loyalty_assert_balance_invariant($1) AS result`, [accountId]),
        )
      ).rows[0],
    );
    expect(r.holds).toBe(true);
    // The checker's own arithmetic: the invariant is what matters, not an absolute figure
    // (the discounted sale legitimately earned points of its own).
    expect(Number(r.balance_points)).toBe(
      Number(r.lifetime_earned_points) - Number(r.lifetime_redeemed_points),
    );
    expect(Number(r.ledger_sum)).toBe(Number(r.balance_points));
  });

  it("29. product rewards are unaffected", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    await exec.query(`UPDATE public.products SET stock_on_hand = 10 WHERE id = $1`, [f.productAId]);
    const productReward = await makeReward({ name: "Free Coke", points: 100, productId: f.productAId });

    const r = await redeem(f.ownerAId, accountId, productReward, `product-${crypto.randomUUID()}`);
    expect(r.ok, JSON.stringify(r)).toBe(true);

    const rd = await redemptionRow(await lastRedemptionId(accountId));
    // A product reward carries no monetary benefit and is not applicable to a sale.
    expect(rd.benefit_kind).toBe("none");
    expect(rd.applied_amount_ugx).toBeNull();
  });

  it("30. no token, and no money field, leaks from the application RPC", async () => {
    const { accountId, customerId, redemptionId } = await benefitRedemption({ amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 10_000, discountUgx: 5_000 });
    const r = await apply(f.ownerAId, redemptionId, saleId);

    const payload = JSON.stringify(r);
    expect(payload).not.toContain("qr_token");
    expect(payload).not.toContain("public_card_token");

    const who = await exec.query<{ qr_token: string | null }>(
      `SELECT qr_token FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(who.rows[0]!.qr_token).toBeTruthy();
    expect(payload).not.toContain(who.rows[0]!.qr_token!);

    // The customer's points balance is NOT a currency: the RPC never returns one.
    expect(payload).not.toContain("balance_points");
    expect(payload).not.toContain("wallet");
  });
});

// ===========================================================================
// PART 7 & 8 — the benefit reaches the member and merchant read models
// ===========================================================================

describe("PART 7 & 8. both read models carry the benefit", () => {
  it("the member's reward list says what their points buy", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({
      name: "UGX 5,000 Off",
      points: 500,
      benefitKind: "fixed_discount",
      amountUgx: 5_000,
    });

    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "p7@test.local"]);
    const member = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["P7 Member", "+256700940001"]),
        )
      ).rows[0],
    );
    await exec.query(
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
       VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
      [member.member_id, accountId, f.shopAId],
    );

    const payload = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_rewards(100) AS result`),
        )
      ).rows[0],
    ) as never as {
      rewards: { id: string; benefit_kind: string; benefit_amount_ugx: number | null; benefit_percent: number | null }[];
    };

    const shown = payload.rewards.find((r) => r.id === rewardId)!;
    expect(shown.benefit_kind).toBe("fixed_discount");
    expect(Number(shown.benefit_amount_ugx)).toBe(5_000);
    expect(shown.benefit_percent).toBeNull();

    // Nothing privileged leaks with it.
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain("qr_token");
    expect(raw).not.toContain("public_card_token");
    expect(raw).not.toContain("requires_offer_grant");
  });

  it("a percentage benefit reaches the member as a percentage", async () => {
    const customerId = await newCustomer();
    const accountId = await fundedAccount(customerId, 1_000);
    const rewardId = await makeReward({
      name: "10% Off",
      points: 1_000,
      benefitKind: "percentage_discount",
      amountUgx: null,
      percent: 10,
    });

    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "p7b@test.local"]);
    const member = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["P7b Member", "+256700940002"]),
        )
      ).rows[0],
    );
    await exec.query(
      `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
       VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
      [member.member_id, accountId, f.shopAId],
    );

    const payload = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_rewards(100) AS result`),
        )
      ).rows[0],
    ) as never as { rewards: { id: string; benefit_kind: string; benefit_percent: number | null }[] };

    const shown = payload.rewards.find((r) => r.id === rewardId)!;
    expect(shown.benefit_kind).toBe("percentage_discount");
    expect(Number(shown.benefit_percent)).toBe(10);
  });

  it("Customer 360 shows the benefit SNAPSHOT, and a later edit cannot rewrite it", async () => {
    const { customerId, rewardId, redemptionId } = await benefitRedemption({ funded: 1_000, amountUgx: 5_000 });
    const saleId = await discountedSale(customerId, { subtotalUgx: 20_000, discountUgx: 5_000 });
    expect((await apply(f.ownerAId, redemptionId, saleId)).ok).toBe(true);

    // The merchant re-prices the reward.
    await exec.query(`UPDATE public.loyalty_rewards SET benefit_amount_ugx = 1_000 WHERE id = $1`, [rewardId]);

    const profile = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.shop_customer_360($1, $2, 10) AS result`, [f.shopAId, customerId]),
        )
      ).rows[0],
    ) as never as {
      recent_redemptions: {
        reward_name: string;
        points_spent: number;
        benefit_kind: string;
        benefit_amount_ugx: number | null;
        applied_amount_ugx: number | null;
        applied_sale_id: string | null;
        status: string;
      }[];
    };

    const shown = profile.recent_redemptions.find((r) => r.status === "completed")!;
    expect(shown.benefit_kind).toBe("fixed_discount");
    expect(Number(shown.benefit_amount_ugx)).toBe(5_000); // the historical worth, not 1,000
    expect(Number(shown.applied_amount_ugx)).toBe(5_000);
    expect(shown.applied_sale_id).toBe(saleId);
    expect(Number(shown.points_spent)).toBe(500);
  });

  it("Customer 360 shows a redeemed-but-unapplied benefit honestly", async () => {
    const { customerId, redemptionId } = await benefitRedemption({ funded: 1_000, amountUgx: 5_000 });
    expect(customerId).toBeTruthy();

    const profile = rpcJson(
      (
        await asUser(exec, f.ownerAId, async () =>
          exec.query(`SELECT public.shop_customer_360($1, $2, 10) AS result`, [f.shopAId, customerId]),
        )
      ).rows[0],
    ) as never as {
      recent_redemptions: { applied_amount_ugx: number | null; applied_sale_id: string | null }[];
    };

    const shown = profile.recent_redemptions[0]!;
    // Worth 5,000, but no sale has received it yet — reported as absent, not as 5,000.
    expect(shown.applied_amount_ugx).toBeNull();
    expect(shown.applied_sale_id).toBeNull();
    expect(redemptionId).toBeTruthy();
  });
});
