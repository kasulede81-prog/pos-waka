import { describe, expect, it } from "vitest";
import {
  assertSafePublicCardJson,
  encodeLoyaltyQrPayload,
  isValidPublicCardTokenFormat,
  LOYALTY_QR_PREFIX,
} from "../../../supabase/functions/_shared/loyaltyWallet/publicCardTypes.ts";
import {
  assertClientSafePublicCard,
  buildCustomerLoyaltyCardUrl,
  isValidPublicCardTokenFormat as clientTokenFormat,
} from "./loyaltyPublicCard";
import {
  CUSTOMER_PAGE_SHARE_INTRO,
  buildCustomerPageShareText,
  buildCustomerPageWhatsAppHref,
} from "./loyaltyPublicCardShare";

const VALID_TOKEN = "a".repeat(64);
const QR_TOKEN = "opaque-qr-token-xyz";

describe("public card token format", () => {
  it("accepts 64 hex chars", () => {
    expect(isValidPublicCardTokenFormat(VALID_TOKEN)).toBe(true);
    expect(clientTokenFormat(VALID_TOKEN.toUpperCase())).toBe(true);
  });

  it("rejects short, empty, or non-hex tokens", () => {
    expect(isValidPublicCardTokenFormat("")).toBe(false);
    expect(isValidPublicCardTokenFormat("abc")).toBe(false);
    expect(isValidPublicCardTokenFormat("g".repeat(64))).toBe(false);
    expect(isValidPublicCardTokenFormat(`${"a".repeat(63)}!`)).toBe(false);
  });
});

describe("QR payload remains POS identity", () => {
  it("encodes WAKA-LOYALTY:<qr_token> unchanged", () => {
    expect(encodeLoyaltyQrPayload(QR_TOKEN)).toBe(`${LOYALTY_QR_PREFIX}${QR_TOKEN}`);
    expect(encodeLoyaltyQrPayload(QR_TOKEN)).toBe(`WAKA-LOYALTY:${QR_TOKEN}`);
  });
});

describe("assertSafePublicCardJson", () => {
  it("allows safe public fields", () => {
    expect(() =>
      assertSafePublicCardJson({
        ok: true,
        customer_name: "Amina",
        shop_name: "Kampala Kiosk",
        balance_points: 10,
        qr_payload: `WAKA-LOYALTY:${QR_TOKEN}`,
      }),
    ).not.toThrow();
  });

  it("rejects phone, email, internal ids, tokens, save_url", () => {
    for (const key of [
      "phone",
      "email",
      "customer_id",
      "account_id",
      "shop_id",
      "qr_token",
      "public_card_token",
      "save_url",
    ]) {
      expect(() => assertSafePublicCardJson({ ok: true, [key]: "x" })).toThrow(/unsafe/);
      expect(() => assertClientSafePublicCard({ ok: true, [key]: "x" })).toThrow(/unsafe/);
    }
  });
});

describe("customer loyalty page URL", () => {
  it("builds pos.waka.ug/loyalty/<token> and not a Google Save URL", () => {
    const url = buildCustomerLoyaltyCardUrl(VALID_TOKEN);
    expect(url).toBe(`https://pos.waka.ug/loyalty/${VALID_TOKEN}`);
    expect(url).not.toContain("pay.google.com");
    expect(url).not.toContain("/save/");
  });

  it("share text uses page URL not Save URL", () => {
    const pageUrl = buildCustomerLoyaltyCardUrl(VALID_TOKEN);
    const text = buildCustomerPageShareText(pageUrl);
    expect(text).toContain(CUSTOMER_PAGE_SHARE_INTRO);
    expect(text).toContain(pageUrl);
    expect(text).not.toContain("pay.google.com");
    const wa = buildCustomerPageWhatsAppHref(pageUrl);
    expect(wa).toContain(encodeURIComponent(pageUrl).slice(0, 20));
  });
});
