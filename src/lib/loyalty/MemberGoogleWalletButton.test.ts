import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberGoogleWalletButton } from "../../components/loyalty/MemberGoogleWalletButton";
import { memberWalletErrorKey } from "./loyaltyErrorMessages";
import { memberWalletButtonLabel } from "./memberWalletLabel";
import { t } from "../i18n";

/**
 * The member's "Add to Google Wallet" affordance.
 *
 * TWO THINGS ARE PINNED. First, the button is not offered before it is known that Wallet is
 * configured — a customer must never be shown a control that is going to fail, and a customer
 * must never be shown the merchant-facing "ask DKASU support to set issuer credentials" message,
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
      createElement(MemberGoogleWalletButton, {
        shopId: "shop-1",
        shopName: "Kampala Kiosk",
        lang: "en",
        balancePoints: 100,
      }),
    );
    expect(html).toBe("");
  });

  it("renders nothing for a card with no shop", () => {
    const html = renderToStaticMarkup(
      createElement(MemberGoogleWalletButton, {
        shopId: "  ",
        shopName: "Kampala Kiosk",
        lang: "en",
        balancePoints: 100,
      }),
    );
    expect(html).toBe("");
  });
});

describe("memberWalletButtonLabel — Phase B honest states", () => {
  it("follows what the backend actually knows", () => {
    const base = { lang: "en" as const };
    expect(memberWalletButtonLabel({ ...base, busy: false, issued: false, stale: false })).toBe(
      "Add to Google Wallet",
    );
    expect(memberWalletButtonLabel({ ...base, busy: false, issued: true, stale: false })).toBe(
      "Open in Google Wallet",
    );
    expect(memberWalletButtonLabel({ ...base, busy: false, issued: true, stale: true })).toBe(
      "Update wallet card",
    );
    expect(memberWalletButtonLabel({ ...base, busy: true, issued: false, stale: false })).toBe(
      "Creating your card…",
    );
  });

  it("unknown wallet state (older projection) behaves as Add, never as installed", () => {
    const label = memberWalletButtonLabel({
      lang: "en",
      busy: false,
      issued: false,
      stale: false,
    });
    expect(label).toBe(t("en", "loyaltyWalletMemberAdd"));
    // No state can claim on-device installation: that signal does not exist.
    for (const lang of ["en", "lg", "sw"] as const) {
      expect(t(lang, "memberWalletOpen")).not.toMatch(/install|saved/i);
      expect(t(lang, "memberWalletUpdate")).not.toMatch(/install|saved/i);
    }
  });

  it("resolves every label in en, lg and sw with no raw keys", () => {
    const keys = ["loyaltyWalletMemberCreating", "memberWalletUpdate", "memberWalletOpen", "loyaltyWalletMemberAdd"];
    for (const key of keys) {
      for (const lang of ["en", "lg", "sw"] as const) {
        expect(t(lang, key), `${lang}.${key}`).toBeTruthy();
        expect(t(lang, key), `${lang}.${key}`).not.toBe(key);
      }
    }
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
      createElement(MemberGoogleWalletButton, {
        shopId: "shop-1",
        shopName: "Kampala Kiosk",
        lang: "en",
        balancePoints: 100,
      }),
    );
    expect(html).not.toMatch(/account_id|qr_token|public_card_token|acct_/i);
  });
});
