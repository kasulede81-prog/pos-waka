/**
 * ANDROID-UPDATE-P1 — persistent dismissal of RECOMMENDED updates.
 *
 * Scope: version-scoped only (Play availableVersionCode, or release id when Play
 * did not surface a code). This mirrors the existing `waka-whats-new-seen-<code>`
 * pattern in UpdateEligibility.ts — no account/shop data is stored, so there is
 * nothing that can leak across accounts.
 *
 * Mandatory (force / below-minimum / immediate) updates NEVER consult dismissal.
 */
import { Preferences } from "@capacitor/preferences";

const DISMISS_KEY_PREFIX = "waka-update-dismissed-";

export type UpdateDismissalTarget = {
  availableVersionCode: number;
  releaseId?: string | null;
};

/** Stable, version-scoped identity for "this exact update offer". */
export function updateDismissalKey(target: UpdateDismissalTarget): string | null {
  if (target.availableVersionCode > 0) {
    return `${DISMISS_KEY_PREFIX}vc-${target.availableVersionCode}`;
  }
  if (target.releaseId) {
    return `${DISMISS_KEY_PREFIX}rel-${target.releaseId}`;
  }
  return null;
}

/** Fail-open: a storage error must never hide a real update. */
export async function readUpdateDismissed(key: string | null): Promise<boolean> {
  if (!key) return false;
  try {
    const { value } = await Preferences.get({ key });
    return value === "1";
  } catch {
    return false;
  }
}

export async function markUpdateDismissed(key: string | null): Promise<boolean> {
  if (!key) return false;
  try {
    await Preferences.set({ key, value: "1" });
    return true;
  } catch {
    return false;
  }
}

export async function clearUpdateDismissal(key: string | null): Promise<void> {
  if (!key) return;
  try {
    await Preferences.remove({ key });
  } catch {
    /* non-fatal */
  }
}
