/** Split push/pull mutexes — uploads must not wait for downloads (Phase 24.1B). */

export type PullSyncKind = "syncShopWithCloud" | "hydrateAccountFromCloud" | "pullCloud";
export type PushSyncKind = "pushPending" | "flushSyncQueue";
export type SyncTaskKind = PullSyncKind | PushSyncKind;

let pullDepth = 0;
let pushDepth = 0;
let pullKind: PullSyncKind | null = null;
let pushKind: PushSyncKind | null = null;
let pullChain: Promise<unknown> = Promise.resolve();
let pushChain: Promise<unknown> = Promise.resolve();

export function isPullSyncInFlight(): boolean {
  return pullDepth > 0;
}

export function isPushSyncInFlight(): boolean {
  return pushDepth > 0;
}

/** Push is only blocked by active pull/hydrate — not by other pushes. */
export function isGlobalSyncInFlight(): boolean {
  return isPullSyncInFlight();
}

export function currentGlobalSyncKind(): SyncTaskKind | null {
  return pullKind ?? pushKind;
}

export function globalSyncMutexDepth(): number {
  return pullDepth + pushDepth;
}

function isPullKind(kind: SyncTaskKind): kind is PullSyncKind {
  return kind === "syncShopWithCloud" || kind === "hydrateAccountFromCloud" || kind === "pullCloud";
}

async function withPipelineMutex<T, K extends SyncTaskKind>(
  kind: K,
  depthRef: { get: () => number; set: (n: number) => void },
  kindRef: { get: () => K | null; set: (k: K | null) => void },
  chainRef: { get: () => Promise<unknown>; set: (p: Promise<unknown>) => void },
  fn: () => Promise<T>,
): Promise<T> {
  if (depthRef.get() > 0) {
    depthRef.set(depthRef.get() + 1);
    try {
      return await fn();
    } finally {
      depthRef.set(depthRef.get() - 1);
    }
  }

  const run = chainRef.get().then(async () => {
    depthRef.set(depthRef.get() + 1);
    kindRef.set(kind);
    try {
      return await fn();
    } finally {
      depthRef.set(depthRef.get() - 1);
      if (depthRef.get() === 0) kindRef.set(null);
    }
  });

  chainRef.set(run.catch(() => undefined));
  return run as Promise<T>;
}

export async function withPullSyncMutex<T>(kind: PullSyncKind, fn: () => Promise<T>): Promise<T> {
  return withPipelineMutex(
    kind,
    { get: () => pullDepth, set: (n) => { pullDepth = n; } },
    { get: () => pullKind, set: (k) => { pullKind = k; } },
    { get: () => pullChain, set: (p) => { pullChain = p; } },
    fn,
  );
}

export async function withPushSyncMutex<T>(kind: PushSyncKind, fn: () => Promise<T>): Promise<T> {
  return withPipelineMutex(
    kind,
    { get: () => pushDepth, set: (n) => { pushDepth = n; } },
    { get: () => pushKind, set: (k) => { pushKind = k; } },
    { get: () => pushChain, set: (p) => { pushChain = p; } },
    fn,
  );
}

/** Routes to push or pull pipeline. Push and pull pipelines may run concurrently. */
export async function withGlobalSyncMutex<T>(kind: SyncTaskKind, fn: () => Promise<T>): Promise<T> {
  if (isPullKind(kind)) {
    return withPullSyncMutex(kind, fn);
  }
  return withPushSyncMutex(kind, fn);
}
