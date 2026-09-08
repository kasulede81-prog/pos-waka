/**
 * PHASE 0A — setup for the executable offline test project.
 *
 * Deliberately does NOT mock `../offline/localDb`. That global mock is what
 * makes the default project unable to observe offline behaviour; this project
 * exists to run the real thing.
 *
 * Provides only the two browser primitives the offline layer actually needs:
 *
 *   1. `indexedDB` — via `fake-indexeddb/auto`, an in-memory implementation of
 *      the real IndexedDB API. `idb` (and therefore `localDb.ts` /
 *      `entityStore.ts`) runs unmodified against it.
 *
 *   2. `localStorage` — used by `syncCheckpoints.ts`, `organizationDeletionState.ts`
 *      and friends. Every call site already wraps access in try/catch, but
 *      without a shim those code paths silently take their error branch, which
 *      would hide real behaviour rather than exercise it.
 *
 * `window` is intentionally NOT defined. Large parts of the codebase branch on
 * `typeof window === "undefined"` to skip browser-only work (event dispatch,
 * legacy snapshot claiming, shop-scope migration). Leaving it undefined keeps
 * this project on the same deterministic path the Node test environment
 * already uses, instead of half-activating browser behaviour. Tests that need
 * real DOM behaviour belong in a future jsdom/happy-dom project, not here.
 */

import "fake-indexeddb/auto";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.map.delete(String(key));
  }

  clear(): void {
    this.map.clear();
  }
}

if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
