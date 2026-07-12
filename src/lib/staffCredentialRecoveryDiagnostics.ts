/**
 * Staff credential recovery diagnostics (Phase 21.9).
 * Never log PINs, passwords, or hashes.
 */

export type StaffCredentialRecoveryStep =
  | "recovery_detected"
  | "cloud_invalidation"
  | "local_cache_cleared"
  | "credential_reset_required"
  | "staff_setup_complete"
  | "offline_recovery_applied";

export function logStaffRecoveryStep(
  step: StaffCredentialRecoveryStep,
  detail?: Record<string, unknown>,
): void {
  if (detail && Object.keys(detail).length > 0) {
    console.info(`[waka-staff-recovery] ${step}`, detail);
    return;
  }
  console.info(`[waka-staff-recovery] ${step}`);
}
