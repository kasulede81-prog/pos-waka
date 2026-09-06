/**
 * IC-NEW-01 — apply persisted pharmacy remainder collections to runtime state.
 * Does not change staged hydration semantics. Incoming undefined keeps in-memory.
 * When incoming is provided, persisted rows fill gaps; existing ids win (newer runtime).
 */
export function applyPharmacyRemainderHydration<T extends { id: string }>(
  incoming: unknown[] | undefined,
  existing: T[],
  normalize: (raw: unknown) => T | null,
): T[] {
  if (incoming === undefined) return existing;
  const byId = new Map<string, T>();
  for (const raw of incoming) {
    const row = normalize(raw);
    if (!row?.id) continue;
    byId.set(row.id, row);
  }
  for (const row of existing) {
    if (row.id) byId.set(row.id, row);
  }
  return [...byId.values()];
}
