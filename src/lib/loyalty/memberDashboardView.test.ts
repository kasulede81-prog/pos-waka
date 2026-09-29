import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { MemberDashboardView, MemberHomePage } from "../../pages/member/MemberHomePage";
import type { MemberDashboard, MemberLinkedAccount } from "../memberDashboard";

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
  it("labels them as coming next rather than showing invented data", () => {
    const html = render(dashboard());
    expect(html).toContain('data-testid="member-coming-next"');
    expect(html).toContain("Coming next");
    expect(html).toContain("Activity and rewards");
    // Future tense, because it is not available yet — and no reward or transaction row is rendered.
    expect(html).toContain("will appear here");
    const next = html.slice(html.indexOf('data-testid="member-coming-next"'));
    expect(next).not.toMatch(/points_required|transaction|redeemed at|claim now/i);
  });
});
