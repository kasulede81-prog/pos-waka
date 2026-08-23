import { hydrateAccountFromCloud } from "./postAuthCloudHydrate";
import { logStartupPhase } from "./startupDiagnostics";
import { markWorkspaceBootstrapped } from "./workspaceBootstrapCache";

/**
 * Phase 6: Auth staff (invitee / non-owner member) must hydrate into their own
 * `sb:<authUserId>` ledger. Do not gate on owner onboarding markers.
 */
export async function hydrateStaffAuthWorkspace(userId: string): Promise<void> {
  if (!userId) return;
  markWorkspaceBootstrapped(userId);
  logStartupPhase("staff_auth_hydrate", { userId });
  try {
    await hydrateAccountFromCloud({ forcePull: true });
  } catch (e) {
    logStartupPhase("staff_auth_hydrate", {
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  void import("./staffCacheSync").then(({ scheduleStaffCacheProvisioning }) => {
    scheduleStaffCacheProvisioning();
  });
}

/** True when shop_members role is present and not owner. */
export function isNonOwnerShopMemberRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return role !== "owner";
}
