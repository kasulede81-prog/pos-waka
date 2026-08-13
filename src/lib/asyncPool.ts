/** Run async work over items with a fixed concurrency limit. */
export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<boolean>,
): Promise<{ ok: number; fail: number }> {
  if (items.length === 0) return { ok: 0, fail: 0 };
  let ok = 0;
  let fail = 0;
  let nextIndex = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) break;
        if (await worker(items[index]!, index)) ok += 1;
        else fail += 1;
      }
    }),
  );

  return { ok, fail };
}

/** Bounded concurrent map that preserves result order. */
export async function mapPoolResults<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  await mapPool(items, concurrency, async (item, index) => {
    results[index] = await worker(item, index);
    return true;
  });
  return results;
}
