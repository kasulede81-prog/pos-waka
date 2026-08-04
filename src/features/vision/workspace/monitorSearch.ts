import type { VisionCamera } from "../types";

/** Filter cameras for monitor search (name, zone, recorder, brand, branch, POS). */
export function filterVisionCameras(cameras: VisionCamera[], query: string): VisionCamera[] {
  const q = query.trim().toLowerCase();
  if (!q) return cameras;
  return cameras.filter((c) => {
    const hay = [
      c.name,
      c.locationLabel,
      c.zoneId,
      c.nvrHost ?? "",
      c.brand ?? "",
      c.model ?? "",
      c.branchLabel ?? "",
      c.assignedPosLabel ?? "",
      c.ip ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function listVisionBranches(cameras: VisionCamera[]): string[] {
  const set = new Set<string>();
  for (const c of cameras) {
    const label = (c.branchLabel || "Main Shop").trim() || "Main Shop";
    set.add(label);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function filterByBranch(cameras: VisionCamera[], branch: string | null): VisionCamera[] {
  if (!branch) return cameras;
  return cameras.filter((c) => (c.branchLabel || "Main Shop") === branch);
}

/** Favorites first, then alphabetical. */
export function sortWithFavorites(cameras: VisionCamera[], favoriteIds: string[]): VisionCamera[] {
  const fav = new Set(favoriteIds);
  return [...cameras].sort((a, b) => {
    const af = fav.has(a.id) ? 0 : 1;
    const bf = fav.has(b.id) ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.name.localeCompare(b.name);
  });
}
