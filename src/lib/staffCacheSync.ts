/**
 * Phase 3 — versioned staff distribution from cloud to encrypted offline cache.
 * Approved devices download and refresh staff cache after cloud mutations.
 */

import type { Permission, StaffAccount, UserRole } from "../types";
import { getDeviceOnline } from "./deviceOnline";
import { resolveShopCtx } from "../offline/cloudSync";
import { supabase } from "./supabase";
import { getOrCreateDeviceId } from "./deviceId";
import {
  getCachedStaffVersion,
  readOfflineStaffCache,
  sanitizeStaffForCache,
  writeOfflineStaffCache,
  type OfflineStaffCacheRecord,
} from "./offlineStaffCache";
import { logStaffCacheEvent } from "./staffCacheDiagnostics";
import type { CloudStaffRow } from "./shopStaffCloud";

export type StaffDownloadResult = {
  unchanged: boolean;
  version: number;
  changed: StaffAccount[];
  removedClientIds: string[];
};

type CloudStaffDownloadResponse = {
  ok?: boolean;
  unchanged?: boolean;
  version?: number;
  changed?: CloudStaffRow[];
  removed_client_ids?: string[];
};

function cloudRowToStaff(row: CloudStaffRow): StaffAccount {
  return {
    id: row.client_id ?? row.id,
    name: row.name,
    username: row.username,
    role: row.role as UserRole,
    permissions: (row.permissions ?? []) as Permission[],
    pin: null,
    password: null,
    pinHash: row.pin_hash,
    passwordHash: row.password_hash,
    phone: row.phone_e164,
    email: row.email,
    active: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pendingCloudSync: false,
    lastLoginAt: row.last_login_at,
    lastDeviceFingerprint: row.last_device_fingerprint,
    lastLoginPlatform: row.last_login_platform,
    failedPinAttempts: row.failed_pin_attempts ?? 0,
    lockedUntil: row.locked_until,
    lastFailedLoginAt: row.last_failed_login_at,
    firstFailedLoginAt: row.first_failed_login_at,
    failuresInWindow: row.failures_in_window ?? 0,
    failureWindowStartedAt: row.failure_window_started_at,
    pinChangedAt: row.pin_changed_at,
    passwordChangedAt: row.password_changed_at,
  };
}

export async function fetchCloudStaffVersion(shopId: string): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("shop_pos_staff_version", { p_shop_id: shopId });
  if (error) return null;
  return Number((data as { version?: number })?.version ?? 1);
}

export async function downloadStaffDelta(
  shopId: string,
  localVersion: number,
): Promise<StaffDownloadResult | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("shop_pos_staff_download", {
    p_shop_id: shopId,
    p_local_version: localVersion,
    p_device_fingerprint: getOrCreateDeviceId(),
  });
  if (error) {
    console.warn("[waka-staff-cache] download", error.message);
    return null;
  }
  const r = data as CloudStaffDownloadResponse;
  const changedRows = Array.isArray(r.changed) ? r.changed : [];
  const removed = Array.isArray(r.removed_client_ids)
    ? r.removed_client_ids.map(String)
    : [];
  return {
    unchanged: r.unchanged === true,
    version: Number(r.version ?? localVersion),
    changed: changedRows.map((row) => cloudRowToStaff(row as CloudStaffRow)),
    removedClientIds: removed,
  };
}

export function applyStaffDeltaToCache(
  existing: OfflineStaffCacheRecord | null,
  shopId: string,
  delta: StaffDownloadResult,
): OfflineStaffCacheRecord {
  const base: OfflineStaffCacheRecord = existing ?? {
    shopId,
    version: 0,
    downloadedAt: new Date(0).toISOString(),
    staff: [],
  };

  if (delta.unchanged) {
    return { ...base, version: delta.version };
  }

  const isFullBootstrap = base.version <= 0 && delta.changed.length > 0;
  if (isFullBootstrap) {
    return {
      shopId,
      version: delta.version,
      downloadedAt: new Date().toISOString(),
      staff: sanitizeStaffForCache(delta.changed),
    };
  }

  const byId = new Map(base.staff.map((s) => [s.id, s]));
  for (const id of delta.removedClientIds) {
    byId.delete(id);
  }
  for (const row of delta.changed) {
    byId.set(row.id, row);
  }

  return {
    shopId,
    version: delta.version,
    downloadedAt: new Date().toISOString(),
    staff: sanitizeStaffForCache([...byId.values()]),
  };
}

/** Mirror cache into preferences — single unified path (Phase 25.1). */
export async function mirrorStaffCacheToPreferences(
  staff: StaffAccount[],
  opts?: { removedIds?: string[]; source?: string },
): Promise<void> {
  const mirrorStarted = performance.now();
  const { applyStaffAccountsMergeToStore, computeImplicitStaffTombstones } = await import("./staffSyncApply");
  const { usePosStore } = await import("../store/usePosStore");
  const local = usePosStore.getState().preferences.staffAccounts ?? [];
  const implicitRemoved = computeImplicitStaffTombstones(local, staff);
  const removedIds = [...new Set([...(opts?.removedIds ?? []), ...implicitRemoved])];
  await applyStaffAccountsMergeToStore(staff, {
    source: opts?.source ?? "cache_mirror",
    removedIds,
  });
  const { recordStaffMirrorDuration } = await import("./staffSyncDiagnostics");
  recordStaffMirrorDuration(performance.now() - mirrorStarted, { source: opts?.source ?? "cache_mirror" });
}

/** Write encrypted cache and mirror to preferences in one step. */
export async function writeStaffCacheAndMirrorToPreferences(
  record: OfflineStaffCacheRecord,
  removedClientIds: string[] = [],
): Promise<void> {
  await writeOfflineStaffCache(record);
  void import("./staffSyncDiagnostics").then(({ recordStaffCacheVersion }) => {
    recordStaffCacheVersion(record.version);
  });
  await mirrorStaffCacheToPreferences(record.staff, {
    removedIds: removedClientIds,
    source: "cache_delta",
  });
}

/**
 * When encrypted staff cache is newer than preferences (common after cross-device sync),
 * merge cache rows into preferences.staffAccounts without a cloud round-trip.
 */
export async function reconcileStaffCacheToPreferencesIfNeeded(shopId: string): Promise<boolean> {
  let cache = await readOfflineStaffCache(shopId);
  if (!cache?.staff.length) {
    const cloudVersion = await fetchCloudStaffVersion(shopId);
    if (cloudVersion != null && cloudVersion > 0) {
      await refreshStaffCacheBackground({ force: true });
      cache = await readOfflineStaffCache(shopId);
    }
  }
  if (!cache?.staff.length) return false;

  const { applyStaffAccountsMergeToStore, computeImplicitStaffTombstones } = await import("./staffSyncApply");
  const { usePosStore } = await import("../store/usePosStore");
  const local = usePosStore.getState().preferences.staffAccounts ?? [];
  const removedIds = computeImplicitStaffTombstones(local, cache.staff);
  const stats = await applyStaffAccountsMergeToStore(cache.staff, {
    source: "cache_reconcile",
    removedIds,
  });
  return stats.added > 0 || stats.updated > 0 || removedIds.length > 0 || stats.mergedCount !== stats.localCount;
}

export async function isStaffCacheUpToDate(shopId: string): Promise<boolean> {
  const localVersion = await getCachedStaffVersion(shopId);
  if (localVersion <= 0) return false;
  const cloudVersion = await fetchCloudStaffVersion(shopId);
  return cloudVersion != null && localVersion >= cloudVersion;
}

/** After cloud staff mutation, force cache refresh. */
export async function refreshStaffCacheAfterOwnerMutation(): Promise<void> {
  await refreshStaffCacheBackground({ force: true });
}

/**
 * Background staff cache refresh — never throws, never blocks caller.
 * Returns true when cache was updated.
 */
export async function refreshStaffCacheBackground(opts?: {
  force?: boolean;
}): Promise<boolean> {
  if (!getDeviceOnline()) return false;
  const ctx = await resolveShopCtx();
  if (!ctx || !supabase) return false;

  const localVersion = opts?.force ? 0 : await getCachedStaffVersion(ctx.shopId);
  const cloudVersion = await fetchCloudStaffVersion(ctx.shopId);

  logStaffCacheEvent("staff_cache_version", {
    shopId: ctx.shopId,
    localVersion,
    cloudVersion: cloudVersion ?? null,
  });

  if (cloudVersion != null && localVersion >= cloudVersion && localVersion > 0 && !opts?.force) {
    return false;
  }

  const delta = await downloadStaffDelta(ctx.shopId, localVersion);
  if (!delta) return false;

  if (delta.unchanged) {
    return false;
  }

  logStaffCacheEvent("staff_delta_download", {
    shopId: ctx.shopId,
    changed: delta.changed.length,
    removed: delta.removedClientIds.length,
    version: delta.version,
  });

  if (localVersion > 0 && delta.version > localVersion) {
    logStaffCacheEvent("staff_version_changed", {
      shopId: ctx.shopId,
      from: localVersion,
      to: delta.version,
    });
  }

  const existing = await readOfflineStaffCache(ctx.shopId);
  const next = applyStaffDeltaToCache(existing, ctx.shopId, delta);
  const { usePosStore } = await import("../store/usePosStore");
  const businessName = usePosStore.getState().preferences.shopDisplayName?.trim();
  if (businessName) {
    next.businessName = businessName;
  }
  await writeStaffCacheAndMirrorToPreferences(next, delta.removedClientIds);

  return true;
}

/** Provision staff on approved device login — fire-and-forget. */
export function scheduleStaffCacheProvisioning(): void {
  void import("./uiYield").then(({ runWhenIdle }) => {
    runWhenIdle(() => {
      void (async () => {
        const ctx = await resolveShopCtx();
        await refreshStaffCacheBackground({ force: false });
        if (ctx?.shopId) {
          await reconcileStaffCacheToPreferencesIfNeeded(ctx.shopId);
        }
      })();
    }, 500);
  });
}
