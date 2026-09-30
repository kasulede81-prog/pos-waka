import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoyaltyCustomer360View } from "../../components/loyalty/LoyaltyCustomer360Panel";
import type { Customer360, Customer360Reward } from "./loyaltyCustomer360";

/**
 * The merchant Customer 360 profile.
 *
 * TWO THINGS THIS FILE EXISTS TO PROTECT.
 *
 * 1. SPENDING IS SHOWN AS THREE NUMBERS. A returned sale keeps `status='completed'`, so
 *    the gross figure includes money the customer got back. Rendering only a net total
 *    hides the refunds; rendering only gross overstates what the shop kept. The tests
 *    assert both are present whenever a refund exists.
 *
 * 2. A MISSING LOYALTY ACCOUNT IS A STATE, NOT A CRASH. A customer with purchases and no
 *    loyalty card is ordinary, and the profile must render their spending regardless.
 */

function reward(over: Partial<Customer360Reward> = {}): Customer360Reward {
  return {
    id: "reward-1",
    name: "Free Coke",
    pointsRequired: 100,
    rewardKind: "product",
    personal: false,
    active: true,
    expiresOn: null,
    timesRedeemed: 0,
    maxRedemptionsPerAccount: null,
    redemptionsRemaining: null,
    state: "available",
    ...over,
  };
}

function profile(over: Partial<Customer360> = {}): Customer360 {
  return {
    customer: {
      id: "cust-1",
      name: "Cathy",
      phoneE164: "+256700111222",
      email: null,
      customerSince: "2026-01-15T10:00:00.000Z",
    },
    loyalty: {
      hasAccount: true,
      accountStatus: "active",
      memberSince: "2026-02-01T10:00:00.000Z",
      membershipExpiresAt: null,
      membershipActive: true,
      balancePoints: 4_850,
      lifetimeEarnedPoints: 18_400,
      lifetimeRedeemedPoints: 7_000,
      memberLinkStatus: "active",
    },
    spending: {
      completedPurchases: 42,
      grossSpendUgx: 1_900_000,
      returnedUgx: 60_000,
      netSpendUgx: 1_840_000,
      averagePurchaseUgx: 43_809,
      voidedPurchases: 2,
      firstPurchaseAt: "2026-02-01T10:00:00.000Z",
      lastPurchaseAt: "2026-09-28T10:00:00.000Z",
    },
    rewards: { items: [reward()], truncated: false, redemptionCount: 3, pointsRedeemed: 7_000 },
    recentPurchases: [
      { totalUgx: 100_000, returnedUgx: 0, completedAt: "2026-09-28T10:00:00.000Z", paymentStatus: "paid" },
    ],
    recentLoyaltyActivity: [
      { kind: "earned", cause: "sale", points: 100, balanceAfter: 4_850, createdAt: "2026-09-28T10:00:00.000Z" },
    ],
    recentRedemptions: [
      {
        id: "redemption-1",
        rewardName: "Free Coke",
        pointsSpent: 500,
        status: "completed",
        redeemedAt: "2026-09-20T10:00:00.000Z",
        benefitKind: "none",
        benefitAmountUgx: null,
        benefitPercent: null,
        appliedAmountUgx: null,
      },
    ],
    ...over,
  };
}

const render = (data: Customer360) =>
  renderToStaticMarkup(createElement(LoyaltyCustomer360View, { lang: "en" as const, data }));

describe("the merchant customer profile", () => {
  it("shows the spending summary the merchant asked for", () => {
    const html = render(profile());
    expect(html).toContain('data-testid="customer-360"');
    expect(html).toContain("UGX 1,840,000"); // net spend
    expect(html).toContain("42"); // purchases
    expect(html).toContain("UGX 43,809"); // derived average
    // Last purchase. The month abbreviation varies with the runtime's ICU data
    // ("Sep" vs "Sept"), so the assertion pins the date rather than one spelling of it.
    expect(html).toMatch(/28 Sep(?:t)? 2026/);
  });

  it("shows gross and refunds whenever money came back", () => {
    const html = render(profile());
    expect(html).toContain("UGX 1,900,000"); // before refunds
    expect(html).toContain("UGX 60,000"); // refunded
    expect(html).toContain("refunded");
  });

  it("labels the average as derived, so it is not read as authoritative", () => {
    expect(render(profile())).toContain("derived average");
  });

  it("reports voided purchases separately from completed ones", () => {
    const html = render(profile());
    expect(html).toContain("2 voided");
    expect(html).toContain("42");
  });

  it("omits the refund line when nothing was refunded", () => {
    const noRefunds = profile({
      spending: { ...profile().spending, returnedUgx: 0, netSpendUgx: 1_900_000 },
    });
    const html = render(noRefunds);
    expect(html).not.toContain("before refunds");
  });

  it("shows the loyalty summary in points, never as money", () => {
    const html = render(profile());
    expect(html).toContain("4,850"); // balance
    expect(html).toContain("18,400"); // lifetime earned
    expect(html).toContain("7,000"); // lifetime redeemed
    // Points are points: no currency symbol is attached to them anywhere.
    expect(html).not.toMatch(/UGX 4,850|UGX 18,400|UGX 7,000/);
  });
});

describe("a customer with no loyalty account", () => {
  it("still renders spending, and says the account is simply absent", () => {
    const html = render(profile({ loyalty: null, rewards: { items: [], truncated: false, redemptionCount: 0, pointsRedeemed: 0 } }));
    expect(html).toContain('data-testid="customer-360"');
    expect(html).toContain("UGX 1,840,000"); // spending is unaffected
    expect(html).toContain('data-testid="customer-360-no-loyalty"');
    expect(html).toContain("No loyalty account at this shop yet.");
  });
});

describe("the rewards and activity sections", () => {
  it("summarises ready, personal and redeemed counts", () => {
    const html = render(profile());
    expect(html).toContain("1 ready now");
    expect(html).toContain("3 redemptions");
    expect(html).toContain("Free Coke");
    expect(html).toContain("Ready to redeem");
  });

  it("marks a personal reward", () => {
    const html = render(
      profile({
        rewards: {
          items: [reward({ personal: true, state: "available" })],
          truncated: false,
          redemptionCount: 0,
          pointsRedeemed: 0,
        },
      }),
    );
    expect(html).toContain("Personal");
  });

  it("labels a reward that is not yet affordable, and one that lapsed", () => {
    const html = render(
      profile({
        rewards: {
          items: [reward({ state: "insufficient_points" }), reward({ id: "r2", name: "Lapsed", state: "expired" })],
          truncated: false,
          redemptionCount: 0,
          pointsRedeemed: 0,
        },
      }),
    );
    expect(html).toContain("Not enough points");
    expect(html).toContain("Expired");
    expect(html).not.toContain("Ready to redeem");
  });

  it("has an empty state for rewards and for activity", () => {
    const html = render(
      profile({
        rewards: { items: [], truncated: false, redemptionCount: 0, pointsRedeemed: 0 },
        recentPurchases: [],
        recentLoyaltyActivity: [],
        recentRedemptions: [],
      }),
    );
    expect(html).toContain('data-testid="customer-360-no-rewards"');
    expect(html).toContain('data-testid="customer-360-no-activity"');
  });

  it("shows purchases, loyalty activity and redemptions together", () => {
    const html = render(profile());
    expect(html).toContain("Purchase");
    expect(html).toContain("Redeemed");
    expect(html).toContain("+100 pts");
    expect(html).toContain("−500 pts");
  });

  it("shows a per-sale refund next to the purchase it belongs to", () => {
    const html = render(
      profile({
        recentPurchases: [
          { totalUgx: 50_000, returnedUgx: 10_000, completedAt: "2026-09-28T10:00:00.000Z", paymentStatus: "paid" },
        ],
      }),
    );
    expect(html).toContain("UGX 50,000");
    expect(html).toContain("−UGX 10,000");
  });
});

describe("SECURITY: the panel renders only what the server sent", () => {
  it("carries no token, no internal id and no cross-shop figure", () => {
    const html = render(profile());
    expect(html).not.toContain("qr_token");
    expect(html).not.toContain("public_card_token");
    expect(html).not.toContain("auth_user_id");
    // The customer's own id is not displayed; only their name and phone are.
    expect(html).not.toContain("cust-1");
  });

  it("never presents points as cash", () => {
    const html = render(profile());
    expect(html.toLowerCase()).not.toContain("cashback");
    expect(html.toLowerCase()).not.toContain("cash back");
  });
});
