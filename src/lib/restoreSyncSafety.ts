/**
 * Restore queue safety — archive pre-restore sync ops and track last restore stats.
 */

import { archiveAndClearSyncQueue, countArchivedRestoreQueueOps } from "../offline/localDb";

export type RestoreQueueSafetyResult = {
  clearedCount: number;
  archivedCount: number;
  totalArchivedOps: number;
  at: string;
};

let lastRestoreQueueSafety: RestoreQueueSafetyResult | null = null;

export function getLastRestoreQueueSafety(): RestoreQueueSafetyResult | null {
  return lastRestoreQueueSafety;
}

export async function clearSyncQueueForRestore(): Promise<RestoreQueueSafetyResult> {
  const { clearedCount, archivedCount } = await archiveAndClearSyncQueue();
  const totalArchivedOps = await countArchivedRestoreQueueOps();
  const result: RestoreQueueSafetyResult = {
    clearedCount,
    archivedCount,
    totalArchivedOps,
    at: new Date().toISOString(),
  };
  lastRestoreQueueSafety = result;
  return result;
}

export async function readRestoreArchiveStats(): Promise<{
  totalArchivedOps: number;
  lastRestore: RestoreQueueSafetyResult | null;
}> {
  return {
    totalArchivedOps: await countArchivedRestoreQueueOps(),
    lastRestore: lastRestoreQueueSafety,
  };
}
