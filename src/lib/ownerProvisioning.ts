/**
 * Owner workspace provisioning, as performed on the authenticated return from an email
 * confirmation or an OAuth round trip.
 *
 * WHY THIS IS ITS OWN MODULE. These three functions decide whether a merchant who has just
 * authenticated gets a usable workspace, and they are the difference between "registration
 * finished" and "registration silently half-done". They are orchestration only — no React, no
 * routing — so the failure paths can be tested directly rather than inferred from a page.
 *
 * NOTHING HERE IS A NEW AUTHORITY. `ensureOwnerWorkspaceIfNeeded` still performs the guarded
 * bootstrap, `owner_onboarding_status()` still decides what "finished onboarding" means, and
 * provisioning is still refused for anyone the identity classifier does not call a merchant.
 */

import type { Session } from "@supabase/supabase-js";
import { ensureOwnerWorkspaceIfNeeded } from "./ownerWorkspaceOnSignIn";
import { hasFirstTimeOwnerMarker, isOnboardingWizardRequiredLocally } from "./firstTimeOwnerDevice";
import { fetchOwnerOnboardingStatus } from "./ownerOnboarding";
import { withTimeout } from "./promiseTimeout";

export const PROVISION_FAILED_MESSAGE =
  "We could not finish setting up your shop. Nothing was lost — check your connection and try again.";

export const PROVISION_TIMEOUT_MESSAGE =
  "Setting up your shop is taking longer than expected. Please try again.";

/** How long the guarded bootstrap may run before the person is told rather than left waiting. */
export const PROVISION_TIMEOUT_MS = 12_000;

/**
 * Run the guarded owner bootstrap and REPORT the outcome.
 *
 * `withTimeout(promise, ms, fallback)` RESOLVES WITH THE FALLBACK instead of throwing, so a
 * bootstrap that hung used to be indistinguishable from one that succeeded: the caller then
 * navigated into the app as though a shop existed. A sentinel with its own type makes the timeout
 * a failure the caller can act on. The underlying RPC message is deliberately not surfaced —
 * `ensureOwnerWorkspaceIfNeeded` can throw a raw Postgres string, and a merchant must never read
 * one.
 *
 * Safe to call again after a failure: the bootstrap is idempotent, and since the migration that
 * accompanies this change it is also serialized per user, so a retry finds the earlier attempt's
 * rows instead of creating a second workspace.
 */
export async function provisionOwnerWorkspace(
  session: Session,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const TIMED_OUT = "__waka_bootstrap_timeout__";
  try {
    const outcome = await withTimeout<true | string>(
      ensureOwnerWorkspaceIfNeeded(session).then(() => true as const),
      PROVISION_TIMEOUT_MS,
      TIMED_OUT,
    );
    if (outcome === TIMED_OUT) return { ok: false, message: PROVISION_TIMEOUT_MESSAGE };
    return { ok: true };
  } catch {
    return { ok: false, message: PROVISION_FAILED_MESSAGE };
  }
}

/**
 * Where a merchant goes once provisioning has been settled.
 *
 * The device answers first — a brand-new owner on this device starts at the wizard — but a device
 * with no local evidence at all (a reinstall, a second phone, cleared storage) must not march a
 * merchant who finished months ago back through onboarding. So the marker and local completion
 * decide immediately when they are present, and otherwise the SERVER is asked once. That is the
 * same authority every other onboarding decision now uses.
 *
 * If the server cannot be reached the local answer stands: this decides which screen to show, and
 * the business-profile gate is the one that fails closed.
 */
export async function postAuthDestination(userId: string): Promise<string> {
  if (hasFirstTimeOwnerMarker(userId)) return "/onboarding";
  if (!isOnboardingWizardRequiredLocally()) return "/";
  const status = await fetchOwnerOnboardingStatus().catch(() => null);
  return status?.complete ? "/" : "/onboarding";
}

/** The destination rules, in one place, so a retry cannot drift from the first attempt. */
export async function destinationFor(args: {
  userId: string;
  pendingJoinPath: string | null;
  skipOwnerBootstrap: boolean;
  inviteAccepted: boolean;
  memberOnly: boolean;
  landing: string;
}): Promise<string> {
  if (args.pendingJoinPath) return args.pendingJoinPath;
  if (args.skipOwnerBootstrap) return args.inviteAccepted ? "/" : "/staff/accept";
  if (args.memberOnly) return args.landing;
  return postAuthDestination(args.userId);
}
