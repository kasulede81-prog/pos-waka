import type { StaffAccount } from "../types";

function slugFromName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12);
  return base || "staff";
}

/** Internal login id — not shown to shop owners in the simple create flow. */
export function generateStaffUsername(name: string, existing: StaffAccount[]): string {
  const taken = new Set(existing.map((s) => (s.username ?? "").toLowerCase()).filter(Boolean));
  const base = slugFromName(name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}${Date.now().toString(36).slice(-4)}`;
}
