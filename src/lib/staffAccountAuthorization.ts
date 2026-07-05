/**
 * Store-layer authorization for staff account CRUD.
 * Staff management requires owner/manager role AND primary device (cloud shops).
 */

import type { SessionActor } from "./sessionActor";
import { checkStorePermission, type StoreAuthResult } from "./storeAuthorization";

export class StaffAccountAuthorizationError extends Error {
  readonly errorKey: import("./storeAuthorization").StoreAuthErrorKey;

  constructor(errorKey: "forbidden" | "noSelection" | "notPrimaryDevice") {
    super(errorKey);
    this.name = "StaffAccountAuthorizationError";
    this.errorKey = errorKey;
  }
}

/** Owner or settings.shop role may manage staff; plan caps enforced separately in the store. */
export function authorizeStaffAccountMutation(actor: SessionActor | null): StoreAuthResult {
  if (!actor) return { ok: false, errorKey: "noSelection" };
  if (actor.role === "owner") return { ok: true };
  return checkStorePermission(actor, "settings.shop");
}

export async function authorizeStaffAccountMutationWithDevice(
  actor: SessionActor | null,
  opts?: { authMode?: "local" | "supabase"; skipDeviceCheck?: boolean },
): Promise<StoreAuthResult> {
  const roleAuth = authorizeStaffAccountMutation(actor);
  if (!roleAuth.ok) return roleAuth;
  if (opts?.skipDeviceCheck || opts?.authMode === "local") return { ok: true };
  const { isCurrentDevicePrimaryForStaffManagement } = await import("./primaryDevice");
  const isPrimary = await isCurrentDevicePrimaryForStaffManagement();
  if (!isPrimary) return { ok: false, errorKey: "notPrimaryDevice" };
  return { ok: true };
}

export function assertStaffAccountMutationAllowed(actor: SessionActor | null): void {
  const auth = authorizeStaffAccountMutation(actor);
  if (!auth.ok) {
    throw new StaffAccountAuthorizationError(auth.errorKey as "forbidden" | "noSelection");
  }
}

export async function assertStaffAccountMutationAllowedAsync(
  actor: SessionActor | null,
  opts?: { authMode?: "local" | "supabase" },
): Promise<void> {
  const auth = await authorizeStaffAccountMutationWithDevice(actor, opts);
  if (!auth.ok) {
    throw new StaffAccountAuthorizationError(
      auth.errorKey as "forbidden" | "noSelection" | "notPrimaryDevice",
    );
  }
}
