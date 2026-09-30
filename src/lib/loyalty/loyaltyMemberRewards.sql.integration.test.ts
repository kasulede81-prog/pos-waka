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
 * LOYALTY PHASE B — the member's reward read model.
 *
 * THE ISOLATION NEGATIVES CARRY THE WEIGHT. This projection surfaces `loyalty_rewards`
 * to a customer for the first time, and the catalogue is shared: one shop's rewards are
 * visible to every member of that shop. The failure that matters is a PERSONAL reward —
 * `requires_offer_grant = true`, granted to one account — leaking into another member's
 * list, or a member seeing a shop they are not linked to. Both are asserted directly.
 *
 * ELIGIBILITY IS NOT RESTATED HERE. The RPC calls the canonical helpers
 * (`loyalty_account_reward_granted`, `loyalty_reward_unexpired`) and the same
 * redemption-limit predicate the redeem RPC enforces. These tests therefore pin the
 * RPC's USE of those rules, not a second copy of them.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function makeMember(phone: string, name = "Member"): Promise<{ userId: string; memberId: string }> {
  const userId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    userId,
    `${userId.slice(0, 8)}@rewards.test`,
  ]);
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, [name, phone]),
  );
  return { userId, memberId: String(rpcJson(r.rows[0]).member_id ?? "") };
}

async function newCustomer(shopId: string = f.shopAId): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    shopId,
    "Rewards Customer",
  ]);
  return id;
}

/**
 * The member's loyalty account at a shop.
 *
 * A real account is created by the award flow on the first qualifying sale, but a member
 * can also be linked before ever buying anything — so this creates the row when it is
 * absent rather than pretending every member has already shopped.
 */
async function accountFor(shopId: string, customerId: string): Promise<string> {
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, customerId],
  );
  const existing = r.rows[0]?.id;
  if (existing) return existing;

  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.loyalty_accounts (id, shop_id, customer_id) VALUES ($1, $2, $3)`, [
    id,
    shopId,
    customerId,
  ]);
  return id;
}

async function link(memberId: string, shopId: string, accountId: string): Promise<void> {
  await exec.query(
    `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
     VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
    [memberId, accountId, shopId],
  );
}

/** A reward on a shop, with the fields under test. */
async function makeReward(opts: {
  shopId?: string;
  name: string;
  points?: number;
  kind?: "product" | "voucher" | "custom";
  active?: boolean;
  expiresOn?: string | null;
  personal?: boolean;
  maxPerAccount?: number | null;
  sortOrder?: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(
    `INSERT INTO public.loyalty_rewards
       (id, shop_id, name, description, points_required, reward_kind, active, expires_on,
        requires_offer_grant, max_redemptions_per_account, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      opts.shopId ?? f.shopAId,
      opts.name,
      `${opts.name} description`,
      opts.points ?? 100,
      opts.kind ?? "custom",
      opts.active ?? true,
      opts.expiresOn ?? null,
      opts.personal ?? false,
      opts.maxPerAccount ?? null,
      opts.sortOrder ?? 0,
    ],
  );
  return id;
}

/** Grant a personal reward to one account (D029). */
async function assign(shopId: string, accountId: string, rewardId: string, expiresAt?: string | null) {
  await asUser(exec, f.ownerAId, async () =>
    exec.query(`SELECT public.loyalty_assign_reward($1, $2, $3, $4) AS result`, [
      shopId,
      accountId,
      rewardId,
      expiresAt ?? null,
    ]),
  );
}

type RewardRow = {
  id: string;
  name: string;
  description: string;
  reward_kind: string;
  points_required: number;
  balance_points: number;
  points_needed: number;
  personal: boolean;
  granted_until: string | null;
  expires_on: string | null;
  active: boolean;
  max_redemptions_per_account: number | null;
  times_redeemed: number;
  redemptions_remaining: number | null;
  state: string;
  shop: { id: string; name: string };
};

const rewards = async (
  userId: string,
  limit?: number,
): Promise<{ ok: boolean; error?: string; rewards: RewardRow[]; truncated: boolean }> => {
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_rewards($1) AS result`, [limit ?? 100]),
  );
  return rpcJson(r.rows[0]) as never;
};

/** Give the account a balance by completing a real sale. 1,000 UGX = 1 point. */
async function earn(shopId: string, customerId: string, totalUgx: number) {
  await insertCompletedSale(exec, { ...f, shopAId: shopId } as LoyaltyFixture, { totalUgx, customerId });
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
// 1, 2, 14, 19 — what the member sees
// ===========================================================================

describe("a member sees the rewards they may actually have", () => {
  it("1. sees an eligible merchant-wide reward, with the merchant's balance", async () => {
    const { userId, memberId } = await makeMember("+256700900001");
    const customerId = await newCustomer();
    await earn(f.shopAId, customerId, 500_000); // 500 points
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    await makeReward({ name: "Free Coke", points: 100 });

    const r = await rewards(userId);
    expect(r.ok).toBe(true);
    const reward = r.rewards.find((x) => x.name === "Free Coke")!;
    expect(reward.state).toBe("available");
    // The balance is the authoritative account balance, not a reward-derived number.
    expect(Number(reward.balance_points)).toBe(500);
    expect(Number(reward.points_required)).toBe(100);
    expect(Number(reward.points_needed)).toBe(0);
    expect(reward.personal).toBe(false);
    expect(reward.shop.id).toBe(f.shopAId);
  });

  it("2 & 19. sees rewards from every linked merchant, each labelled", async () => {
    const { userId, memberId } = await makeMember("+256700900002");
    const customerA = await newCustomer(f.shopAId);
    const customerB = await newCustomer(f.shopBId);
    await earn(f.shopAId, customerA, 100_000);
    await earn(f.shopBId, customerB, 200_000);
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerA));
    await link(memberId, f.shopBId, await accountFor(f.shopBId, customerB));
    await makeReward({ name: "A Reward", shopId: f.shopAId });
    await makeReward({ name: "B Reward", shopId: f.shopBId });

    const r = await rewards(userId);
    const a = r.rewards.find((x) => x.name === "A Reward")!;
    const b = r.rewards.find((x) => x.name === "B Reward")!;
    expect(a.shop.id).toBe(f.shopAId);
    expect(b.shop.id).toBe(f.shopBId);
    expect(a.shop.name).not.toBe(b.shop.name);
    // Each row carries ITS OWN merchant's balance — never a pooled figure.
    expect(Number(a.balance_points)).toBe(100);
    expect(Number(b.balance_points)).toBe(200);
  });

  it("14. a shop-wide reward is visible to every member of that shop", async () => {
    const one = await makeMember("+256700900003");
    const two = await makeMember("+256700900004");
    const shopWide = await makeReward({ name: "Everyone Reward", points: 10 });
    for (const m of [one, two]) {
      const customerId = await newCustomer();
      await link(m.memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    }
    expect((await rewards(one.userId)).rewards.some((x) => x.id === shopWide)).toBe(true);
    expect((await rewards(two.userId)).rewards.some((x) => x.id === shopWide)).toBe(true);
  });
});

// ===========================================================================
// 3, 4, 13, 18 — isolation
// ===========================================================================

describe("SECURITY: a personal reward reaches exactly one member", () => {
  it("3 & 13. two members of one shop cannot see each other's assignment", async () => {
    const alice = await makeMember("+256700900005", "Alice");
    const bob = await makeMember("+256700900006", "Bob");
    const aliceCustomer = await newCustomer();
    const bobCustomer = await newCustomer();
    const aliceAccount = await accountFor(f.shopAId, aliceCustomer);
    await accountFor(f.shopAId, bobCustomer);
    await link(alice.memberId, f.shopAId, aliceAccount);
    const bobAccount = await accountFor(f.shopAId, bobCustomer);
    await link(bob.memberId, f.shopAId, bobAccount);

    const personal = await makeReward({ name: "Alice Only", points: 10, personal: true });
    await assign(f.shopAId, aliceAccount, personal);

    const aliceView = await rewards(alice.userId);
    const bobView = await rewards(bob.userId);
    expect(aliceView.rewards.some((x) => x.id === personal)).toBe(true);
    expect(aliceView.rewards.find((x) => x.id === personal)!.personal).toBe(true);
    // Bob must not see it at all — not even as unavailable.
    expect(bobView.rewards.some((x) => x.id === personal)).toBe(false);
    expect(JSON.stringify(bobView)).not.toContain("Alice Only");
  });

  it("3b. a grant-only reward is invisible to an unassigned member even when affordable", async () => {
    const { userId, memberId } = await makeMember("+256700900007");
    const customerId = await newCustomer();
    await earn(f.shopAId, customerId, 1_000_000); // 1000 points — plenty
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    const personal = await makeReward({ name: "Rich Only", points: 10, personal: true });

    const r = await rewards(userId);
    expect(r.rewards.some((x) => x.id === personal)).toBe(false);
  });

  it("4. a member cannot see rewards from a shop they are not linked to", async () => {
    const { userId, memberId } = await makeMember("+256700900008");
    const customerA = await newCustomer(f.shopAId);
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerA));
    // A reward at another shop, and an account there belonging to somebody else.
    await makeReward({ name: "Other Shop Reward", shopId: f.shopBId, points: 10 });

    const r = await rewards(userId);
    expect(r.rewards.some((x) => x.name === "Other Shop Reward")).toBe(false);
    expect(JSON.stringify(r)).not.toContain("Other Shop Reward");
  });

  it("4b. a second account at a linked shop is not the member's, and is not reported", async () => {
    const { userId, memberId } = await makeMember("+256700900009");
    const mine = await newCustomer();
    const notMine = await newCustomer();
    await earn(f.shopAId, notMine, 900_000); // 900 points on someone else's card
    await link(memberId, f.shopAId, await accountFor(f.shopAId, mine));
    await makeReward({ name: "Shop Reward", points: 10 });

    const r = await rewards(userId);
    // The member's own account is the fresh one: zero points, so insufficient.
    const reward = r.rewards.find((x) => x.name === "Shop Reward")!;
    expect(Number(reward.balance_points)).toBe(0);
    expect(reward.state).toBe("insufficient_points");
    expect(JSON.stringify(r)).not.toContain("900");
  });

  it("18. no cross-merchant leakage of a personal reward", async () => {
    const { userId, memberId } = await makeMember("+256700900010");
    const customerA = await newCustomer(f.shopAId);
    const customerB = await newCustomer(f.shopBId);
    const accountA = await accountFor(f.shopAId, customerA);
    await link(memberId, f.shopAId, accountA);
    await link(memberId, f.shopBId, await accountFor(f.shopBId, customerB));

    const personalAtA = await makeReward({ name: "A Personal", points: 10, personal: true });
    await assign(f.shopAId, accountA, personalAtA);
    // Another member's personal reward at the SAME shop.
    const someoneElse = await makeMember("+256700900011");
    const otherCustomer = await newCustomer();
    const otherAccount = await accountFor(f.shopAId, otherCustomer);
    await link(someoneElse.memberId, f.shopAId, otherAccount);
    const personalOther = await makeReward({ name: "Not Yours", points: 10, personal: true });
    await assign(f.shopAId, otherAccount, personalOther);

    const r = await rewards(userId);
    expect(r.rewards.some((x) => x.id === personalAtA)).toBe(true);
    expect(r.rewards.some((x) => x.id === personalOther)).toBe(false);
  });
});

// ===========================================================================
// 5, 6, 7, 8 — authorization
// ===========================================================================

describe("SECURITY: access is the session, not a parameter", () => {
  it("5. a revoked merchant link removes that merchant's rewards immediately", async () => {
    const { userId, memberId } = await makeMember("+256700900012");
    const customerId = await newCustomer();
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);
    await makeReward({ name: "Revocable Reward", points: 10 });

    expect((await rewards(userId)).rewards.some((x) => x.name === "Revocable Reward")).toBe(true);

    await exec.query(
      `UPDATE public.loyalty_member_links SET status = 'revoked', revoked_at = now()
       WHERE member_id = $1 AND account_id = $2`,
      [memberId, accountId],
    );

    const after = await rewards(userId);
    expect(after.ok).toBe(true);
    expect(after.rewards.some((x) => x.name === "Revocable Reward")).toBe(false);
  });

  it("6. a closed member reads nothing", async () => {
    const { userId, memberId } = await makeMember("+256700900013");
    const customerId = await newCustomer();
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    await makeReward({ name: "Closed Member Reward", points: 10 });
    expect((await rewards(userId)).ok).toBe(true);

    await exec.query(`UPDATE public.loyalty_members SET status = 'closed' WHERE id = $1`, [memberId]);
    const r = await rewards(userId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_a_member");
  });

  it("7. anonymous access is refused by grant", async () => {
    await expect(
      asAnon(exec, async () => exec.query(`SELECT public.loyalty_member_rewards() AS result`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("8. an authenticated non-member — including shop staff — is refused", async () => {
    const asStaff = await rewards(f.ownerAId);
    expect(asStaff.ok).toBe(false);
    expect(asStaff.error).toBe("not_a_member");
  });

  it("17. the RPC exposes no member, account, shop or customer parameter", async () => {
    const r = await exec.query<{ args: string }>(
      `SELECT pg_get_function_identity_arguments(oid) AS args
       FROM pg_proc WHERE proname = 'loyalty_member_rewards'`,
    );
    expect(r.rows[0]!.args).toBe("p_limit integer");
    expect(r.rows[0]!.args).not.toMatch(/member|account|shop|customer|user/i);
  });
});

// ===========================================================================
// 9, 10, 11, 12, 15 — state
// ===========================================================================

describe("state is computed by the server and reported honestly", () => {
  const stateOf = async (userId: string, name: string) =>
    (await rewards(userId)).rewards.find((x) => x.name === name)?.state;

  it("12. insufficient points are reported with the shortfall", async () => {
    const { userId, memberId } = await makeMember("+256700900014");
    const customerId = await newCustomer();
    await earn(f.shopAId, customerId, 30_000); // 30 points
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    await makeReward({ name: "Pricey", points: 500 });

    const row = (await rewards(userId)).rewards.find((x) => x.name === "Pricey")!;
    expect(row.state).toBe("insufficient_points");
    expect(Number(row.balance_points)).toBe(30);
    expect(Number(row.points_needed)).toBe(470);
  });

  it("9. an expired reward is reported as expired, never as available", async () => {
    const { userId, memberId } = await makeMember("+256700900015");
    const customerId = await newCustomer();
    await earn(f.shopAId, customerId, 500_000);
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    await makeReward({ name: "Yesterday", points: 10, expiresOn: "2020-01-01" });

    expect(await stateOf(userId, "Yesterday")).toBe("expired");
  });

  it("10. an inactive reward is not advertised as available", async () => {
    const { userId, memberId } = await makeMember("+256700900016");
    const customerId = await newCustomer();
    await earn(f.shopAId, customerId, 500_000);
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    await makeReward({ name: "Switched Off", points: 10, active: false });

    const r = await rewards(userId);
    // Not advertised at all to a member who never had it…
    expect(r.rewards.some((x) => x.name === "Switched Off")).toBe(false);
  });

  it("10b. a retired reward stays visible ONLY to a member who redeemed it, as inactive", async () => {
    const { userId, memberId } = await makeMember("+256700900017");
    const customerId = await newCustomer();
    await earn(f.shopAId, customerId, 500_000);
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);
    const rewardId = await makeReward({ name: "Retired", points: 10 });

    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
        f.shopAId,
        accountId,
        rewardId,
        "phase-b-retired-1",
      ]),
    );
    await exec.query(`UPDATE public.loyalty_rewards SET active = false WHERE id = $1`, [rewardId]);

    const row = (await rewards(userId)).rewards.find((x) => x.name === "Retired")!;
    expect(row.state).toBe("inactive");
    expect(Number(row.times_redeemed)).toBe(1);
  });

  it("15. a per-account redemption limit is respected", async () => {
    const { userId, memberId } = await makeMember("+256700900018");
    const customerId = await newCustomer();
    await earn(f.shopAId, customerId, 500_000);
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);
    const rewardId = await makeReward({ name: "Once Only", points: 10, maxPerAccount: 1 });

    let row = (await rewards(userId)).rewards.find((x) => x.name === "Once Only")!;
    expect(row.state).toBe("available");
    expect(Number(row.redemptions_remaining)).toBe(1);

    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
        f.shopAId,
        accountId,
        rewardId,
        "phase-b-limit-1",
      ]),
    );

    row = (await rewards(userId)).rewards.find((x) => x.name === "Once Only")!;
    // The same predicate the redeem RPC enforces: it would now refuse.
    expect(row.state).toBe("limit_reached");
    expect(Number(row.times_redeemed)).toBe(1);
    expect(Number(row.redemptions_remaining)).toBe(0);
  });

  it("11. an expired personal assignment removes the reward from that member", async () => {
    const { userId, memberId } = await makeMember("+256700900019");
    const customerId = await newCustomer();
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);
    const rewardId = await makeReward({ name: "Lapsed Personal", points: 10, personal: true });
    await assign(f.shopAId, accountId, rewardId, "2020-01-01T00:00:00Z");

    expect((await rewards(userId)).rewards.some((x) => x.id === rewardId)).toBe(false);
  });

  it("an active personal assignment reports when the grant lapses", async () => {
    const { userId, memberId } = await makeMember("+256700900020");
    const customerId = await newCustomer();
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);
    const rewardId = await makeReward({ name: "Dated Personal", points: 10, personal: true });
    await assign(f.shopAId, accountId, rewardId, "2099-01-01T00:00:00Z");

    const row = (await rewards(userId)).rewards.find((x) => x.id === rewardId)!;
    expect(row.personal).toBe(true);
    expect(row.granted_until).not.toBeNull();
  });
});

// ===========================================================================
// 16, 20 — payload safety
// ===========================================================================

describe("SECURITY: payload and bounds", () => {
  it("16. returns no token of any kind", async () => {
    const { userId, memberId } = await makeMember("+256700900021");
    const customerId = await newCustomer();
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);
    await makeReward({ name: "Tokenless", points: 10 });

    const payload = JSON.stringify(await rewards(userId));
    expect(payload).not.toContain("public_card_token");
    expect(payload).not.toContain("qr_token");

    // Not vacuous: the account does hold a qr_token, and it is absent from the payload.
    const who = await exec.query<{ qr_token: string | null }>(
      `SELECT qr_token FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(who.rows[0]!.qr_token).toBeTruthy();
    expect(payload).not.toContain(who.rows[0]!.qr_token!);
  });

  it("16b. does not leak a reward id that belongs to another member's assignment", async () => {
    const other = await makeMember("+256700900022");
    const customerId = await newCustomer();
    const accountId = await accountFor(f.shopAId, customerId);
    await link(other.memberId, f.shopAId, accountId);
    const theirs = await makeReward({ name: "Their Secret", points: 5, personal: true });
    await assign(f.shopAId, accountId, theirs);

    const me = await makeMember("+256700900023");
    const myCustomer = await newCustomer();
    await link(me.memberId, f.shopAId, await accountFor(f.shopAId, myCustomer));

    const payload = JSON.stringify(await rewards(me.userId));
    expect(payload).not.toContain(theirs);
    expect(payload).not.toContain("Their Secret");
  });

  it("20. the list is bounded and says so", async () => {
    const { userId, memberId } = await makeMember("+256700900024");
    const customerId = await newCustomer();
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    for (let i = 0; i < 5; i++) {
      await makeReward({ name: `Bulk ${i}`, points: 10, sortOrder: i });
    }

    const capped = await rewards(userId, 3);
    expect(capped.rewards.length).toBe(3);
    expect(capped.truncated).toBe(true);

    // A limit above the cap is clamped, not honoured blindly.
    const huge = await rewards(userId, 100_000);
    expect(huge.rewards.length).toBeLessThanOrEqual(200);
  });

  it("20b. an exhausted list is not reported as truncated", async () => {
    const { userId, memberId } = await makeMember("+256700900025");
    const customerId = await newCustomer();
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    await makeReward({ name: "Single", points: 10 });

    const r = await rewards(userId, 50);
    expect(r.truncated).toBe(false);
  });

  it("shows nothing — and no error — when the shop offers the member nothing", async () => {
    // Runs last in this file: it retires shop A's catalogue. A member with no personal
    // grant and no redemption history then sees an empty list, which is what the
    // dashboard's empty state is for.
    const { userId, memberId } = await makeMember("+256700900027");
    const customerId = await newCustomer();
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));

    await exec.query(`UPDATE public.loyalty_rewards SET active = false WHERE shop_id = $1`, [f.shopAId]);

    const r = await rewards(userId);
    expect(r.ok).toBe(true);
    expect(r.rewards).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it("a redeemed reward cannot be deleted — merchant history is protected", async () => {
    // Worth pinning because it is WHY the phase retires rewards rather than removing
    // them: `loyalty_redemptions.reward_id` is ON DELETE RESTRICT, so a reward that has
    // ever been redeemed is permanent. This is the same reason `active = false` — not
    // deletion — is the merchant's way to withdraw one.
    const redeemed = await exec.query<{ id: string }>(
      `SELECT reward_id AS id FROM public.loyalty_redemptions LIMIT 1`,
    );
    expect(redeemed.rows[0]?.id).toBeTruthy();
    await expect(
      exec.query(`DELETE FROM public.loyalty_rewards WHERE id = $1`, [redeemed.rows[0]!.id]),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});

// ===========================================================================
// The claim question, answered honestly
// ===========================================================================

describe("there is no member claim flow, and this RPC does not pretend otherwise", () => {
  it("offers no write path — the RPC is read-only", async () => {
    const r = await exec.query<{ volatility: string }>(
      `SELECT provolatile AS volatility FROM pg_proc WHERE proname = 'loyalty_member_rewards'`,
    );
    // 's' = stable: it cannot modify the database.
    expect(r.rows[0]!.volatility).toBe("s");
  });

  it("redemption stays merchant-driven: the redeem RPC refuses a member outright", async () => {
    // The RPC is granted to `authenticated` because shop STAFF call it, so the refusal is
    // not a grant check — it is `user_can_redeem_loyalty` inside the function, which admits
    // only owner/manager/cashier and org owner/admin. A member is turned away with
    // 'forbidden' and nothing is written.
    const { userId } = await makeMember("+256700900028");
    const r = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
            f.shopAId,
            crypto.randomUUID(),
            crypto.randomUUID(),
            "member-should-not-redeem",
          ]),
        )
      ).rows[0],
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });
});
