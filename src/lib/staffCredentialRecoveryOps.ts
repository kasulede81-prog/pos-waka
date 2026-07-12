/**
 * Staff credential recovery operations — apply invalidation + post-recovery setup.
 */

import type { StaffAccount } from "../types";
import { hashStaffSecretAsync, normalizePin } from "./staffSecret";
import { logStaffRecoveryStep } from "./staffCredentialRecoveryDiagnostics";
import {
  peekStaffCredentialRecoveryStaffNotice,
  staffAccountNeedsCredentialSetup,
} from "./staffCredentialRecovery";

export function stripStaffCredentialsForRecovery(staff: StaffAccount[], clearedAt: string): StaffAccount[] {
  const now = clearedAt || new Date().toISOString();
  return staff.map((row) => ({
    ...row,
    pin: null,
    password: null,
    pinHash: null,
    passwordHash: null,
    lockedUntil: null,
    failedPinAttempts: 0,
    failuresInWindow: 0,
    failureWindowStartedAt: null,
    lastFailedLoginAt: null,
    firstFailedLoginAt: null,
    credentialsInvalidatedAt: now,
    updatedAt: now,
  }));
}

export async function completeStaffCredentialRecovery(input: {
  shopId: string;
  staffId: string;
  pin?: string;
  password?: string;
}): Promise<{ ok: true } | { ok: false; errorKey: string }> {
  const pinNorm = input.pin ? normalizePin(input.pin) : "";
  const password = input.password?.trim() ?? "";
  if (!pinNorm && !password) {
    return { ok: false, errorKey: "staffRecoveryCredentialRequired" };
  }
  if (pinNorm && (pinNorm.length < 4 || pinNorm.length > 6)) {
    return { ok: false, errorKey: "staffRecoveryPinInvalid" };
  }
  if (password && password.length < 8) {
    return { ok: false, errorKey: "staffRecoveryPasswordInvalid" };
  }

  const { usePosStore, flushPendingPersist } = await import("../store/usePosStore");
  const state = usePosStore.getState();
  const staff = (state.preferences.staffAccounts ?? []).find((row) => row.id === input.staffId);
  if (!staff || !staff.active) {
    return { ok: false, errorKey: "staffRecoveryStaffNotFound" };
  }

  const recoveryActive =
    staffAccountNeedsCredentialSetup(staff) ||
    Boolean(peekStaffCredentialRecoveryStaffNotice(input.shopId));
  if (!recoveryActive) {
    return { ok: false, errorKey: "staffRecoveryNotRequired" };
  }

  const pinHash = pinNorm ? await hashStaffSecretAsync(pinNorm) : null;
  const passwordHash = password ? await hashStaffSecretAsync(password) : null;
  const now = new Date().toISOString();

  usePosStore.setState((s) => ({
    preferences: {
      ...s.preferences,
      staffAccounts: (s.preferences.staffAccounts ?? []).map((row) =>
        row.id === input.staffId
          ? {
              ...row,
              pin: null,
              password: null,
              pinHash,
              passwordHash,
              pinChangedAt: pinHash ? now : row.pinChangedAt,
              passwordChangedAt: passwordHash ? now : row.passwordChangedAt,
              credentialsInvalidatedAt: null,
              lockedUntil: null,
              failedPinAttempts: 0,
              updatedAt: now,
            }
          : row,
      ),
    },
  }));

  flushPendingPersist();

  const updated = usePosStore.getState().preferences.staffAccounts?.find((row) => row.id === input.staffId);
  if (updated) {
    const { pushStaffToCloud } = await import("./shopStaffCloud");
    await pushStaffToCloud(updated);
    const { logStaffSecurityAudit } = await import("./staffSecurityAudit");
    logStaffSecurityAudit("staff_pin_reset", {
      staffId: updated.id,
      staffName: updated.name,
      source: "credential_recovery",
    });
  }

  logStaffRecoveryStep("staff_setup_complete", { shopId: input.shopId, staffId: input.staffId });

  void import("./cloudSnapshotSync").then(({ uploadShopCloudSnapshot }) => {
    void uploadShopCloudSnapshot({ force: true });
  });

  return { ok: true };
}
