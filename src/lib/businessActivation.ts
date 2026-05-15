import { supabase } from "./supabase";

export type ActivationLifecycle = "inactive" | "pending_review" | "active" | "suspended";

export type ActivationGatePayload = {
  shop_id: string | null;
  lifecycle: ActivationLifecycle | string;
  reference_code: string | null;
  open_request: {
    id: string;
    business_display_name: string;
    public_reference_code: string;
    status: string;
    created_at: string;
  } | null;
  active_license_key: string | null;
};

export async function fetchMyActivationGate(): Promise<ActivationGatePayload | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_my_shop_activation_gate");
  if (error || data == null || typeof data !== "object") return null;
  const j = data as Record<string, unknown>;
  return {
    shop_id: typeof j.shop_id === "string" ? j.shop_id : null,
    lifecycle: String(j.lifecycle ?? "inactive"),
    reference_code: typeof j.reference_code === "string" ? j.reference_code : null,
    open_request: j.open_request && typeof j.open_request === "object" ? (j.open_request as ActivationGatePayload["open_request"]) : null,
    active_license_key: typeof j.active_license_key === "string" ? j.active_license_key : null,
  };
}

export async function submitActivationRequest(businessDisplayName: string): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: "Supabase not configured." };
  const { data, error } = await supabase.rpc("submit_shop_activation_request", {
    p_business_display_name: businessDisplayName.trim(),
  });
  if (error) return { ok: false, message: error.message };
  const row = data as { public_reference_code?: string } | null;
  const code = row?.public_reference_code;
  if (!code) return { ok: false, message: "No reference code returned." };
  return { ok: true, code };
}

export type OpsActivationRow = {
  id: string;
  shop_id: string;
  business_display_name: string;
  public_reference_code: string;
  status: string;
  created_at: string;
  created_by: string;
  shop_lifecycle: string;
};

export async function opsListActivationRequests(): Promise<OpsActivationRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("waka_ops_list_activation_requests");
  if (error || !Array.isArray(data)) return [];
  return data as OpsActivationRow[];
}

export async function opsResolveActivationRequest(params: {
  requestId: string;
  approve: boolean;
  planCode?: string;
  expiresDays?: number;
  maxDevices?: number;
}): Promise<{ ok: boolean; message?: string; licenseKey?: string }> {
  if (!supabase) return { ok: false, message: "Supabase not configured." };
  const { data, error } = await supabase.rpc("waka_ops_resolve_activation_request", {
    p_request_id: params.requestId,
    p_approve: params.approve,
    p_plan_code: params.planCode ?? "business",
    p_expires_days: params.expiresDays ?? 365,
    p_max_devices: params.maxDevices ?? 3,
  });
  if (error) return { ok: false, message: error.message };
  const j = data as { ok?: boolean; license_key?: string };
  return { ok: Boolean(j?.ok), licenseKey: j?.license_key };
}

export function isPosUnlocked(gate: ActivationGatePayload | null): boolean {
  if (!gate) return true;
  return gate.lifecycle === "active";
}
