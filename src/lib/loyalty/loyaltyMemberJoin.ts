/**
 * Authenticated member join (Phase 2C) — the client half of `loyalty_member_join_by_code`.
 *
 * The ONLY thing this sends is the public WPL code. There is no member, account, shop or
 * organization parameter, because the RPC has none: it derives the member from `auth.uid()` and
 * re-resolves the merchant from the code itself. So there is nothing here for a caller to forge,
 * and nothing here to keep in sync with the server's view of who they are.
 *
 * This is a different path from `loyaltyPublicProgram.ts`, which talks to the anonymous
 * `loyalty-public-program` Edge Function with the anon key. That function stays a public lookup;
 * it was deliberately NOT turned into an authenticated authority. This module uses the member's own
 * Supabase session, which is what makes `auth.uid()` meaningful server-side.
 *
 * The outcome is still a PENDING enrollment request a merchant must approve. Authentication proves
 * who asked; it does not decide whether they may join.
 */

import { hasSupabaseConfig, supabase } from "../supabase";
import { isValidProgramCodeFormat, normalizeProgramCode } from "./loyaltyPublicProgram";

export type MemberJoinResult =
  /** Queued (or already queued) for merchant review. */
  | { ok: true; status: "pending"; alreadyRequested: boolean }
  /** Already a member of this program — nothing to request. */
  | { ok: true; status: "already_member" }
  | { ok: false; error: string };

export async function joinLoyaltyProgramByCode(code: string): Promise<MemberJoinResult> {
  const normalized = normalizeProgramCode(code);
  if (!isValidProgramCodeFormat(normalized)) return { ok: false, error: "code_invalid" };
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "offline" };

  try {
    // Exactly one argument. If this ever grows a second one carrying an id, the security property
    // of the whole flow is gone — the server accepts nothing else by construction.
    const { data, error } = await supabase.rpc("loyalty_member_join_by_code", { p_code: normalized });
    if (error) return { ok: false, error: "unavailable" };

    const raw = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown> | null;
    if (!raw || raw.ok !== true) {
      return { ok: false, error: String(raw?.error ?? "unavailable") };
    }
    if (raw.status === "already_member") return { ok: true, status: "already_member" };
    return { ok: true, status: "pending", alreadyRequested: raw.already_requested === true };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** Human-readable text for the errors the RPC can return. */
export function memberJoinErrorText(error: string): string {
  switch (error) {
    case "not_authenticated":
      return "Your session expired. Sign in again and retry.";
    case "not_a_member":
      return "Create your WAKA Loyalty profile first, then join this shop.";
    case "member_phone_required":
      return "Add a phone number to your WAKA Loyalty profile before joining a shop.";
    case "code_invalid":
      return "That WAKA Loyalty Code is not valid.";
    case "not_found":
      return "We could not find that shop's loyalty programme.";
    case "unavailable":
      return "This shop is not accepting new members right now.";
    case "loyalty_request_queue_full":
      return "This shop has too many pending requests. Please try again later.";
    case "offline":
      return "We could not reach WAKA. Check your connection and try again.";
    default:
      return "We could not send your request. Please try again.";
  }
}
