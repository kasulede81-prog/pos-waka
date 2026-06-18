/**
 * Complete account-namespace erasure for deletion safety (idempotent).
 */

import { clearStaffAuth, readPendingStaffSelection, readStaffSession } from "./staffOfflineAuth";
import {
  clearDeletionMarker,
  clearWipeMarker,
  writeWipeMarker,
  userIdFromSupabaseAccountKey,
} from "./organizationDeletionState";
import {
  countBackupsForAccount,
  listAccountKeysInIndexedDb,
  wipeIndexedDbNamespace,
  type AccountIdbWipeSummary,
} from "../offline/localDb";
import { unmarkWorkspaceBootstrapped } from "./workspaceBootstrapCache";

const SYNC_CHECKPOINTS_BASE = "waka.sync.checkpoints.v1";
const SYNC_HEALTH_BASE = "waka.sync.health.v1";
const PILOT_EVENTS_BASE = "waka.pilot.events.v1";
const ONBOARDING_DRAFT_BASE = "waka.business.onboarding.draft";
const WORKSPACE_BOOTSTRAPPED_KEY = "waka.workspace.bootstrapped.v1";
const ACTIVATION_CACHE_KEY = "waka.activation.gate.v1";
const OWNER_ONBOARDING_CACHE_PREFIX = "waka.ownerOnboarding.v1:";

export type AccountWipeSummary = AccountIdbWipeSummary & {
  accountKey: string;
  localStorageKeysRemoved: number;
  sessionStorageKeysRemoved: number;
  staffSessionCleared: boolean;
  wipeMarkerWritten: boolean;
};

function removeLocalStorageKey(key: string): boolean {
  try {
    if (localStorage.getItem(key) == null) return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function removeSessionStorageKey(key: string): boolean {
  try {
    if (sessionStorage.getItem(key) == null) return false;
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function clearWorkspaceBootstrappedForUser(userId: string): boolean {
  if (!userId) return false;
  try {
    const raw = localStorage.getItem(WORKSPACE_BOOTSTRAPPED_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!(userId in o)) return false;
    delete o[userId];
    localStorage.setItem(WORKSPACE_BOOTSTRAPPED_KEY, JSON.stringify(o));
    unmarkWorkspaceBootstrapped(userId);
    return true;
  } catch {
    return false;
  }
}

function clearStaffReferencesForAccount(accountKey: string): boolean {
  let cleared = false;
  const session = readStaffSession();
  if (session?.accountKey === accountKey) {
    clearStaffAuth();
    cleared = true;
  }
  const pending = readPendingStaffSelection();
  if (pending?.accountKey === accountKey) {
    clearStaffAuth();
    cleared = true;
  }
  return cleared;
}

function wipeAccountLocalStorage(accountKey: string, userId: string | null): number {
  let removed = 0;
  const keys = [
    `${SYNC_CHECKPOINTS_BASE}::${accountKey}`,
    `${SYNC_HEALTH_BASE}::${accountKey}`,
    `${PILOT_EVENTS_BASE}::${accountKey}`,
    `${ONBOARDING_DRAFT_BASE}::${accountKey}`,
  ];
  for (const key of keys) {
    if (removeLocalStorageKey(key)) removed += 1;
  }
  if (userId && clearWorkspaceBootstrappedForUser(userId)) removed += 1;
  return removed;
}

function wipeAccountSessionStorage(userId: string | null): number {
  if (!userId) return 0;
  let removed = 0;
  if (removeSessionStorageKey(`${ACTIVATION_CACHE_KEY}:${userId}`)) removed += 1;
  if (removeSessionStorageKey(`${OWNER_ONBOARDING_CACHE_PREFIX}${userId}`)) removed += 1;
  return removed;
}

/**
 * Remove all persisted data for an account namespace (idempotent).
 * Writes a wipe marker after successful IndexedDB cleanup.
 */
export async function wipeAccountNamespace(accountKey: string): Promise<AccountWipeSummary> {
  const userId = userIdFromSupabaseAccountKey(accountKey);
  const idb = await wipeIndexedDbNamespace(accountKey);
  const localStorageKeysRemoved = wipeAccountLocalStorage(accountKey, userId);
  const sessionStorageKeysRemoved = wipeAccountSessionStorage(userId);
  const staffSessionCleared = clearStaffReferencesForAccount(accountKey);

  clearDeletionMarker(accountKey);
  writeWipeMarker(accountKey);

  return {
    accountKey,
    ...idb,
    localStorageKeysRemoved,
    sessionStorageKeysRemoved,
    staffSessionCleared,
    wipeMarkerWritten: true,
  };
}

/** Diagnostics helper — list namespaces and backup counts. */
export async function listAccountNamespaceDiagnostics(): Promise<
  Array<{ accountKey: string; backupCount: number }>
> {
  const keys = await listAccountKeysInIndexedDb();
  const out: Array<{ accountKey: string; backupCount: number }> = [];
  for (const accountKey of keys) {
    out.push({
      accountKey,
      backupCount: await countBackupsForAccount(accountKey),
    });
  }
  return out;
}

/** Clear wipe marker only (testing / re-provision). */
export function clearAccountWipeMarker(accountKey: string): void {
  clearWipeMarker(accountKey);
}
