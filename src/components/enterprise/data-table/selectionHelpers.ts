/** Pure helpers for desktop table selection (Phase 30.1). */

export function toggleIdInSet(prev: ReadonlySet<string>, id: string, selected: boolean): Set<string> {
  const next = new Set(prev);
  if (selected) next.add(id);
  else next.delete(id);
  return next;
}

export function mergeToggleAll(prev: ReadonlySet<string>, ids: string[], selected: boolean): Set<string> {
  const next = new Set(prev);
  for (const id of ids) {
    if (selected) next.add(id);
    else next.delete(id);
  }
  return next;
}
