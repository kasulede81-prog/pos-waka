import type { WakaInternalAdminRow } from "./wakaInternalAdmin";
import { isInternalAdminPreviewActive } from "./internalAdminPreview";

/**
 * Preview mode is active only when preview is requested AND there is no real internal admin session.
 * Real admins always operate on live data even if `?preview=1` is stale in the URL.
 */
export function resolveInternalAdminPreviewMode(
  search: string,
  adminRow: WakaInternalAdminRow | null | undefined,
  loadingAdmin = false,
): boolean {
  if (!isInternalAdminPreviewActive(search)) return false;
  if (loadingAdmin) return true;
  return !adminRow;
}

export const INTERNAL_ADMIN_PREVIEW_BLOCKED = "internalAdminPreviewActionBlocked";
