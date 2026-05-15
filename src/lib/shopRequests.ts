import { supabase } from "./supabase";
import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";

export async function fetchStarterTrialRequestGateForUser(userId: string): Promise<{
  starterRequestConsumed: boolean;
  pendingStarterRequestCreatedAt: string | null;
}> {
  if (!supabase) return { starterRequestConsumed: false, pendingStarterRequestCreatedAt: null };
  const org = await resolvePrimaryOrganizationForUser(userId);
  if (!org) return { starterRequestConsumed: false, pendingStarterRequestCreatedAt: null };

  const { data, error } = await supabase
    .from("subscription_requests")
    .select("status, created_at, requested_plan")
    .eq("organization_id", org.organizationId)
    .eq("requested_plan", "starter")
    .order("created_at", { ascending: false });

  if (error || !data?.length) return { starterRequestConsumed: false, pendingStarterRequestCreatedAt: null };

  let starterRequestConsumed = false;
  let pendingStarterRequestCreatedAt: string | null = null;
  for (const r of data) {
    const st = String(r.status ?? "").toLowerCase();
    if (st === "pending") pendingStarterRequestCreatedAt = pendingStarterRequestCreatedAt ?? (r.created_at as string);
    if (["approved", "rejected", "extended"].includes(st)) starterRequestConsumed = true;
  }
  return { starterRequestConsumed, pendingStarterRequestCreatedAt };
}

export async function requestSubscriptionPlanChange(
  plan: "starter" | "business" | "waka_plus",
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("request_subscription_plan_change", { p_requested_plan: plan });
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok) return { ok: true };
  return { ok: false, message: j.error ?? "Could not submit plan request." };
}

export async function requestAnnualPlanSupport(): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("request_annual_plan_support");
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok) return { ok: true };
  return { ok: false, message: j.error ?? "Could not submit request." };
}
