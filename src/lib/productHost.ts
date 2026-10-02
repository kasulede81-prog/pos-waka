/**
 * Product surfaces — which WAKA product a session belongs to, decided by HOSTNAME.
 *
 *   pos.waka.ug      merchant / staff WAKA POS
 *   loyalty.waka.ug  customer-facing WAKA Loyalty
 *
 * The host is the ONLY input, and that is the whole point. Product intent is deliberately NOT
 * derived from auth metadata, from Google profile data, or from anything else a user carries
 * between surfaces: the host a session STARTS and RETURNS on is what separates "I came here to
 * collect points" from "I came here to run my shop", and it survives an OAuth round trip for free
 * because the redirect returns to the same origin it started on.
 *
 * NOTHING HERE PROVISIONS ANYTHING. Product intent selects a SURFACE and a landing route. Whether
 * a session may be bootstrapped into a tenancy is still decided server-side by
 * `waka_account_identity()` through `resolveAccountIdentity` (memberIdentity.ts), and a session on
 * the loyalty host does not become a merchant, or a member, because of the host alone.
 */

import { WAKA_LOYALTY_URL, WAKA_POS_URL } from "../config/company";
import {
  isPublicLoyaltyCardPath,
  isPublicLoyaltyJoinPath,
  isPublicLoyaltyProgramPath,
} from "./nativeApp";

export type ProductAuthIntent = "merchant" | "member";

export const POS_PRODUCT_HOST = "pos.waka.ug";
export const LOYALTY_PRODUCT_HOST = "loyalty.waka.ug";

/**
 * DKASU production hosts.
 *
 * BOTH GENERATIONS ARE RECOGNISED during the migration, and that is a correctness fix rather than
 * a rename. Host matching was an equality check against the two WAKA constants, so on the new
 * domains every check failed: `loyalty.dkasu.com` did not classify as a loyalty host and fell
 * through to the `merchant` default, which would have left the customer surface inert on its own
 * production domain.
 */
export const DKASU_POS_PRODUCT_HOST = "pos.dkasu.com";
export const DKASU_LOYALTY_PRODUCT_HOST = "loyalty.dkasu.com";

const POS_HOSTS: ReadonlySet<string> = new Set([POS_PRODUCT_HOST, DKASU_POS_PRODUCT_HOST]);
const LOYALTY_HOSTS: ReadonlySet<string> = new Set([LOYALTY_PRODUCT_HOST, DKASU_LOYALTY_PRODUCT_HOST]);

/**
 * Where a loyalty-host session goes when it asks for something that is not part of the customer
 * app. `/member` renders the member home, or the registration form for a session that is not a
 * member yet, and it is behind `ProtectedRoute` — so a signed-out visitor lands on `/login`.
 */
export const LOYALTY_SURFACE_HOME = "/member";

/** Lowercase, port-stripped, trailing-dot-stripped. Never throws on empty or malformed input. */
export function normalizeHostname(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "";
  const host = value.split(":")[0] ?? "";
  return host.replace(/\.$/, "");
}

function currentHostname(): string {
  if (typeof window === "undefined") return "";
  return normalizeHostname(window.location?.hostname);
}

export function isPosHost(hostname: string = currentHostname()): boolean {
  return POS_HOSTS.has(normalizeHostname(hostname));
}

export function isLoyaltyHost(hostname: string = currentHostname()): boolean {
  return LOYALTY_HOSTS.has(normalizeHostname(hostname));
}

/**
 * `VITE_PRODUCT_INTENT` is an explicit local-development opt-in for exercising the customer
 * surface on localhost. It is read ONLY when the host is not a known product host, so a production
 * origin can never be overridden by a stray environment variable.
 */
function readIntentOverride(): ProductAuthIntent | null {
  const raw = String(import.meta.env.VITE_PRODUCT_INTENT ?? "").trim().toLowerCase();
  if (raw === "member" || raw === "loyalty") return "member";
  if (raw === "merchant" || raw === "pos") return "merchant";
  return null;
}

/**
 * The initial product intent for a brand-new authentication session.
 *
 * Unknown hosts — localhost, a LAN address, a Vercel preview, any future custom domain — resolve
 * to `merchant`, which is what every existing deployment, every dev machine and the Android shell
 * already are. That default is what keeps this change inert until loyalty.waka.ug is actually
 * pointed at a loyalty build.
 */
export function getProductAuthIntent(hostname: string = currentHostname()): ProductAuthIntent {
  if (isLoyaltyHost(hostname)) return "member";
  if (isPosHost(hostname)) return "merchant";
  return readIntentOverride() ?? "merchant";
}

/** True when this session is on the customer Loyalty surface. */
export function isLoyaltySurface(): boolean {
  return getProductAuthIntent() === "member";
}

/**
 * The canonical public origin for a host, or null when the host is not a product surface.
 * Returning null (rather than guessing) is what lets `authConfig` keep its existing
 * `VITE_APP_URL` / canonical fallback behaviour untouched everywhere else.
 */
export function productOriginForHostname(hostname: string = currentHostname()): string | null {
  if (isLoyaltyHost(hostname)) return WAKA_LOYALTY_URL.replace(/\/$/, "");
  if (isPosHost(hostname)) return WAKA_POS_URL.replace(/\/$/, "");
  return null;
}

/** The absolute URL of the other product, for the "wrong host" cross-links. */
export function posOrigin(): string {
  return WAKA_POS_URL.replace(/\/$/, "");
}

export function loyaltyOrigin(): string {
  return WAKA_LOYALTY_URL.replace(/\/$/, "");
}

/**
 * The paths that make up the customer app on loyalty.waka.ug.
 *
 * Deliberately an ALLOW list, not a deny list: a merchant route added later is excluded by
 * default rather than exposed by accident. It covers the customer journey (sign in, sign up,
 * member home) plus the auth handoff and legal/support pages those screens link to.
 */
export const LOYALTY_SURFACE_PATHS: ReadonlySet<string> = new Set([
  "/login",
  "/member",
  "/member/register",
  "/auth/callback",
  "/verify-email",
  "/forgot-password",
  "/auth/recovery",
  "/reset-password",
  "/terms",
  "/privacy",
  "/acceptable-use",
  "/support",
]);

/** True when `pathname` belongs to the customer app and may render on the loyalty host. */
export function isLoyaltySurfacePath(pathname: string): boolean {
  const raw = String(pathname ?? "").split("?")[0] || "/";
  const path = raw.length > 1 ? raw.replace(/\/$/, "") : raw;
  if (LOYALTY_SURFACE_PATHS.has(path)) return true;
  // The card a customer opens from a share link, the join page an enrollment link opens, and the
  // program page a merchant QR opens.
  return (
    isPublicLoyaltyCardPath(path) ||
    isPublicLoyaltyJoinPath(path) ||
    isPublicLoyaltyProgramPath(path)
  );
}
