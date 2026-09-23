/**
 * Where a scanned code goes (Phase 2).
 *
 * One rule, one place: a WAKA membership code is never a product. Every scan
 * entry point — the HID wedge, the camera, and later NFC — routes through this
 * so the precedence can never drift between them.
 */

import { decodeLoyaltyQrPayload } from "./loyaltyEnrollment";

export type ScannedCodeRoute =
  | { kind: "loyalty"; token: string }
  | { kind: "product"; code: string };

export function routeScannedCode(code: string): ScannedCodeRoute {
  const token = decodeLoyaltyQrPayload(code);
  if (token) return { kind: "loyalty", token };
  return { kind: "product", code };
}

export function isLoyaltyScan(code: string): boolean {
  return routeScannedCode(code).kind === "loyalty";
}
