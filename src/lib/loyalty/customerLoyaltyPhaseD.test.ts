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
 * Customer Loyalty Phase D — final polish (audit §26): anchored section chips for
 * the long scroll, the self-contained light public-card surface (dark-mode safety),
 * the card-asset rebrand, and DKASU SEO tests. Source-scan + SSR per this repo's
 * conventions.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function account(over: Partial<MemberLinkedAccount> = {}): MemberLinkedAccount {
  return {
    linkId: crypto.randomUUID(),
    shopId: crypto.randomUUID(),
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
    memberNumber: "26D4 33F0 2BED 4ABE",
    memberCvc: "251",
    qrToken: "opaque",
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
      activeAccounts: accounts.length,
      suspendedAccounts: 0,
    },
  };
}

function renderView(d: MemberDashboard): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(MemberDashboardView, { dashboard: d, lang: "en" })),
  );
}

describe("section chips (audit §26 — one page, anchored)", () => {
  it("renders jump chips only for long multi-merchant dashboards", () => {
    const many = renderView(dashboard([account(), account(), account()]));
    expect(many).toContain('data-testid="member-section-chips"');
    expect(many).toContain('aria-label="Dashboard sections"');

    const single = renderView(dashboard([account()]));
    expect(single).not.toContain('data-testid="member-section-chips"');
  });

  it("every chip targets an anchor that exists on the page", () => {
    const html = renderView(
      dashboard([
        account({ linkId: "l1" }),
        account({ linkId: "l2" }),
        account({ linkId: "l3" }),
      ]),
    );
    // Cards chip only when card identity exists; its section id ships with it.
    expect(html).toContain('id="loyalty-cards"');
    for (const id of ["loyalty-memberships", "loyalty-activity", "loyalty-rewards"]) {
      expect(html, `missing anchor ${id}`).toContain(`id="${id}"`);
    }
    // Anchors are focus targets for the jump (keyboard landing point);
    // SSR renders tabIndex as the lowercase `tabindex` attribute.
    expect(html).toMatch(/id="loyalty-activity"[^>]*tabindex="-1"/);
    expect(read("src/pages/member/MemberHomePage.tsx")).toContain("scrollIntoView");
  });

  it("promotions chip follows the promotions section", () => {
    const html = renderView(dashboard([account(), account(), account()]));
    // No promotions fixture here — chip and section are both absent.
    expect(html).not.toContain('id="loyalty-promotions"');
    expect(html).not.toContain('data-testid="member-promotions"');
  });

  it("chip labels resolve in en, lg and sw", () => {
    for (const key of ["memberChipNav", "memberChipMembership", "memberChipCards"]) {
      for (const lang of ["en", "lg", "sw"] as const) {
        const value = t(lang, key);
        expect(value, `${lang}.${key}`).toBeTruthy();
        expect(value, `${lang}.${key}`).not.toBe(key);
      }
      expect(t("lg", key)).not.toBe(t("en", key));
      expect(t("sw", key)).not.toBe(t("en", key));
    }
  });
});

describe("public card surface is a self-contained light island (dark-mode safety)", () => {
  it("the shell paints its own background edge to edge, with a dark counterpart", () => {
    const css = read("src/index.css");
    const shell = css.slice(css.indexOf(".loyalty-public-shell"));
    expect(shell).toContain("background:");
    expect(shell).toContain("linear-gradient");
    // Phase D (U17): the global .dark remap inverts the page's utilities, so the
    // shell must go dark with them instead of staying a light gradient.
    expect(shell).toContain(".dark .loyalty-public-shell");
    // min-h-dvh on the same element guarantees the surface covers the viewport,
    // so a dark body can never bleed through behind the card page.
    const page = read("src/pages/PublicLoyaltyCardPage.tsx");
    expect(page).toContain("loyalty-public-shell min-h-dvh");
    expect(page).toContain("text-stone-900");
    // The card view itself uses raw palette utilities only — the remap layer pairs
    // them, and no `dark:` variant can double-invert a single element.
    const view = read("src/components/loyalty/public/PublicLoyaltyCardView.tsx");
    expect(view).not.toContain("dark:");
  });
});

describe("card asset rebrand (audit §26 decision)", () => {
  it("customer card surfaces use the DKASU mark, never the legacy W asset", () => {
    const card = read("src/components/loyalty/WakaLoyaltyCard.tsx");
    expect(card).toContain("brand/d-icon-128-cream.png");
    expect(card).not.toContain("brand/w-icon");
    // No customer surface references the legacy mark asset.
    for (const file of [
      "src/pages/member/MemberHomePage.tsx",
      "src/pages/PublicLoyaltyCardPage.tsx",
      "src/components/loyalty/public/PublicLoyaltyCardView.tsx",
    ]) {
      expect(read(file), file).not.toContain("w-icon");
    }
  });
});

describe("DKASU SEO for the public card (stale-test cleanup)", () => {
  it("the SEO module serves the DKASU title and the canonical resolves to the DKASU host", async () => {
    const seo = read("src/config/seoRoutes.ts");
    expect(seo).toContain('"DKASU Loyalty"');
    const { loyaltyCanonical } = await import("../../config/company");
    expect(loyaltyCanonical("/c")).toBe("https://loyalty.dkasu.com/c");
  });
});
