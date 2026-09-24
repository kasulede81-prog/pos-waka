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

/** Customer-facing loyalty card — no merchant login (web). Token is opaque hex. */
export function isPublicLoyaltyCardPath(pathname: string): boolean {
  const raw = pathname.split("?")[0] || "/";
  const p = raw.length > 1 ? raw.replace(/\/$/, "") : raw;
  // B3: /c/<token> (canonical). Legacy /loyalty/<token> still recognized until redirects dominate.
  return /^\/(c|loyalty)\/[a-f0-9]{64}$/i.test(p);
}

/** Public self-enrollment join page — opaque enrollment token (not public_card_token). */
export function isPublicLoyaltyJoinPath(pathname: string): boolean {
  const raw = pathname.split("?")[0] || "/";
  const p = raw.length > 1 ? raw.replace(/\/$/, "") : raw;
  return /^\/join\/[a-f0-9]{64}$/i.test(p);
}

/** Paths where Supabase returns after email/OAuth — must render immediately (no startup gate). */
export function isAuthHandoffPath(pathname: string): boolean {
  const p = pathname.split("?")[0] || "/";
  return p === "/auth/callback" || p === "/auth/recovery" || p === "/reset-password";
}

/** Paths that must render before auth/session bootstrap finishes (marketing + sign-in). */
export function isStartupPublicPath(pathname: string): boolean {
  const p = pathname.split("?")[0] || "/";
  if (p === "/" || p === "/home") return true;
  if (NATIVE_PUBLIC_PATHS.has(p)) return true;
  if (isAuthHandoffPath(p)) return true;
  if (isVerifyAgentPath(p)) return true;
  if (isPublicLoyaltyCardPath(p)) return true;
  if (isPublicLoyaltyJoinPath(p)) return true;
  return isNativeMarketingPath(p);
}

/** Paths reachable before sign-in on Android/iOS (auth + legal footer links). */
export const NATIVE_PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/verify-email",
  "/staff/accept",
  "/auth/callback",
  "/auth/recovery",
  "/reset-password",
  "/terms",
  "/privacy",
  "/acceptable-use",
  "/support",
]);

const NATIVE_MARKETING_PREFIXES = ["/home", "/about", "/pricing", "/contact", "/founder", "/company", "/demo", "/solutions"] as const;

export function isNativeMarketingPath(pathname: string): boolean {
  const p = pathname.split("?")[0] || "/";
  if (p === "/about/founder") return true;
  return NATIVE_MARKETING_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
