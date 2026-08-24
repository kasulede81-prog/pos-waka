import { hydrateAccountFromCloud } from "./postAuthCloudHydrate";
import { logStartupPhase } from "./startupDiagnostics";
import { usePosStore } from "../store/usePosStore";
import { markWorkspaceBootstrapped } from "./workspaceBootstrapCache";

/**
 * Path L personal staff: clear shared-terminal runtime flags that may arrive via
 * shop cloud snapshot (`posLocked`, `activeStaffId`). Does not remove shop settings
 * (PIN hashes, staffAccounts, auto-lock minutes, etc.).
 */
export function clearPersonalStaffTerminalRuntimeState(): void {
  const prefs = usePosStore.getState().preferences;
  if (!prefs.posLocked && !prefs.activeStaffId) return;
  usePosStore.setState((s) => ({
    preferences: {
      ...s.preferences,
      posLocked: false,
      activeStaffId: null,
    },
  }));
}

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
  clearPersonalStaffTerminalRuntimeState();
  void import("./staffCacheSync").then(({ scheduleStaffCacheProvisioning }) => {
    scheduleStaffCacheProvisioning();
  });
}

/** True when shop_members role is present and not owner. */
export function isNonOwnerShopMemberRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return role !== "owner";
}
