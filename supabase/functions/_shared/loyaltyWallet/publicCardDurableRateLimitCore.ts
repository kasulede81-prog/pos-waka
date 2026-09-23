/**
 * Pure helpers for durable public-card rate limiting (no Deno npm: imports).
 * Shared by Edge and Vitest.
 */

export const RATE_SCOPE_CARD_READ = "card_read" as const;
export const RATE_SCOPE_WALLET_ISSUE = "wallet_issue" as const;

export type RateScope = typeof RATE_SCOPE_CARD_READ | typeof RATE_SCOPE_WALLET_ISSUE;

/** Shared bucket key material when no trustworthy client IP can be established. */
export const UNTRUSTED_IP_MATERIAL = "untrusted";

export const CARD_READ_IP_LIMIT = 60;
export const CARD_READ_IP_WINDOW_MS = 60_000;
export const CARD_READ_TOKEN_LIMIT = 30;
export const CARD_READ_TOKEN_WINDOW_MS = 60_000;

export const WALLET_ISSUE_IP_LIMIT = 10;
export const WALLET_ISSUE_IP_WINDOW_MS = 60_000;
export const WALLET_ISSUE_TOKEN_LIMIT = 5;
export const WALLET_ISSUE_TOKEN_WINDOW_MS = 600_000; // 10 minutes

export type TrustedIpResult =
  | { trusted: true; ip: string }
  | { trusted: false; reason: "missing" | "spoofable_xff_only" };

/**
 * Prefer platform-injected single-value IPs.
 * Never trust leftmost X-Forwarded-For (browser-influenced).
 */
export function resolveTrustedClientIp(req: Request): TrustedIpResult {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf && isPlausibleIp(cf)) return { trusted: true, ip: cf };

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp && isPlausibleIp(realIp)) return { trusted: true, ip: realIp };

  const xff = req.headers.get("x-forwarded-for")?.trim();
  if (xff) return { trusted: false, reason: "spoofable_xff_only" };
  return { trusted: false, reason: "missing" };
}

function isPlausibleIp(value: string): boolean {
  if (!value || value.length > 64) return false;
  if (value.includes(",") || value.includes(" ")) return false;
  return /^[0-9a-fA-F:.]+$/.test(value);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashRateLimitKey(material: string): Promise<string> {
  return sha256Hex(material);
}

/** Build hashed IP material: trusted IP or shared untrusted bucket. */
export async function resolveIpHashForRateLimit(req: Request): Promise<string> {
  const resolved = resolveTrustedClientIp(req);
  if (resolved.trusted) return hashRateLimitKey(`ip:${resolved.ip}`);
  return hashRateLimitKey(`ip:${UNTRUSTED_IP_MATERIAL}`);
}
