import { hasSupabaseConfig } from "./supabase";
import type { ShopPreferences, UserRole } from "../types";
import { canUseDevRoleSimulator, resolveAuthRole } from "./permissions";
import type { User } from "@supabase/supabase-js";

export type SessionActor = {
  userId: string;
  role: UserRole;
  displayName?: string;
};

function devOverrideAllowed(): boolean {
  return !hasSupabaseConfig || Boolean(import.meta.env.DEV);
}

/**
 * `devRoleOverride` in preferences applies only when dev override is allowed and
 * the authenticated role (before override) is owner — avoids cashiers escalating in prod.
 */
export function resolveSessionActor(params: {
  mode: "supabase" | "local";
  user: User | null;
  email: string | null | undefined;
  preferences: ShopPreferences;
}): SessionActor {
  const meta = params.user?.user_metadata as Record<string, unknown> | undefined;
  const authRole = resolveAuthRole({ mode: params.mode, userMetadata: meta });
  const devAllowed = devOverrideAllowed();
  const override = params.preferences.devRoleOverride;
  const simulatedRole: UserRole =
    devAllowed && override && canUseDevRoleSimulator(authRole) ? override : authRole;
  const activeStaff = (params.preferences.staffAccounts ?? []).find(
    (s) => s.id === params.preferences.activeStaffId && s.active,
  );
  const role: UserRole = activeStaff?.role ?? simulatedRole;

  const baseUserId =
    params.user?.id ?? (params.email ? `local:${params.email.trim().toLowerCase()}` : "local:anonymous");
  const userId = activeStaff ? `staff:${activeStaff.id}` : baseUserId;

  const displayName =
    activeStaff?.name ||
    (params.user?.user_metadata as Record<string, string> | undefined)?.full_name?.trim() ||
    params.user?.email ||
    params.email ||
    undefined;

  return { userId, role, displayName };
}
