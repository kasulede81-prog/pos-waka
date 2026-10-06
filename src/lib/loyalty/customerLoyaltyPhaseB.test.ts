import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import { MemberDashboardView } from "../../pages/member/MemberHomePage";
import type { MemberDashboard, MemberLinkedAccount } from "../memberDashboard";

/**
 * Customer Loyalty Phase B — wallet states + premium dashboard cards.
 * Source-scan + SSR assertions per this repository's test conventions.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function account(over: Partial<MemberLinkedAccount> = {}): MemberLinkedAccount {
  return {
    linkId: "link-1",
    shopId: "shop-1",
    shopName: "Kampala Kiosk",
    shopBusinessType: "kiosk_duka",
    shopDistrict: "Kampala",
    accountStatus: "active",
    balancePoints: 180,
    lifetimeEarnedPoints: 380,
    lifetimeRedeemedPoints: 200,
    membershipExpiresAt: "2026-10-30T00:00:00.000Z",
    enrolledAt: "2026-01-10T00:00:00.000Z",
    hasPublicCard: true,
    ...over,
  };
}

function dashboard(accounts: MemberLinkedAccount[]): MemberDashboard {
  return {
    member: {
      id: "member-1",
      displayName: "Denis Kasule",
      phoneMasked: "+2567** *** 020",
      email: "denis@example.test",
      status: "active",
      memberSince: "2026-01-10T00:00:00.000Z",
      phoneVerified: true,
    },
    accounts,
    counts: {
      linkedAccounts: accounts.length,
      activeAccounts: accounts.filter((a) => a.accountStatus === "active").length,
      suspendedAccounts: 0,
    },
  };
}

function renderView(
  d: MemberDashboard,
  extra: { cardQr?: Record<string, string | null> } = {},
): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(MemberDashboardView, { dashboard: d, lang: "en", ...extra }),
    ),
  );
}

describe("premium loyalty cards on the dashboard (audit §22)", () => {
  it("renders a premium card face per account when the projection provides card identity", () => {
    const html = renderView(
      dashboard([
        account({
          memberNumber: "26D4 33F0 2BED 4ABE",
          memberCvc: "251",
          qrToken: "opaque-token",
        }),
      ]),
      { cardQr: { "link-1": "data:image/png;base64,AAAA" } },
    );
    expect(html).toContain('data-testid="member-cards"');
    expect(html).toContain("Your loyalty card");
    expect(html).toContain('data-loyalty-card="premium"');
    expect(html).toContain("26D4 33F0 2BED 4ABE");
    // The membership block kept its own (renamed) heading — the two are distinct.
    expect(html).toContain("Your membership");
  });

  it("multi-merchant dashboards show every merchant's card with its own balance on it", () => {
    const html = renderView(
      dashboard([
        account({
          linkId: "l1",
          shopName: "Cathy Boutique",
          balancePoints: 180,
          memberNumber: "AAAA 1111 BBBB 2222",
          memberCvc: "101",
          qrToken: "tok-1",
        }),
        account({
          linkId: "l2",
          shopId: "shop-2",
          shopName: "Shop B",
          balancePoints: 420,
          memberNumber: "CCCC 3333 DDDD 4444",
          memberCvc: "202",
          qrToken: "tok-2",
        }),
      ]),
      { cardQr: { l1: "data:image/png;base64,A", l2: "data:image/png;base64,B" } },
    );
    expect(html).toContain("Your loyalty cards");
    expect(html).toContain("Cathy Boutique");
    expect(html).toContain("Shop B");
    expect(html).toContain("180");
    expect(html).toContain("420");
    expect((html.match(/data-loyalty-card="premium"/g) ?? []).length).toBe(2);
  });

  it("renders no card section when the server does not provide card identity (older projection)", () => {
    const html = renderView(dashboard([account()]));
    expect(html).not.toContain('data-testid="member-cards"');
    expect(html).not.toContain('data-loyalty-card="premium"');
    // The membership block still renders.
    expect(html).toContain('data-testid="member-merchants"');
  });

  it("never leaks the shareable public-card token into the page", () => {
    const html = renderView(
      dashboard([account({ memberNumber: "AAAA 1111 BBBB 2222", qrToken: "opaque" })]),
    );
    expect(html).not.toMatch(/public_card_token/);
  });
});

describe("wallet state wiring (audit §24)", () => {
  const page = read("src/pages/member/MemberHomePage.tsx");
  const button = read("src/components/loyalty/MemberGoogleWalletButton.tsx");

  it("merchant card forwards the backend wallet fields to the button", () => {
    expect(page).toContain("walletIssuedAt={account.googleWalletIssuedAt}");
    expect(page).toContain("walletSyncBalance={account.googleWalletSyncBalance}");
    expect(page).toContain("balancePoints={account.balancePoints}");
    expect(page).toContain("lang={lang}");
  });

  /** Strip comments so documentation that DESCRIBES a prohibition doesn't trip the scan. */
  const codeOnly = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("the button derives issued/stale state and never claims installation", () => {
    expect(button).toContain("memberWalletButtonLabel");
    expect(button).toContain("walletSyncBalance !== balancePoints");
    expect(button).toContain("data-wallet-state=");
    // Comments may discuss "installed"; the CODE must never offer that state.
    expect(codeOnly(button)).not.toMatch(/installed/i);
    expect(button).not.toContain("useUiLanguage"); // follows the page's lang prop — no stale copy
  });

  it("the data layer maps the new projection fields and withholds credentials", () => {
    const data = read("src/lib/memberDashboard.ts");
    expect(data).toContain("google_wallet_issued_at");
    expect(data).toContain("google_wallet_sync_balance");
    expect(data).toContain("card.qr_token");
    expect(data).toContain("card.member_number");
    expect(data).toContain("card.member_cvc");
    // The shareable bearer URL token is still never READ from the projection
    // (the header comment mentions it only to forbid it).
    expect(codeOnly(data)).not.toContain("public_card_token");
  });
});

describe("card QR generation", () => {
  it("builds QR data URLs from the member's own token with the shared payload helper", () => {
    const page = read("src/pages/member/MemberHomePage.tsx");
    expect(page).toContain("encodeLoyaltyQrPayload");
    expect(page).toContain("QRCode.toDataURL");
    expect(page).toContain("cardQr={cardQr}");
    expect(page).toContain("qrDataUrl={cardQr[account.linkId] ?? null}");
  });
});

describe("Phase B translations", () => {
  const keys = [
    "memberCardsHeadingSingle",
    "memberCardsHeading",
    "memberMerchantsHeadingSingle",
    "memberWalletOpen",
    "memberWalletUpdate",
    "memberWalletAdded",
  ];
  it("resolve in en, lg and sw without raw keys", () => {
    for (const key of keys) {
      for (const lang of ["en", "lg", "sw"] as const) {
        const value = t(lang, key);
        expect(value, `${lang}.${key}`).toBeTruthy();
        expect(value, `${lang}.${key}`).not.toBe(key);
      }
    }
  });

  it("headings and wallet labels are actually translated", () => {
    for (const key of ["memberCardsHeadingSingle", "memberWalletOpen", "memberWalletUpdate"]) {
      expect(t("lg", key), `lg.${key}`).not.toBe(t("en", key));
      expect(t("sw", key), `sw.${key}`).not.toBe(t("en", key));
    }
    expect(t("en", "memberMerchantsHeadingSingle")).toBe("Your membership");
  });

  it("memberWalletAdded keeps its date placeholder", () => {
    for (const lang of ["en", "lg", "sw"] as const) {
      expect(t(lang, "memberWalletAdded")).toContain("{date}");
    }
  });
});
