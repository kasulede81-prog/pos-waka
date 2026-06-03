/** Human-readable labels for shop device registry UI. */

export function formatDevicePlatformLabel(platform: string | null | undefined): string {
  const p = (platform ?? "").trim().toLowerCase();
  if (p === "android") return "Android";
  if (p === "ios") return "iOS";
  if (p === "electron" || p === "win32" || p === "windows") return "Windows";
  if (p === "web") return "Web";
  if (p === "macos" || p === "darwin") return "Mac";
  return platform?.trim() || "Unknown";
}

export function formatDeviceDisplayName(
  label: string | null | undefined,
  platform: string | null | undefined,
): string {
  const name = label?.trim();
  if (name) return name;
  const plat = formatDevicePlatformLabel(platform);
  if (plat !== "Unknown") return `${plat} POS`;
  return "POS Device";
}

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/** Relative last-seen for owner device list (English keys returned for i18n mapping). */
export function formatLastActiveRelative(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): { key: "just_now" | "mins" | "hours" | "yesterday" | "days" | "never"; count?: number } {
  if (!iso) return { key: "never" };
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return { key: "never" };
  const diff = Math.max(0, nowMs - t);
  if (diff < MS_MIN) return { key: "just_now" };
  if (diff < MS_HOUR) return { key: "mins", count: Math.max(1, Math.floor(diff / MS_MIN)) };
  if (diff < MS_DAY) return { key: "hours", count: Math.max(1, Math.floor(diff / MS_HOUR)) };
  if (diff < MS_DAY * 2) return { key: "yesterday" };
  return { key: "days", count: Math.max(2, Math.floor(diff / MS_DAY)) };
}
