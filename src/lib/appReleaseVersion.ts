/** Version helpers for Google Play version codes and display semver strings. */

export function parseVersionCode(raw: string | number | null | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  const n = parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Compare dotted version strings (e.g. 2.0.0 vs 2.3.0). Returns -1, 0, or 1. */
export function compareVersionStrings(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

export function isBelowMinimumVersionCode(
  currentCode: number,
  minimumCode: number,
  forceEnabled: boolean,
): boolean {
  if (!forceEnabled || minimumCode <= 0) return false;
  return currentCode < minimumCode;
}

export function isPlayUpdateAvailable(currentCode: number, availableCode: number): boolean {
  return availableCode > 0 && availableCode > currentCode;
}
