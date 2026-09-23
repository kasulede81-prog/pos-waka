import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicLoyaltyCardView } from "../../components/loyalty/public/PublicLoyaltyCardView";
import type { PublicCardData } from "./loyaltyPublicCard";

const baseCard = (over: Partial<PublicCardData> = {}): PublicCardData => ({
  customer_name: "Denis",
  shop_name: "Kampala Kiosk",
  program_name: "Kampala Kiosk Loyalty",
  balance_points: 405,
  account_active: true,
  program_enabled: true,
  qr_payload: "WAKA-LOYALTY:qr-stable-token",
  rewards: [
    { name: "1kg Sugar", points_required: 300, description: "1kg sugar bag" },
    { name: "Free soda", points_required: 500, description: null },
  ],
  wallet_configured: true,
  ...over,
});

describe("PublicLoyaltyCardView (B1)", () => {
  const noop = () => undefined;

  it("renders customer name, points, shop, and program", () => {
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard()}
        qrDataUrl="data:image/png;base64,abc"
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={noop}
        onSharePage={noop}
      />,
    );
    expect(html).toContain("Denis");
    expect(html).toContain("405");
    expect(html).toContain("Kampala Kiosk");
    expect(html).toContain("Kampala Kiosk Loyalty");
    expect(html).toContain("aria-label=\"405 points\"");
  });

  it("shows affordable progress and available/locked rewards", () => {
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard()}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={noop}
        onSharePage={noop}
      />,
    );
    expect(html).toContain("You have enough points for 1kg Sugar");
    expect(html).toContain("1kg Sugar");
    expect(html).toContain("Free soda");
    expect(html).toContain("Available");
    expect(html).toContain("Need more points");
    expect(html).toContain("Ask the shop to redeem at checkout");
  });

  it("shows points-away progress when balance is insufficient", () => {
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard({ balance_points: 405, rewards: [{ name: "Free soda", points_required: 500, description: null }] })}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={noop}
        onSharePage={noop}
      />,
    );
    expect(html).toContain("95 points to your next reward");
  });

  it("hides progress and shows empty rewards copy when no rewards", () => {
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard({ rewards: [] })}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={noop}
        onSharePage={noop}
      />,
    );
    expect(html).not.toContain("You have enough points");
    expect(html).not.toContain("points to your next reward");
    expect(html).toContain("You&#x27;re all set.");
    expect(html).toContain("Keep shopping to unlock rewards.");
  });

  it("renders QR from provided data URL without changing payload semantics", () => {
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard()}
        qrDataUrl="data:image/png;base64,qr-img"
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={noop}
        onSharePage={noop}
      />,
    );
    expect(html).toContain("data:image/png;base64,qr-img");
    expect(html).toContain("Show this QR at checkout to collect your points.");
    // View never embeds qr_token or public token
    expect(html).not.toMatch(/public_card_token|qr-stable-token/i);
  });

  it("shows Wallet only when configured; Share always", () => {
    const withWallet = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard({ wallet_configured: true })}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={noop}
        onSharePage={noop}
      />,
    );
    expect(withWallet).toContain("Add to Google Wallet");
    expect(withWallet).toContain("Share my loyalty card");

    const withoutWallet = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard({ wallet_configured: false })}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={noop}
        onSharePage={noop}
      />,
    );
    expect(withoutWallet).not.toContain("Add to Google Wallet");
    expect(withoutWallet).toContain("Share my loyalty card");
  });

  it("hides Wallet when account is inactive even if configured", () => {
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard({ wallet_configured: true, account_active: false })}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={noop}
        onSharePage={noop}
      />,
    );
    expect(html).toContain("Account inactive");
    expect(html).not.toContain("Add to Google Wallet");
    expect(html).toContain("Share my loyalty card");
  });

  it("does not render a redeem action", () => {
    const html = renderToStaticMarkup(
      <PublicLoyaltyCardView
        card={baseCard()}
        qrDataUrl={null}
        walletBusy={false}
        walletMessage={null}
        walletError={null}
        onAddToWallet={vi.fn()}
        onSharePage={vi.fn()}
      />,
    );
    expect(html.toLowerCase()).not.toMatch(/>\s*redeem\s*</);
    expect(html).not.toContain("loyalty.redeem");
  });
});
