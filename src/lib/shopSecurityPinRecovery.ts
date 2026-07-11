/**
 * Shop Security PIN recovery orchestration (Phase 21.1).
 * Server recovery signal is authoritative — local cache and migration yield to admin clear.
 */

import { getDeviceOnline } from "./deviceOnline";
import { logShopSecurityPinRecoveryStep } from "./shopSecurityPinDiagnostics";

const MIGRATION_BLOCKED_KEY = "waka.shop.security.pin.migrationBlocked.v1";
const RECOVERY_NOTICE_KEY = "waka.shop.security.pin.recoveryNotice.v1";

export type ShopSecurityPinRecoveryTrigger =
  | "app_launch"
  | "app_resume"
  | "owner_login"
  | "cloud_reconnect"
  | "background_sync";

function scopedKey(prefix: string, shopId: string): string {
  return `${prefix}::${shopId}`;
}

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof localStorage !== "undefined") return localStorage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

function readScopedFlag(prefix: string, shopId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(scopedKey(prefix, shopId)) === "1";
  } catch {
    return false;
  }
}

function writeScopedFlag(prefix: string, shopId: string, value: boolean): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const key = scopedKey(prefix, shopId);
    if (value) storage.setItem(key, "1");
    else storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function blockShopSecurityPinMigration(shopId: string, reason: string): void {
  writeScopedFlag(MIGRATION_BLOCKED_KEY, shopId, true);
  logShopSecurityPinRecoveryStep("migration_blocked", { shopId, reason });
}

export function isShopSecurityPinMigrationBlocked(shopId: string): boolean {
  return readScopedFlag(MIGRATION_BLOCKED_KEY, shopId);
}

export function clearShopSecurityPinMigrationBlock(shopId: string): void {
  writeScopedFlag(MIGRATION_BLOCKED_KEY, shopId, false);
}

export function setShopSecurityPinRecoveryNotice(shopId: string, clearedAt: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(scopedKey(RECOVERY_NOTICE_KEY, shopId), clearedAt);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("waka:shop-security-pin-recovery", { detail: { shopId, clearedAt } }),
      );
    }
  } catch {
    /* ignore */
  }
}

export function peekShopSecurityPinRecoveryNotice(shopId: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(scopedKey(RECOVERY_NOTICE_KEY, shopId));
  } catch {
    return null;
  }
}

export function dismissShopSecurityPinRecoveryNotice(shopId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(scopedKey(RECOVERY_NOTICE_KEY, shopId));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("waka:shop-security-pin-recovery-dismissed", { detail: { shopId } }));
    }
  } catch {
    /* ignore */
  }
}

export type ShopSecurityPinRecoveryCycleResult = {
  applied: boolean;
  hydrated: boolean;
  awaitingNewPin: boolean;
};

/** Full recovery pipeline: signal → local clear → migration guard → hydrate → owner notice. */
export async function runShopSecurityPinRecoveryCycle(
  shopId: string,
  reason: ShopSecurityPinRecoveryTrigger,
): Promise<ShopSecurityPinRecoveryCycleResult> {
  if (!shopId) return { applied: false, hydrated: false, awaitingNewPin: false };

  logShopSecurityPinRecoveryStep("recovery_detected", { shopId, reason });

  const { applyShopRecoverySignalsForShop } = await import("./shopRecoverySignals");
  const applied = await applyShopRecoverySignalsForShop(shopId, reason);

  if (applied) {
    blockShopSecurityPinMigration(shopId, "admin_clear");
    logShopSecurityPinRecoveryStep("local_cache_cleared", { shopId, reason });
  }

  let hydrated = false;
  let awaitingNewPin = false;

  if (getDeviceOnline()) {
    const { hydrateShopSecurityPin } = await import("./shopSecurityPinSync");
    const hydrateResult = await hydrateShopSecurityPin(shopId, { force: applied });
    hydrated = hydrateResult !== "offline" && hydrateResult !== "failed";
    logShopSecurityPinRecoveryStep("hydration_complete", { shopId, reason, hydrateResult });

    const { usePosStore } = await import("../store/usePosStore");
    const { isShopSecurityPinConfigured } = await import("./enterpriseSecurity/shopPinSecret");
    const localHash = usePosStore.getState().preferences.backOfficePin;
    awaitingNewPin = !isShopSecurityPinConfigured(localHash);

    if (awaitingNewPin && applied) {
      logShopSecurityPinRecoveryStep("awaiting_new_pin", { shopId, reason });
    }

    if (awaitingNewPin && (applied || peekShopSecurityPinRecoveryNotice(shopId))) {
      const noticeAt = peekShopSecurityPinRecoveryNotice(shopId) ?? new Date().toISOString();
      if (applied) setShopSecurityPinRecoveryNotice(shopId, noticeAt);
    } else if (!awaitingNewPin) {
      dismissShopSecurityPinRecoveryNotice(shopId);
    }
  } else if (applied) {
    logShopSecurityPinRecoveryStep("offline_recovery_applied", { shopId, reason });
    awaitingNewPin = true;
  }

  return { applied, hydrated, awaitingNewPin };
}

/** Resolve current shop and run recovery — safe on launch, resume, reconnect, sync. */
export async function ensureShopSecurityPinRecovery(
  reason: ShopSecurityPinRecoveryTrigger = "app_launch",
): Promise<ShopSecurityPinRecoveryCycleResult> {
  const { hasSupabaseConfig, supabase } = await import("./supabase");
  if (!hasSupabaseConfig || !supabase) {
    return { applied: false, hydrated: false, awaitingNewPin: false };
  }

  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx?.shopId) {
    return { applied: false, hydrated: false, awaitingNewPin: false };
  }

  return runShopSecurityPinRecoveryCycle(ctx.shopId, reason);
}

let recoveryInFlight: Promise<ShopSecurityPinRecoveryCycleResult> | null = null;

/** Coalesce concurrent recovery checks into one in-flight promise. */
export function scheduleShopSecurityPinRecovery(
  reason: ShopSecurityPinRecoveryTrigger,
): Promise<ShopSecurityPinRecoveryCycleResult> {
  if (recoveryInFlight) return recoveryInFlight;
  recoveryInFlight = ensureShopSecurityPinRecovery(reason).finally(() => {
    recoveryInFlight = null;
  });
  return recoveryInFlight;
}
