import { supabase } from "./supabase";

export type AiEntitlementState = "none" | "pending" | "trial" | "active" | "rejected";

export type MyFeatureEntitlements = {
  ai_stock_assistant: AiEntitlementState;
  ai_trial_ends_at: string | null;
};

export async function fetchMyFeatureEntitlements(): Promise<MyFeatureEntitlements | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("my_feature_entitlements");
  if (error || data == null || typeof data !== "object") return null;
  const j = data as Record<string, unknown>;
  const st = String(j.ai_stock_assistant ?? "none") as AiEntitlementState;
  return {
    ai_stock_assistant: ["none", "pending", "trial", "active", "rejected"].includes(st) ? st : "none",
    ai_trial_ends_at: (j.ai_trial_ends_at as string) ?? null,
  };
}

export async function requestAiStockAssistant(): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("request_ai_stock_assistant");
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok) return { ok: true };
  return { ok: false, message: j.error ?? "Could not submit request." };
}

export async function requestFreeAiTrial(): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("request_free_ai_trial");
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok) return { ok: true };
  return { ok: false, message: j.error ?? "Could not submit request." };
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

export function canUseAiStockTools(ent: MyFeatureEntitlements | null): boolean {
  if (!ent) return false;
  if (ent.ai_stock_assistant === "active") return true;
  if (ent.ai_stock_assistant === "trial") {
    if (!ent.ai_trial_ends_at) return true;
    return new Date(ent.ai_trial_ends_at).getTime() > Date.now();
  }
  return false;
}
