/**
 * WAKA-07 — composite (time, id) keyset for incremental cloud pulls.
 *
 * A timestamp-only `.gt(updated_at, cursor)` stalls when a full page shares one
 * `updated_at` (Postgres `now()` is transaction-start time). The in-memory page
 * cursor carries the last row's id; the persisted WAKA-05 checkpoint remains
 * the newest server timestamp observed.
 */

export type IncrementalKeysetTimeColumn = "updated_at" | "created_at";

export type IncrementalKeyset = {
  at: string;
  id: string;
};

export function incrementalKeysetFromSince(since: string): IncrementalKeyset {
  return { at: since, id: "" };
}

export function asIncrementalKeyset(cursor: string | IncrementalKeyset): IncrementalKeyset {
  return typeof cursor === "string" ? incrementalKeysetFromSince(cursor) : cursor;
}

export function quoteIncrementalKeysetValue(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

export function formatIncrementalKeysetOr(
  timeCol: IncrementalKeysetTimeColumn,
  at: string,
  id: string,
): string {
  const t = quoteIncrementalKeysetValue(at);
  const i = quoteIncrementalKeysetValue(id);
  return `${timeCol}.gt.${t},and(${timeCol}.eq.${t},id.gt.${i})`;
}

export function parseIncrementalKeysetOr(
  expr: string,
): { timeCol: IncrementalKeysetTimeColumn; at: string; id: string } | null {
  const m = expr.match(
    /^(updated_at|created_at)\.gt\."([^"]+)",and\(\1\.eq\."([^"]+)",id\.gt\."([^"]+)"\)$/,
  );
  if (!m || m[2] !== m[3]) return null;
  return { timeCol: m[1] as IncrementalKeysetTimeColumn, at: m[2], id: m[4] };
}

export function rowMatchesIncrementalKeyset(
  row: Record<string, unknown>,
  timeCol: IncrementalKeysetTimeColumn,
  cursor: IncrementalKeyset,
): boolean {
  const t = row[timeCol];
  if (typeof t !== "string") return false;
  if (!cursor.id) return t > cursor.at;
  const id = String(row.id ?? "");
  return t > cursor.at || (t === cursor.at && id > cursor.id);
}

export function keysetFromLastRow(
  rows: Record<string, unknown>[],
  timeCol: IncrementalKeysetTimeColumn,
  fallback: IncrementalKeyset,
): IncrementalKeyset {
  const last = rows[rows.length - 1];
  if (!last) return fallback;
  const at = String(last[timeCol] ?? fallback.at);
  const id = String(last.id ?? "");
  return { at, id };
}

type IncrementalKeysetQuery<Q> = {
  gt: (column: string, value: string) => IncrementalKeysetQuery<Q>;
  or: (filters: string) => IncrementalKeysetQuery<Q>;
  order: (column: string, opts?: { ascending?: boolean }) => IncrementalKeysetQuery<Q>;
};

export function applyIncrementalKeyset<Q>(
  query: Q,
  timeCol: IncrementalKeysetTimeColumn,
  cursor: IncrementalKeyset,
): Q {
  const q = query as IncrementalKeysetQuery<Q>;
  const filtered = cursor.id
    ? q.or(formatIncrementalKeysetOr(timeCol, cursor.at, cursor.id))
    : q.gt(timeCol, cursor.at);
  return filtered.order(timeCol, { ascending: true }).order("id", { ascending: true }) as Q;
}
