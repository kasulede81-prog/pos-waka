/** Contract: POS-ready is local-disk critical only. Cloud sync is background. */
export const POS_BOOT_GATES = {
  awaitInitializeActiveShop: true,
  awaitCriticalDiskHydrate: true,
  awaitCloudRecovery: false,
  awaitQueueFlush: false,
  awaitReports: false,
} as const;
