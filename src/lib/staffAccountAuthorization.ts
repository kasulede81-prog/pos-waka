/**
 * Store-layer authorization for staff account CRUD.
 */

import type { SessionActor } from "./sessionActor";
import { checkStorePermission, type StoreAuthResult } from "./storeAuthorization";

export class StaffAccountAuthorizationError extends Error {
  readonly errorKey: import("./storeAuthorization").StoreAuthErrorKey;

  constructor(errorKey: "forbidden" | "noSelection") {
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

export function assertStaffAccountMutationAllowed(actor: SessionActor | null): void {
  const auth = authorizeStaffAccountMutation(actor);
  if (!auth.ok) {
    throw new StaffAccountAuthorizationError(auth.errorKey as "forbidden" | "noSelection");
  }
}
