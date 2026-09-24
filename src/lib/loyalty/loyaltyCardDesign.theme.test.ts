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
  it("defaults to blue hero + orange accents + white text", () => {
    expect(DEFAULT_LOYALTY_CARD_DESIGN.backgroundColor).toBe("#0b3a82");
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
    expect(theme.backgroundColor).toBe("#0b3a82");
    expect(theme.heroForeground).toBe("#ffffff");
    expect(theme.heroAccent).toBe("#f97316");
  });

  it("applies default WAKA theme when design is omitted", () => {
    const card: PublicCardData = {
      customer_name: "Denis",
      shop_name: "Kampala Kiosk",
      program_name: "Kampala Kiosk Loyalty",
      balance_points: 405,
      account_active: true,
      program_enabled: true,
    membership_active: true,
    membership_expires_on: null,
      qr_payload: "WAKA-LOYALTY:preview",
      rewards: [],
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
    expect(html).toContain("#0b3a82");
    expect(html).toContain("#f97316");
    expect(html).toContain("Denis");
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
