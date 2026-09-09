/**
 * R4 — compare timestamptz values by instant, not lexicographic ISO text.
 *
 * Client cursors are typically `…000Z`; PostgREST returns `…+00:00` with up to
 * 6 fractional digits. At an equal-millisecond boundary `'Z' > '1'`, so a
 * string compare refuses a newer (or equal) server timestamp and the page is
 * re-pulled. Equivalent instants must not advance the stored maximum.
 *
 * Returns one of the original strings — never a client-clock rewrite.
 */
const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/;

function isoInstantUs(iso: string): number | null {
  const trimmed = iso.trim();
  if (!trimmed) return null;
  const m = trimmed.match(ISO_INSTANT_RE);
  if (!m) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms * 1000 : null;
  }
  const frac = m[7] ?? "";
  const us = Number((frac + "000000").slice(0, 6));
  if (!Number.isFinite(us)) return null;
  const tz = m[8];
  let offsetMin = 0;
  if (tz !== "Z") {
    const sign = tz.startsWith("-") ? -1 : 1;
    const compact = tz.slice(1).replace(":", "");
    const hh = Number(compact.slice(0, 2));
    const mm = Number(compact.slice(2, 4) || "0");
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    offsetMin = sign * (hh * 60 + mm);
  }
  const utcMs =
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) -
    offsetMin * 60_000;
  if (!Number.isFinite(utcMs)) return null;
  return utcMs * 1000 + us;
}

export function maxIsoTimestamp(current: string, candidate: unknown): string {
  const next = typeof candidate === "string" ? candidate : "";
  if (!next) return current;
  const currentUs = isoInstantUs(current);
  const nextUs = isoInstantUs(next);
  if (nextUs == null) return current;
  if (currentUs == null) return next;
  return nextUs > currentUs ? next : current;
}
