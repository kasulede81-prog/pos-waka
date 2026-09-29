/**
 * Internal-admin Loyalty dashboard data layer (Phase 6B).
 *
 * Read-only by construction: every function here calls a Phase 6A/6B read RPC that is
 * SECURITY DEFINER and re-checks the internal-admin role in the database. The browser never
 * reads a protected Loyalty table directly, and nothing in this module can mutate anything.
 *
 * A non-admin (or an unauthorized role) receives `forbidden` from the server, which these
 * helpers surface as empty/null data — the dashboard shows an error state rather than
 * pretending the platform has no merchants.
 */

import { hasSupabaseConfig, supabase } from "./supabase";

export type LoyaltyAdminOverview = {
  organizationsEnabled: number;
  shopsEnabled: number;
  activeMembers: number;
  shopsOverLimit: number;
  organizationsOverLimit: number;
  membersOverLimit: number;
  pendingRequests: number;
  plansActive: number;
  plansInactive: number;
  defaultTierCode: string | null;
};

export type LoyaltyAdminPlan = {
  code: string;
  name: string;
  memberLimit: number;
  monthlyPriceUgx: number;
  annualPriceUgx: number;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  organizations: number;
  shops: number;
};

export type LoyaltyAdminShopState = {
  shopId: string;
  shopName: string;
  shopNumber: string | null;
  organizationId: string;
  organizationName: string;
  /**
   * The shop's permanent public WPL code (WPL2026001), or null when the shop has never switched
   * Loyalty on and so has no program row yet. Projected onto the row by the RPC itself — see the
   * note on `fetchLoyaltyAdminShopStates`.
   */
  publicCode: string | null;
  loyaltyEnabled: boolean;
  entitlementStatus: string;
  tierCode: string | null;
  tierName: string | null;
  memberLimit: number;
  activeMembers: number;
  remaining: number;
  overLimit: boolean;
  pendingRequests: number;
};

export type LoyaltyPlanImpact = {
  tierCode: string;
  proposedMemberLimit: number;
  isDefault: boolean;
  organizations: number;
  shops: number;
  shopsOverLimit: number;
  membersOverLimit: number;
};

export type LoyaltyAdminShopDetail = {
  shopId: string;
  organizationId: string;
  loyaltyEnabled: boolean;
  entitlementStatus: string;
  tierCode: string | null;
  tierName: string | null;
  memberLimit: number;
  activeMembers: number;
  remaining: number;
  overLimit: boolean;
  pendingRequests: number;
  usagePercent: number;
};

export type LoyaltyAdminShopFilter = "all" | "enabled" | "disabled" | "over_limit";

export type LoyaltyAdminResult<T> = { ok: true; data: T } | { ok: false; error: string };

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  map: (raw: Record<string, unknown>) => T,
): Promise<LoyaltyAdminResult<T>> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "offline" };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, error: "forbidden" };
    const raw = (data ?? {}) as Record<string, unknown>;
    if (raw.ok !== true) return { ok: false, error: String(raw.error ?? "forbidden") };
    return { ok: true, data: map(raw) };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function fetchLoyaltyAdminOverview(): Promise<LoyaltyAdminResult<LoyaltyAdminOverview>> {
  return callRpc("internal_ops_loyalty_admin_overview", {}, (raw) => ({
    organizationsEnabled: num(raw.organizations_enabled),
    shopsEnabled: num(raw.shops_enabled),
    activeMembers: num(raw.active_members),
    shopsOverLimit: num(raw.shops_over_limit),
    organizationsOverLimit: num(raw.organizations_over_limit),
    membersOverLimit: num(raw.members_over_limit),
    pendingRequests: num(raw.pending_requests),
    plansActive: num(raw.plans_active),
    plansInactive: num(raw.plans_inactive),
    defaultTierCode: str(raw.default_tier_code),
  }));
}

export async function fetchLoyaltyAdminPlans(): Promise<LoyaltyAdminResult<LoyaltyAdminPlan[]>> {
  return callRpc("internal_ops_loyalty_admin_plans", {}, (raw) => {
    const list = Array.isArray(raw.plans) ? (raw.plans as Record<string, unknown>[]) : [];
    return list.map((p) => ({
      code: String(p.code ?? ""),
      name: String(p.name ?? ""),
      memberLimit: num(p.member_limit),
      monthlyPriceUgx: num(p.monthly_price_ugx),
      annualPriceUgx: num(p.annual_price_ugx),
      isActive: p.is_active === true,
      isDefault: p.is_default === true,
      sortOrder: num(p.sort_order),
      organizations: num(p.organizations),
      shops: num(p.shops),
    }));
  });
}

/**
 * The admin shop list, with each shop's WPL code on the row.
 *
 * `query` matches shop name, organization name, shop number OR WPL code — the code match happens
 * server-side, so the caller never has to resolve a code to a shop and then re-filter a list it
 * already fetched.
 *
 * The code is projected by this RPC rather than joined in the browser from
 * `fetchLoyaltyAdminPrograms`, because that read is capped and ordered newest-first: past the cap
 * the oldest merchants — the ones whose codes matter most — would silently render blank.
 */
export async function fetchLoyaltyAdminShopStates(
  query: string,
  filter: LoyaltyAdminShopFilter,
  limit = 50,
): Promise<LoyaltyAdminResult<LoyaltyAdminShopState[]>> {
  return callRpc(
    "internal_ops_loyalty_admin_shop_states",
    { p_query: query.trim() || null, p_filter: filter, p_limit: limit },
    (raw) => {
      const list = Array.isArray(raw.shops) ? (raw.shops as Record<string, unknown>[]) : [];
      return list.map((s) => {
        const memberLimit = num(s.member_limit);
        const activeMembers = num(s.active_members);
        return {
          shopId: String(s.shop_id ?? ""),
          shopName: String(s.shop_name ?? ""),
          shopNumber: str(s.shop_number),
          organizationId: String(s.organization_id ?? ""),
          organizationName: String(s.organization_name ?? ""),
          publicCode: str(s.public_code),
          loyaltyEnabled: s.loyalty_enabled === true,
          entitlementStatus: String(s.entitlement_status ?? "none"),
          tierCode: str(s.tier_code),
          tierName: str(s.tier_name),
          memberLimit,
          activeMembers,
          remaining: Math.max(0, memberLimit - activeMembers),
          overLimit: s.loyalty_enabled === true && activeMembers > Math.max(0, memberLimit),
          pendingRequests: num(s.pending_requests),
        };
      });
    },
  );
}

export async function fetchLoyaltyPlanImpact(
  tierCode: string,
  proposedMemberLimit: number,
): Promise<LoyaltyAdminResult<LoyaltyPlanImpact>> {
  return callRpc(
    "internal_ops_loyalty_plan_impact",
    { p_code: tierCode, p_proposed_limit: proposedMemberLimit },
    (raw) => ({
      tierCode: String(raw.tier_code ?? ""),
      proposedMemberLimit: num(raw.proposed_member_limit),
      isDefault: raw.is_default === true,
      organizations: num(raw.organizations),
      shops: num(raw.shops),
      shopsOverLimit: num(raw.shops_over_limit),
      membersOverLimit: num(raw.members_over_limit),
    }),
  );
}

export async function fetchLoyaltyAdminShopDetail(
  shopId: string,
): Promise<LoyaltyAdminResult<LoyaltyAdminShopDetail>> {
  return callRpc("internal_ops_loyalty_shop_state", { p_shop_id: shopId }, (raw) => {
    const usage = (raw.usage ?? {}) as Record<string, unknown>;
    return {
      shopId: String(raw.shop_id ?? ""),
      organizationId: String(raw.organization_id ?? ""),
      loyaltyEnabled: usage.loyalty_enabled === true,
      entitlementStatus: String(raw.entitlement_status ?? usage.entitlement_status ?? "none"),
      tierCode: str(usage.tier_code),
      tierName: str(usage.tier_name),
      memberLimit: num(usage.member_limit),
      activeMembers: num(usage.active_members),
      remaining: num(usage.remaining),
      overLimit: raw.over_limit === true,
      pendingRequests: num(usage.pending_requests),
      usagePercent: num(usage.usage_percent),
    };
  });
}

/**
 * WPL — the permanent public Loyalty Program code (WPL2026001).
 *
 * Read-only by construction: these are lookups. The code is issued once, server-side, by a trigger
 * on insert; it is immutable, it is never recycled, and no RPC anywhere accepts it as a write
 * input. `public_code` is therefore always displayed, never edited.
 *
 * Both RPCs are granted to `authenticated` but gated INSIDE by `is_waka_internal_role`, the same
 * shape as every other `internal_ops_loyalty_*` call above — so a merchant calling them directly
 * gets `forbidden`, and the audit trail is the existing one.
 */
export type LoyaltyAdminProgram = {
  publicCode: string;
  shopId: string;
  shopName: string;
  shopNumber: string | null;
  organizationId: string;
  organizationName: string;
  programDisplayName: string | null;
  enabled: boolean;
  createdAt: string;
  membersTotal: number;
  membersActive: number;
};

function mapAdminProgram(p: Record<string, unknown>): LoyaltyAdminProgram {
  return {
    publicCode: String(p.public_code ?? ""),
    shopId: String(p.shop_id ?? ""),
    shopName: String(p.shop_name ?? ""),
    shopNumber: str(p.shop_number),
    organizationId: String(p.organization_id ?? ""),
    organizationName: String(p.organization_name ?? ""),
    programDisplayName: str(p.program_display_name),
    enabled: p.enabled === true,
    createdAt: String(p.created_at ?? ""),
    membersTotal: num(p.members_total),
    membersActive: num(p.members_active),
  };
}

/** List/search programs by WPL code, shop name, shop number or organization name. */
export async function fetchLoyaltyAdminPrograms(
  search: string,
  limit = 100,
): Promise<LoyaltyAdminResult<LoyaltyAdminProgram[]>> {
  return callRpc(
    "internal_ops_loyalty_programs",
    { p_search: search.trim() || null, p_limit: limit },
    (raw) => {
      const list = Array.isArray(raw.programs) ? (raw.programs as Record<string, unknown>[]) : [];
      return list.map(mapAdminProgram);
    },
  );
}

/** Resolve exactly one program by its public code. */
export async function fetchLoyaltyAdminProgramByCode(
  publicCode: string,
): Promise<LoyaltyAdminResult<LoyaltyAdminProgram>> {
  return callRpc("internal_ops_loyalty_program_by_code", { p_code: publicCode.trim() }, (raw) =>
    mapAdminProgram((raw.program ?? {}) as Record<string, unknown>),
  );
}
