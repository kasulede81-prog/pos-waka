/**
 * MB-1 — explicit active shop + account+shop persistence namespace.
 *
 * Local operational data and sync queue rows are partitioned under:
 *   sb:<userId>:<shopId>   (Supabase multi-branch)
 *   sb:<userId>            (legacy single-shop, migrated on first boot)
 *   local:<email>          (offline-only auth — no shop dimension)
 */

import { getActiveAccountKey, scopedStorageKey } from "./accountScope";

/** Account-scoped last active shop. Never a global unscoped preference. */
const LAST_ACTIVE_SHOP_BASE_KEY = "waka.lastActiveShopId.v1";

const SHOP_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let activeShopId: string | null = null;

const listeners = new Set<(next: string | null, prev: string | null) => void>();

export function isValidShopId(shopId: string | null | undefined): shopId is string {
  return typeof shopId === "string" && SHOP_UUID_RE.test(shopId.trim());
}

/** Build persistence namespace: account key optionally suffixed with shop UUID. */
export function buildPersistenceNamespace(accountKey: string, shopId: string | null | undefined): string {
  if (!shopId || !isValidShopId(shopId)) return accountKey;
  const trimmed = shopId.trim();
  if (accountKey.endsWith(`:${trimmed}`)) return accountKey;
  return `${accountKey}:${trimmed}`;
}

/** Parse trailing UUID shop segment from a persistence namespace, if present. */
export function parseShopIdFromPersistenceNamespace(namespace: string): string | null {
  const parts = namespace.split(":");
  const last = parts[parts.length - 1];
  return last && isValidShopId(last) ? last : null;
}

export function isLegacySingleShopNamespace(namespace: string): boolean {
  return parseShopIdFromPersistenceNamespace(namespace) === null;
}

/** Active shop for POS runtime (branch context). Distinct from profiles.primary_shop_id. */
export function getActiveShopId(): string | null {
  return activeShopId;
}

export function lastActiveShopStorageKey(accountKey: string | null = getActiveAccountKey()): string | null {
  return scopedStorageKey(LAST_ACTIVE_SHOP_BASE_KEY, accountKey);
}

export function readPersistedLastActiveShopId(accountKey: string | null = getActiveAccountKey()): string | null {
  const key = lastActiveShopStorageKey(accountKey);
  if (!key) return null;
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return isValidShopId(raw) ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function persistLastActiveShopId(
  shopId: string,
  accountKey: string | null = getActiveAccountKey(),
): void {
  const key = lastActiveShopStorageKey(accountKey);
  if (!key || !isValidShopId(shopId)) return;
  try {
    globalThis.localStorage?.setItem(key, shopId.trim());
  } catch {
    /* quota / private mode */
  }
}

export function clearPersistedLastActiveShopId(accountKey: string | null = getActiveAccountKey()): void {
  const key = lastActiveShopStorageKey(accountKey);
  if (!key) return;
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Returns true when the active shop changed. In-memory only — last-shop persist is explicit. */
export function setActiveShopId(next: string | null): boolean {
  const normalized = next && isValidShopId(next) ? next.trim() : null;
  if (activeShopId === normalized) return false;
  const prev = activeShopId;
  activeShopId = normalized;
  for (const listener of [...listeners]) {
    try {
      listener(normalized, prev);
    } catch {
      /* listeners must not throw across shop changes */
    }
  }
  return true;
}

export function clearActiveShopId(): void {
  setActiveShopId(null);
}

export function onActiveShopIdChange(
  listener: (next: string | null, prev: string | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Namespace for IndexedDB KV, entity rows, sync queue partition, and scoped localStorage.
 * Returns null when no account is active or demo mode.
 */
export function getPersistenceNamespace(): string | null {
  const base = getActiveAccountKey();
  if (!base || base.startsWith("demo:")) return null;
  return buildPersistenceNamespace(base, activeShopId);
}

/** Legacy alias used by enterprise foundation tests. */
export function shopScopedAccountKey(shopId: string | null | undefined): string | null {
  const base = getActiveAccountKey();
  if (!base) return null;
  return buildPersistenceNamespace(base, shopId);
}

export function resetActiveShopForTests(): void {
  activeShopId = null;
  listeners.clear();
}
