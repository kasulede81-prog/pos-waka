import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_LOYALTY_CARD_DESIGN,
  draftFromDesign,
  mergeDesignWithDefaults,
  normalizeHexColor,
  normalizeLogoUrl,
  validateDesignDraft,
  type LoyaltyCardDesignDraft,
} from "./loyaltyCardDesign";
import { PublicLoyaltyCardView } from "../../components/loyalty/public/PublicLoyaltyCardView";
import type { PublicCardData } from "./loyaltyPublicCard";

describe("loyaltyCardDesign validators", () => {
  it("accepts only #RRGGBB hex colors", () => {
    expect(normalizeHexColor("#F59E0B")).toBe("#f59e0b");
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor("url(x)")).toBeNull();
    expect(normalizeHexColor("linear-gradient(red,blue)")).toBeNull();
    expect(normalizeHexColor("#fff")).toBeNull();
  });

  it("rejects unsafe logo URLs including SVG and non-https", () => {
    expect(normalizeLogoUrl("https://cdn.example.com/logo.png")).toBe(
      "https://cdn.example.com/logo.png",
    );
    expect(normalizeLogoUrl("http://cdn.example.com/logo.png")).toBeNull();
    expect(normalizeLogoUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLogoUrl("data:image/png;base64,abc")).toBeNull();
    expect(normalizeLogoUrl("https://cdn.example.com/logo.svg")).toBeNull();
    expect(normalizeLogoUrl("https://user:pass@cdn.example.com/logo.png")).toBeNull();
  });

  it("rejects oversized text and invalid style enums", () => {
    const draft: LoyaltyCardDesignDraft = {
      ...draftFromDesign(DEFAULT_LOYALTY_CARD_DESIGN),
      programDisplayName: "x".repeat(61),
    };
    expect(validateDesignDraft(draft)).toBe("invalid_program_name");

    const welcome: LoyaltyCardDesignDraft = {
      ...draftFromDesign(DEFAULT_LOYALTY_CARD_DESIGN),
      welcomeMessage: "y".repeat(121),
    };
    expect(validateDesignDraft(welcome)).toBe("invalid_welcome_message");

    const badStyle = {
      ...draftFromDesign(DEFAULT_LOYALTY_CARD_DESIGN),
      cardStyle: "neon" as LoyaltyCardDesignDraft["cardStyle"],
    };
    expect(validateDesignDraft(badStyle)).toBe("invalid_card_style");
  });

  it("merges null stored design with defaults", () => {
    const merged = mergeDesignWithDefaults(null, "Kampala");
    expect(merged.programDisplayName).toBe("Kampala Loyalty");
    expect(merged.primaryColor).toBe(DEFAULT_LOYALTY_CARD_DESIGN.primaryColor);
    expect(merged.cardStyle).toBe("classic");
  });
});

describe("PublicLoyaltyCardView design presentation", () => {
  const baseCard: PublicCardData = {
    customer_name: "Denis",
    shop_name: "Kampala Kiosk",
    program_name: "Kampala Kiosk Loyalty",
    balance_points: 405,
    account_active: true,
    program_enabled: true,
    membership_active: true,
    membership_expires_on: null,
    qr_payload: "WAKA-LOYALTY:preview",
    rewards: [{ name: "Sugar", points_required: 100, description: null }],
    your_rewards: [],
    wallet_configured: true,
  };

  it("still renders B1 layout when design is undefined", () => {
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={() => undefined}
        onSharePage={() => undefined}
      />,
    );
    expect(html).toContain("Denis");
    expect(html).toContain("405");
    expect(html).toContain("Kampala Kiosk Loyalty");
    expect(html).toContain("#0b3a82");
    expect(html).toContain("#f97316");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders merchant text as escaped text (XSS payloads)", () => {
    const design = mergeDesignWithDefaults({
      program_display_name: "<script>alert(1)</script>",
      welcome_message: '<img src=x onerror=alert(1)>',
      primary_color: "#112233",
      accent_color: "#445566",
      background_color: "#0c0a09",
      text_color: "#fafaf9",
      card_style: "classic",
      reward_layout: "list",
      logo_url: null,
    });
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard}
        design={design}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={() => undefined}
        onSharePage={() => undefined}
      />,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/onerror\s*=/);
  });

  it("preview mode hides action buttons and uses local design", () => {
    const design = mergeDesignWithDefaults({
      program_display_name: "Custom Loyalty",
      welcome_message: "Welcome back",
      primary_color: "#abcdef",
      card_style: "premium",
      reward_layout: "cards",
    });
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard}
        design={design}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={() => undefined}
        onSharePage={() => undefined}
        previewMode
      />,
    );
    expect(html).toContain("Custom Loyalty");
    expect(html).toContain("Welcome back");
    expect(html).not.toContain("Add to Google Wallet");
    expect(html).not.toContain("Share my loyalty card");
  });
});
