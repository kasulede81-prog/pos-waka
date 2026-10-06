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
 * LOYALTY PHASE A — the member's own activity.
 *
 * THE ISOLATION TESTS ARE THE POINT. This is the first time the points ledger is
 * readable by a customer rather than by shop staff, and the ledger's only policy is
 * `user_can_access_shop` — staff. Rather than widen that policy (which would hand
 * every customer the shop's entire ledger), the read is a SECURITY DEFINER
 * projection whose identity comes from `auth.uid()` and which takes NO parameter
 * naming a person. These tests prove that, and prove it cannot be turned into a
 * cross-member read.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;
let codeA = "";

async function makeMember(phone: string, name = "Member"): Promise<{ userId: string; memberId: string }> {
  const userId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    userId,
    `${userId.slice(0, 8)}@activity.test`,
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
    "Activity Customer",
  ]);
  return id;
}

async function accountFor(shopId: string, customerId: string): Promise<string> {
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, customerId],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("no loyalty account for customer");
  return id;
}

/** A merchant-confirmed link. Link creation itself is covered by the multi-shop suite. */
async function link(memberId: string, shopId: string, accountId: string): Promise<void> {
  await exec.query(
    `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
     VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
    [memberId, accountId, shopId],
  );
}

type ActivityItem = {
  id: string;
  kind: string;
  cause: string;
  points: number;
  balance_after: number | null;
  created_at: string;
  shop: { id: string; name: string };
  sale_total_ugx: number | null;
  reward_name: string | null;
  reward_points_required: number | null;
};

const activity = async (
  userId: string,
  limit?: number,
  before?: string,
  beforeId?: string,
): Promise<{ ok: boolean; error?: string; items: ActivityItem[]; has_more: boolean; next_before: string | null; next_before_id: string | null }> => {
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_activity($1, $2, $3) AS result`, [
      limit ?? 20,
      before ?? null,
      beforeId ?? null,
    ]),
  );
  return rpcJson(r.rows[0]) as never;
};

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
  await enableProgram(exec, f.shopBId);
  codeA = String(
    (await exec.query(`SELECT public_code FROM public.loyalty_programs WHERE shop_id = $1`, [f.shopAId]))
      .rows[0]?.public_code ?? "",
  );
}, T);

afterAll(async () => {
  await exec?.close();
});

// ===========================================================================
// The read
// ===========================================================================

describe("a member reads their own activity", () => {
  it("returns the points movement with the merchant it belongs to", async () => {
    const { userId, memberId } = await makeMember("+256700800001");
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 100_000, customerId });
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));

    const a = await activity(userId);
    expect(a.ok).toBe(true);
    expect(a.items).toHaveLength(1);

    const item = a.items[0]!;
    expect(item.kind).toBe("earned");
    expect(item.cause).toBe("sale");
    expect(Number(item.points)).toBe(100);
    // The purchase value comes from the authoritative sale, joined inside the RPC.
    expect(Number(item.sale_total_ugx)).toBe(100_000);
    // Merchant identity is never collapsed.
    expect(item.shop.name).toBeTruthy();
    expect(item.shop.id).toBe(f.shopAId);
    expect(saleId).toBeTruthy();
    // No staff commentary.
    expect(item).not.toHaveProperty("note");
  });

  it("carries the running balance so the member can follow the arithmetic", async () => {
    const { userId, memberId } = await makeMember("+256700800002");
    const customerId = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 20_000, customerId });
    await insertCompletedSale(exec, f, { totalUgx: 30_000, customerId });
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));

    const a = await activity(userId);
    expect(a.items).toHaveLength(2);
    // Newest first, and the balances are the real cached ones.
    expect(Number(a.items[0]!.points)).toBe(30);
    expect(Number(a.items[0]!.balance_after)).toBe(50);
    expect(Number(a.items[1]!.points)).toBe(20);
    expect(Number(a.items[1]!.balance_after)).toBe(20);
  });

  it("names the reward a redemption was spent on", async () => {
    const { userId, memberId } = await makeMember("+256700800003");
    const customerId = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 50_000, customerId });
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);

    const rewardId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, description, points_required, reward_kind, active)
       VALUES ($1, $2, 'Free Coke', 'One 500ml Coke', 10, 'custom', true)`,
      [rewardId, f.shopAId],
    );
    await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_redeem_reward($1, $2, $3, $4) AS result`, [
        f.shopAId,
        accountId,
        rewardId,
        "activity-test-key-1",
      ]),
    );

    const a = await activity(userId);
    const redeemed = a.items.find((i) => i.kind === "redeemed");
    expect(redeemed, "the redemption must appear in the member's own history").toBeDefined();
    expect(Number(redeemed!.points)).toBe(-10);
    expect(redeemed!.reward_name).toBe("Free Coke");
    expect(Number(redeemed!.reward_points_required)).toBe(10);
  });

  it("shows returns, expiries and adjustments alongside earnings", async () => {
    const { userId, memberId } = await makeMember("+256700800004");
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 40_000, customerId });
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);

    // A partial return reverses through the trigger.
    await exec.query(
      `INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx)
       VALUES ($1, $2, $3, $4, 1, 10_000)`,
      [crypto.randomUUID(), f.shopAId, saleId, f.productAId],
    );
    // An expiry and a manual adjustment, written the way the engine writes them.
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause, actor_source)
       VALUES ($1, $2, 'expired', -5, 'expiration', 'system'),
              ($1, $2, 'adjusted', 3, 'manual_adjustment', 'staff')`,
      [f.shopAId, accountId],
    );

    const a = await activity(userId);
    const kinds = a.items.map((i) => i.kind).sort();
    expect(kinds).toEqual(["adjusted", "earned", "expired", "reversed"]);

    const reversed = a.items.find((i) => i.kind === "reversed")!;
    expect(Number(reversed.points)).toBe(-10); // 25% of a 40-point award
    const expired = a.items.find((i) => i.kind === "expired")!;
    expect(expired.cause).toBe("expiration");
  });
});

// ===========================================================================
// Multi-merchant
// ===========================================================================

describe("a multi-merchant member sees every merchant, kept apart", () => {
  it("labels each row with its own merchant", async () => {
    const { userId, memberId } = await makeMember("+256700800005");
    const customerA = await newCustomer(f.shopAId);
    const customerB = await newCustomer(f.shopBId);
    await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId: customerA });
    await insertCompletedSale(exec, { ...f, shopAId: f.shopBId }, { totalUgx: 20_000, customerId: customerB });
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerA));
    await link(memberId, f.shopBId, await accountFor(f.shopBId, customerB));

    const a = await activity(userId);
    expect(a.items).toHaveLength(2);

    const byShop = new Map(a.items.map((i) => [i.shop.id, i]));
    expect(Number(byShop.get(f.shopAId)!.points)).toBe(10);
    expect(Number(byShop.get(f.shopBId)!.points)).toBe(20);
    // The two merchants' names differ — the member can tell them apart.
    expect(byShop.get(f.shopAId)!.shop.name).not.toBe(byShop.get(f.shopBId)!.shop.name);
  });

  it("does not show activity from an account the member is NOT linked to", async () => {
    const { userId, memberId } = await makeMember("+256700800006");
    const mine = await newCustomer();
    const theirs = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 10_000, customerId: mine });
    // Same shop, same member — but this account belongs to somebody else.
    await insertCompletedSale(exec, f, { totalUgx: 99_000, customerId: theirs });
    await link(memberId, f.shopAId, await accountFor(f.shopAId, mine));

    const a = await activity(userId);
    expect(a.items).toHaveLength(1);
    expect(Number(a.items[0]!.sale_total_ugx)).toBe(10_000);
    // The other customer's 99,000 sale is nowhere in the payload.
    expect(JSON.stringify(a)).not.toContain("99000");
  });

  it("a revoked link stops reporting, without touching the ledger", async () => {
    const { userId, memberId } = await makeMember("+256700800007");
    const customerId = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 15_000, customerId });
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);

    expect((await activity(userId)).items).toHaveLength(1);

    await exec.query(
      `UPDATE public.loyalty_member_links SET status = 'revoked', revoked_at = now()
       WHERE member_id = $1 AND account_id = $2`,
      [memberId, accountId],
    );

    expect((await activity(userId)).items).toHaveLength(0);
    // The points still exist — only the member's visibility of them changed.
    const still = await exec.query<{ balance_points: number }>(
      `SELECT balance_points FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(Number(still.rows[0]!.balance_points)).toBe(15);
  });
});

// ===========================================================================
// Isolation and authorization
// ===========================================================================

describe("SECURITY: no member can reach another member's history", () => {
  it("two members linked to the same shop see only their own rows", async () => {
    const alice = await makeMember("+256700800008", "Alice");
    const bob = await makeMember("+256700800009", "Bob");
    const aliceCustomer = await newCustomer();
    const bobCustomer = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 11_000, customerId: aliceCustomer });
    await insertCompletedSale(exec, f, { totalUgx: 77_000, customerId: bobCustomer });
    await link(alice.memberId, f.shopAId, await accountFor(f.shopAId, aliceCustomer));
    await link(bob.memberId, f.shopAId, await accountFor(f.shopAId, bobCustomer));

    const a = await activity(alice.userId);
    const b = await activity(bob.userId);

    expect(a.items).toHaveLength(1);
    expect(b.items).toHaveLength(1);
    expect(Number(a.items[0]!.sale_total_ugx)).toBe(11_000);
    expect(Number(b.items[0]!.sale_total_ugx)).toBe(77_000);
    // Bob's points are not in Alice's payload at all.
    expect(JSON.stringify(a)).not.toContain("77000");
    expect(JSON.stringify(b)).not.toContain("11000");
  });

  it("the RPC accepts no parameter that names a member, account or shop", async () => {
    const r = await exec.query<{ args: string }>(
      `SELECT pg_get_function_identity_arguments(oid) AS args
       FROM pg_proc WHERE proname = 'loyalty_member_activity'`,
    );
    const args = r.rows[0]!.args;
    // Phase C: a page size, a cursor and optional filters (window, own-shop, kind).
    expect(args).toBe(
      "p_limit integer, p_before timestamp with time zone, p_before_id uuid, " +
        "p_from timestamp with time zone, p_to timestamp with time zone, p_shop_id uuid, p_kind text",
    );
    // Nothing that could name the READER or another person. p_shop_id is a filter
    // over rows already gated by the caller's own active-links join — naming an
    // unlinked shop returns zero rows (proved by the isolation tests), and the
    // dedicated Phase C filter suite exercises exactly that.
    expect(args).not.toMatch(/member|account|customer/i);
    // The superseded 3-argument overload must be gone (same name, old shape).
    const all = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'loyalty_member_activity'`,
    );
    expect(Number(all.rows[0]!.n)).toBe(1);
  });

  it("is not executable by anon at all — no grant, not merely no session", async () => {
    await expect(
      asAnon(exec, async () => exec.query(`SELECT public.loyalty_member_activity() AS result`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses an authenticated non-member, including shop staff", async () => {
    const r = await activity(f.ownerAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_a_member");
  });

  it("a closed member reads nothing", async () => {
    const { userId, memberId } = await makeMember("+256700800010");
    const customerId = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 5_000, customerId });
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));
    expect((await activity(userId)).items).toHaveLength(1);

    await exec.query(`UPDATE public.loyalty_members SET status = 'closed' WHERE id = $1`, [memberId]);
    const r = await activity(userId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_a_member");
  });
});

// ===========================================================================
// Pagination
// ===========================================================================

describe("pagination is bounded, keyset-based, and lossless", () => {
  it("pages through the whole history exactly once", async () => {
    const { userId, memberId } = await makeMember("+256700800011");
    const customerId = await newCustomer();
    const accountId0 = await insertCompletedSale(exec, f, { totalUgx: 1_000, customerId });
    expect(accountId0).toBeTruthy();
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);

    // Four more credits, so there are five rows to page through.
    for (let i = 0; i < 4; i++) {
      await exec.query(
        `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause, actor_source)
         VALUES ($1, $2, 'adjusted', 1, 'manual_adjustment', 'staff')`,
        [f.shopAId, accountId],
      );
    }

    const seen: string[] = [];
    let page = await activity(userId, 2);
    expect(page.items).toHaveLength(2);
    expect(page.has_more).toBe(true);
    seen.push(...page.items.map((i) => i.id));

    while (page.has_more) {
      page = await activity(userId, 2, page.next_before!, page.next_before_id!);
      seen.push(...page.items.map((i) => i.id));
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5); // no duplicates, no skips
  });

  it("caps the page size so a member cannot request the whole ledger", async () => {
    const { userId, memberId } = await makeMember("+256700800012");
    const customerId = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 1_000, customerId });
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);

    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause, actor_source)
       SELECT $1, $2, 'adjusted', 1, 'manual_adjustment', 'staff'
       FROM generate_series(1, 104)`,
      [f.shopAId, accountId],
    );

    const page = await activity(userId, 1000);
    expect(page.items).toHaveLength(100); // capped at the documented maximum
    expect(page.has_more).toBe(true);
  });

  it("treats a nonsense page size as one page, not an error", async () => {
    const { userId, memberId } = await makeMember("+256700800013");
    const customerId = await newCustomer();
    await insertCompletedSale(exec, f, { totalUgx: 1_000, customerId });
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));

    const page = await activity(userId, 0);
    expect(page.ok).toBe(true);
    expect(page.items).toHaveLength(1);
  });

  it("returns an empty history without failing", async () => {
    const { userId, memberId } = await makeMember("+256700800014");
    const customerId = await newCustomer();
    // Account exists but has no ledger rows yet.
    await exec.query(`INSERT INTO public.loyalty_accounts (shop_id, customer_id) VALUES ($1, $2)`, [
      f.shopAId,
      customerId,
    ]);
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));

    const page = await activity(userId);
    expect(page.ok).toBe(true);
    expect(page.items).toEqual([]);
    expect(page.has_more).toBe(false);
    expect(page.next_before).toBeNull();
  });
});

// ===========================================================================
// What must never appear
// ===========================================================================

describe("SECURITY: nothing internal leaks into a member payload", () => {
  it("exposes no token and no staff note", async () => {
    const { userId, memberId } = await makeMember("+256700800015");
    const customerId = await newCustomer();
    const saleId = await insertCompletedSale(exec, f, { totalUgx: 5_000, customerId });
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);

    // A note written on the member's ledger row, and tokens on their account.
    await exec.query(
      `UPDATE public.loyalty_transactions SET note = 'internal remark: possible fraud check'
       WHERE source_sale_id = $1 AND kind = 'earned'`,
      [saleId],
    );

    const payload = JSON.stringify(await activity(userId));
    expect(payload).not.toContain("internal remark");
    expect(payload).not.toContain("possible fraud");
    expect(payload).not.toContain("public_card_token");
    expect(payload).not.toContain("qr_token");

    // The account does carry a token — proving the assertion above is not vacuous.
    const who = await exec.query<{ qr_token: string | null }>(
      `SELECT qr_token FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(who.rows[0]!.qr_token).toBeTruthy();
    expect(payload).not.toContain(who.rows[0]!.qr_token!);
  });

  it("needs no public-card or WPL code to work", async () => {
    // The member's identity is the session. Nothing here consumes a bearer token,
    // and `codeA` exists only to prove the fixture is a real WPL-enabled shop.
    expect(codeA).toMatch(/^WPL/);
  });
});
