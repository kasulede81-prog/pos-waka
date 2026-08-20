/**
 * RS-CI-0 — POS "Need Help" ticket client.
 *
 * Creates a support_requests row only.
 * Must never start Remote Support or native transport.
 */

import { getOrCreateDeviceId } from "./deviceId";
import { getDeviceOnline } from "./deviceOnline";
import { supabase } from "./supabase";

export const POS_SUPPORT_CATEGORIES = [
  "printer",
  "cash_drawer",
  "scanner",
  "network",
  "waka_pos",
  "account_login",
  "other",
] as const;

export type PosSupportCategory = (typeof POS_SUPPORT_CATEGORIES)[number];

export const POS_SUPPORT_CATEGORY_LABEL_KEYS: Record<PosSupportCategory, string> = {
  printer: "posHelpCategory_printer",
  cash_drawer: "posHelpCategory_cash_drawer",
  scanner: "posHelpCategory_scanner",
  network: "posHelpCategory_network",
  waka_pos: "posHelpCategory_waka_pos",
  account_login: "posHelpCategory_account_login",
  other: "posHelpCategory_other",
};

export type PosSupportSubmitResult =
  | { ok: true; ticketId: string }
  | { ok: false; error: "offline" | "description_required" | "forbidden" | "not_authenticated" | "shop_unavailable" | "failed"; message?: string };

export function canSeePosNeedHelp(input: {
  authenticated: boolean;
  internalAdminRoute?: boolean;
  posLocked?: boolean;
}): boolean {
  return input.authenticated === true && input.internalAdminRoute !== true && input.posLocked !== true;
}

export function normalizePosSupportCategory(raw: string | null | undefined): PosSupportCategory | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return (POS_SUPPORT_CATEGORIES as readonly string[]).includes(value) ? (value as PosSupportCategory) : null;
}

export function validatePosSupportForm(input: { description: string; category?: string | null }): {
  ok: boolean;
  error?: "description_required";
  description?: string;
  category?: PosSupportCategory | null;
} {
  const description = String(input.description ?? "").trim();
  if (description.length < 3) return { ok: false, error: "description_required" };
  return { ok: true, description, category: normalizePosSupportCategory(input.category) };
}

export function buildPosSupportDiagnostics(input?: { category?: PosSupportCategory | null; role?: string | null }): {
  deviceId: string;
  appVersion: string;
  source: "pos_need_help";
  category: PosSupportCategory | null;
  role: string | null;
} {
  return {
    deviceId: getOrCreateDeviceId(),
    appVersion: import.meta.env.VITE_APP_VERSION?.trim() || "1.0.12",
    source: "pos_need_help",
    category: input?.category ?? null,
    role: input?.role ?? null,
  };
}

export function tryBeginPosHelpSubmit(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function posSupportSubject(description: string, category: PosSupportCategory | null): string {
  const label = category ? category.replace(/_/g, " ") : "POS help";
  const clipped = description.trim().slice(0, 80);
  return `${label}: ${clipped}`.slice(0, 200);
}

export async function submitPosSupportTicket(input: {
  shopId: string | null | undefined;
  description: string;
  category?: string | null;
  role?: string | null;
}): Promise<PosSupportSubmitResult> {
  const parsed = validatePosSupportForm(input);
  if (!parsed.ok || !parsed.description) return { ok: false, error: "description_required" };
  if (!getDeviceOnline() || !supabase) return { ok: false, error: "offline" };
  const shopId = String(input.shopId ?? "").trim();
  if (!shopId) return { ok: false, error: "shop_unavailable" };

  const diagnostics = buildPosSupportDiagnostics({ category: parsed.category, role: input.role });
  const { data, error } = await supabase.rpc("shop_submit_pos_support_ticket", {
    p_shop_id: shopId,
    p_subject: posSupportSubject(parsed.description, parsed.category ?? null),
    p_body: parsed.description,
    p_issue_type: parsed.category ?? "pos_support",
    p_diagnostics: diagnostics,
  });
  if (error) {
    if (import.meta.env.DEV) {
      console.error("Support request failed", error);
    }
    return { ok: false, error: "failed", message: error.message };
  }
  const j = data as { ok?: boolean; ticket_id?: string; error?: string };
  if (j?.ok && j.ticket_id) return { ok: true, ticketId: String(j.ticket_id) };
  if (j?.error === "forbidden" || j?.error === "not_authenticated" || j?.error === "description_required") {
    if (import.meta.env.DEV) {
      console.error("Support request failed", j);
    }
    return { ok: false, error: j.error };
  }
  if (import.meta.env.DEV) {
    console.error("Support request failed", j);
  }
  return { ok: false, error: "failed", message: j?.error ?? "Failed" };
}
