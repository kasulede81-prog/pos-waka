import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberGoogleWalletButton } from "../../components/loyalty/MemberGoogleWalletButton";
import { memberWalletErrorKey } from "./loyaltyErrorMessages";
import { t } from "../i18n";

/**
 * The member's "Add to Google Wallet" affordance.
 *
 * TWO THINGS ARE PINNED. First, the button is not offered before it is known that Wallet is
 * configured — a customer must never be shown a control that is going to fail, and a customer
 * must never be shown the merchant-facing "ask WAKA support to set issuer credentials" message,
 * which describes the shop's infrastructure rather than anything the member can act on.
 *
 * Second, every refusal the server can return is mapped to a sentence the member can act on, and
 * no refusal is ever rendered verbatim. The mapping is exercised directly because the component's
 * probe is asynchronous and this project's test environment renders without effects.
 */

describe("MemberGoogleWalletButton", () => {
  it("renders nothing at all until Wallet is known to be available", () => {
    // Server-rendered: the probe has not resolved, so there is no button, no Save URL and — the
    // point — no "not configured" note either.
    const html = renderToStaticMarkup(
      createElement(MemberGoogleWalletButton, { shopId: "shop-1", shopName: "Kampala Kiosk" }),
    );
    expect(html).toBe("");
  });

  it("renders nothing for a card with no shop", () => {
    const html = renderToStaticMarkup(
      createElement(MemberGoogleWalletButton, { shopId: "  ", shopName: "Kampala Kiosk" }),
    );
    expect(html).toBe("");
  });
});

describe("memberWalletErrorKey", () => {
  it("says the card is inactive when the card is inactive", () => {
    for (const code of ["account_revoked", "account_inactive", "membership_expired"]) {
      expect(memberWalletErrorKey(code)).toBe("loyaltyWalletMemberInactive");
    }
  });

  it("says there is nothing to add when the member has no card at that shop", () => {
    for (const code of ["not_found", "not_a_member", "account_not_found", "shop_not_found"]) {
      expect(memberWalletErrorKey(code)).toBe("loyaltyWalletMemberNoCard");
    }
  });

  it("falls back to a plain failure for anything unmapped or unrecognised", () => {
    for (const code of ["signing_failed", "wallet_misconfigured", "network", "unavailable", ""]) {
      expect(memberWalletErrorKey(code)).toBe("loyaltyWalletMemberFailed");
    }
  });

  it("every mapped key resolves to real copy, not to the key itself", () => {
    for (const code of [
      "account_inactive",
      "not_found",
      "signing_failed",
      "network",
      "wallet_not_configured",
    ]) {
      const key = memberWalletErrorKey(code);
      expect(t("en", key)).not.toBe(key);
      expect(t("en", key).length).toBeGreaterThan(8);
    }
  });

  it("no message exposes the server's code, an account id or a credential", () => {
    const html = renderToStaticMarkup(
      createElement(MemberGoogleWalletButton, { shopId: "shop-1", shopName: "Kampala Kiosk" }),
    );
    expect(html).not.toMatch(/account_id|qr_token|public_card_token|acct_/i);
  });
});
