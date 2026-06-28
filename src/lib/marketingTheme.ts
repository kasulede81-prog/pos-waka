/** localStorage key for marketing site color preference. */
export const MARKETING_THEME_STORAGE_KEY = "waka-marketing-theme";

export type MarketingThemePreference = "system" | "light" | "dark";
export type MarketingThemeResolved = "light" | "dark";

const MARKETING_PATH_PREFIXES = [
  "/home",
  "/pricing",
  "/about",
  "/contact",
  "/founder",
  "/company",
  "/support",
  "/demo",
  "/terms",
  "/privacy",
  "/solutions",
] as const;

export function isMarketingPublicPath(pathname: string): boolean {
  return MARKETING_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function readStoredMarketingTheme(): MarketingThemePreference | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(MARKETING_THEME_STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return null;
}

export function persistMarketingTheme(preference: MarketingThemePreference): void {
  localStorage.setItem(MARKETING_THEME_STORAGE_KEY, preference);
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveMarketingTheme(preference: MarketingThemePreference | null): MarketingThemeResolved {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemPrefersDark() ? "dark" : "light";
}

export function cycleMarketingTheme(current: MarketingThemePreference): MarketingThemePreference {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

export function marketingThemeColorMeta(resolved: MarketingThemeResolved): string {
  return resolved === "dark" ? "#0B0F19" : "#FFFFFF";
}

/** Runs before React paint on marketing routes to avoid theme flash. */
export function bootstrapMarketingThemeClass(): void {
  if (typeof document === "undefined") return;
  const path = window.location.pathname;
  if (!isMarketingPublicPath(path)) return;

  const stored = readStoredMarketingTheme();
  const resolved = resolveMarketingTheme(stored);
  document.documentElement.classList.toggle("marketing-theme-dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", marketingThemeColorMeta(resolved));
}
