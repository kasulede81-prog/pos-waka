/**
 * Organization deletion lock — blocks local operations when cloud org is gone
 * or a deletion marker / wipe marker is present for the account namespace.
 */

import { getActiveAccountKey } from "../offline/accountScope";
import { hasIndexedDbDataForAccount } from "../offline/localDb";
import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { isWorkspaceBootstrapped, unmarkWorkspaceBootstrapped } from "./workspaceBootstrapCache";

export const ORGANIZATION_DELETED_MESSAGE = "This organization has been permanently deleted.";
export const ORGANIZATION_DELETED_ERROR = "organizationDeleted";

const DELETION_MARKER_BASE = "waka.org.deletion.marker.v1";
const WIPE_MARKER_BASE = "waka.account.wiped.v1";

export type OrganizationDeletionStatus = "active" | "pending" | "deleted";

export type OrganizationDeletionMarker = {
  status: "pending" | "deleted";
  accountKey: string;
  userId?: string;
  organizationId?: string | null;
  shopId?: string | null;
  markedAt: string;
  source: "cloud_absent" | "admin" | "manual";
};

export type OrganizationWipeMarker = {
  accountKey: string;
  wipedAt: string;
};

export class OrganizationDeletedError extends Error {
  readonly errorKey = ORGANIZATION_DELETED_ERROR;

  constructor(message = ORGANIZATION_DELETED_MESSAGE) {
    super(message);
    this.name = "OrganizationDeletedError";
  }
}

function deletionMarkerKey(accountKey: string): string {
  return `${DELETION_MARKER_BASE}::${accountKey}`;
}

function wipeMarkerKey(accountKey: string): string {
  return `${WIPE_MARKER_BASE}::${accountKey}`;
}

export function readDeletionMarker(accountKey: string): OrganizationDeletionMarker | null {
  if (!accountKey) return null;
  try {
    const raw = localStorage.getItem(deletionMarkerKey(accountKey));
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<OrganizationDeletionMarker>;
    if (!o.accountKey || (o.status !== "deleted" && o.status !== "pending")) return null;
    return {
      status: o.status,
      accountKey: o.accountKey,
      userId: typeof o.userId === "string" ? o.userId : undefined,
      organizationId: o.organizationId ?? null,
      shopId: o.shopId ?? null,
      markedAt: typeof o.markedAt === "string" ? o.markedAt : new Date().toISOString(),
      source: o.source === "admin" || o.source === "manual" ? o.source : "cloud_absent",
    };
  } catch {
    return null;
  }
}

export function writeDeletionMarker(marker: OrganizationDeletionMarker): void {
  try {
    localStorage.setItem(deletionMarkerKey(marker.accountKey), JSON.stringify(marker));
  } catch {
    /* ignore quota */
  }
}

export function clearDeletionMarker(accountKey: string): void {
  if (!accountKey) return;
  try {
    localStorage.removeItem(deletionMarkerKey(accountKey));
  } catch {
    /* ignore */
  }
}

export function readWipeMarker(accountKey: string): OrganizationWipeMarker | null {
  if (!accountKey) return null;
  try {
    const raw = localStorage.getItem(wipeMarkerKey(accountKey));
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<OrganizationWipeMarker>;
    if (!o.accountKey || typeof o.wipedAt !== "string") return null;
    return { accountKey: o.accountKey, wipedAt: o.wipedAt };
  } catch {
    return null;
  }
}

export function writeWipeMarker(accountKey: string): OrganizationWipeMarker {
  const marker: OrganizationWipeMarker = {
    accountKey,
    wipedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(wipeMarkerKey(accountKey), JSON.stringify(marker));
  } catch {
    /* ignore */
  }
  return marker;
}

export function clearWipeMarker(accountKey: string): void {
  if (!accountKey) return;
  try {
    localStorage.removeItem(wipeMarkerKey(accountKey));
  } catch {
    /* ignore */
  }
}

export function hasWipeMarker(accountKey: string): boolean {
  return readWipeMarker(accountKey) != null;
}

export function userIdFromSupabaseAccountKey(accountKey: string): string | null {
  if (!accountKey.startsWith("sb:")) return null;
  return accountKey.slice(3) || null;
}

export function isDeletionPending(accountKey: string | null = getActiveAccountKey()): boolean {
  if (!accountKey) return false;
  const marker = readDeletionMarker(accountKey);
  return marker?.status === "pending";
}

export function isDeletedOrganization(accountKey: string | null = getActiveAccountKey()): boolean {
  if (!accountKey) return false;
  if (hasWipeMarker(accountKey)) return true;
  const marker = readDeletionMarker(accountKey);
  return marker?.status === "deleted";
}

export function isOrganizationBlocked(accountKey: string | null = getActiveAccountKey()): boolean {
  if (!accountKey) return false;
  return isDeletedOrganization(accountKey) || isDeletionPending(accountKey);
}

export function markOrganizationDeleted(input: {
  accountKey: string;
  userId?: string;
  organizationId?: string | null;
  shopId?: string | null;
  source?: OrganizationDeletionMarker["source"];
  pending?: boolean;
}): OrganizationDeletionMarker {
  const marker: OrganizationDeletionMarker = {
    status: input.pending ? "pending" : "deleted",
    accountKey: input.accountKey,
    userId: input.userId,
    organizationId: input.organizationId ?? null,
    shopId: input.shopId ?? null,
    markedAt: new Date().toISOString(),
    source: input.source ?? "cloud_absent",
  };
  writeDeletionMarker(marker);
  return marker;
}

export function markDeletionPending(input: Omit<Parameters<typeof markOrganizationDeleted>[0], "pending">): OrganizationDeletionMarker {
  return markOrganizationDeleted({ ...input, pending: true });
}

export function clearOrganizationDeletionState(accountKey: string, userId?: string): void {
  clearDeletionMarker(accountKey);
  clearWipeMarker(accountKey);
  if (userId) unmarkWorkspaceBootstrapped(userId);
}

/**
 * Reconcile local deletion markers with cloud org presence.
 * Returns true when the organization should be treated as deleted.
 */
export async function refreshOrganizationDeletionState(
  userId: string,
  accountKey: string,
): Promise<boolean> {
  if (!userId || !accountKey || accountKey.startsWith("local:")) {
    return isOrganizationBlocked(accountKey);
  }

  const org = await resolvePrimaryOrganizationForUser(userId);
  if (org?.organizationId) {
    clearDeletionMarker(accountKey);
    return false;
  }

  const bootstrapped = isWorkspaceBootstrapped(userId);
  const hasLocal = await hasIndexedDbDataForAccount(accountKey);
  if (bootstrapped || hasLocal) {
    markOrganizationDeleted({
      accountKey,
      userId,
      source: "cloud_absent",
    });
    return true;
  }

  return isOrganizationBlocked(accountKey);
}

/**
 * Blocks switching into a namespace that was locally wiped. Deletion markers are
 * reconciled asynchronously via `refreshOrganizationDeletionState` so a stale
 * marker cannot block sign-in when the cloud org still exists.
 */
export function assertAccountSwitchAllowed(nextAccountKey: string): void {
  if (hasWipeMarker(nextAccountKey)) {
    throw new OrganizationDeletedError();
  }
}

export async function assertOrganizationOperationsAllowed(opts?: {
  accountKey?: string | null;
  userId?: string | null;
}): Promise<void> {
  const accountKey = opts?.accountKey ?? getActiveAccountKey();
  if (!accountKey) return;

  if (isOrganizationBlocked(accountKey)) {
    throw new OrganizationDeletedError();
  }

  const userId = opts?.userId ?? userIdFromSupabaseAccountKey(accountKey);
  if (userId && accountKey.startsWith("sb:")) {
    const deleted = await refreshOrganizationDeletionState(userId, accountKey);
    if (deleted) throw new OrganizationDeletedError();
  }
}

export function isOrganizationDeletedError(err: unknown): boolean {
  return (
    err instanceof OrganizationDeletedError ||
    (err instanceof Error && err.message === ORGANIZATION_DELETED_ERROR)
  );
}
