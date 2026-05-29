/** PostgREST returns SETOF / TABLE RPCs as an array — normalize to one row. */
export function parseWakaInternalMeRow(data: unknown): { role: string } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const role = String((row as { role?: string }).role ?? "").trim().toLowerCase();
  if (!role) return null;
  return { role };
}
