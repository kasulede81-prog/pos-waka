import type { Permission, Product, StaffAccount, UserRole } from "../types";
import {
  hasEffectivePermission,
  maxProductsForTier,
  maxStaffAccountsForTier,
  planAllowsPermission,
  resolveEffectivePlanTier,
  type RemoteSubscriptionRow,
  type SubscriptionPlanCode,
  type SubscriptionSnapshot,
} from "./subscriptionEntitlements";
import { lockedProductIds } from "./productPlanLock";

const PLAN_GATED_PERMISSIONS: Permission[] = [
  "reports.profit",
  "settings.shop",
  "owner.dashboard",
  "owner.activity",
  "owner.cash_history",
];

export type SubscriptionDiagnosticsSnapshot = {
  role: UserRole;
  authMode: "supabase" | "local";
  snapshotKind: SubscriptionSnapshot["kind"];
  basePlanCode: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  effectiveTier: SubscriptionPlanCode;
  isTrialLike: boolean;
  productCount: number;
  productLimit: number | null;
  lockedProductCount: number;
  staffCount: number;
  staffLimit: number;
  blockedFeatures: Permission[];
};

function remoteRow(
  row: Partial<RemoteSubscriptionRow> & Pick<RemoteSubscriptionRow, "plan_code" | "status">,
): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: "1",
      organization_id: "o1",
      shop_id: "s1",
      trial_ends_at: null,
      current_period_start: null,
      current_period_end: null,
      max_pos_users: null,
      max_shops: null,
      max_devices: null,
      ...row,
    } as RemoteSubscriptionRow,
  };
}

export function buildSubscriptionDiagnostics(input: {
  role: UserRole;
  snapshot: SubscriptionSnapshot;
  authMode: "supabase" | "local";
  products: readonly Product[];
  staffAccounts: readonly StaffAccount[];
}): SubscriptionDiagnosticsSnapshot {
  const effectiveTier =
    input.authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(input.snapshot);
  const productLimit = maxProductsForTier(effectiveTier);
  const locked = lockedProductIds(input.products, productLimit);
  const staffLimit = maxStaffAccountsForTier(effectiveTier);
  const blockedFeatures = PLAN_GATED_PERMISSIONS.filter(
    (perm) => !hasEffectivePermission(input.role, perm, input.snapshot, input.authMode),
  );

  let basePlanCode: string | null = null;
  let subscriptionStatus: string | null = null;
  let trialEndsAt: string | null = null;
  let currentPeriodEnd: string | null = null;
  let isTrialLike = false;

  if (input.snapshot.kind === "remote") {
    basePlanCode = input.snapshot.row.plan_code;
    subscriptionStatus = input.snapshot.row.status;
    trialEndsAt = input.snapshot.row.trial_ends_at;
    currentPeriodEnd = input.snapshot.row.current_period_end;
    const st = (subscriptionStatus ?? "").trim().toLowerCase();
    isTrialLike = st === "trial" || st === "trialing";
  }

  return {
    role: input.role,
    authMode: input.authMode,
    snapshotKind: input.snapshot.kind,
    basePlanCode,
    subscriptionStatus,
    trialEndsAt,
    currentPeriodEnd,
    effectiveTier,
    isTrialLike,
    productCount: input.products.length,
    productLimit,
    lockedProductCount: locked.size,
    staffCount: input.staffAccounts.length,
    staffLimit,
    blockedFeatures,
  };
}

export { remoteRow as subscriptionDiagnosticsRemoteFixture, planAllowsPermission };
