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
 * LOYALTY PHASE G — what a member can see about PROMOTIONS.
 *
 * D026 already runs promotions: earn multipliers, flat bonuses, reward grants, start/end
 * windows, priority, per-account targeting and an auditable snapshot on every ledger row it
 * touches. This projection only EXPOSES them to the member they belong to.
 *
 * So the tests that matter are the boundaries: it shows exactly the promotions the earn
 * engine would pay out on (the SAME window helper decides), it shows them only to the member
 * they are for, and it leaks no merchant config, target list or token.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function newCustomer(): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    f.shopAId,
    "Promo Customer",
  ]);
  return id;
}

async function accountFor(): Promise<string> {
  const customerId = await newCustomer();
  await insertCompletedSale(exec, f, { totalUgx: 1_000, customerId });
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [f.shopAId, customerId],
  );
  return r.rows[0]!.id;
}

/** A member linked to an account, so the member projection can see it. */
async function makeLinkedMember(phone: string, accountId: string): Promise<string> {
  const userId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, `${phone.slice(-4)}@g.test`]);
  const member = rpcJson(
    (
      await asUser(exec, userId, async () =>
        exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, ["Promo Member", phone]),
      )
    ).rows[0],
  );
  await exec.query(
    `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
     VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
    [member.member_id, accountId, f.shopAId],
  );
  return userId;
}

async function makeOffer(opts: {
  accountId: string;
  title: string;
  kind?: string;
  config?: Record<string, unknown>;
  status?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  /** The offer must belong to the SAME shop as its account (composite FK). */
  shopId?: string;
}): Promise<void> {
  await exec.query(
    `INSERT INTO public.loyalty_customer_offers
       (shop_id, account_id, offer_kind, title, config, status, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [
      // The composite FK (account_id, shop_id) means an offer cannot point at an account in
      // another shop at all — the database refuses it, which is the cross-shop guarantee.
      opts.shopId ?? f.shopAId,
      opts.accountId,
      opts.kind ?? "earn_bonus_flat",
      opts.title,
      JSON.stringify(opts.config ?? { points: 100 }),
      opts.status ?? "active",
      opts.startsAt ?? null,
      opts.endsAt ?? null,
    ],
  );
}

type PromoItem = {
  title: string;
  kind: string;
  bonus_points: number | null;
  multiplier: number | null;
  granted_reward_count: number | null;
  ends_at: string | null;
  rewarded: boolean;
  shop: { name: string };
};

const promotions = async (userId: string) =>
  rpcJson(
    (
      await asUser(exec, userId, async () =>
        exec.query(`SELECT public.loyalty_member_promotions() AS result`),
      )
    ).rows[0],
  ) as never as { ok: boolean; error?: string; promotions: PromoItem[] };

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
  await enableProgram(exec, f.shopBId);
}, T);

afterAll(async () => {
  await exec?.close();
});

describe("a member sees the promotions running for them", () => {
  it("shows a flat bonus with the points it is worth", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960001", accountId);
    await makeOffer({ accountId, title: "Weekend bonus", config: { points: 250 } });

    const p = await promotions(userId);
    expect(p.ok).toBe(true);
    const offer = p.promotions.find((x) => x.title === "Weekend bonus")!;
    expect(offer.kind).toBe("earn_bonus_flat");
    expect(Number(offer.bonus_points)).toBe(250);
    expect(offer.shop.name).toBeTruthy();
  });

  it("shows a multiplier with its multiplier", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960002", accountId);
    await makeOffer({ accountId, title: "Double points", kind: "earn_multiplier", config: { multiplier: 2 } });

    const offer = (await promotions(userId)).promotions.find((x) => x.title === "Double points")!;
    expect(offer.kind).toBe("earn_multiplier");
    expect(Number(offer.multiplier)).toBe(2);
  });

  it("shows a reward grant as a count, not as a reward id", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960003", accountId);
    const rewardId = crypto.randomUUID();
    await exec.query(
      `INSERT INTO public.loyalty_rewards (id, shop_id, name, points_required, reward_kind, active)
       VALUES ($1, $2, 'Granted Reward', 100, 'custom', true)`,
      [rewardId, f.shopAId],
    );
    await makeOffer({
      accountId,
      title: "You unlocked something",
      kind: "reward_grant",
      config: { reward_ids: [rewardId] },
    });

    const offer = (await promotions(userId)).promotions.find((x) => x.title === "You unlocked something")!;
    expect(Number(offer.granted_reward_count)).toBe(1);
    // A reward id is a merchant-side handle; the member gets a count.
    expect(JSON.stringify(offer)).not.toContain(rewardId);
  });

  it("reports the window end so the member knows when it lapses", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960004", accountId);
    await makeOffer({ accountId, title: "Ends soon", endsAt: "2099-01-01T00:00:00Z" });

    const offer = (await promotions(userId)).promotions.find((x) => x.title === "Ends soon")!;
    expect(offer.ends_at).toContain("2099");
  });
});

describe("only what the engine would actually pay out on", () => {
  it("a PAUSED promotion is not advertised", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960005", accountId);
    await makeOffer({ accountId, title: "Paused Offer", status: "paused" });

    expect((await promotions(userId)).promotions.some((x) => x.title === "Paused Offer")).toBe(false);
  });

  it("a REVOKED promotion is not advertised", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960006", accountId);
    await makeOffer({ accountId, title: "Revoked Offer", status: "revoked" });

    expect((await promotions(userId)).promotions.some((x) => x.title === "Revoked Offer")).toBe(false);
  });

  it("a promotion that has not STARTED yet is not advertised", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960007", accountId);
    await makeOffer({ accountId, title: "Future Offer", startsAt: "2099-01-01T00:00:00Z" });

    expect((await promotions(userId)).promotions.some((x) => x.title === "Future Offer")).toBe(false);
  });

  it("a promotion that has ENDED is not advertised", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960008", accountId);
    await makeOffer({
      accountId,
      title: "Lapsed Offer",
      startsAt: "2020-01-01T00:00:00Z",
      endsAt: "2020-02-01T00:00:00Z",
    });

    expect((await promotions(userId)).promotions.some((x) => x.title === "Lapsed Offer")).toBe(false);
  });

  it("an OPEN-ENDED promotion is advertised", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960009", accountId);
    await makeOffer({ accountId, title: "Always On" });

    expect((await promotions(userId)).promotions.some((x) => x.title === "Always On")).toBe(true);
  });
});

describe("SECURITY: a promotion reaches only the member it is for", () => {
  it("another member's promotion is invisible", async () => {
    const mine = await accountFor();
    const theirs = await accountFor();
    const myUserId = await makeLinkedMember("+256700960010", mine);

    await makeOffer({ accountId: theirs, title: "Not Yours", config: { points: 9_999 } });

    const p = await promotions(myUserId);
    expect(p.promotions.some((x) => x.title === "Not Yours")).toBe(false);
    expect(JSON.stringify(p)).not.toContain("9999");
  });

  it("a revoked link removes the promotion from view", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960011", accountId);
    await makeOffer({ accountId, title: "Visible One" });

    expect((await promotions(userId)).promotions.some((x) => x.title === "Visible One")).toBe(true);

    await exec.query(
      `UPDATE public.loyalty_member_links SET status = 'revoked', revoked_at = now() WHERE account_id = $1`,
      [accountId],
    );
    expect((await promotions(userId)).promotions.some((x) => x.title === "Visible One")).toBe(false);
  });

  it("another shop's promotion cannot cross over", async () => {
    const shopBCustomer = crypto.randomUUID();
    await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
      shopBCustomer,
      f.shopBId,
      "B Customer",
    ]);
    await insertCompletedSale(exec, { ...f, shopAId: f.shopBId } as LoyaltyFixture, {
      totalUgx: 1_000,
      customerId: shopBCustomer,
    });
    const accountB = (
      await exec.query<{ id: string }>(
        `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
        [f.shopBId, shopBCustomer],
      )
    ).rows[0]!.id;

    const userId = await makeLinkedMember("+256700960012", await accountFor());
    await makeOffer({ accountId: accountB, title: "Shop B Offer", shopId: f.shopBId });

    expect((await promotions(userId)).promotions.some((x) => x.title === "Shop B Offer")).toBe(false);
  });

  it("anonymous access is refused by grant", async () => {
    await expect(
      asAnon(exec, async () => exec.query(`SELECT public.loyalty_member_promotions() AS result`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("an authenticated non-member is refused", async () => {
    const p = await promotions(f.ownerAId);
    expect(p.ok).toBe(false);
    expect(p.error).toBe("not_a_member");
  });

  it("a closed member sees nothing", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960013", accountId);
    await makeOffer({ accountId, title: "Before Closure" });
    expect((await promotions(userId)).promotions.some((x) => x.title === "Before Closure")).toBe(true);

    const memberId = (
      await exec.query<{ member_id: string }>(
        `SELECT member_id FROM public.loyalty_member_links WHERE account_id = $1 LIMIT 1`,
        [accountId],
      )
    ).rows[0]!.member_id;
    await exec.query(`UPDATE public.loyalty_members SET status = 'closed' WHERE id = $1`, [memberId]);

    const after = await promotions(userId);
    expect(after.ok).toBe(false);
    expect(after.error).toBe("not_a_member");
  });

  it("exposes no merchant config, target list or token", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960014", accountId);
    await makeOffer({ accountId, title: "Quiet Offer", config: { points: 100 } });

    const payload = JSON.stringify(await promotions(userId));
    for (const forbidden of ["config", "priority", "account_id", "qr_token", "public_card_token", "created_by"]) {
      expect(payload, forbidden).not.toContain(forbidden);
    }
  });

  it("is read-only, so a member cannot mutate promotion state through it", async () => {
    const r = await exec.query<{ volatility: string }>(
      `SELECT provolatile AS volatility FROM pg_proc WHERE proname = 'loyalty_member_promotions'`,
    );
    expect(r.rows[0]!.volatility).toBe("s");
  });
});

describe("whether the member has already received it", () => {
  it("reports rewarded false before any award, and true after one", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960015", accountId);
    await makeOffer({ accountId, title: "Bonus Offer", config: { points: 100 } });

    const offerId = (
      await exec.query<{ id: string }>(
        `SELECT id FROM public.loyalty_customer_offers WHERE account_id = $1 LIMIT 1`,
        [accountId],
      )
    ).rows[0]!.id;

    expect((await promotions(userId)).promotions.find((x) => x.title === "Bonus Offer")!.rewarded).toBe(false);

    // Written the way the engine writes one: a promotional ledger row whose snapshot names
    // the offer that produced it.
    await exec.query(
      `INSERT INTO public.loyalty_transactions
         (shop_id, account_id, kind, points, cause, actor_source, rule_snapshot)
       VALUES ($1, $2, 'promotional', 100, 'promotion', 'promotion', jsonb_build_object('offer_id', $3::text))`,
      [f.shopAId, accountId, offerId],
    );

    expect((await promotions(userId)).promotions.find((x) => x.title === "Bonus Offer")!.rewarded).toBe(true);
  });

  it("a promotional award keeps the balance invariant intact", async () => {
    const accountId = await accountFor();
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause, actor_source)
       VALUES ($1, $2, 'promotional', 100, 'promotion', 'promotion')`,
      [f.shopAId, accountId],
    );

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

  it("the member activity feed already distinguishes promotional points", async () => {
    const accountId = await accountFor();
    const userId = await makeLinkedMember("+256700960016", accountId);
    await exec.query(
      `INSERT INTO public.loyalty_transactions (shop_id, account_id, kind, points, cause, actor_source)
       VALUES ($1, $2, 'promotional', 100, 'promotion', 'promotion')`,
      [f.shopAId, accountId],
    );

    const activity = rpcJson(
      (
        await asUser(exec, userId, async () =>
          exec.query(`SELECT public.loyalty_member_activity(20, null, null) AS result`),
        )
      ).rows[0],
    ) as never as { items: { kind: string; cause: string; points: number }[] };

    const promo = activity.items.find((i) => i.kind === "promotional")!;
    expect(promo.cause).toBe("promotion");
    expect(Number(promo.points)).toBe(100);
  });
});
