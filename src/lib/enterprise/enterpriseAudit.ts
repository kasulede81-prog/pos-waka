import type { EnterpriseAuditRow } from "../../types/enterprise";
import { supabase } from "../supabase";

export type EnterpriseAuditSearchParams = {
  shopId?: string | null;
  action?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
};

export async function searchEnterpriseAudit(params: EnterpriseAuditSearchParams): Promise<EnterpriseAuditRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("enterprise_audit_search", {
    p_shop_id: params.shopId ?? null,
    p_action: params.action ?? null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_limit: params.limit ?? 100,
  });
  if (error) {
    console.warn("[enterprise] audit_search", error.message);
    return [];
  }
  return Array.isArray(data) ? (data as EnterpriseAuditRow[]) : [];
}

export function auditSeverity(action: string): "info" | "warning" | "critical" {
  const lower = action.toLowerCase();
  if (lower.includes("denied") || lower.includes("failed") || lower.includes("rejected")) return "critical";
  if (lower.includes("override") || lower.includes("void") || lower.includes("controlled")) return "warning";
  return "info";
}
