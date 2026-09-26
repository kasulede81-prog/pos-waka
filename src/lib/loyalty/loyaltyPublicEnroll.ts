/**
 * Public self-enrollment client (Decision 028).
 * Uses loyalty-public-enroll Edge. Never sends shop_id / account_id / points.
 */

import { WAKA_LOYALTY_URL } from "../../config/company";
import { hasSupabaseConfig } from "../supabase";
import { isValidPublicCardTokenFormat } from "./loyaltyPublicCard";

const ENROLL_FN = "loyalty-public-enroll";

function functionsBase(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url?.trim()) return null;
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

export function buildLoyaltyJoinUrl(
  enrollmentToken: string,
  origin: string = WAKA_LOYALTY_URL,
): string {
  const token = enrollmentToken.trim();
  const base = origin.replace(/\/$/, "");
  return `${base}/join/${encodeURIComponent(token)}`;
}

export type EnrollmentPreview =
  | {
      ok: true;
      shopName: string;
      welcomeMessage: string;
      logoUrl: string;
      primaryColor: string;
      programEnabled: boolean;
    }
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function fetchEnrollmentPreview(token: string): Promise<EnrollmentPreview> {
  if (!hasSupabaseConfig || !isValidPublicCardTokenFormat(token)) {
    return { ok: false, error: "token_invalid" };
  }
  const base = functionsBase();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !anon) return { ok: false, error: "unavailable" };
  try {
    const res = await fetch(`${base}/${ENROLL_FN}?token=${encodeURIComponent(token.trim())}`, {
      method: "GET",
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (res.status === 429) {
      return {
        ok: false,
        error: "rate_limited",
        retryAfterSeconds: Math.max(1, Number(body.retry_after_seconds ?? 1)),
      };
    }
    if (!res.ok || body.ok !== true) {
      return { ok: false, error: String(body.error ?? "not_found") };
    }
    return {
      ok: true,
      shopName: String(body.shop_name ?? ""),
      welcomeMessage: String(body.welcome_message ?? ""),
      logoUrl: String(body.logo_url ?? ""),
      primaryColor: String(body.primary_color ?? ""),
      programEnabled: Boolean(body.program_enabled),
    };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * Phase 2: submitting is a REQUEST, not an enrollment. The possible success outcomes are
 * a queued request awaiting merchant approval, or "you are already a member". Neither
 * carries a card — a card only exists after a merchant approves.
 */
export type PublicEnrollResult =
  | { ok: true; status: "pending"; alreadyRequested: boolean }
  | { ok: true; status: "already_member" }
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function submitPublicEnrollment(input: {
  token: string;
  name: string;
  phone: string;
  email?: string;
  consent: boolean;
}): Promise<PublicEnrollResult> {
  if (!hasSupabaseConfig || !isValidPublicCardTokenFormat(input.token)) {
    return { ok: false, error: "token_invalid" };
  }
  const base = functionsBase();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !anon) return { ok: false, error: "unavailable" };
  try {
    const res = await fetch(`${base}/${ENROLL_FN}`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: input.token.trim(),
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        consent: input.consent,
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (res.status === 429) {
      return {
        ok: false,
        error: "rate_limited",
        retryAfterSeconds: Math.max(1, Number(body.retry_after_seconds ?? 1)),
      };
    }
    if (!res.ok || body.ok !== true) {
      return { ok: false, error: String(body.error ?? "unavailable") };
    }
    if (body.status === "already_member") return { ok: true, status: "already_member" };
    return { ok: true, status: "pending", alreadyRequested: body.already_requested === true };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
