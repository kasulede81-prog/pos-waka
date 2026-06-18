/** Ensures only one heavy cloud sync pipeline runs at a time. */

type SyncTaskKind = "syncShopWithCloud" | "flushSyncQueue" | "hydrateAccountFromCloud" | "pushPending";

let mutexDepth = 0;
let inFlightKind: SyncTaskKind | null = null;
let chain: Promise<unknown> = Promise.resolve();

export function isGlobalSyncInFlight(): boolean {
  return mutexDepth > 0;
}

export function currentGlobalSyncKind(): SyncTaskKind | null {
  return inFlightKind;
}

export async function withGlobalSyncMutex<T>(
  kind: SyncTaskKind,
  fn: () => Promise<T>,
): Promise<T> {
  if (mutexDepth > 0) {
    return fn();
  }

  const run = chain.then(async () => {
    mutexDepth += 1;
    inFlightKind = kind;
    try {
      return await fn();
    } finally {
      mutexDepth -= 1;
      inFlightKind = null;
    }
  });

  chain = run.catch(() => undefined);
  return run as Promise<T>;
}
