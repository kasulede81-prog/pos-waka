/**
 * Which cloud vs local entity count mismatches block recovery startup.
 * Core business entities fail closed; historical/operational parity is warning-only.
 */

import type { FullEntityCounts } from "./cloudTrustCenter";

/** Must match exactly before recovery unlocks the app. */
export const RECOVERY_CORE_ENTITY_PARITY_IDS = new Set<keyof FullEntityCounts>([
  "products",
  "sales",
  "customers",
]);

export function entityCountMismatchBlocksRecovery(entityId: keyof FullEntityCounts): boolean {
  return RECOVERY_CORE_ENTITY_PARITY_IDS.has(entityId);
}

const NON_BLOCKING_TRUST_FAILURE_CODES = new Set([
  "inventory_integrity_warning",
  "stock_movement_count_mismatch",
]);

/** Whether a certification failure should block recovery / mark shop uncertified. */
export function isBlockingRecoveryCertificationFailure(failureCode: string): boolean {
  if (NON_BLOCKING_TRUST_FAILURE_CODES.has(failureCode)) return false;
  if (failureCode.startsWith("entity_count_mismatch_")) {
    const entityId = failureCode.slice("entity_count_mismatch_".length) as keyof FullEntityCounts;
    return entityCountMismatchBlocksRecovery(entityId);
  }
  return true;
}

export function partitionEntityCountMismatch(
  entityId: keyof FullEntityCounts,
): { failureKey: string; blocksRecovery: boolean } {
  const failureKey = `entity_count_mismatch_${entityId}`;
  return { failureKey, blocksRecovery: entityCountMismatchBlocksRecovery(entityId) };
}
