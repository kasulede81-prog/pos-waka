import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOYALTY_QR_PREFIX,
  decodeLoyaltyQrPayload,
  encodeLoyaltyQrPayload,
} from "./loyaltyEnrollment";
import { isLoyaltyScan, routeScannedCode } from "./loyaltyScanRouting";

/**
 * Phase 2 — a membership code scanned at the till must never be treated as a
 * product barcode, and product scanning must keep behaving exactly as before.
 */

const ROOT = process.cwd();
const POS_PAGE = readFileSync(resolve(ROOT, "src/pages/PosPage.tsx"), "utf8");
const SELL_SCANNER = readFileSync(resolve(ROOT, "src/hooks/useSellBarcodeScanner.ts"), "utf8");

describe("loyalty QR payload round-trip", () => {
  it("encodes with the WAKA-LOYALTY prefix and decodes back to the raw token", () => {
    const payload = encodeLoyaltyQrPayload("abc123");
    expect(payload).toBe(`${LOYALTY_QR_PREFIX}abc123`);
    expect(decodeLoyaltyQrPayload(payload)).toBe("abc123");
  });

  it("tolerates the surrounding whitespace a wedge scanner adds", () => {
    expect(decodeLoyaltyQrPayload(`  ${LOYALTY_QR_PREFIX}tok  `)).toBe("tok");
  });
});

describe("routeScannedCode — loyalty always wins over the catalog", () => {
  it("routes a membership code to loyalty, carrying the bare token", () => {
    expect(routeScannedCode(encodeLoyaltyQrPayload("tok-1"))).toEqual({
      kind: "loyalty",
      token: "tok-1",
    });
  });

  it.each([
    ["a plain EAN-13 product barcode", "5449000000996"],
    ["a numeric SKU", "0000000000000"],
    ["another system's prefixed code", "OTHER-SYSTEM:abc123"],
    ["an empty scan", ""],
  ])("routes %s to the product catalog", (_name, code) => {
    expect(routeScannedCode(code)).toEqual({ kind: "product", code });
  });

  it("does not claim the bare prefix with no token — that is not an identity", () => {
    expect(routeScannedCode(LOYALTY_QR_PREFIX).kind).toBe("product");
    expect(routeScannedCode(`${LOYALTY_QR_PREFIX}   `).kind).toBe("product");
  });

  it("does not claim a product barcode that merely contains the prefix mid-string", () => {
    expect(isLoyaltyScan(`123${LOYALTY_QR_PREFIX}456`)).toBe(false);
  });

  it("is case-sensitive, so a lookalike code cannot impersonate a membership", () => {
    expect(isLoyaltyScan("waka-loyalty:tok-1")).toBe(false);
  });
});

/**
 * The precedence only matters if every scan entry point actually applies it.
 * These guard the wiring the same way the repo's other architecture tests do.
 */
describe("every scan entry point applies the rule before the catalog lookup", () => {
  it("the shared sell scanner claims loyalty before findProductByBarcode", () => {
    const claimIdx = SELL_SCANNER.indexOf("onLoyaltyScanned?.(code)");
    const productIdx = SELL_SCANNER.indexOf("findProductByBarcode(products, code)");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(productIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeLessThan(productIdx);
  });

  it("both PosPage scan paths (wedge + camera) claim loyalty first", () => {
    const claims = [...POS_PAGE.matchAll(/if \(claimLoyaltyScan\(code\)\)/g)];
    expect(claims).toHaveLength(2);

    // Each claim must sit before the product lookup that follows it.
    const lookups = [...POS_PAGE.matchAll(/findProductByBarcode\(products, code\)/g)];
    expect(lookups).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      expect(claims[i]!.index).toBeLessThan(lookups[i]!.index!);
    }
  });

  it("PosPage routes through the shared rule rather than re-implementing it", () => {
    expect(POS_PAGE).toMatch(/isLoyaltyScan\(code\)/);
  });
});
