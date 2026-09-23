export const ACCESSIBILITY_PREFERENCES_KEY = "waka.accessibility.preferences.v1";

export type TextSizePreference = "default" | "large" | "extra-large";

export type AccessibilityPreferences = {
  reducedMotion: boolean;
  textSize: TextSizePreference;
  highContrast: boolean;
};

export const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  reducedMotion: false,
  textSize: "default",
  highContrast: false,
};

export function parseAccessibilityPreferences(value: string | null): AccessibilityPreferences {
  if (!value) return DEFAULT_ACCESSIBILITY_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as Partial<AccessibilityPreferences>;
    const textSize: TextSizePreference =
      parsed.textSize === "large" || parsed.textSize === "extra-large" ? parsed.textSize : "default";
    return {
      reducedMotion: parsed.reducedMotion === true,
      textSize,
      highContrast: parsed.highContrast === true,
    };
  } catch {
    return DEFAULT_ACCESSIBILITY_PREFERENCES;
  }
}

export function readAccessibilityPreferences(): AccessibilityPreferences {
  if (typeof window === "undefined") return DEFAULT_ACCESSIBILITY_PREFERENCES;
  return parseAccessibilityPreferences(window.localStorage.getItem(ACCESSIBILITY_PREFERENCES_KEY));
}

export function persistAccessibilityPreferences(preferences: AccessibilityPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACCESSIBILITY_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences still apply for this session when storage is unavailable.
  }
}

export function applyAccessibilityPreferences(preferences: AccessibilityPreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.textSize = preferences.textSize;
  root.toggleAttribute("data-high-contrast", preferences.highContrast);
  root.toggleAttribute("data-reduce-motion", preferences.reducedMotion);
}
