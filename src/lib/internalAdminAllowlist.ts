/**
 * Browser-only gate for the internal Waka admin shell.
 * Set `VITE_WAKA_INTERNAL_ADMIN_EMAILS` to a comma-separated list (lowercase recommended).
 * Server-side checks are still required for any real admin actions.
 */
const DEFAULT_SUPER = "kasule.de81@gmail.com";

export function parseInternalAdminEmails(): string[] {
  const raw = import.meta.env.VITE_WAKA_INTERNAL_ADMIN_EMAILS as string | undefined;
  if (raw && raw.trim()) {
    return raw
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }
  return [DEFAULT_SUPER];
}

export function isWakaInternalAdminEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  return parseInternalAdminEmails().includes(e);
}
