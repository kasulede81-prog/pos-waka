/**
 * Shop Security PIN cloud synchronization — dedicated path (Phase 20.4).
 * Server stores Argon2id hash only; local preferences.backOfficePin is offline cache.
 */

import { getOrCreateDeviceId } from "./deviceId";
import { getDeviceOnline } from "./deviceOnline";
import {
  isShopPinHash,
  isShopSecurityPinConfigured,
  migrateShopPinIfPlaintext,
} from "./enterpriseSecurity/shopPinSecret";
import {
  logShopSecurityPinEvent,
  logShopSecurityPinFailure,
} from "./shopSecurityPinDiagnostics";
import {
  clearShopSecurityPinMigrationBlock,
  isShopSecurityPinMigrationBlocked,
} from "./shopSecurityPinRecovery";
import { supabase } from "./supabase";

const CACHE_KEY = "waka.shop.security.pin.cache.v1";

export type ShopSecurityPinCloudState = {
  configured: boolean;
  pinHash: string | null;
  version: number;
  updatedAt: string | null;
};

type LocalPinCache = {
  shopId: string;
  version: number;
  updatedAt: string | null;
  syncedAt: string;
};

export type ShopSecurityPinHydrateResult =
  | "unchanged"
  | "synced"
  | "cleared"
  | "migrated"
  | "offline"
  | "failed";

function readLocalCache(shopId: string): LocalPinCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalPinCache;
    if (parsed.shopId !== shopId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalCache(shopId: string, version: number, updatedAt: string | null): void {
  if (typeof window === "undefined") return;
  const entry: LocalPinCache = {
    shopId,
    version,
    updatedAt,
    syncedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

export function clearLocalShopSecurityPinCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function parseCloudState(data: unknown): ShopSecurityPinCloudState | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (r.ok !== true) return null;
  const pinHash = r.pin_hash != null ? String(r.pin_hash) : null;
  return {
    configured: r.configured === true || Boolean(pinHash && isShopPinHash(pinHash)),
    pinHash: pinHash && isShopPinHash(pinHash) ? pinHash : null,
    version: typeof r.version === "number" ? r.version : Number(r.version ?? 0) || 0,
    updatedAt: r.updated_at != null ? String(r.updated_at) : null,
  };
}

export async function fetchShopSecurityPinFromCloud(
  shopId: string,
): Promise<ShopSecurityPinCloudState | null> {
  if (!shopId || !supabase) return null;
  const { data, error } = await supabase.rpc("shop_security_pin_get", {
    p_shop_id: shopId,
    p_device_fingerprint: getOrCreateDeviceId(),
  });
  if (error) {
    logShopSecurityPinFailure("pin_hydrate_failed", { shopId, reason: error.message });
    return null;
  }
  if (data && typeof data === "object" && (data as { ok?: boolean }).ok === false) {
    const err = String((data as { error?: string }).error ?? "unknown");
    logShopSecurityPinFailure("pin_hydrate_failed", { shopId, reason: err });
    return null;
  }
  return parseCloudState(data);
}

async function applyCloudStateToLocal(
  shopId: string,
  cloud: ShopSecurityPinCloudState,
): Promise<void> {
  const { usePosStore, flushPendingPersist } = await import("../store/usePosStore");
  usePosStore.setState((s) => ({
    preferences: {
      ...s.preferences,
      backOfficePin: cloud.configured ? cloud.pinHash : null,
    },
  }));
  writeLocalCache(shopId, cloud.version, cloud.updatedAt);
  flushPendingPersist();
  logShopSecurityPinEvent("pin_synced", { shopId, version: cloud.version, configured: cloud.configured });
}

export async function migrateLocalShopSecurityPinToCloud(shopId: string): Promise<boolean> {
  if (!shopId || !supabase || !getDeviceOnline()) return false;

  if (isShopSecurityPinMigrationBlocked(shopId)) {
    logShopSecurityPinEvent("pin_migration_blocked", { shopId, reason: "recovery_authoritative" });
    return false;
  }

  const { usePosStore } = await import("../store/usePosStore");
  let localHash = usePosStore.getState().preferences.backOfficePin;
  if (!localHash) return false;

  const migrated = await migrateShopPinIfPlaintext(localHash);
  if (migrated) {
    localHash = migrated;
    usePosStore.setState((s) => ({
      preferences: { ...s.preferences, backOfficePin: migrated },
    }));
  }

  if (!isShopSecurityPinConfigured(localHash) || !isShopPinHash(localHash)) {
    return false;
  }

  const { data, error } = await supabase.rpc("shop_security_pin_migrate", {
    p_shop_id: shopId,
    p_pin_hash: localHash,
    p_device_fingerprint: getOrCreateDeviceId(),
  });

  if (error) {
    logShopSecurityPinFailure("pin_hydrate_failed", { shopId, reason: error.message, phase: "migrate" });
    return false;
  }

  const payload = data as { ok?: boolean; error?: string; version?: number; updated_at?: string };
  if (payload?.ok !== true) {
    if (payload?.error === "already_configured") return false;
    logShopSecurityPinFailure("pin_hydrate_failed", { shopId, reason: payload?.error ?? "migrate_failed" });
    return false;
  }

  writeLocalCache(shopId, Number(payload.version ?? 1), payload.updated_at ?? new Date().toISOString());
  logShopSecurityPinEvent("pin_migrated", { shopId, version: payload.version ?? 1 });
  return true;
}

/** Download shop PIN hash from server and apply to local preferences when newer. */
export async function hydrateShopSecurityPin(
  shopId: string,
  opts?: { force?: boolean },
): Promise<ShopSecurityPinHydrateResult> {
  if (!shopId) return "failed";
  if (!getDeviceOnline() || !supabase) return "offline";

  logShopSecurityPinEvent("pin_hydrate_start", { shopId });

  const cloud = await fetchShopSecurityPinFromCloud(shopId);
  if (!cloud) return "failed";

  const localCache = readLocalCache(shopId);
  const { usePosStore } = await import("../store/usePosStore");
  const localHash = usePosStore.getState().preferences.backOfficePin;
  const localConfigured = isShopSecurityPinConfigured(localHash);

  if (!cloud.configured && !localConfigured) {
    if (isShopSecurityPinMigrationBlocked(shopId)) {
      clearShopSecurityPinMigrationBlock(shopId);
      logShopSecurityPinEvent("pin_hydrate_success", { shopId, result: "server_empty_confirmed" });
    } else {
      logShopSecurityPinEvent("pin_hydrate_success", { shopId, result: "unchanged" });
    }
    return "unchanged";
  }

  if (!cloud.configured && localConfigured) {
    if (isShopSecurityPinMigrationBlocked(shopId)) {
      await applyCloudStateToLocal(shopId, cloud);
      clearShopSecurityPinMigrationBlock(shopId);
      logShopSecurityPinEvent("pin_cleared", { shopId, version: cloud.version, reason: "recovery_wins" });
      return "cleared";
    }
    const migrated = await migrateLocalShopSecurityPinToCloud(shopId);
    return migrated ? "migrated" : "unchanged";
  }

  const cloudIsNewer =
    opts?.force === true ||
    !localCache ||
    cloud.version > localCache.version ||
    (cloud.updatedAt &&
      localCache.updatedAt &&
      Date.parse(cloud.updatedAt) > Date.parse(localCache.updatedAt)) ||
    (cloud.configured && !localConfigured) ||
    (!cloud.configured && localConfigured);

  if (!cloudIsNewer) {
    logShopSecurityPinEvent("pin_hydrate_success", { shopId, result: "unchanged" });
    return "unchanged";
  }

  if (!cloud.configured) {
    await applyCloudStateToLocal(shopId, cloud);
    clearShopSecurityPinMigrationBlock(shopId);
    logShopSecurityPinEvent("pin_cleared", { shopId, version: cloud.version });
    return "cleared";
  }

  if (cloud.pinHash && cloud.pinHash !== localHash) {
    await applyCloudStateToLocal(shopId, cloud);
    return "synced";
  }

  writeLocalCache(shopId, cloud.version, cloud.updatedAt);
  logShopSecurityPinEvent("pin_hydrate_success", { shopId, result: "synced" });
  return "synced";
}

export async function saveShopSecurityPinToCloud(
  shopId: string,
  pinHash: string,
): Promise<{ ok: boolean; version?: number; error?: string }> {
  if (!shopId || !supabase) return { ok: false, error: "offline" };
  if (!isShopPinHash(pinHash)) return { ok: false, error: "invalid_pin_hash" };

  const expectedVersion = readLocalCache(shopId)?.version ?? null;
  const { data, error } = await supabase.rpc("shop_security_pin_upsert", {
    p_shop_id: shopId,
    p_pin_hash: pinHash,
    p_expected_version: expectedVersion,
    p_device_fingerprint: getOrCreateDeviceId(),
  });

  if (error) return { ok: false, error: error.message };

  const payload = data as {
    ok?: boolean;
    error?: string;
    version?: number;
    updated_at?: string;
    pin_hash?: string;
  };

  if (payload?.error === "version_conflict") {
    logShopSecurityPinFailure("pin_version_conflict", { shopId });
    const cloud = parseCloudState({
      ok: true,
      configured: Boolean(payload.pin_hash),
      pin_hash: payload.pin_hash ?? null,
      version: payload.version,
      updated_at: payload.updated_at,
    });
    if (cloud) await applyCloudStateToLocal(shopId, cloud);
    return { ok: false, error: "version_conflict" };
  }

  if (payload?.ok !== true) {
    return { ok: false, error: payload?.error ?? "upsert_failed" };
  }

  writeLocalCache(shopId, Number(payload.version ?? 1), payload.updated_at ?? new Date().toISOString());
  logShopSecurityPinEvent(
    expectedVersion && expectedVersion > 0 ? "pin_changed" : "pin_created",
    { shopId, version: payload.version },
  );
  return { ok: true, version: payload.version };
}

export async function clearShopSecurityPinOnCloud(
  shopId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!shopId || !supabase) return { ok: false, error: "offline" };

  const expectedVersion = readLocalCache(shopId)?.version ?? null;
  const { data, error } = await supabase.rpc("shop_security_pin_clear", {
    p_shop_id: shopId,
    p_expected_version: expectedVersion,
    p_device_fingerprint: getOrCreateDeviceId(),
  });

  if (error) return { ok: false, error: error.message };

  const payload = data as { ok?: boolean; error?: string; version?: number; updated_at?: string };
  if (payload?.ok !== true) {
    return { ok: false, error: payload?.error ?? "clear_failed" };
  }

  writeLocalCache(shopId, Number(payload.version ?? 0), payload.updated_at ?? new Date().toISOString());
  logShopSecurityPinEvent("pin_cleared", { shopId, version: payload.version });
  return { ok: true };
}

/** Apply server recovery clear to local cache metadata. */
export function applyShopSecurityPinRecoveryClear(shopId: string): void {
  clearLocalShopSecurityPinCache();
  logShopSecurityPinEvent("pin_recovery_applied", { shopId });
}
