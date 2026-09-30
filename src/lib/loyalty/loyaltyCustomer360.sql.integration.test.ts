import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  createLoyaltySqlHarness,
  enableProgram,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * LOYALTY PHASE C — merchant-side Customer 360.
 *
 * THE SPENDING ARITHMETIC IS THE POINT OF THIS FILE.
 *
 * A voided sale keeps its money out of the population by STATUS (`status = 'void'`). A
 * returned sale does NOT — it stays `status = 'completed'` and the refund sits beside it
 * in `sale_returns`. So a naive `sum(total_ugx) where status='completed'` reports money
 * the customer got back, and the tests below pin the corrected arithmetic in both
 * directions: a fully-returned sale nets to zero, a partial return reduces by exactly
 * the refunded amount, and a void is excluded rather than double-subtracted.
 *
 * THE ISOLATION NEGATIVES ARE THE OTHER HALF. Customer 360 is shop-scoped: a customer id
 * from another shop must resolve to `not_found`, and one shop's spending, balance,
 * rewards and redemptions must never appear in another shop's profile for the same
 * person.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function newCustomer(shopId: string, name = "Customer"): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    shopId,
    name,
  ]);
  return id;
}

/** A completed sale at a shop, at a chosen time. */
async function sale(
  shopId: string,
  customerId: string | null,
  totalUgx: number,
  opts: { status?: string; at?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const at = opts.at ?? new Date().toISOString();
  await exec.query(
    `INSERT INTO public.sales (id, shop_id, customer_id, status, payment_status, total_ugx, completed_at, created_at)
     VALUES ($1, $2, $3, $4, 'paid', $5, $6, $6)`,
    [id, shopId, customerId, opts.status ?? "completed", totalUgx, at],
  );
  return id;
}

async function refund(shopId: string, saleId: string, productId: string, amountUgx: number) {
  await exec.query(
    `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx)
     VALUES ($1, $2, $3, $4, 1, $5)`,
    [crypto.randomUUID(), shopId, saleId, productId, amountUgx],
  );
}

async function account(shopId: string, customerId: string): Promise<string> {
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, customerId],
  );
  if (r.rows[0]?.id) return r.rows[0].id;
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.loyalty_accounts (id, shop_id, customer_id) VALUES ($1, $2, $3)`, [
    id,
    shopId,
    customerId,
  ]);
  return id;
}

type Spending = {
  completed_purchases: number;
  gross_spend_ugx: number;
  returned_ugx: number;
  net_spend_ugx: number;
  average_purchase_ugx: number | null;
  voided_purchases: number;
  first_purchase_at: string | null;
  last_purchase_at: string | null;
};

type Profile360 = {
  ok: boolean;
  error?: string;
  customer?: { id: string; name: string; phone_e164: string | null };
  loyalty?: {
    balance_points: number;
    lifetime_earned_points: number;
    lifetime_redeemed_points: number;
    account_status: string;
    membership_active: boolean;
    member_link_status: string | null;
  } | null;
  spending: Spending;
  rewards: {
    visible_count: number;
    items: { id: string; name: string; state: string; personal: boolean; times_redeemed: number }[];
    redemption_count: number;
    points_redeemed: number;
  };
  recent_purchases: { total_ugx: number; returned_ugx: number }[];
  recent_loyalty_activity: { kind: string; points: number }[];
  recent_redemptions: { reward_name: string; points_spent: number }[];
};

const profile = async (
  asUserId: string,
  shopId: string,
  customerId: string,
  limit?: number,
): Promise<Profile360> => {
  const r = await asUser(exec, asUserId, async () =>
    exec.query(`SELECT public.shop_customer_360($1, $2, $3) AS result`, [
      shopId,
      customerId,
      limit ?? 10,
    ]),
  );
  return rpcJson(r.rows[0]) as never;
};

const search = async (asUserId: string, shopId: string, q?: string | null) => {
  const r = await asUser(exec, asUserId, async () =>
    exec.query(`SELECT public.shop_customer_search($1, $2, $3) AS result`, [shopId, q ?? null, 25]),
  );
  return rpcJson(r.rows[0]) as never as {
    ok: boolean;
    error?: string;
    customers: { id: string; name: string; has_loyalty_account: boolean; balance_points: number | null }[];
  };
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
// 9, 10, 11, 12, 13 — spending is derived from authoritative sales
// ===========================================================================

describe("9-13. spending is derived from sales, and returns are subtracted", () => {
  it("9 & 12. sums completed sales and counts them", async () => {
    const customerId = await newCustomer(f.shopAId);
    await sale(f.shopAId, customerId, 10_000, { at: "2026-09-01T10:00:00Z" });
    await sale(f.shopAId, customerId, 25_000, { at: "2026-09-02T10:00:00Z" });

    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(p.ok).toBe(true);
    expect(p.spending.completed_purchases).toBe(2);
    expect(Number(p.spending.gross_spend_ugx)).toBe(35_000);
    expect(Number(p.spending.net_spend_ugx)).toBe(35_000);
    expect(Number(p.spending.average_purchase_ugx)).toBe(17_500);
    expect(p.spending.first_purchase_at).toContain("2026-09-01");
    expect(p.spending.last_purchase_at).toContain("2026-09-02");
  });

  it("11. a PARTIAL return reduces spend by exactly the refunded amount", async () => {
    const customerId = await newCustomer(f.shopAId);
    const saleId = await sale(f.shopAId, customerId, 100_000);
    await refund(f.shopAId, saleId, f.productAId, 30_000);

    const p = await profile(f.ownerAId, f.shopAId, customerId);
    // The sale still counts as a purchase — the customer did buy…
    expect(p.spending.completed_purchases).toBe(1);
    expect(Number(p.spending.gross_spend_ugx)).toBe(100_000);
    // …but only 70,000 of it stayed with the shop.
    expect(Number(p.spending.returned_ugx)).toBe(30_000);
    expect(Number(p.spending.net_spend_ugx)).toBe(70_000);
    // And the recent-purchase row carries its own refund, so the figure reconciles.
    expect(Number(p.recent_purchases[0]!.returned_ugx)).toBe(30_000);
  });

  it("11b. a FULLY returned sale nets to zero — it is not permanent spend", async () => {
    const customerId = await newCustomer(f.shopAId);
    const saleId = await sale(f.shopAId, customerId, 50_000);
    await refund(f.shopAId, saleId, f.productAId, 50_000);

    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(Number(p.spending.gross_spend_ugx)).toBe(50_000);
    expect(Number(p.spending.returned_ugx)).toBe(50_000);
    expect(Number(p.spending.net_spend_ugx)).toBe(0);
    // This is the assertion that fails against a naive sum(status='completed').
    expect(Number(p.spending.net_spend_ugx)).not.toBe(50_000);
  });

  it("10. a VOIDED sale leaves the population by status, and is not double-subtracted", async () => {
    const customerId = await newCustomer(f.shopAId);
    await sale(f.shopAId, customerId, 40_000, { status: "void" });
    const good = await sale(f.shopAId, customerId, 20_000);
    await refund(f.shopAId, good, f.productAId, 5_000);

    const p = await profile(f.ownerAId, f.shopAId, customerId);
    // The void contributes nothing to either side…
    expect(Number(p.spending.gross_spend_ugx)).toBe(20_000);
    expect(Number(p.spending.returned_ugx)).toBe(5_000);
    expect(Number(p.spending.net_spend_ugx)).toBe(15_000);
    // …and is reported separately rather than silently vanishing.
    expect(p.spending.voided_purchases).toBe(1);
    expect(p.spending.completed_purchases).toBe(1);
  });

  it("13. historical totals are read, never recomputed from prices or line items", async () => {
    const customerId = await newCustomer(f.shopAId);
    const saleId = await sale(f.shopAId, customerId, 7_777);

    // Make every plausible recomputation give a different answer: a current product price
    // far above the sale, and a line item that contradicts the header total. If the
    // aggregate recomputed anything, it would report one of these, not 7,777.
    await exec.query(`UPDATE public.products SET selling_price_per_unit_ugx = 999_999 WHERE id = $1`, [
      f.productAId,
    ]);
    await exec.query(
      `INSERT INTO public.sale_line_items (id, sale_id, product_id, quantity, unit_price_ugx, line_total_ugx)
       VALUES ($1, $2, $3, 1, 888_888, 888_888)`,
      [crypto.randomUUID(), saleId, f.productAId],
    );

    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(Number(p.spending.gross_spend_ugx)).toBe(7_777);
    expect(JSON.stringify(p)).not.toContain("888888");
    expect(JSON.stringify(p)).not.toContain("999999");
  });

  it("23. a customer with no purchases reports zeros, not nulls or an error", async () => {
    const customerId = await newCustomer(f.shopAId);
    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(p.ok).toBe(true);
    expect(p.spending.completed_purchases).toBe(0);
    expect(Number(p.spending.net_spend_ugx)).toBe(0);
    expect(p.spending.average_purchase_ugx).toBeNull();
    expect(p.spending.last_purchase_at).toBeNull();
    expect(p.recent_purchases).toEqual([]);
  });

  it("a sale belonging to a DIFFERENT customer is not counted", async () => {
    const mine = await newCustomer(f.shopAId);
    const theirs = await newCustomer(f.shopAId);
    await sale(f.shopAId, mine, 1_000);
    await sale(f.shopAId, theirs, 888_000);

    const p = await profile(f.ownerAId, f.shopAId, mine);
    expect(Number(p.spending.gross_spend_ugx)).toBe(1_000);
    expect(JSON.stringify(p)).not.toContain("888000");
  });

  it("a sale with no customer attached is attributed to nobody", async () => {
    await sale(f.shopAId, null, 123_000);
    const customerId = await newCustomer(f.shopAId);
    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(Number(p.spending.gross_spend_ugx)).toBe(0);
  });
});

// ===========================================================================
// 14, 15, 16 — loyalty comes from the existing ledger and counters
// ===========================================================================

describe("14-16. loyalty figures come from the authoritative account and ledger", () => {
  it("14 & 15. balance and lifetime figures are the account's own, not recomputed", async () => {
    const customerId = await newCustomer(f.shopAId);
    await sale(f.shopAId, customerId, 100_000); // awards 100 points
    const accountId = await account(f.shopAId, customerId);

    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(p.loyalty).not.toBeNull();
    expect(Number(p.loyalty!.balance_points)).toBe(100);
    expect(Number(p.loyalty!.lifetime_earned_points)).toBe(100);
    expect(Number(p.loyalty!.lifetime_redeemed_points)).toBe(0);

    // A redemption moves both the ledger and the cached counters.
    const rewardId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, reward_kind, active)
       VALUES ($1, $2, 'Coke', 40, 'custom', true)`,
      [rewardId, f.shopAId],
    );
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
        f.shopAId,
        accountId,
        rewardId,
        `c360-${rewardId}`,
      ]),
    );

    const after = await profile(f.ownerAId, f.shopAId, customerId);
    expect(Number(after.loyalty!.balance_points)).toBe(60);
    expect(Number(after.loyalty!.lifetime_redeemed_points)).toBe(40);
    expect(after.rewards.redemption_count).toBe(1);
    expect(Number(after.rewards.points_redeemed)).toBe(40);
  });

  it("16. redemption history belongs to this customer's account only", async () => {
    const mine = await newCustomer(f.shopAId);
    const theirs = await newCustomer(f.shopAId);
    await sale(f.shopAId, mine, 100_000);
    await sale(f.shopAId, theirs, 100_000);
    const mineAccount = await account(f.shopAId, mine);
    const theirAccount = await account(f.shopAId, theirs);

    const rewardId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, reward_kind, active)
       VALUES ($1, $2, 'Shared Reward', 10, 'custom', true)`,
      [rewardId, f.shopAId],
    );
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
        f.shopAId,
        theirAccount,
        rewardId,
        `c360-theirs-${rewardId}`,
      ]),
    );

    const p = await profile(f.ownerAId, f.shopAId, mine);
    expect(p.rewards.redemption_count).toBe(0);
    expect(p.recent_redemptions).toEqual([]);
    // (The reward itself is shop-wide, so it legitimately appears for every member of
    // this shop. What must NOT leak is the other customer's REDEMPTION of it.)
    expect(p.recent_redemptions).toEqual([]);
    expect(mineAccount).not.toBe(theirAccount);
  });

  it("22. a customer with purchases but NO loyalty account still returns a full profile", async () => {
    // The award flow auto-enrols on the first qualifying sale, so a customer can only
    // have purchases and no account while the program is off — which is a real state
    // (loyalty launched later than the customer did).
    await exec.query(`UPDATE public.loyalty_programs SET enabled = false WHERE shop_id = $1`, [f.shopAId]);
    let customerId = "";
    try {
      customerId = await newCustomer(f.shopAId);
      await sale(f.shopAId, customerId, 12_000);
    } finally {
      await exec.query(`UPDATE public.loyalty_programs SET enabled = true WHERE shop_id = $1`, [f.shopAId]);
    }
    const accounts = await exec.query(
      `SELECT 1 FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
      [f.shopAId, customerId],
    );
    expect(accounts.rows).toHaveLength(0); // the premise holds

    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(p.ok).toBe(true);
    expect(p.loyalty).toBeNull(); // no account — reported as absent, not as zero
    expect(Number(p.spending.net_spend_ugx)).toBe(12_000); // spending still works
    expect(p.recent_loyalty_activity).toEqual([]);
    expect(p.recent_redemptions).toEqual([]);
  });

  it("21. an empty customer renders without failing", async () => {
    const customerId = await newCustomer(f.shopAId);
    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(p.ok).toBe(true);
    expect(p.recent_purchases).toEqual([]);
    expect(p.recent_loyalty_activity).toEqual([]);
    expect(p.recent_redemptions).toEqual([]);
    expect(p.rewards.items).toEqual([]);
  });
});

// ===========================================================================
// 17, 18 — rewards reuse the canonical eligibility engine
// ===========================================================================

describe("17-18. rewards use the canonical eligibility rules", () => {
  it("18. a shop-wide reward appears with its server-computed state", async () => {
    const customerId = await newCustomer(f.shopAId);
    await account(f.shopAId, customerId);
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, reward_kind, active)
       VALUES ($1, $2, 'Everyone Reward', 10, 'custom', true)`,
      [crypto.randomUUID(), f.shopAId],
    );

    const p = await profile(f.ownerAId, f.shopAId, customerId);
    const reward = p.rewards.items.find((r) => r.name === "Everyone Reward")!;
    expect(reward.state).toBe("insufficient_points"); // zero balance
    expect(reward.personal).toBe(false);
  });

  it("17. a personal reward for ANOTHER customer does not appear", async () => {
    const mine = await newCustomer(f.shopAId);
    const theirs = await newCustomer(f.shopAId);
    await account(f.shopAId, mine);
    const theirAccount = await account(f.shopAId, theirs);

    const personalId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, reward_kind, active, requires_offer_grant)
       VALUES ($1, $2, 'Their Personal', 10, 'custom', true, true)`,
      [personalId, f.shopAId],
    );
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_assign_reward($1, $2, $3) AS result`, [
        f.shopAId,
        theirAccount,
        personalId,
      ]),
    );

    const p = await profile(f.ownerAId, f.shopAId, mine);
    expect(p.rewards.items.some((r) => r.id === personalId)).toBe(false);
    expect(JSON.stringify(p)).not.toContain("Their Personal");

    // …while the customer it WAS granted to does see it.
    const theirs360 = await profile(f.ownerAId, f.shopAId, theirs);
    const seen = theirs360.rewards.items.find((r) => r.id === personalId)!;
    expect(seen.personal).toBe(true);
  });

  it("an expired reward is reported as expired, not available", async () => {
    const customerId = await newCustomer(f.shopAId);
    await account(f.shopAId, customerId);
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, reward_kind, active, expires_on)
       VALUES ($1, $2, 'Lapsed', 10, 'custom', true, '2020-01-01')`,
      [crypto.randomUUID(), f.shopAId],
    );
    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(p.rewards.items.find((r) => r.name === "Lapsed")!.state).toBe("expired");
  });
});

// ===========================================================================
// 1-8, 24 — authorization and multi-merchant isolation
// ===========================================================================

describe("1-4. merchant authorization", () => {
  it("1. an authorized merchant reads their own customer", async () => {
    const customerId = await newCustomer(f.shopAId);
    expect((await profile(f.ownerAId, f.shopAId, customerId)).ok).toBe(true);
  });

  it("2 & 5. another shop's staff cannot read this customer, even knowing the ids", async () => {
    const customerId = await newCustomer(f.shopAId);
    // Shop B's owner is genuinely authorized for shop B — but not for shop A's customers.
    // `outsiderId` is the owner of shop B — genuinely authorized for shop B.
    const crossShop = await profile(f.outsiderId, f.shopBId, customerId);
    expect(crossShop.ok).toBe(false);
    expect(crossShop.error).toBe("not_found");
  });

  it("5b. a customer id from another shop resolves to not_found, not to data", async () => {
    // Shop A's owner IS authorized for shop A — so this is not a permissions refusal, it
    // is the ownership check: the id belongs to another shop and resolves to nothing.
    const shopBCustomer = await newCustomer(f.shopBId);
    const r = await profile(f.ownerAId, f.shopAId, shopBCustomer);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_found");
    // And the mirror: shop B asking for its own customer succeeds, proving the check is
    // ownership rather than a blanket refusal.
    const own = await profile(f.outsiderId, f.shopBId, shopBCustomer);
    expect(own.ok).toBe(true);
  });

  it("3. an outsider with no shop access is refused entirely", async () => {
    const customerId = await newCustomer(f.shopAId);
    const r = await profile(f.outsiderId, f.shopAId, customerId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });

  it("4. anonymous access is refused by grant", async () => {
    const customerId = await newCustomer(f.shopAId);
    await expect(
      asAnon(exec, async () => exec.query(`SELECT public.shop_customer_360($1, $2) AS result`, [f.shopAId, customerId])),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAnon(exec, async () => exec.query(`SELECT public.shop_customer_search($1) AS result`, [f.shopAId])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("4b. a loyalty MEMBER (customer) cannot reach the merchant view", async () => {
    // A member is authenticated but is not shop staff, so `user_can_access_shop` refuses.
    const userId = crypto.randomUUID();
    await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, "m360@test.local"]);
    await asUser(exec, userId, async () =>
      exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["C360 Member", "+256700910001"]),
    );
    const customerId = await newCustomer(f.shopAId);

    const r = await profile(userId, f.shopAId, customerId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    const s = await search(userId, f.shopAId, null);
    expect(s.ok).toBe(false);
    expect(s.error).toBe("forbidden");
  });

  it("a cashier may read — matching the existing customers policy boundary", async () => {
    const customerId = await newCustomer(f.shopAId);
    expect((await profile(f.cashierAId, f.shopAId, customerId)).ok).toBe(true);
  });
});

describe("6-8, 24. multi-merchant isolation", () => {
  it("6. a customer belonging to shop A is invisible to shop B", async () => {
    const customerId = await newCustomer(f.shopAId);
    await sale(f.shopAId, customerId, 60_000);
    const s = await search(f.outsiderId, f.shopBId, null);
    expect(s.ok).toBe(true);
    // Shop B's own customer list never includes shop A's people.
    expect(s.customers.some((c) => c.id === customerId)).toBe(false);
  });

  it("7 & 8 & 24. the same person at two shops shows each shop only its own relationship", async () => {
    // Two customer rows — one per shop — as the schema is shop-scoped.
    const atA = await newCustomer(f.shopAId, "Shared Person");
    const atB = await newCustomer(f.shopBId, "Shared Person");
    await sale(f.shopAId, atA, 30_000);
    await sale(f.shopBId, atB, 770_000);

    const a = await profile(f.ownerAId, f.shopAId, atA);
    const b = await profile(f.outsiderId, f.shopBId, atB);

    expect(Number(a.spending.gross_spend_ugx)).toBe(30_000);
    expect(Number(b.spending.gross_spend_ugx)).toBe(770_000);
    // Neither payload carries the other shop's money.
    expect(JSON.stringify(a)).not.toContain("770000");
    expect(JSON.stringify(b)).not.toContain("30000");
  });

  it("8b. loyalty balances do not cross shops, even for the same person", async () => {
    const atA = await newCustomer(f.shopAId, "Balance Person");
    const atB = await newCustomer(f.shopBId, "Balance Person");
    await sale(f.shopAId, atA, 100_000); // 100 points at A
    await sale(f.shopBId, atB, 45_000); // 45 points at B

    const a = await profile(f.ownerAId, f.shopAId, atA);
    const b = await profile(f.outsiderId, f.shopBId, atB);
    expect(Number(a.loyalty!.balance_points)).toBe(100);
    expect(Number(b.loyalty!.balance_points)).toBe(45);
  });

  it("9. reward assignments do not cross shops", async () => {
    const atA = await newCustomer(f.shopAId, "Assign Person");
    const accountA = await account(f.shopAId, atA);
    const personal = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, reward_kind, active, requires_offer_grant)
       VALUES ($1, $2, 'A Only Personal', 10, 'custom', true, true)`,
      [personal, f.shopAId],
    );
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_assign_reward($1, $2, $3) AS result`, [f.shopAId, accountA, personal]),
    );

    // Shop B's owner, looking at their OWN customer list, never sees shop A's rewards.
    const s = await search(f.outsiderId, f.shopBId, null);
    expect(JSON.stringify(s)).not.toContain("A Only Personal");
  });
});

// ===========================================================================
// 19, 20 — payload safety and scoping
// ===========================================================================

describe("19-20. payload safety", () => {
  it("19. no QR or public-card token is ever returned", async () => {
    const customerId = await newCustomer(f.shopAId);
    const accountId = await account(f.shopAId, customerId);
    const p = await profile(f.ownerAId, f.shopAId, customerId);

    const payload = JSON.stringify(p);
    expect(payload).not.toContain("qr_token");
    expect(payload).not.toContain("public_card_token");
    expect(payload).not.toContain("auth_user_id");

    // Not vacuous: the account really does hold a token, and it is absent.
    const who = await exec.query<{ qr_token: string | null }>(
      `SELECT qr_token FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(who.rows[0]!.qr_token).toBeTruthy();
    expect(payload).not.toContain(who.rows[0]!.qr_token!);
  });

  it("20. the customer's own identity is scoped to this shop", async () => {
    const customerId = await newCustomer(f.shopAId, "Scoped Name");
    const p = await profile(f.ownerAId, f.shopAId, customerId);
    expect(p.customer!.id).toBe(customerId);
    expect(p.customer!.name).toBe("Scoped Name");
    // Only the fields the profile needs.
    expect(Object.keys(p.customer!).sort()).toEqual(["customer_since", "email", "id", "name", "phone_e164"].sort());
  });

  it("exposes no internal customer columns, whatever the table carries", async () => {
    // The harness `customers` table is the narrow bootstrap shape (no notes/metadata), so
    // this asserts the PROPERTY rather than a leaked value: the profile reports a fixed
    // set of fields and nothing else, which is what stops a later column silently
    // appearing in the payload. (Production's `customers` does carry `notes` and
    // `metadata`; neither is selected anywhere in `shop_customer_360`.)
    const customerId = await newCustomer(f.shopAId, "Private Person");
    const p = await profile(f.ownerAId, f.shopAId, customerId);
    const payload = JSON.stringify(p);

    for (const forbidden of ["metadata", "notes", "loyalty_points", "auth_user_id", "qr_token", "public_card_token"]) {
      expect(payload, forbidden).not.toContain(forbidden);
    }
    // Exactly the fields the profile needs, and no more.
    expect(Object.keys(p.customer!).sort()).toEqual(
      ["customer_since", "email", "id", "name", "phone_e164"].sort(),
    );
  });

  it("bounds the activity lists rather than loading the whole history", async () => {
    const customerId = await newCustomer(f.shopAId);
    for (let i = 0; i < 8; i++) {
      await sale(f.shopAId, customerId, 1_000, { at: `2026-08-0${i + 1}T10:00:00Z` });
    }
    const p = await profile(f.ownerAId, f.shopAId, customerId, 3);
    expect(p.recent_purchases).toHaveLength(3);
    // The SUMMARY still covers everything — only the activity slices are bounded.
    expect(p.spending.completed_purchases).toBe(8);
    expect(Number(p.spending.gross_spend_ugx)).toBe(8_000);
  });
});

// ===========================================================================
// Search
// ===========================================================================

describe("search finds the customer to open", () => {
  it("finds by name and flags loyalty membership", async () => {
    const name = `Findable ${crypto.randomUUID().slice(0, 8)}`;
    const customerId = await newCustomer(f.shopAId, name);
    await account(f.shopAId, customerId);

    const s = await search(f.ownerAId, f.shopAId, "Findable");
    const hit = s.customers.find((c) => c.id === customerId)!;
    expect(hit).toBeDefined();
    expect(hit.has_loyalty_account).toBe(true);
  });

  it("includes a customer with no loyalty account", async () => {
    const name = `Plain ${crypto.randomUUID().slice(0, 8)}`;
    const customerId = await newCustomer(f.shopAId, name);
    const s = await search(f.ownerAId, f.shopAId, "Plain");
    const hit = s.customers.find((c) => c.id === customerId)!;
    expect(hit.has_loyalty_account).toBe(false);
  });

  it("finds by phone", async () => {
    const customerId = await newCustomer(f.shopAId, "Phone Person");
    await exec.query(`UPDATE public.customers SET phone_e164 = '+256700999888' WHERE id = $1`, [customerId]);
    const s = await search(f.ownerAId, f.shopAId, "+256700999888");
    expect(s.customers.some((c) => c.id === customerId)).toBe(true);
  });

  it("is bounded", async () => {
    const s = await search(f.ownerAId, f.shopAId, null);
    expect(s.customers.length).toBeLessThanOrEqual(25);
  });
});
