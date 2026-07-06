/** Persists floor scroll/zoom/area across order screen navigation. */

export type FloorViewState = {
  areaId: string | null;
  scrollTop: number;
  zoom: number;
};

const STORAGE_KEY = "waka-hospitality-floor-view";

export function saveFloorViewState(state: FloorViewState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadFloorViewState(): FloorViewState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloorViewState>;
    return {
      areaId: parsed.areaId ?? null,
      scrollTop: typeof parsed.scrollTop === "number" ? parsed.scrollTop : 0,
      zoom: typeof parsed.zoom === "number" ? Math.min(1.4, Math.max(0.75, parsed.zoom)) : 1,
    };
  } catch {
    return null;
  }
}

export function clearFloorViewState(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
