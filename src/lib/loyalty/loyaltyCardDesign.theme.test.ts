import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicLoyaltyCardView } from "../../components/loyalty/public/PublicLoyaltyCardView";
import {
  DEFAULT_LOYALTY_CARD_DESIGN,
  contrastSafeAccentOnBackground,
  contrastSafeForeground,
  mergeDesignWithDefaults,
  resolveLoyaltyPresentation,
} from "./loyaltyCardDesign";
import type { PublicCardData } from "./loyaltyPublicCard";

describe("WAKA loyalty default theme", () => {
  it("defaults to premium navy + orange accents + white text", () => {
    expect(DEFAULT_LOYALTY_CARD_DESIGN.backgroundColor).toBe("#0b1a2e");
    expect(DEFAULT_LOYALTY_CARD_DESIGN.primaryColor).toBe("#f97316");
    expect(DEFAULT_LOYALTY_CARD_DESIGN.accentColor).toBe("#ea580c");
    expect(DEFAULT_LOYALTY_CARD_DESIGN.textColor).toBe("#ffffff");
  });

  it("derives contrast-safe hero foreground when merchant text fails AA", () => {
    expect(contrastSafeForeground("#0b3a82", "#ffffff")).toBe("#ffffff");
    expect(contrastSafeForeground("#facc15", "#fde047")).toBe("#1c1917");
    expect(contrastSafeForeground("#ffffff", "#fafafa")).toBe("#1c1917");
  });

  it("keeps orange accent on blue hero; replaces collapsed accent", () => {
    expect(contrastSafeAccentOnBackground("#0b3a82", "#f97316")).toBe("#f97316");
    expect(contrastSafeAccentOnBackground("#0b3a82", "#0b3a82")).toBe("#f97316");
  });

  it("resolveLoyaltyPresentation always yields a full theme", () => {
    const theme = resolveLoyaltyPresentation(undefined);
    expect(theme.backgroundColor).toBe("#0b1a2e");
    expect(theme.heroForeground).toBe("#ffffff");
    expect(theme.heroAccent).toBe("#f97316");
    // The default style is the physical-card layout; a saved shop design keeps its own.
    expect(theme.cardStyle).toBe("premium");
  });

  it("applies default WAKA theme when design is omitted", () => {
    const card: PublicCardData = {
      customer_name: "Denis",
      member_number: "26D4 33F0 2BED 4ABE",
      member_cvc: "251",
      shop_name: "Kampala Kiosk",
      program_name: "Kampala Kiosk Loyalty",
      balance_points: 405,
      account_active: true,
      program_enabled: true,
    membership_active: true,
    membership_expires_on: null,
      qr_payload: "WAKA-LOYALTY:preview",
      rewards: [],
      your_rewards: [],
      wallet_configured: true,
    };
    const html = renderToStaticMarkup(
      createElement(PublicLoyaltyCardView, {
        card,
        qrDataUrl: null,
        walletBusy: false,
        walletMessage: null,
        walletError: null,
        onAddToWallet: () => undefined,
        onSharePage: () => undefined,
      }),
    );
    expect(html).toContain("#0b1a2e");
    expect(html).toContain("#f97316");
    expect(html).toContain("Denis");
    // Premium card surfaces the derived identity, the real balance, and no earn rule.
    expect(html).toContain("26D4 33F0 2BED 4ABE");
    expect(html).toContain("251");
    expect(html).toContain("405");
    expect(html).not.toContain("account_id");
    expect(html).not.toContain("per UGX");
  });

  it("preserves merchant custom colors when contrast is safe", () => {
    const design = mergeDesignWithDefaults({
      primary_color: "#22c55e",
      accent_color: "#16a34a",
      background_color: "#0f172a",
      text_color: "#f8fafc",
    });
    const theme = resolveLoyaltyPresentation(design);
    expect(theme.backgroundColor).toBe("#0f172a");
    expect(theme.heroForeground).toBe("#f8fafc");
    expect(theme.heroAccent).toBe("#22c55e");
  });
});
