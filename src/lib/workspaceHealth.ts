import type { User } from "@supabase/supabase-js";
import { isSupabaseEmailVerified } from "./emailVerification";
import { supabase } from "./supabase";
import { bootstrapOwnerWorkspace, type BootstrapArgs } from "./workspaceBootstrap";

export type WorkspaceHealth = {
  ok: boolean;
  has_profile?: boolean;
  has_org?: boolean;
  has_shop?: boolean;
  has_membership?: boolean;
};

export async function fetchOwnerWorkspaceHealth(): Promise<WorkspaceHealth | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("owner_workspace_health");
  if (error) {
    console.warn("[waka-auth] owner_workspace_health", error.message);
    return null;
  }
  return (data ?? {}) as WorkspaceHealth;
}

export async function repairOwnerWorkspaceIfNeeded(
  user: User,
  args?: Partial<BootstrapArgs>,
): Promise<{ repaired: boolean; health: WorkspaceHealth | null }> {
  if (!supabase) return { repaired: false, health: null };

  const health = await fetchOwnerWorkspaceHealth();
  if (health?.ok) return { repaired: false, health };

  if (!isSupabaseEmailVerified(user)) {
    return { repaired: false, health };
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const orgName =
    args?.organizationName ??
    (String(meta.organization_name ?? meta.business_name ?? meta.shop_name ?? "").trim() ||
      user.email?.split("@")[0] ||
      "My Shop");

  const { data, error } = await supabase.rpc("repair_owner_workspace", {
    p_org_name: orgName,
    p_business_type: String(meta.business_type ?? "kiosk_duka"),
    p_full_name: String(meta.full_name ?? "").trim() || null,
    p_email: user.email?.trim().toLowerCase() ?? null,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("email_not_verified")) {
      return { repaired: false, health };
    }
    console.error("[waka-auth] repair_owner_workspace failed", error);
    try {
      await bootstrapOwnerWorkspace(user, {
        organizationName: orgName,
        shopDisplayName: String(meta.shop_display_name ?? orgName).trim() || orgName,
        businessType: (String(meta.business_type ?? "kiosk_duka") || "kiosk_duka") as BootstrapArgs["businessType"],
        fullName: String(meta.full_name ?? "").trim() || undefined,
      });
    } catch (e) {
      console.error("[waka-auth] repair fallback bootstrap failed", e);
      return { repaired: false, health };
    }
  } else {
    const j = (data ?? {}) as { repaired?: boolean };
    if (!j.repaired) return { repaired: false, health: await fetchOwnerWorkspaceHealth() };
  }

  return { repaired: true, health: await fetchOwnerWorkspaceHealth() };
}
