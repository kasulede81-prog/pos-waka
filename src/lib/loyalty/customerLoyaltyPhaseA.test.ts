import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { t, tTemplate } from "../i18n";

/**
 * Phase A — Customer Loyalty Dashboard (frontend-only) verification.
 *
 * Covers the §17 checklist of the Phase A task: rebrand coverage, i18n resolution
 * across en/lg/sw, placeholder integrity, summary clarity, merchant breakdown,
 * Account repositioning, reward benefit rendering, truncation visibility,
 * progressbar semantics and wallet-probe memoization. Source-scan assertions follow
 * this repository's established pattern (no DOM test project).
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Customer-facing Phase A surfaces. */
const CUSTOMER_SOURCES = [
  "src/pages/member/MemberHomePage.tsx",
  "src/pages/member/MemberRegisterPage.tsx",
  "src/pages/member/WelcomePage.tsx",
  "src/pages/PublicLoyaltyCardPage.tsx",
  "src/pages/PublicLoyaltyJoinPage.tsx",
  "src/pages/PublicLoyaltyProgramPage.tsx",
  "src/components/loyalty/WakaLoyaltyCard.tsx",
  "src/components/loyalty/public/PublicLoyaltyCardView.tsx",
];

/**
 * Legacy identifiers that must NOT be replaced (per the audit classification):
 * host constants, CSS classes, persisted keys, asset paths used elsewhere, and the
 * component's own historical name.
 */
const PROTECTED_WAKA = [
  "waka-",
  "waka.ui.language",
  "waka-pos-local-session",
  "loyalty.waka.ug",
  "WAKA_W_MARK", // removed, kept for safety
  "waka-skeleton",
];

describe("P0-1 — customer-facing WAKA branding removed", () => {
  it("no customer-visible WAKA strings remain on Phase A surfaces", () => {
    for (const file of CUSTOMER_SOURCES) {
      const src = read(file);
      // Strip comments so historical notes don't fail the scan.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const hits = code
        .split("\n")
        .filter((line) => /WAKA|waka\.ug/.test(line))
        .filter((line) => !PROTECTED_WAKA.some((p) => line.includes(p)));
      expect(hits, `${file} still contains customer-visible WAKA: ${hits.join(" | ")}`).toEqual([]);
    }
  });

  it("public card SEO/copy uses DKASU wording", () => {
    const page = read("src/pages/PublicLoyaltyCardPage.tsx");
    expect(page).toContain('t(lang, "memberTitle")'); // title
    expect(page).toContain('t(lang, "publicCardDescription")');
    expect(page).toContain('t(lang, "publicCardPoweredBy")');
    expect(page).not.toContain("Powered by WAKA");
  });

  it("card wordmark renders the DKASU brand mark asset", () => {
    const card = read("src/components/loyalty/WakaLoyaltyCard.tsx");
    expect(card).toContain("brand/d-icon-128-cream.png");
    expect(card).not.toContain("brand/w-icon-128.png");
  });
});

describe("P1-1 — customer dashboard i18n", () => {
  const KEYS = [
    "memberTitle",
    "memberSubtitle",
    "memberSummaryTotal",
    "memberSummaryDisclaimer",
    "memberMerchantsHeading",
    "activityTitle",
    "activityMore",
    "rewardsTitle",
    "rewardsCheckoutNote",
    "memberRewardReady",
    "memberBenefitFixed",
    "memberBenefitPercent",
    "memberBenefitProduct",
    "rewardsTruncated",
    "memberJoinTitle",
    "welcomeTitle",
    "publicCardShare",
    "cardIssuedBy",
    "cardValidThru",
    "programPhoneHint",
    "memberPendingTitle",
    "memberRejectedTitle",
    "memberLoadErrorTitle",
    "memberAccountLabel",
    "memberSignOutKey_unused_never_mind", // placeholder filtered below
  ].filter((k) => k !== "memberSignOutKey_unused_never_mind");

  it("required keys resolve in en, lg and sw without leaking the raw key", () => {
    for (const key of KEYS) {
      for (const lang of ["en", "lg", "sw"] as const) {
        const value = t(lang, key);
        expect(value, `${lang}.${key} missing`).toBeTruthy();
        expect(value, `${lang}.${key} leaks raw key`).not.toBe(key);
      }
    }
  });

  it("translated customer copy differs from English in lg and sw", () => {
    // Brand name and trade-category labels are deliberately identical everywhere.
    const mustTranslate = [
      "memberSubtitle",
      "memberSummaryTotal",
      "activityMore",
      "rewardsCheckoutNote",
      "memberRewardReady",
      "memberBenefitFixed",
      "memberPendingTitle",
      "welcomeTitle",
      "publicCardShare",
      "memberAccountLabel",
    ];
    for (const key of mustTranslate) {
      expect(t("lg", key), `lg.${key} untranslated`).not.toBe(t("en", key));
      expect(t("sw", key), `sw.${key} untranslated`).not.toBe(t("en", key));
    }
  });

  it("placeholders survive translation for Phase A template keys", () => {
    const placeholders = (v: string) => (v.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
    const templateKeys = [
      "memberExpires",
      "memberExpiredDate",
      "memberJoined",
      "memberRewardNeeded",
      "memberRewardProgress",
      "memberBenefitFixed",
      "memberBenefitPercent",
      "promotionProgress",
      "rewardsTruncated",
      "memberActivityPurchase",
      "publicRewardAriaAvailable",
    ];
    for (const key of templateKeys) {
      expect(placeholders(t("lg", key)), `lg placeholders for ${key}`).toEqual(
        placeholders(t("en", key)),
      );
      expect(placeholders(t("sw", key)), `sw placeholders for ${key}`).toEqual(
        placeholders(t("en", key)),
      );
    }
  });

  it("language selection changes the dashboard copy", () => {
    expect(t("en", "memberTitle")).not.toBe(t("lg", "memberSummaryTotal"));
    const sample = "memberSummaryTotal";
    expect(t("en", sample)).not.toBe(t("lg", sample));
    expect(t("lg", sample)).not.toBe(t("sw", sample));
  });

  it("member surface uses the shared t()/tTemplate architecture and no raw RPC codes render", () => {
    const hub = read("src/pages/member/MemberHomePage.tsx");
    expect(hub).toContain("t(lang,");
    expect(hub).toContain("tTemplate(lang,");
    // Member-facing failure surfaces must map through keys, never raw codes.
    expect(hub).not.toMatch(/\{state\.error\}/);
    expect(hub).not.toContain("loyaltyErrorKey"); // member surface uses prose keys, not merchant mapper
  });
});

describe("P1-4 — reward benefit value", () => {
  const rewards = read("src/pages/member/MemberHomePage.tsx");

  it("renders supported benefit kinds and never invents one", () => {
    expect(rewards).toContain("rewardBenefitLabel");
    expect(rewards).toContain('reward.benefitKind === "fixed_discount"');
    expect(rewards).toContain('reward.benefitKind === "percentage_discount"');
    expect(rewards).toContain('reward.rewardKind === "product"');
    // Exactly three guarded branches (fixed, percentage, none+product) — no fourth kind.
    const branches = rewards.match(/reward\.benefitKind === /g)?.length ?? 0;
    expect(branches).toBe(3);
    expect(rewards).toContain("memberBenefitProduct");
    expect(rewards).toContain('data-testid="member-reward-benefit"');
  });

  it("keeps point cost and merchant ownership visible", () => {
    expect(rewards).toContain("reward.pointsRequired");
    expect(rewards).toContain("showMerchant && reward.shopName");
  });
});

describe("P1-5 — summary clarity", () => {
  const view = read("src/pages/member/MemberHomePage.tsx");

  it("aggregate is labelled as across-merchants, not pooled", () => {
    expect(t("en", "memberSummaryTotal")).toBe("Points across merchants");
    expect(view).toContain('t(lang, "memberSummaryTotal")');
    expect(view).toContain('t(lang, "memberSummaryDisclaimer")');
    expect(view).not.toContain('"Total points"');
  });

  it("renders a per-merchant breakdown row", () => {
    expect(view).toContain('data-testid="member-summary-breakdown"');
    expect(view).toContain("activeAccounts.map");
  });
});

describe("P1-6 — Account repositioned below loyalty content", () => {
  const page = read("src/pages/member/MemberHomePage.tsx");

  it("Account block renders after the dashboard view, still collapsible and functional", () => {
    const viewAt = page.indexOf("<MemberDashboardView");
    const accountAt = page.indexOf('data-testid="member-account"');
    expect(viewAt).toBeGreaterThan(-1);
    expect(accountAt).toBeGreaterThan(viewAt);
    expect(page).toContain("aria-expanded={accountOpen}");
    expect(page).toContain('data-testid="member-sign-out"');
    expect(page).toContain("signOut");
  });
});

describe("P1-1 — language control on /member", () => {
  const page = read("src/pages/member/MemberHomePage.tsx");

  it("ships the shared cycling language toggle", () => {
    expect(page).toContain('data-testid="member-language-toggle"');
    expect(page).toContain("nextLanguage(lang)");
    expect(page).toContain("languageToggleLabel(lang)");
    // No second language state: the toggle goes through the prop the app owns.
    expect(page).toContain("setLang: (lg: Language) => void");
  });
});

describe("P2 — rewards truncation surfaced", () => {
  it("truncated flag flows to a truthful customer message", () => {
    const page = read("src/pages/member/MemberHomePage.tsx");
    expect(page).toContain("setRewardsTruncated(r.data.truncated)");
    expect(page).toContain("rewardsTruncated={rewardsTruncated}");
    expect(page).toContain('data-testid="member-rewards-truncated"');
    expect(t("en", "rewardsTruncated")).toContain("{limit}");
  });
});

describe("P2 — progressbar accessibility", () => {
  it("promotion and reward bars expose accurate progressbar semantics", () => {
    const page = read("src/pages/member/MemberHomePage.tsx");
    const bars = page.match(/role="progressbar"/g) ?? [];
    expect(bars.length).toBeGreaterThanOrEqual(2);
    for (const required of [
      'aria-valuemin={0}',
      "aria-valuemax={promotion.thresholdUgx}",
      "aria-valuenow={Math.min(",
      "aria-valuemax={reward.pointsRequired}",
      "aria-label=",
    ]) {
      expect(page, `missing ${required}`).toContain(required);
    }
    // The bars are no longer blanket-hidden.
    expect(page).not.toMatch(/role="progressbar"[\s\S]{0,200}aria-hidden/);
  });
});

describe("P2 — wallet configuration probe memoized", () => {
  it("shares one probe across mounts instead of N edge calls", () => {
    const wallet = read("src/lib/loyalty/loyaltyGoogleWallet.ts");
    expect(wallet).toContain("configuredCache");
    expect(wallet).toContain("configuredInflight");
    expect(wallet).toContain("CONFIGURED_OK_TTL_MS");
    expect(wallet).toContain("CONFIGURED_ERR_TTL_MS");
    // Failures are never cached forever.
    expect(wallet).toContain("CONFIGURED_ERR_TTL_MS = 10_000");
    // Callers still go through the cached entry point.
    const memberButton = read("src/components/loyalty/MemberGoogleWalletButton.tsx");
    expect(memberButton).toContain("fetchGoogleWalletConfigured()");
    expect(memberButton).not.toContain("probeGoogleWalletConfigured");
  });
});

describe("dates follow the selected language", () => {
  it("maps each language to an explicit locale and uses it", () => {
    // Phase B extracted the helpers into a shared module so the wallet button
    // formats dates identically; the contract is unchanged.
    const dates = read("src/lib/loyalty/memberDates.ts");
    expect(dates).toContain('en: "en-GB"');
    expect(dates).toContain('lg: "en-UG"');
    expect(dates).toContain('sw: "sw-KE"');
    expect(dates).toContain("toLocaleDateString(DATE_LOCALES[lang]");
    const page = read("src/pages/member/MemberHomePage.tsx");
    expect(page).toContain("formatDay,");
    expect(page).not.toContain('toLocaleDateString("en-GB"');
  });

  it("activity and reward labels come from i18n, not literals", () => {
    expect(t("en", "memberActivityPurchase")).toBe("Purchase — UGX {total}");
    expect(t("en", "memberRewardNeeded")).toContain("{points}");
    expect(t("en", "memberRewardReady")).toBe("Ready to redeem");
  });
});

describe("tTemplate works for composed customer strings", () => {
  it("substitutes balance-style variables", () => {
    const out = tTemplate("en", "memberBenefitPercent", { percent: 10 });
    expect(out).toBe("10% off");
    expect(out).not.toContain("{percent}");
  });
});
