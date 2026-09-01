/**
 * Complete account-namespace erasure for deletion safety (idempotent).
 *
 * After MB-1, IndexedDB and shop-scoped localStorage live under both
 * `sb:userId` and `sb:userId:shopId`. Wipe must cover every namespace
 * belonging to the deleted account without touching another account
 * (`sb:user1` must not delete `sb:user10`).
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
import {
  buildPersistenceNamespace,
  lastActiveShopStorageKey,
  readPersistedLastActiveShopId,
} from "../offline/shopScope";
import { unmarkWorkspaceBootstrapped } from "./workspaceBootstrapCache";
import { reportAuthIssue } from "./monitoring";

const SYNC_CHECKPOINTS_BASE = "waka.sync.checkpoints.v1";
const SYNC_HEALTH_BASE = "waka.sync.health.v1";
const PILOT_EVENTS_BASE = "waka.pilot.events.v1";
const ONBOARDING_DRAFT_BASE = "waka.business.onboarding.draft";
const WORKSPACE_BOOTSTRAPPED_KEY = "waka.workspace.bootstrapped.v1";
const ACTIVATION_CACHE_KEY = "waka.activation.gate.v1";
const OWNER_ONBOARDING_CACHE_PREFIX = "waka.ownerOnboarding.v1:";

export type AccountWipeNamespaceFailure = {
  namespace: string;
  error: string;
};

export type AccountWipeSummary = AccountIdbWipeSummary & {
  accountKey: string;
  localStorageKeysRemoved: number;
  sessionStorageKeysRemoved: number;
  staffSessionCleared: boolean;
  wipeMarkerWritten: boolean;
  /** False when any discovered namespace failed; wipe marker may still be written. */
  complete: boolean;
  namespacesWiped: string[];
  failedNamespaces: AccountWipeNamespaceFailure[];
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

function listLocalStorageKeys(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const keys: string[] = [];
    const len = localStorage.length;
    for (let i = 0; i < len; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

function extractStorageSuffix(key: string): string | null {
  const sep = key.indexOf("::");
  if (sep < 0) return null;
  return key.slice(sep + 2);
}

/**
 * True when `namespace` is exactly `accountKey` or a shop-scoped child
 * (`accountKey:<shopId>`). Colon after the full account key prevents
 * `sb:user1` from matching `sb:user10`.
 */
export function persistenceNamespaceBelongsToAccount(namespace: string, accountKey: string): boolean {
  if (!accountKey || !namespace) return false;
  if (namespace === accountKey) return true;
  return namespace.startsWith(`${accountKey}:`);
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

function knownLocalStorageKeysForNamespaces(accountKey: string, namespaces: string[]): string[] {
  const keys: string[] = [];
  for (const ns of namespaces) {
    keys.push(
      `${SYNC_CHECKPOINTS_BASE}::${ns}`,
      `${SYNC_HEALTH_BASE}::${ns}`,
      `${PILOT_EVENTS_BASE}::${ns}`,
      `${ONBOARDING_DRAFT_BASE}::${ns}`,
    );
  }
  const lastShopKey = lastActiveShopStorageKey(accountKey);
  if (lastShopKey) keys.push(lastShopKey);
  return keys;
}

function wipeAccountLocalStorage(accountKey: string, userId: string | null, namespaces: string[]): number {
  let removed = 0;
  const explicit = knownLocalStorageKeysForNamespaces(accountKey, namespaces);
  for (const key of explicit) {
    if (removeLocalStorageKey(key)) removed += 1;
  }
  for (const key of listLocalStorageKeys()) {
    const suffix = extractStorageSuffix(key);
    if (!suffix || !persistenceNamespaceBelongsToAccount(suffix, accountKey)) continue;
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
 * Discover every local persistence namespace owned by this account:
 * the account key itself, IndexedDB accountKey fields, last-active shop,
 * and account-owned localStorage suffixes. Unrelated accounts are excluded.
 */
export async function listPersistenceNamespacesForAccount(accountKey: string): Promise<string[]> {
  const found = new Set<string>();
  if (!accountKey) return [];
  found.add(accountKey);

  try {
    const idbKeys = await listAccountKeysInIndexedDb();
    for (const ns of idbKeys) {
      if (persistenceNamespaceBelongsToAccount(ns, accountKey)) found.add(ns);
    }
  } catch {
    /* continue with other sources */
  }

  try {
    const lastShop = readPersistedLastActiveShopId(accountKey);
    if (lastShop) found.add(buildPersistenceNamespace(accountKey, lastShop));
  } catch {
    /* ignore */
  }

  try {
    for (const key of listLocalStorageKeys()) {
      const suffix = extractStorageSuffix(key);
      if (suffix && persistenceNamespaceBelongsToAccount(suffix, accountKey)) {
        found.add(suffix.includes("::") ? suffix.split("::")[0]! : suffix);
      }
    }
  } catch {
    /* ignore */
  }

  return [...found].sort();
}

function emptyIdbTotals(): Pick<
  AccountIdbWipeSummary,
  "kvKeysRemoved" | "recordsRemoved" | "syncQueueRemoved" | "backupsRemoved"
> {
  return {
    kvKeysRemoved: 0,
    recordsRemoved: 0,
    syncQueueRemoved: 0,
    backupsRemoved: 0,
  };
}

/**
 * Remove all persisted data for an account and its shop-scoped namespaces (idempotent).
 * One namespace failure does not stop the rest. Does not throw on partial IDB failure.
 * Writes a wipe marker after attempted cleanup so deleted orgs stay blocked locally.
 */
export async function wipeAccountNamespace(accountKey: string): Promise<AccountWipeSummary> {
  const userId = userIdFromSupabaseAccountKey(accountKey);
  let namespaces: string[] = accountKey ? [accountKey] : [];
  try {
    namespaces = await listPersistenceNamespacesForAccount(accountKey);
  } catch {
    namespaces = accountKey ? [accountKey] : [];
  }

  const namespacesWiped: string[] = [];
  const failedNamespaces: AccountWipeNamespaceFailure[] = [];
  const idb = emptyIdbTotals();

  for (const ns of namespaces) {
    try {
      const result = await wipeIndexedDbNamespace(ns);
      idb.kvKeysRemoved += result.kvKeysRemoved;
      idb.recordsRemoved += result.recordsRemoved;
      idb.syncQueueRemoved += result.syncQueueRemoved;
      idb.backupsRemoved += result.backupsRemoved;
      if (result.ok === false) {
        failedNamespaces.push({
          namespace: ns,
          error: result.error || "indexeddb_wipe_failed",
        });
      } else {
        namespacesWiped.push(ns);
      }
    } catch (err) {
      failedNamespaces.push({
        namespace: ns,
        error: err instanceof Error ? err.message : "indexeddb_wipe_failed",
      });
    }
  }

  let localStorageKeysRemoved = 0;
  try {
    localStorageKeysRemoved = wipeAccountLocalStorage(accountKey, userId, namespaces);
  } catch (err) {
    failedNamespaces.push({
      namespace: accountKey,
      error: err instanceof Error ? err.message : "localStorage_wipe_failed",
    });
  }

  const sessionStorageKeysRemoved = wipeAccountSessionStorage(userId);
  const staffSessionCleared = clearStaffReferencesForAccount(accountKey);

  clearDeletionMarker(accountKey);
  writeWipeMarker(accountKey);

  const complete = failedNamespaces.length === 0;
  if (!complete) {
    reportAuthIssue("account_namespace_wipe_incomplete", {
      failedCount: failedNamespaces.length,
      wipedCount: namespacesWiped.length,
    });
  }

  return {
    accountKey,
    ...idb,
    localStorageKeysRemoved,
    sessionStorageKeysRemoved,
    staffSessionCleared,
    wipeMarkerWritten: true,
    complete,
    namespacesWiped,
    failedNamespaces,
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
