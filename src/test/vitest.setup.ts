import { vi } from "vitest";

const noop = vi.fn(async () => undefined);
const nullAsync = vi.fn(async () => null);
const emptyAsync = vi.fn(async () => [] as unknown[]);

/** Prevent unhandled IndexedDB rejections when store mutations touch offline persistence in Node. */
vi.mock("../offline/localDb", () => ({
  warmupLocalDb: vi.fn(),
  getLocalDb: vi.fn(async () => ({})),
  readKv: nullAsync,
  writeKv: noop,
  deleteKv: noop,
  readSnapshot: nullAsync,
  readSnapshotWithFallback: nullAsync,
  claimLegacySnapshotForCurrentAccount: nullAsync,
  writeSnapshot: noop,
  readSyncQueue: emptyAsync,
  appendSyncOperation: noop,
  removeSyncOperation: noop,
  clearSyncQueue: noop,
  archiveAndClearSyncQueue: vi.fn(async () => ({ clearedCount: 0, archivedCount: 0 })),
  countArchivedRestoreQueueOps: vi.fn(async () => 0),
  appendBackupRecord: noop,
  listBackupRecords: emptyAsync,
  getBackupRecord: nullAsync,
  deleteBackupRecord: noop,
  listAccountKeysInIndexedDb: emptyAsync,
  countBackupsForAccount: vi.fn(async () => 0),
  hasIndexedDbDataForAccount: vi.fn(async () => false),
  wipeIndexedDbNamespace: vi.fn(async () => ({
    accountKey: "",
    kvDeleted: 0,
    snapshotsDeleted: 0,
    syncOpsDeleted: 0,
    backupsDeleted: 0,
  })),
}));
