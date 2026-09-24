/**
 * Merchant enrollment-link RPCs (Decision 028).
 */

import { hasSupabaseConfig, supabase } from "../supabase";

export type EnrollmentLinkState = {
  active: boolean;
  token: string | null;
  linkId: string | null;
  label: string | null;
  createdAt: string | null;
  registrationsTotal: number;
  recentRegistrations: Array<{ accountId: string; customerName: string; enrolledAt: string }>;
};

export async function fetchEnrollmentLink(shopId: string): Promise<EnrollmentLinkState | null> {
  if (!hasSupabaseConfig || !supabase || !shopId) return null;
  try {
    const { data, error } = await supabase.rpc("loyalty_get_enrollment_link", {
      p_shop_id: shopId,
    });
    if (error) return null;
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok !== true) return null;
    const recent = Array.isArray(r.recent_registrations) ? r.recent_registrations : [];
    return {
      active: r.active === true,
      token: r.token == null ? null : String(r.token),
      linkId: r.link_id == null ? null : String(r.link_id),
      label: r.label == null ? null : String(r.label),
      createdAt: r.created_at == null ? null : String(r.created_at),
      registrationsTotal: Number(r.registrations_total ?? 0),
      recentRegistrations: recent.map((row) => {
        const x = row as Record<string, unknown>;
        return {
          accountId: String(x.account_id ?? ""),
          customerName: String(x.customer_name ?? ""),
          enrolledAt: String(x.enrolled_at ?? ""),
        };
      }),
    };
  } catch {
    return null;
  }
}

export async function regenerateEnrollmentLink(
  shopId: string,
  label?: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!hasSupabaseConfig || !supabase || !shopId) return { ok: false, error: "unavailable" };
  try {
    const { data, error } = await supabase.rpc("loyalty_regenerate_enrollment_link", {
      p_shop_id: shopId,
      p_label: label ?? null,
    });
    if (error) return { ok: false, error: error.code ?? "failed" };
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok !== true) return { ok: false, error: String(r.error ?? "rejected") };
    return { ok: true, token: String(r.token) };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function revokeEnrollmentLink(
  shopId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasSupabaseConfig || !supabase || !shopId) return { ok: false, error: "unavailable" };
  try {
    const { data, error } = await supabase.rpc("loyalty_revoke_enrollment_link", {
      p_shop_id: shopId,
    });
    if (error) return { ok: false, error: error.code ?? "failed" };
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok !== true) return { ok: false, error: String(r.error ?? "rejected") };
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}
