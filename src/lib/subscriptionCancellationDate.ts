/**
 * WHEN WAS THIS SUBSCRIPTION CANCELLED? Only answer when the records actually say.
 *
 * `subscriptions` has no cancellation timestamp column. What exists instead is
 * `metadata.status_set_at`, written by `admin_subscription_set_status`
 * (028_internal_ops_live_metrics_admin_rpcs.sql) alongside a history row and an audit row.
 * That one key is what this module reads, because it is the only cancellation date a SHOP
 * can reach: `subscription_history` is internal-staff-only under RLS, while
 * `subscriptions_select` puts no restriction on columns, so an org member can read their
 * own row's metadata.
 *
 * WHY THE STATUS CHECK IS NOT OPTIONAL. The key is written for EVERY status that RPC sets
 * — active, paused, trial, cancelled alike — and the row does not record which status the
 * stamp belongs to. Only the current `status` column says that. So a row that was paused
 * yesterday and cancelled today carries a stamp for the *pause*, and reading it as a
 * cancellation date would be a fabrication. We answer only while the row is still
 * cancelled, which makes the stamp unambiguously the cancellation instant.
 *
 * WHY SOME CANCELLED ROWS HAVE NO DATE, AND WHY THAT IS ALLOWED TO STAND. Cancellations
 * are not all written by that RPC. The sibling sweep inside `admin_shop_set_subscription_plan`
 * cancels competing rows with a bare status write — no metadata stamp, no history row, no
 * audit row — and a reset-to-free leaves an `active` row with a null period end rather than
 * a cancellation at all. For those rows there is genuinely no recorded date, so this
 * returns null and the UI shows the status with no date. Deriving one from `updated_at`
 * would be wrong: updated_at moves on any later write, so it is not the cancellation
 * instant and never was.
 */

import type { RemoteSubscriptionRow } from "./subscriptionEntitlements";

/**
 * Postgres renders `timezone('Africa/Kampala', now())::text` as a wall-clock timestamp with
 * no offset — `2026-10-13 14:05:00.123456`. Handing that to `new Date(...)` reads it in the
 * *browser's* zone, which silently shifts the instant by however far the device is from
 * Kampala. So the offset is attached explicitly instead.
 */
const KAMPALA_UTC_OFFSET = "+03:00";

/**
 * Deliberately stops at whole seconds. The stored value carries microseconds, and they are
 * dropped rather than carried through — this date is only ever rendered at day granularity,
 * and truncating sub-second precision cannot move it across a day boundary.
 */
const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * Interpret a Kampala wall-clock string as UTC+3 and return an ISO instant, or null if the
 * value is absent or not a timestamp we recognise. Never throws, never guesses.
 */
export function parseKampalaWallClock(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = WALL_CLOCK_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const ms = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second ?? "00"}${KAMPALA_UTC_OFFSET}`,
  ).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A cancelled row may be spelled either way: the column is normalised, callers are not. */
export function isCancelledStatus(status: string | null | undefined): boolean {
  const st = (status ?? "").trim().toLowerCase();
  return st === "cancelled" || st === "canceled";
}

/**
 * The recorded cancellation instant as an ISO string, or null when the row is not
 * cancelled or no date was recorded for it. Both null cases are honest answers.
 */
export function resolveSubscriptionCancelledAt(row: RemoteSubscriptionRow): string | null {
  if (!isCancelledStatus(row.status)) return null;
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  return parseKampalaWallClock((metadata as Record<string, unknown>).status_set_at);
}
