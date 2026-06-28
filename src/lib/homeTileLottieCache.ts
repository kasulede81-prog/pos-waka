/** In-memory cache for lazily fetched home tile Lottie JSON (PWA also caches /lottie/*). */
const cache = new Map<string, object>();
const inflight = new Map<string, Promise<object | null>>();

export function getHomeTileLottiePath(tileId: string): string {
  return `/lottie/home/${tileId}.json`;
}

export async function fetchHomeTileLottie(tileId: string): Promise<object | null> {
  const cached = cache.get(tileId);
  if (cached) return cached;

  const pending = inflight.get(tileId);
  if (pending) return pending;

  const promise = fetch(getHomeTileLottiePath(tileId))
    .then((res) => {
      if (!res.ok) return null;
      return res.json() as Promise<object>;
    })
    .then((data) => {
      if (data) cache.set(tileId, data);
      inflight.delete(tileId);
      return data;
    })
    .catch(() => {
      inflight.delete(tileId);
      return null;
    });

  inflight.set(tileId, promise);
  return promise;
}

export function prefetchHomeTileLottie(tileId: string): void {
  void fetchHomeTileLottie(tileId);
}
