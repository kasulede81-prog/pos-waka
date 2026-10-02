/**
 * Where a scanned code goes (Phase 2).
 *
 * One rule, one place: a DKASU membership code is never a product. Every scan
 * entry point — the HID wedge, the camera, and later NFC — routes through this
 * so the precedence can never drift between them.
 */

import { decodeLoyaltyQrPayload } from "./loyaltyEnrollment";
import { parseProgramCodeFromUrl } from "./loyaltyPublicProgram";

export type ScannedCodeRoute =
  | { kind: "loyalty"; token: string }
  /** A merchant's public Loyalty Program code (WPL2026001) — identifies a SHOP, not a member. */
  | { kind: "program"; programCode: string }
  | { kind: "product"; code: string };

export function routeScannedCode(code: string): ScannedCodeRoute {
  // Member card first: a `DKASU-LOYALTY:` payload is never anything else.
  const token = decodeLoyaltyQrPayload(code);
  if (token) return { kind: "loyalty", token };
  // Then the merchant's program QR, which is a URL containing the code.
  const programCode = parseProgramCodeFromUrl(code);
  if (programCode) return { kind: "program", programCode };
  return { kind: "product", code };
}

export function isLoyaltyScan(code: string): boolean {
  return routeScannedCode(code).kind === "loyalty";
}
