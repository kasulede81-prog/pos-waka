/**
 * Public WAKA Loyalty Program code client (WPL2026001).
 *
 * Uses the `loyalty-public-program` Edge Function — the same public architecture as
 * `loyalty-public-enroll` and `loyalty-public-card`. There is deliberately NO direct
 * `supabase.rpc` here: the code lookup functions are service-role only, so a browser cannot reach
 * them at all, and every request passes the durable rate limiter on the way in.
 *
 * Never sends shop_id / account_id / points. A code identifies the MERCHANT; it never creates a
 * member and never returns an internal identifier.
 */

import { WAKA_LOYALTY_URL } from "../../config/company";
import { hasSupabaseConfig } from "../supabase";

const PROGRAM_FN = "loyalty-public-program";

/** The exact shape the database CHECK enforces: WPL + 4-digit year + 3-or-more digits. */
export const PROGRAM_CODE_RE = /^WPL[0-9]{4}[0-9]{3,9}$/;

export function normalizeProgramCode(raw: string): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidProgramCodeFormat(raw: string): boolean {
  return PROGRAM_CODE_RE.test(normalizeProgramCode(raw));
}

/**
 * The QR payload and the manual-entry target, from ONE builder.
 *
 * Scanning and typing therefore reach the same resolver by construction rather than by
 * convention — which is the only way "QR and manual entry identify the same program" stays true
 * after someone edits one of them.
 */
export function buildProgramJoinUrl(programCode: string, origin: string = WAKA_LOYALTY_URL): string {
  const code = normalizeProgramCode(programCode);
  const base = origin.replace(/\/$/, "");
  return `${base}/j/${encodeURIComponent(code)}`;
}

export function buildProgramJoinPath(programCode: string): string {
  return `/j/${encodeURIComponent(normalizeProgramCode(programCode))}`;
}

/** The code embedded in a scanned URL, or null when the payload is not a program QR. */
export function parseProgramCodeFromUrl(scanned: string): string | null {
  const value = String(scanned ?? "").trim();
  if (!value) return null;
  // A bare code is accepted so a QR that encodes only the code also works.
  const bare = normalizeProgramCode(value);
  if (PROGRAM_CODE_RE.test(bare)) return bare;
  try {
    const url = new URL(value);
    const m = /^\/j\/([^/?#]+)/.exec(url.pathname);
    if (!m?.[1]) return null;
    const code = normalizeProgramCode(decodeURIComponent(m[1]));
    return PROGRAM_CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

function functionsBase(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url?.trim()) return null;
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

/**
 * The safe merchant identity a customer sees before deciding to join.
 *
 * Display fields only. There is no shop id, no organization id, no account/member/customer id,
 * no phone, no email, no token and no member count in this type — and the Edge Function rebuilds
 * the payload field by field so one cannot appear at runtime either.
 */
export type ProgramPreview =
  | {
      ok: true;
      code: string;
      programName: string;
      shopName: string;
      district: string | null;
      businessType: string | null;
      enabled: boolean;
    }
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function fetchProgramPreview(programCode: string): Promise<ProgramPreview> {
  const code = normalizeProgramCode(programCode);
  if (!hasSupabaseConfig || !isValidProgramCodeFormat(code)) {
    // Same answer the server gives for a malformed or unknown code, so a typo and a stranger look
    // identical from the UI as well as from the API.
    return { ok: false, error: "not_found" };
  }
  const base = functionsBase();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !anon) return { ok: false, error: "unavailable" };
  try {
    const res = await fetch(`${base}/${PROGRAM_FN}?code=${encodeURIComponent(code)}`, {
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
      code: String(body.code ?? ""),
      programName: String(body.program_name ?? ""),
      shopName: String(body.shop_name ?? ""),
      district: body.district == null ? null : String(body.district),
      businessType: body.business_type == null ? null : String(body.business_type),
      enabled: Boolean(body.enabled),
    };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * Request to join the program the code identifies.
 *
 * A REQUEST, not an enrollment — a merchant still approves it, and no membership or card exists
 * until they do. The customer's own identity is established separately by authentication; this
 * call carries no identity at all.
 */
export type ProgramJoinResult =
  | { ok: true; status: "pending"; alreadyRequested: boolean }
  | { ok: true; status: "already_member" }
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function submitProgramJoin(input: {
  code: string;
  name: string;
  phone: string;
  email?: string;
  consent: boolean;
}): Promise<ProgramJoinResult> {
  const code = normalizeProgramCode(input.code);
  if (!hasSupabaseConfig || !isValidProgramCodeFormat(code)) {
    return { ok: false, error: "code_invalid" };
  }
  const base = functionsBase();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !anon) return { ok: false, error: "unavailable" };
  try {
    const res = await fetch(`${base}/${PROGRAM_FN}`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
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
