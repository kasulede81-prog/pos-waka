/**
 * Account scoping for all locally persisted POS data.
 *
 * Every offline storage primitive (IndexedDB KV, syncQueue, backups, scoped
 * localStorage keys) MUST be namespaced by the value returned by
 * `getActiveAccountKey()` so that switching between users on the same browser
 * never leaks one account's products / sales / debts / reports to another.
 *
 * Key scheme (documented for future contributors):
 *   - Supabase mode  → `sb:<auth.users.id>`  (stable across email changes)
 *   - Local auth     → `local:<lowercased-email>` (best stable id available)
 *   - No active user → `null` (reads return empty, writes are skipped)
 *
 * The active key is set by `useAuth` whenever the signed-in account changes,
 * BEFORE the React tree re-renders with the new auth state, so that downstream
 * effects (e.g. `bootstrapPosFromDisk`) always observe the correct namespace.
 */

let activeAccountKey: string | null = null;
const listeners = new Set<(next: string | null, prev: string | null) => void>();

const SAFE_SEGMENT = /[^A-Za-z0-9._-]/g;

function sanitizeSegment(input: string): string {
  return input.trim().toLowerCase().replace(SAFE_SEGMENT, "_");
}

export type AccountKeyInput = {
  mode: "supabase" | "local";
  userId?: string | null;
  email?: string | null;
};

export function computeAccountKey(input: AccountKeyInput): string | null {
  if (input.mode === "supabase") {
    if (!input.userId) return null;
    return `sb:${sanitizeSegment(String(input.userId))}`;
  }
  if (!input.email) return null;
  return `local:${sanitizeSegment(String(input.email))}`;
}

export function getActiveAccountKey(): string | null {
  return activeAccountKey;
}

/** Returns true if the key changed. */
export function setActiveAccountKey(next: string | null): boolean {
  if (activeAccountKey === next) return false;
  const prev = activeAccountKey;
  activeAccountKey = next;
  for (const listener of [...listeners]) {
    try {
      listener(next, prev);
    } catch {
      /* listeners must not throw across account changes */
    }
  }
  return true;
}

export function onActiveAccountKeyChange(
  listener: (next: string | null, prev: string | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Scope a freeform storage key (e.g. localStorage) to the active account. */
export function scopedStorageKey(baseKey: string, accountKey: string | null = activeAccountKey): string | null {
  if (!accountKey) return null;
  return `${baseKey}::${accountKey}`;
}
