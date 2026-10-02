import { SOLUTION_PAGE_SLUGS } from "./solutionPages";

/** Public marketing/legal paths that should be indexed (per-page SeoHead sets details). */
export const MARKETING_INDEXABLE_PATHS = new Set([
  "/home",
  "/about",
  "/pricing",
  "/contact",
  "/founder",
  "/company",
  "/support",
  "/terms",
  "/privacy",
  "/acceptable-use",
  ...SOLUTION_PAGE_SLUGS.map((slug) => `/solutions/${slug}`),
]);

export function normalizePathname(pathname: string): string {
  const base = pathname.split("?")[0] || "/";
  if (base.length > 1 && base.endsWith("/")) return base.slice(0, -1);
  return base;
}

export function isMarketingIndexablePath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  if (p === "/about/founder") return true;
  return MARKETING_INDEXABLE_PATHS.has(p);
}

export function noIndexSeoTitle(pathname: string): string {
  const p = normalizePathname(pathname);
  if (p.startsWith("/verify-agent/")) return "Verify DKASU Agent";
  if (p === "/login") return "Sign in to DKASU POS";
  if (p === "/register") return "Create a DKASU POS account";
  if (p === "/demo") return "DKASU POS Demo";
  if (p === "/forgot-password") return "Reset DKASU POS password";
  if (p === "/reset-password") return "Set new password";
  if (p === "/verify-email") return "Verify your email";
  if (p === "/auth/callback") return "Signing in";
  if (p === "/auth/recovery") return "Password recovery";
  if (p.startsWith("/internal/")) return "DKASU POS Admin";
  if (p.startsWith("/loyalty/") || p.startsWith("/c/")) return "DKASU Loyalty";
  return "DKASU POS";
}
