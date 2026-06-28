import type { BusinessSceneState } from "./businessSceneState";
import { INITIAL_BUSINESS_SCENE } from "./businessSceneState";

const STORAGE_KEY = "waka-business-builder-scene-v1";

export function loadBusinessSceneState(): BusinessSceneState {
  if (typeof window === "undefined") return { ...INITIAL_BUSINESS_SCENE };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...INITIAL_BUSINESS_SCENE };
    const parsed = JSON.parse(raw) as Partial<BusinessSceneState>;
    return { ...INITIAL_BUSINESS_SCENE, ...parsed };
  } catch {
    return { ...INITIAL_BUSINESS_SCENE };
  }
}

export function saveBusinessSceneState(state: BusinessSceneState): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

export function clearBusinessSceneState(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
