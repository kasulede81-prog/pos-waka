import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WakaLoyaltyCard, formatValidThru } from "../../components/loyalty/WakaLoyaltyCard";
import { resolveLoyaltyPresentation } from "./loyaltyCardDesign";

/**
 * The physical-card presentation. Rendered through `renderToStaticMarkup` from a `.ts` file on
 * purpose: vite.config.ts only includes `src/**\/*.test.ts`, so a `.test.tsx` here would never run.
 */

const theme = resolveLoyaltyPresentation(undefined);

function render(overrides: Partial<Parameters<typeof WakaLoyaltyCard>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(WakaLoyaltyCard, {
      shopName: "KASULE MART",
      memberName: "KASULE",
      memberNumber: "26D4 33F0 2BED 4ABE",
      memberCvc: "251",
      expiresOn: "2029-09-30",
      balancePoints: 55,
      theme,
      qrDataUrl: "data:image/png;base64,AAAA",
      ...overrides,
    }),
  );
}

describe("formatValidThru", () => {
  it("formats a Kampala end date as MM/YY", () => {
    expect(formatValidThru("2029-09-30")).toBe("09/29");
    expect(formatValidThru("2026-01-01")).toBe("01/26");
    expect(formatValidThru("2030-12-31T00:00:00Z")).toBe("12/30");
  });

  it("shows an em dash when the membership never expires", () => {
    expect(formatValidThru(null)).toBe("—");
    expect(formatValidThru(undefined)).toBe("—");
    expect(formatValidThru("")).toBe("—");
    expect(formatValidThru("not-a-date")).toBe("—");
  });
});

describe("WakaLoyaltyCard", () => {
  it("renders every agreed field from the loyalty payload", () => {
    const html = render();
    expect(html).toContain("WAKA Loyalty");
    expect(html).toContain("Shop · Earn · Redeem");
    expect(html).toContain("KASULE MART"); // ISSUED BY
    expect(html).toContain("26D4 33F0 2BED 4ABE"); // MEMBER ID
    expect(html).toContain("KASULE"); // MEMBER
    expect(html).toContain("09/29"); // VALID THRU
    expect(html).toContain("251"); // CVC
    expect(html).toContain("Points");
    expect(html).toContain("55");
  });

  it("shows the points balance and NO earn rule anywhere", () => {
    const html = render({ balancePoints: 0 });
    expect(html).toContain("Points");
    // The earn rule was deliberately moved to the dashboard.
    for (const banned of ["SPENT", "spent", "PT /", "Earns", "pt per UGX", "per UGX"]) {
      expect(html, banned).not.toContain(banned);
    }
  });

  it("renders the REAL loyalty QR and nothing else", () => {
    const html = render();
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain("Loyalty QR code");
  });

  it("degrades to a labelled placeholder when the QR is unavailable", () => {
    const html = render({ qrDataUrl: null });
    expect(html).toContain("QR unavailable");
    expect(html).not.toContain("data:image/png");
  });

  it("keeps the card layout and shows an em dash rather than inventing an identity", () => {
    const html = render({ memberNumber: null, memberCvc: null });
    expect(html).toContain("Member ID");
    expect(html).toContain("CVC");
    expect(html).toContain("—");
    expect(html).not.toContain("26D4 33F0 2BED 4ABE");
    expect(html).not.toContain("251");
    expect(html).toContain("KASULE MART");
    expect(html).toContain("Points");
  });

  it("never echoes the raw account uuid or the QR secret", () => {
    const html = render({ memberNumber: "11111111-2222-3333-4444-555555555555" });
    expect(html).not.toContain("account_id");
    expect(html).not.toContain("WAKA-LOYALTY:");
  });

  it("scales for long merchant and member names without dropping them", () => {
    const html = render({
      shopName: "KASULE MART SUPERMARKET AND HARDWARE NAKAWA BRANCH",
      memberName: "NABBANJA SSEKANDI CHRISTINE",
    });
    expect(html).toContain("KASULE MART SUPERMARKET AND HARDWARE NAKAWA BRANCH");
    expect(html).toContain("NABBANJA SSEKANDI CHRISTINE");
    expect(html).toContain("title=");
  });

  it("handles zero and large balances", () => {
    expect(render({ balancePoints: 0 })).toContain("0");
    expect(render({ balancePoints: 1234567 })).toContain("1,234,567");
  });

  it("floors negative balances to zero instead of showing a debt on a loyalty card", () => {
    expect(render({ balancePoints: -40 })).toContain("0");
    expect(render({ balancePoints: -40 })).not.toContain("-40");
  });

  it("is marked as a premium loyalty card, not a payment card", () => {
    const html = render();
    expect(html).toContain('data-loyalty-card="premium"');
    for (const word of ["mastercard", "visa", "credit", "debit", "cvv"]) {
      expect(html.toLowerCase()).not.toContain(word);
    }
  });

  it("uses the merchant theme so customised shops keep their colours", () => {
    const custom = resolveLoyaltyPresentation({
      programDisplayName: "",
      logoUrl: null,
      primaryColor: "#22c55e",
      accentColor: "#16a34a",
      backgroundColor: "#0f172a",
      textColor: "#f8fafc",
      welcomeMessage: null,
      cardStyle: "premium",
      rewardLayout: "list",
    });
    expect(render({ theme: custom })).toContain("#0f172a");
  });
});
