/** Ensures only one heavy cloud sync pipeline runs at a time. */

type SyncTaskKind = "syncShopWithCloud" | "flushSyncQueue" | "hydrateAccountFromCloud" | "pushPending";

let execDepth = 0;
let inFlightKind: SyncTaskKind | null = null;
let chain: Promise<unknown> = Promise.resolve();

export function isGlobalSyncInFlight(): boolean {
  return execDepth > 0;
}

export function currentGlobalSyncKind(): SyncTaskKind | null {
  return inFlightKind;
}

export async function withGlobalSyncMutex<T>(
  kind: SyncTaskKind,
  fn: () => Promise<T>,
): Promise<T> {
  const run = chain.then(async () => {
    execDepth += 1;
    inFlightKind = kind;
    try {
      return await fn();
    } finally {
      execDepth -= 1;
      if (execDepth === 0) inFlightKind = null;
    }
  });

  chain = run.catch(() => undefined);
  return run as Promise<T>;
}
