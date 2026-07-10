/** Must match `shop_device_pending_approval_ttl()` in Supabase. */
export const DEVICE_PENDING_APPROVAL_TTL_MS = 60_000;

export function pendingApprovalExpiresAtMs(requestedAt: string | null | undefined): number | null {
  if (!requestedAt) return null;
  const start = Date.parse(requestedAt);
  if (!Number.isFinite(start)) return null;
  return start + DEVICE_PENDING_APPROVAL_TTL_MS;
}

export function pendingApprovalRemainingMs(
  requestedAt: string | null | undefined,
  nowMs = Date.now(),
): number {
  const expiresAt = pendingApprovalExpiresAtMs(requestedAt);
  if (expiresAt == null) return DEVICE_PENDING_APPROVAL_TTL_MS;
  return Math.max(0, expiresAt - nowMs);
}

export function isPendingApprovalExpired(
  requestedAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  const expiresAt = pendingApprovalExpiresAtMs(requestedAt);
  return expiresAt != null && nowMs >= expiresAt;
}

export function formatPendingApprovalCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
