/** Resolve with `fallback` when `promise` does not settle within `ms` (iOS WebView safety). */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = globalThis.setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  });
}
