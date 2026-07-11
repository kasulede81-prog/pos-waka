import type {
  EnterpriseBranch,
  EnterpriseDashboardMetrics,
  EnterpriseOrganizationContext,
  BranchStatus,
} from "../../types/enterprise";
import { supabase } from "../supabase";
import { resolvePrimaryOrganizationForUser } from "../fetchShopSubscription";
import { listUserShops } from "../primaryShop";

function parseBranch(raw: Record<string, unknown>): EnterpriseBranch {
  const businessTypes = Array.isArray(raw.businessTypes)
    ? (raw.businessTypes as string[])
    : raw.businessType
      ? [String(raw.businessType)]
      : ["kiosk_duka"];
  return {
    id: String(raw.id),
    organizationId: String(raw.organizationId),
    name: String(raw.name ?? ""),
    code: raw.code ? String(raw.code) : null,
    addressLine: raw.addressLine ? String(raw.addressLine) : null,
    city: raw.city ? String(raw.city) : null,
    district: raw.district ? String(raw.district) : null,
    phoneE164: raw.phoneE164 ? String(raw.phoneE164) : null,
    managerUserId: raw.managerUserId ? String(raw.managerUserId) : null,
    timezone: String(raw.timezone ?? "Africa/Kampala"),
    currency: String(raw.currency ?? "UGX"),
    taxProfile: (raw.taxProfile as Record<string, unknown>) ?? {},
    businessTypes: businessTypes as EnterpriseBranch["businessTypes"],
    businessType: (raw.businessType ?? businessTypes[0] ?? "kiosk_duka") as EnterpriseBranch["businessType"],
    status: (raw.status ?? "active") as BranchStatus,
    isActive: raw.isActive !== false,
    contacts: (raw.contacts as Record<string, unknown>) ?? {},
    shopNumber: raw.shopNumber ? String(raw.shopNumber) : null,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    archivedAt: raw.archivedAt ? String(raw.archivedAt) : null,
  };
}

/** Resolve org context; single-store orgs work without migration. */
export async function resolveEnterpriseOrganizationContext(
  userId: string | null,
): Promise<EnterpriseOrganizationContext | null> {
  if (!userId) return null;
  const orgShop = await resolvePrimaryOrganizationForUser(userId);
  if (!orgShop) return null;
  const shops = await listUserShops();
  const orgShops = shops.filter((s) => s.organization_id === orgShop.organizationId);
  const branchCount = Math.max(1, orgShops.length);
  return {
    organizationId: orgShop.organizationId,
    primaryShopId: orgShop.shopId,
    branchCount,
    isSingleBranch: branchCount <= 1,
  };
}

export async function fetchEnterpriseBranches(): Promise<EnterpriseBranch[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("enterprise_list_branches");
  if (error) {
    console.warn("[enterprise] list_branches", error.message);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.map((row) => parseBranch(row as Record<string, unknown>));
}

export async function upsertEnterpriseBranch(payload: Partial<EnterpriseBranch> & { name: string }): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
}> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("enterprise_upsert_branch", {
    p_payload: {
      id: payload.id ?? null,
      name: payload.name,
      code: payload.code,
      addressLine: payload.addressLine,
      city: payload.city,
      district: payload.district,
      phoneE164: payload.phoneE164,
      managerUserId: payload.managerUserId,
      timezone: payload.timezone,
      currency: payload.currency,
      taxProfile: payload.taxProfile,
      businessTypes: payload.businessTypes,
      businessType: payload.businessType,
      contacts: payload.contacts,
    },
  });
  if (error) return { ok: false, error: error.message };
  const j = (data ?? {}) as { ok?: boolean; id?: string; error?: string };
  return { ok: j.ok === true, id: j.id, error: j.error };
}

export async function setEnterpriseBranchStatus(
  shopId: string,
  status: BranchStatus,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("enterprise_set_branch_status", {
    p_shop_id: shopId,
    p_status: status,
  });
  if (error) return { ok: false, error: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  return { ok: j.ok === true, error: j.error };
}

export async function fetchEnterpriseDashboardMetrics(
  from?: string,
  to?: string,
): Promise<EnterpriseDashboardMetrics> {
  const empty: EnterpriseDashboardMetrics = {
    ok: false,
    branchCount: 0,
    branchesOnline: 0,
    branchesOffline: 0,
    todaySalesUgx: 0,
    todayProfitUgx: 0,
    openShifts: 0,
    openBusinessDays: 0,
    pendingSyncDevices: 0,
    lowStockBranches: 0,
    nearExpiryAlerts: 0,
    controlledMedicineAlerts: 0,
    topBranches: [],
    recentAudits: [],
  };
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc("enterprise_dashboard_metrics", {
    p_from: from ?? undefined,
    p_to: to ?? undefined,
  });
  if (error) {
    console.warn("[enterprise] dashboard_metrics", error.message);
    return { ...empty, error: error.message };
  }
  const j = (data ?? {}) as EnterpriseDashboardMetrics;
  return {
    ...empty,
    ...j,
    ok: j.ok !== false,
    recentAudits: Array.isArray(j.recentAudits) ? j.recentAudits : [],
    topBranches: Array.isArray(j.topBranches) ? j.topBranches : [],
  };
}

/** Wire legacy preferences.activeBranchId to primary shop for backward compatibility. */
export function resolveActiveBranchId(
  preferences: { activeBranchId?: string | null; wakaShopId?: string | null },
  primaryShopId: string | null,
): string | null {
  return preferences.activeBranchId ?? primaryShopId;
}
