/** App-wide color theme (logged-in POS + auth + marketing). */
export const APP_THEME_STORAGE_KEY = "waka-app-theme";

/** Legacy marketing-only key — read for migration, then write to APP_THEME_STORAGE_KEY. */
const LEGACY_MARKETING_THEME_KEY = "waka-marketing-theme";

export type AppThemePreference = "system" | "light" | "dark";
export type AppThemeResolved = "light" | "dark";

export function readStoredAppTheme(): AppThemePreference | null {
  if (typeof window === "undefined") return null;
  const raw =
    localStorage.getItem(APP_THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_MARKETING_THEME_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return null;
}

export function persistAppTheme(preference: AppThemePreference): void {
  localStorage.setItem(APP_THEME_STORAGE_KEY, preference);
  localStorage.removeItem(LEGACY_MARKETING_THEME_KEY);
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveAppTheme(preference: AppThemePreference | null): AppThemeResolved {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemPrefersDark() ? "dark" : "light";
}

export function cycleAppTheme(current: AppThemePreference): AppThemePreference {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

export function appThemeColorMeta(resolved: AppThemeResolved): string {
  return resolved === "dark" ? "#0B0F19" : "#fafaf9";
}

export function applyAppThemeClass(resolved: AppThemeResolved): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const isDark = resolved === "dark";
  root.classList.toggle("dark", isDark);
  root.classList.toggle("marketing-theme-dark", isDark);
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", appThemeColorMeta(resolved));
}

/** Runs before React paint to avoid theme flash on any route. */
export function bootstrapAppThemeClass(): void {
  applyAppThemeClass(resolveAppTheme(readStoredAppTheme()));
}
