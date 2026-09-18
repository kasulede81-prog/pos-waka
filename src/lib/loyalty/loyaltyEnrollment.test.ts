import { describe, expect, it } from "vitest";
import {
  LOYALTY_QR_PREFIX,
  decodeLoyaltyQrPayload,
  encodeLoyaltyQrPayload,
} from "./loyaltyEnrollment";

/**
 * Phase 05 — Membership QR payload encoding. The QR carries ONLY the opaque
 * `qr_token` behind a `WAKA-LOYALTY:` prefix so POS scanners can tell loyalty
 * codes apart from product barcodes; no personal data is embedded.
 */

describe("loyalty QR payload", () => {
  it("round-trips a token", () => {
    const token = "abc123token";
    const payload = encodeLoyaltyQrPayload(token);
    expect(payload.startsWith(LOYALTY_QR_PREFIX)).toBe(true);
    expect(decodeLoyaltyQrPayload(payload)).toBe(token);
  });

  it("accepts surrounding whitespace when decoding", () => {
    expect(decodeLoyaltyQrPayload(`  ${LOYALTY_QR_PREFIX}tok456  `)).toBe("tok456");
  });

  it("rejects product-barcodes and foreign prefixes", () => {
    expect(decodeLoyaltyQrPayload("7601234567890")).toBeNull();
    expect(decodeLoyaltyQrPayload("WIFI:somedata;;")).toBeNull();
    expect(decodeLoyaltyQrPayload("")).toBeNull();
  });

  it("returns null for a prefix with an empty token", () => {
    expect(decodeLoyaltyQrPayload(LOYALTY_QR_PREFIX)).toBeNull();
    expect(decodeLoyaltyQrPayload(`${LOYALTY_QR_PREFIX}   `)).toBeNull();
  });
});
