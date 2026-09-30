import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { MemberDashboardView, MemberHomePage } from "../../pages/member/MemberHomePage";
import type {
  MemberActivityItem,
  MemberDashboard,
  MemberLinkedAccount,
  MemberPromotion,
  MemberReward,
} from "../memberDashboard";

/**
 * The authenticated member dashboard.
 *
 * WHAT THIS PINS. The page renders EXACTLY what `loyalty_member_dashboard()` returned, and nothing
 * else. The two rules that matter most:
 *
 *   1. POINTS ARE PER MERCHANT. Each merchant card carries its own balance and its own lifetime
 *      figures. The summary is a convenience view over ACTIVE accounts and says so; it is never a
 *      pool the member could mistake for one spendable balance.
 *
 *   2. NO CREDENTIALS OR INTERNAL IDS REACH THE SCREEN. The projection never returns
 *      `public_card_token` or `qr_token`, and the page does not render the ids it does receive
 *      (`linkId`, `shopId`, the member id). The public-card Edge Function is not called from here.
 *
 * The view is rendered directly rather than through `MemberHomePage` because the page's data
 * arrives from an effect, which a static render does not run. The page's own states (loading,
 * error) are asserted structurally further down, which is how the surrounding suites cover them.
 */

const MEMBER_ID = "11111111-2222-3333-4444-555555555555";
const LINK_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SHOP_ID = "99999999-8888-7777-6666-555555555555";

function account(over: Partial<MemberLinkedAccount> = {}): MemberLinkedAccount {
  return {
    linkId: LINK_ID,
    shopId: SHOP_ID,
    shopName: "Kampala Kiosk",
    shopBusinessType: "kiosk_duka",
    shopDistrict: "Kampala",
    accountStatus: "active",
    balancePoints: 0,
    lifetimeEarnedPoints: 0,
    lifetimeRedeemedPoints: 0,
    membershipExpiresAt: null,
    enrolledAt: null,
    hasPublicCard: false,
    ...over,
  };
}

function dashboard(over: Partial<MemberDashboard> = {}): MemberDashboard {
  const accounts = over.accounts ?? [account()];
  return {
    member: {
      id: MEMBER_ID,
      displayName: "ugualy",
      phoneMasked: "+2567** *** 020",
      email: "member@example.test",
      status: "active",
      memberSince: "2026-09-01T10:00:00.000Z",
      phoneVerified: true,
      ...(over.member ?? {}),
    },
    accounts,
    counts: {
      linkedAccounts: accounts.length,
      activeAccounts: accounts.filter((a) => a.accountStatus === "active").length,
      suspendedAccounts: accounts.filter((a) => a.accountStatus === "suspended").length,
      ...(over.counts ?? {}),
    },
  };
}

function render(d: MemberDashboard): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(MemberDashboardView, { dashboard: d })),
  );
}

/**
 * The markup belonging to one card, isolated by its testid. Splitting on the attribute means an
 * assertion can prove a balance is attached to ITS merchant and not merely present on the page.
 */
function merchantCards(markup: string): string[] {
  const parts = markup.split('data-testid="member-merchant-card"');
  return parts.slice(1);
}

/** The markup between two testids — used to assert on the summary without the merchant cards. */
function between(markup: string, startId: string, endId: string): string {
  const start = markup.indexOf(`data-testid="${startId}"`);
  const end = markup.indexOf(`data-testid="${endId}"`);
  expect(start, `${startId} must exist`).toBeGreaterThan(-1);
  return markup.slice(start, end > start ? end : undefined);
}

describe("one linked merchant", () => {
  it("renders that merchant's real balance and identity", () => {
    const html = render(
      dashboard({
        accounts: [
          account({
            shopName: "Kampala Kiosk",
            balancePoints: 1234,
            lifetimeEarnedPoints: 2000,
            lifetimeRedeemedPoints: 766,
          }),
        ],
      }),
    );

    expect(html).toContain("Kampala Kiosk");
    expect(html).toContain("1,234");
    expect(html).toContain("2,000");
    expect(html).toContain("766");
    // A single merchant is presented as the member's card.
    expect(html).toContain("Your loyalty card");
    expect(html).toContain("Kiosk / Duka");
    expect(html).toContain("Kampala");
  });

  it("renders the member's name, masked phone and status", () => {
    const html = render(dashboard());
    expect(html).toContain("ugualy");
    expect(html).toContain("+2567** *** 020");
    // The status pill shows the status the server reported.
    expect(html).toMatch(/>\s*active\s*</);
  });

  it("states the linked merchant count in the singular and the plural", () => {
    expect(render(dashboard())).toContain("1 linked merchant");
    expect(
      render(dashboard({ accounts: [account(), account({ linkId: "l2", shopId: "s2", shopName: "B" })] })),
    ).toContain("2 linked merchants");
  });
});

describe("multiple linked merchants", () => {
  const many = [
    account({
      linkId: "l1",
      shopId: "s1",
      shopName: "Kampala Kiosk",
      balancePoints: 1111,
      lifetimeEarnedPoints: 1500,
      lifetimeRedeemedPoints: 389,
    }),
    account({
      linkId: "l2",
      shopId: "s2",
      shopName: "Entebbe Pharmacy",
      shopBusinessType: "pharmacy",
      shopDistrict: "Wakiso",
      balancePoints: 2222,
      lifetimeEarnedPoints: 3000,
      lifetimeRedeemedPoints: 778,
    }),
  ];

  it("gives each merchant its own card", () => {
    const cards = merchantCards(render(dashboard({ accounts: many })));
    expect(cards).toHaveLength(2);
    expect(render(dashboard({ accounts: many }))).toContain("Your merchants");
  });

  it("keeps each balance attached to its OWN merchant, never mixed", () => {
    const cards = merchantCards(render(dashboard({ accounts: many })));
    const kiosk = cards.find((c) => c.includes("Kampala Kiosk"));
    const pharmacy = cards.find((c) => c.includes("Entebbe Pharmacy"));

    expect(kiosk, "the kiosk card must exist").toBeDefined();
    expect(pharmacy, "the pharmacy card must exist").toBeDefined();

    expect(kiosk!).toContain("1,111");
    expect(kiosk!).not.toContain("2,222");
    expect(pharmacy!).toContain("2,222");
    expect(pharmacy!).not.toContain("1,111");

    // Lifetime figures follow the same rule.
    expect(kiosk!).toContain("1,500");
    expect(kiosk!).not.toContain("3,000");
    expect(pharmacy!).toContain("3,000");
  });

  it("each merchant keeps its own status, so one suspension is not generalised", () => {
    const cards = merchantCards(
      render(
        dashboard({
          accounts: [many[0]!, account({ ...many[1]!, accountStatus: "suspended" })],
        }),
      ),
    );
    const kiosk = cards.find((c) => c.includes("Kampala Kiosk"))!;
    const pharmacy = cards.find((c) => c.includes("Entebbe Pharmacy"))!;
    expect(kiosk).toMatch(/>\s*active\s*</);
    expect(pharmacy).toMatch(/>\s*suspended\s*</);
  });
});

describe("the summary is a convenience view over ACTIVE accounts, and says so", () => {
  it("sums the balances of active accounts only", () => {
    const html = render(
      dashboard({
        accounts: [
          account({ linkId: "l1", shopId: "s1", balancePoints: 100 }),
          account({ linkId: "l2", shopId: "s2", shopName: "Second", balancePoints: 200 }),
          account({
            linkId: "l3",
            shopId: "s3",
            shopName: "Suspended Shop",
            accountStatus: "suspended",
            balancePoints: 9999,
          }),
        ],
      }),
    );

    const summary = between(html, "member-summary", "member-merchants");
    expect(summary).toContain("300");
    // The suspended account's balance is NOT in the total…
    expect(summary).not.toContain("9,999");
    // …but it is still displayed, on its own card, where it belongs.
    expect(merchantCards(html).some((c) => c.includes("9,999"))).toBe(true);
  });

  it("sums lifetime earned and redeemed the same way", () => {
    const html = render(
      dashboard({
        accounts: [
          account({ linkId: "l1", shopId: "s1", lifetimeEarnedPoints: 400, lifetimeRedeemedPoints: 50 }),
          account({
            linkId: "l2",
            shopId: "s2",
            shopName: "Second",
            lifetimeEarnedPoints: 600,
            lifetimeRedeemedPoints: 250,
          }),
        ],
      }),
    );
    const summary = between(html, "member-summary", "member-merchants");
    expect(summary).toContain("1,000"); // earned
    expect(summary).toContain("300"); // redeemed
  });

  it("warns that points are held separately, so the total is never read as one balance", () => {
    const html = render(dashboard());
    expect(html).toMatch(/never combined into one balance/i);
  });
});

describe("merchant card details", () => {
  it("shows membership expiry, and marks an expiry that has passed", () => {
    const future = render(
      dashboard({ accounts: [account({ membershipExpiresAt: "2099-12-31T00:00:00.000Z" })] }),
    );
    expect(future).toContain("Membership expires");
    expect(future).toContain("2099");

    const past = render(
      dashboard({ accounts: [account({ membershipExpiresAt: "2020-01-02T00:00:00.000Z" })] }),
    );
    expect(past).toContain("Membership expired");
  });

  it("treats a missing expiry as no expiry, not as expired", () => {
    const html = render(dashboard({ accounts: [account({ membershipExpiresAt: null })] }));
    expect(html).not.toContain("Membership expired");
    expect(html).not.toContain("Membership expires");
  });

  it("shows the enrolment date and whether a digital card has been issued", () => {
    const html = render(
      dashboard({
        accounts: [account({ enrolledAt: "2026-09-10T10:00:00.000Z", hasPublicCard: true })],
      }),
    );
    expect(html).toContain("Joined");
    expect(html).toContain("2026");
    expect(html).toContain("Digital card ready");

    const noCard = render(dashboard({ accounts: [account({ hasPublicCard: false })] }));
    expect(noCard).toContain("Digital card not issued yet");
  });
});

describe("SECURITY: nothing internal or bearer-like reaches the screen", () => {
  const html = render(
    dashboard({
      accounts: [account({ hasPublicCard: true, enrolledAt: "2026-09-10T10:00:00.000Z" })],
    }),
  );

  it("never renders the member id, link id or account's shop id", () => {
    expect(html).not.toContain(MEMBER_ID);
    expect(html).not.toContain(LINK_ID);
    expect(html).not.toContain(SHOP_ID);
  });

  it("renders no token, and no link to the public card surface", () => {
    // The projection does not return these; the page must not invent a way to show them either.
    expect(html).not.toContain("public_card_token");
    expect(html).not.toContain("qr_token");
    // No anchor into the public card route, where a token would have to appear in the URL.
    expect(html).not.toMatch(/href="[^"]*\/c\//);
    expect(html).not.toContain("loyalty.waka.ug");
  });

  it("reports card availability as a state, not as a credential", () => {
    // "Digital card ready" is a boolean the server sent. It carries no token and no URL.
    const match = html.match(/Digital card [^<]*/);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("Digital card ready");
  });
});

describe("the activity section", () => {
  function activityItem(over: Partial<MemberActivityItem> = {}): MemberActivityItem {
    return {
      id: "tx-1",
      kind: "earned",
      cause: "sale",
      points: 100,
      balanceAfter: 100,
      createdAt: "2026-09-30T09:00:00.000Z",
      shopId: SHOP_ID,
      shopName: "Kampala Kiosk",
      saleTotalUgx: 100_000,
      rewardName: null,
      rewardPointsRequired: null,
      ...over,
    };
  }

  const withActivity = (items: MemberActivityItem[], over: Partial<MemberDashboard> = {}, more = false) =>
    renderToStaticMarkup(
      createElement(MemoryRouter, null, (() =>
        createElement(MemberDashboardView, {
          dashboard: dashboard(over),
          activity: items,
          activityState: "ready" as const,
          activityHasMore: more,
          onLoadMoreActivity: () => {},
        }))()),
    );

  it("reads a purchase as the member's own sale value", () => {
    const html = withActivity([activityItem()]);
    expect(html).toContain("Purchase — UGX 100,000");
    expect(html).toContain("+100");
    expect(html).toContain('data-testid="member-activity"');
  });

  it("names the reward a redemption was spent on, and shows the deduction", () => {
    const html = withActivity([
      activityItem({ kind: "redeemed", cause: "redemption", points: -500, rewardName: "Free Coke", rewardPointsRequired: 500, saleTotalUgx: null }),
    ]);
    expect(html).toContain("Reward redeemed — Free Coke");
    expect(html).toContain("−500");
  });

  it("labels returns, voids, expiries and adjustments distinctly", () => {
    const html = withActivity([
      activityItem({ id: "a", kind: "reversed", cause: "return", points: -25, saleTotalUgx: null }),
      activityItem({ id: "b", kind: "reversed", cause: "void", points: -30, saleTotalUgx: null }),
      activityItem({ id: "c", kind: "expired", cause: "expiration", points: -5, saleTotalUgx: null }),
      activityItem({ id: "d", kind: "adjusted", cause: "manual_adjustment", points: 3, saleTotalUgx: null }),
    ]);
    expect(html).toContain("Return — points reversed");
    expect(html).toContain("Sale voided — points reversed");
    expect(html).toContain("Points expired");
    expect(html).toContain("Adjustment");
  });

  it("keeps the merchant on every row for a multi-merchant member", () => {
    const twoMerchants = [
      account({ linkId: "l1", shopId: "s1", shopName: "Kampala Kiosk" }),
      account({ linkId: "l2", shopId: "s2", shopName: "Entebbe Pharmacy" }),
    ];
    const html = withActivity([activityItem({ shopName: "Kampala Kiosk" })], { accounts: twoMerchants });
    expect(html).toContain("Kampala Kiosk ·");
  });

  it("does not repeat a single merchant's name on every row", () => {
    const html = withActivity([activityItem({ shopName: "Kampala Kiosk" })]);
    const list = html.slice(html.indexOf('data-testid="member-activity-list"'));
    // The shop is already named on the card above; the row carries the date alone.
    expect(list).not.toContain("Kampala Kiosk ·");
  });

  it("offers earlier activity only when more exists", () => {
    expect(withActivity([activityItem()])).not.toContain('data-testid="member-activity-more"');
    expect(withActivity([activityItem()], {}, true)).toContain('data-testid="member-activity-more"');
  });

  it("has a loading, an empty and an error state", () => {
    const shell = (props: Record<string, unknown>) =>
      renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(MemberDashboardView, { dashboard: dashboard(), ...props })),
      );

    const loading = shell({ activityState: "loading" });
    expect(loading).toContain('data-testid="member-activity"');
    expect(loading).toContain('aria-busy="true"');

    const empty = shell({ activity: [], activityState: "ready" });
    expect(empty).toContain("No points activity yet");

    const failed = shell({ activity: [], activityState: "error" });
    expect(failed).toContain("could not load your points history");
    // The balances above the section are untouched by an activity failure.
    expect(failed).toContain("ugualy");
  });

  it("renders no internal identifiers or tokens", () => {
    const html = withActivity([activityItem({ id: "99999999-1111-2222-3333-444444444444" })]);
    // The row id travels for pagination but is not displayed.
    expect(html).not.toContain("99999999-1111-2222-3333-444444444444");
    expect(html).not.toContain("public_card_token");
    expect(html).not.toContain("qr_token");
  });

  it("no longer tells the member that activity is missing", () => {
    const html = withActivity([activityItem()]);
    expect(html).not.toContain("Activity and rewards");
    expect(html).not.toContain("arrives in the next phase");
    // Real rows, not a promise about a later phase.
    expect(html).toContain("Purchase — UGX 100,000");
  });
});

describe("the rewards section", () => {
  function reward(over: Partial<MemberReward> = {}): MemberReward {
    return {
      id: "reward-1",
      shopId: SHOP_ID,
      shopName: "Kampala Kiosk",
      name: "Free Coke",
      description: "One 500ml Coke",
      rewardKind: "product",
      benefitKind: "none",
      benefitAmountUgx: null,
      benefitPercent: null,
      pointsRequired: 100,
      balancePoints: 250,
      pointsNeeded: 0,
      personal: false,
      grantedUntil: null,
      expiresOn: null,
      active: true,
      maxRedemptionsPerAccount: null,
      timesRedeemed: 0,
      redemptionsRemaining: null,
      state: "available",
      ...over,
    };
  }

  const withRewards = (
    rewards: MemberReward[],
    over: Partial<MemberDashboard> = {},
    state: "loading" | "ready" | "error" = "ready",
  ) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(MemberDashboardView, {
          dashboard: dashboard(over),
          rewards,
          rewardsState: state,
        }),
      ),
    );

  it("shows what the reward costs and that it is ready", () => {
    const html = withRewards([reward()]);
    expect(html).toContain('data-testid="member-rewards"');
    expect(html).toContain("Free Coke");
    expect(html).toContain("Ready to redeem");
    expect(html).toContain('data-reward-state="available"');
    // The points cost is shown as a number, not just implied.
    expect(html).toContain("100");
  });

  it("shows the shortfall and the member's own balance when they cannot afford it", () => {
    const html = withRewards([
      reward({ pointsRequired: 500, balancePoints: 120, pointsNeeded: 380, state: "insufficient_points" }),
    ]);
    expect(html).toContain("380 more points needed");
    expect(html).toContain("You have 120 of 500 points here");
    expect(html).toContain('data-reward-state="insufficient_points"');
  });

  it("labels an expired reward as expired, not as available", () => {
    const html = withRewards([reward({ state: "expired", expiresOn: "2026-01-05" })]);
    expect(html).toContain("Expired");
    expect(html).toContain("2026");
    expect(html).not.toContain("Ready to redeem");
  });

  it("labels a retired reward as no longer offered", () => {
    const html = withRewards([reward({ state: "inactive", active: false })]);
    expect(html).toContain("No longer offered");
    expect(html).not.toContain("Ready to redeem");
  });

  it("marks a personal reward and when the grant lapses", () => {
    const html = withRewards([reward({ personal: true, grantedUntil: "2099-05-01T00:00:00.000Z" })]);
    expect(html).toContain("Just for you");
    expect(html).toContain("Yours until");
    expect(html).toContain("2099");
  });

  it("shows a redemption limit that has already been used up", () => {
    const html = withRewards([
      reward({ state: "limit_reached", maxRedemptionsPerAccount: 1, timesRedeemed: 1, redemptionsRemaining: 0 }),
    ]);
    expect(html).toContain("Already redeemed the maximum");
    expect(html).toContain("Redeemed 1×");
  });

  it("names the merchant on every reward for a multi-merchant member", () => {
    const twoMerchants = [
      account({ linkId: "l1", shopId: "s1", shopName: "Kampala Kiosk" }),
      account({ linkId: "l2", shopId: "s2", shopName: "Entebbe Pharmacy" }),
    ];
    const html = withRewards(
      [reward({ shopName: "Kampala Kiosk" }), reward({ id: "r2", shopName: "Entebbe Pharmacy" })],
      { accounts: twoMerchants },
    );
    expect(html).toContain("Kampala Kiosk");
    expect(html).toContain("Entebbe Pharmacy");
  });

  it("does not repeat a single merchant's name onto every reward", () => {
    const html = withRewards([reward({ shopName: "Kampala Kiosk" })]);
    const section = html.slice(html.indexOf('data-testid="member-rewards"'));
    expect(section).not.toContain(">Kampala Kiosk<");
  });

  it("offers no redeem control — redemption is the shop's, not the browser's", () => {
    const html = withRewards([reward()]);
    const section = html.slice(html.indexOf('data-testid="member-rewards"'));
    expect(section).not.toMatch(/<button/);
    expect(section).toContain("redeemed by the shop at checkout");
  });

  it("has a loading, an empty and an error state", () => {
    const loading = withRewards([], {}, "loading");
    expect(loading).toContain('data-testid="member-rewards"');
    expect(loading).toContain('aria-busy="true"');

    const empty = withRewards([], {}, "ready");
    expect(empty).toContain('data-testid="member-rewards-empty"');

    const failed = withRewards([], {}, "error");
    expect(failed).toContain("could not load your rewards");
    // A rewards failure must not blank the balances above it.
    expect(failed).toContain("ugualy");
  });

  it("says nothing is ready yet when every reward is out of reach", () => {
    const html = withRewards([reward({ state: "insufficient_points", pointsNeeded: 50 })]);
    expect(html).toContain('data-testid="member-rewards-none-eligible"');
    // …and says nothing when something IS ready.
    expect(withRewards([reward()])).not.toContain('data-testid="member-rewards-none-eligible"');
  });

  it("renders no token and no internal reward id", () => {
    const html = withRewards([reward({ id: "99999999-1111-2222-3333-444444444444" })]);
    const section = html.slice(html.indexOf('data-testid="member-rewards"'));
    expect(section).not.toContain("99999999-1111-2222-3333-444444444444");
    expect(section).not.toContain("public_card_token");
    expect(section).not.toContain("qr_token");
  });
});

describe("no linked merchants", () => {
  it("offers the WAKA Loyalty code step instead of an empty dashboard", () => {
    const html = render(
      dashboard({ accounts: [], counts: { linkedAccounts: 0, activeAccounts: 0, suspendedAccounts: 0 } }),
    );
    expect(html).toContain("No merchants yet");
    expect(html).toContain("WAKA Loyalty code");
    // The code-entry form is the same component every other not-yet-joined surface uses.
    expect(html).toContain('data-testid="loyalty-code-entry-input"');
    // And there is nothing to summarise.
    expect(html).not.toContain('data-testid="member-summary"');
    expect(html).not.toContain('data-testid="member-merchant-card"');
  });

  it("still shows who the member is", () => {
    const html = render(
      dashboard({ accounts: [], counts: { linkedAccounts: 0, activeAccounts: 0, suspendedAccounts: 0 } }),
    );
    expect(html).toContain("ugualy");
    expect(html).toContain("0 linked merchants");
  });
});

describe("loading and error states", () => {
  const PAGE = () => readFileSync(join(process.cwd(), "src/pages/member/MemberHomePage.tsx"), "utf8");

  it("loading renders a skeleton with the account's shape, not a bare line of text", () => {
    const src = PAGE();
    expect(src).toContain('data-testid="member-loading"');
    expect(src).toContain('aria-busy="true"');
    expect(src).toContain("waka-skeleton-bar");
  });

  it("the page really renders that loading state on first paint", () => {
    // A static render does not run effects, so this is exactly the first paint: the read has not
    // resolved. It proves the loading branch itself is sound — a broken import or a bad reference
    // there would throw here rather than in production.
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(MemberHomePage)),
    );
    expect(html).toContain('data-testid="member-loading"');
    expect(html).toContain('aria-busy="true"');
    // The dashboard is not shown until the server has answered.
    expect(html).not.toContain('data-testid="member-dashboard"');
  });

  it("error offers a retry, and never renders the raw error code", () => {
    const src = PAGE();
    expect(src).toContain('data-testid="member-error"');
    expect(src).toContain("Try again");
    expect(src).toContain("void load().then(setState)");
    // `state.error` is only ever COMPARED (to pick the not-a-member step). It is never
    // interpolated into the markup, so a backend code cannot reach the member.
    const uses = src.match(/state\.error/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(src).toContain('state.error === "not_a_member"');
  });

  it("the member surface still creates no member and bootstraps no workspace", () => {
    const code = PAGE().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(
      /becomeLoyaltyMember|registerLoyaltyMember|loyalty_member_register|MemberRegistrationForm/,
    );
    expect(code).not.toMatch(/bootstrapOwnerWorkspace|bootstrap_owner_workspace/);
  });

  it("does not call the public-card Edge Function from the authenticated dashboard", () => {
    const code = PAGE().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/fetchPublicLoyaltyCard|loyalty-public-card|publicCardToken/);
    // One data source, and it is the member projection.
    expect(code).toContain("fetchMemberDashboard");
  });
});

describe("activity and rewards are not faked", () => {
  it("shows an honest empty state instead of a placeholder, now that both sections are real", () => {
    // Activity (Phase A) and Rewards (Phase B) both ship, so there is no longer anything to
    // announce as "coming next" — and the page must not carry a stale promise about it.
    const html = render(dashboard());
    expect(html).not.toContain('data-testid="member-coming-next"');
    expect(html).not.toContain("Coming next");
    expect(html).not.toContain("arrives in the next phase");
    // With nothing to show, each section says so plainly rather than inventing content.
    expect(html).toContain('data-testid="member-rewards-empty"');
    expect(html).toContain("No rewards are available to you yet");
    // And nothing is claimed to be redeemable from this page.
    expect(html).not.toMatch(/claim now|redeem now/i);
  });
});

describe("the promotions section", () => {
  function promotion(over: Partial<MemberPromotion> = {}): MemberPromotion {
    return {
      shopId: SHOP_ID,
      shopName: "Kampala Kiosk",
      title: "Spend UGX 50,000",
      kind: "spend_bonus",
      bonusPoints: 100,
      multiplier: null,
      grantedRewardCount: null,
      thresholdUgx: 50_000,
      qualifyingSpendUgx: 30_000,
      remainingUgx: 20_000,
      endsAt: "2026-11-30T00:00:00.000Z",
      rewarded: false,
      ...over,
    };
  }

  const withPromotions = (promotions: MemberPromotion[]) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(MemberDashboardView, { dashboard: dashboard(), promotions }),
      ),
    );

  it("shows the threshold, the progress and the remainder", () => {
    const html = withPromotions([promotion()]);
    expect(html).toContain('data-testid="member-promotions"');
    expect(html).toContain("Spend UGX 50,000");
    expect(html).toContain("UGX 30,000 / UGX 50,000");
    expect(html).toContain("20,000 remaining");
    expect(html).toContain("60%");
    expect(html).toContain("+100 pts");
    expect(html).toContain("Kampala Kiosk");
  });

  it("shows the expiry", () => {
    expect(withPromotions([promotion()])).toMatch(/Ends 30 Nov 2026/);
  });

  it("marks a promotion that has been earned", () => {
    const html = withPromotions([promotion({ rewarded: true })]);
    expect(html).toContain('data-testid="member-promotion-earned"');
    expect(html).toContain("Earned");
    // An earned promotion shows the win, not a bar the member can no longer move.
    expect(html).not.toContain("20,000 remaining");
  });

  it("shows a multiplier promotion without a spend bar", () => {
    const html = withPromotions([
      promotion({ kind: "earn_multiplier", bonusPoints: null, multiplier: 2, thresholdUgx: null, qualifyingSpendUgx: null, remainingUgx: null }),
    ]);
    expect(html).toContain("2× pts");
    // No spend progress row — the title is fixture text, so the assertion targets the
    // progress line itself ("UGX a / UGX b · n remaining").
    expect(html).not.toContain("remaining");
    expect(html).not.toContain("/ UGX");
  });

  it("renders nothing at all when there are no promotions", () => {
    const html = withPromotions([]);
    expect(html).not.toContain('data-testid="member-promotions"');
  });

  it("renders only what the server said — it decides no eligibility itself", () => {
    // A promotion the server did NOT mark rewarded must never render as earned, whatever its
    // numbers look like. The frontend has no opinion about thresholds.
    const html = withPromotions([promotion({ qualifyingSpendUgx: 999_999, remainingUgx: 0, rewarded: false })]);
    expect(html).not.toContain('data-testid="member-promotion-earned"');
  });

  it("exposes no internal identifiers", () => {
    const html = withPromotions([promotion()]);
    const section = html.slice(html.indexOf('data-testid="member-promotions"'));
    expect(section).not.toContain(SHOP_ID);
    expect(section).not.toContain("qr_token");
    expect(section).not.toContain("public_card_token");
  });
});
