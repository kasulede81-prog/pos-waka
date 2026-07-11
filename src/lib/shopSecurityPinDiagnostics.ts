/** Enterprise diagnostics for Shop Security PIN sync — never log plaintext or hashes. */

export type ShopSecurityPinDiagnosticEvent =
  | "pin_hydrate_start"
  | "pin_hydrate_success"
  | "pin_hydrate_failed"
  | "pin_synced"
  | "pin_migrated"
  | "pin_created"
  | "pin_changed"
  | "pin_cleared"
  | "pin_recovery_applied"
  | "pin_version_conflict";

const LOG_PREFIX = "[waka-shop-security-pin]";

export function logShopSecurityPinEvent(
  event: ShopSecurityPinDiagnosticEvent,
  detail?: Record<string, unknown>,
): void {
  const safe: Record<string, unknown> = { event };
  if (detail) {
    for (const [key, value] of Object.entries(detail)) {
      if (key.toLowerCase().includes("hash") || key.toLowerCase().includes("pin")) continue;
      safe[key] = value;
    }
  }
  console.info(LOG_PREFIX, safe);
}

export function logShopSecurityPinFailure(
  event: ShopSecurityPinDiagnosticEvent,
  detail?: Record<string, unknown>,
): void {
  logShopSecurityPinEvent(event, { ...detail, level: "warn" });
}
