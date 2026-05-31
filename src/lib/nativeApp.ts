import { Capacitor } from "@capacitor/core";

/** True when running inside Capacitor Android/iOS (not the public marketing site). */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Where signed-out users should land: login on native, marketing home on web. */
export function unauthenticatedEntryPath(): "/login" | "/home" {
  return isNativeApp() ? "/login" : "/home";
}

/** Logo / back links on public pages (support, legal, auth). */
export function publicBrandHref(isAuthenticated: boolean): string {
  return isAuthenticated ? "/" : unauthenticatedEntryPath();
}

/** Native signed-out pages use the same shell as login (logo + legal footer), not marketing chrome. */
export function useAuthShellForPublicPage(isAuthenticated: boolean): boolean {
  return isAuthenticated || isNativeApp();
}

export function isVerifyAgentPath(pathname: string): boolean {
  const p = pathname.split("?")[0] || "/";
  return p === "/verify-agent" || p.startsWith("/verify-agent/");
}

/** Paths reachable before sign-in on Android/iOS (auth + legal footer links). */
export const NATIVE_PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/verify-email",
  "/auth/callback",
  "/auth/recovery",
  "/reset-password",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/acceptable-use",
  "/support",
]);

const NATIVE_MARKETING_PREFIXES = ["/home", "/about", "/contact", "/founder", "/company", "/demo"] as const;

export function isNativeMarketingPath(pathname: string): boolean {
  const p = pathname.split("?")[0] || "/";
  if (p === "/about/founder") return true;
  return NATIVE_MARKETING_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
