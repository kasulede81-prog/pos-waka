import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * INCIDENT: a device recovering after an admin shop reset got stuck showing
 * the "Verifying cloud data…" banner forever, even though the app underneath
 * was already usable. Root cause: `runBackgroundRecoveryCertification` made
 * ~18 network round trips (a full sync, an audit-log pull, 16 entity counts,
 * a staff RPC) with no timeout anywhere and nothing wrapping the function in
 * a try/catch — a single stalled request on a slow/flaky mobile connection
 * left `session.status` stuck at "certifying" with no way out.
 *
 * These tests prove the fix: the whole certification pass now races against
 * a bounded timeout, and ANY failure to finish (a genuine hang, included)
 * still transitions the session out of "certifying" via
 * `recordCertificationWarnings` — the same non-blocking outcome the
 * pre-existing gate-failure path already used.
 */

const mockBeginBackgroundCertification = vi.fn();
const mockSetRecoveryProgressPhase = vi.fn();
const mockRecordCertificationWarnings = vi.fn();
const mockCompleteCloudRecoverySession = vi.fn();
const mockRecordRecoveryCertification = vi.fn();
const mockSyncRecoveryRestoredCountsFromStore = vi.fn();
const mockGetDeviceOnline = vi.fn();
const mockFetchCloudEntityCounts = vi.fn();
const mockUploadShopCloudSnapshot = vi.fn();
const mockValidateRecoveryCompletionGate = vi.fn();

vi.mock("./cloudRecoverySession", () => ({
  beginBackgroundCertification: (...args: unknown[]) => mockBeginBackgroundCertification(...args),
  completeCloudRecoverySession: (...args: unknown[]) => mockCompleteCloudRecoverySession(...args),
  recordCertificationWarnings: (...args: unknown[]) => mockRecordCertificationWarnings(...args),
  recordRecoveryCertification: (...args: unknown[]) => mockRecordRecoveryCertification(...args),
  setRecoveryProgressPhase: (...args: unknown[]) => mockSetRecoveryProgressPhase(...args),
  syncRecoveryRestoredCountsFromStore: (...args: unknown[]) => mockSyncRecoveryRestoredCountsFromStore(...args),
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: (...args: unknown[]) => mockGetDeviceOnline(...args),
}));

vi.mock("./cloudRecoveryValidator", () => ({
  buildCloudRecoverySimulationReport: () => ({}),
  recordCloudRecoveryValidation: () => undefined,
}));

vi.mock("./cloudTrustCenter", () => ({
  fetchCloudEntityCounts: (...args: unknown[]) => mockFetchCloudEntityCounts(...args),
  buildCloudTrustCertificationReport: () => ({}),
  readLocalEntityCounts: () => ({}),
}));

vi.mock("./cloudRecoveryGate", () => ({
  validateRecoveryCompletionGate: (...args: unknown[]) => mockValidateRecoveryCompletionGate(...args),
}));

vi.mock("./cloudSnapshotSync", () => ({
  uploadShopCloudSnapshot: (...args: unknown[]) => mockUploadShopCloudSnapshot(...args),
}));

vi.mock("./cloudRecoveryCompleteness", () => ({
  buildRecoveryCompletenessReport: () => ({}),
}));

vi.mock("./recoveryModuleCheckpoints", () => ({
  clearRecoveryModuleCheckpoints: () => undefined,
}));

vi.mock("../offline/cloudSync", () => ({
  wasLastSalesPullTruncated: () => false,
  pushShopPendingToCloud: async () => undefined,
  syncShopWithCloud: async () => undefined,
  resolveShopCtx: async () => null,
}));

vi.mock("./auditCloudSync", () => ({
  pullAuditLogsFromCloud: async () => [],
  mergeAuditLogsFromCloudPull: () => ({ auditLogs: [], archivedAuditLogs: [] }),
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => ({
      stockMovements: [],
      inventoryCountSessions: [],
      archivedSales: [],
      auditLogs: [],
      archivedAuditLogs: [],
      preferences: {},
    }),
    setState: () => undefined,
  },
}));

function fakeOpts() {
  return {
    probe: {} as never,
    validation: {} as never,
    restoredCounts: {} as never,
  };
}

describe("runBackgroundRecoveryCertification — never leaves the banner stuck on 'certifying'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetDeviceOnline.mockReturnValue(false); // skip the heavy-sync branch, isolate the hang to fetchCloudEntityCounts
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions out of 'certifying' via recordCertificationWarnings when a network call hangs past the timeout ceiling", async () => {
    // Simulates the real incident: a count query that never resolves on a
    // stalled mobile connection.
    mockFetchCloudEntityCounts.mockReturnValue(new Promise(() => {}));

    const { runBackgroundRecoveryCertification } = await import("./backgroundRecoveryCertification");
    const run = runBackgroundRecoveryCertification(fakeOpts());

    expect(mockBeginBackgroundCertification).toHaveBeenCalledTimes(1);
    expect(mockRecordCertificationWarnings).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    await run;

    expect(mockRecordCertificationWarnings).toHaveBeenCalledTimes(1);
    expect(mockRecordCertificationWarnings.mock.calls[0]?.[0]).toEqual(["certification_error"]);
    // The gate-failure path (completeCloudRecoverySession) must NOT have run —
    // this is the timeout/fallback path, not a normal completion.
    expect(mockCompleteCloudRecoverySession).not.toHaveBeenCalled();
  });

  it("finishes well before the timeout and calls completeCloudRecoverySession when everything resolves normally", async () => {
    mockFetchCloudEntityCounts.mockResolvedValue({ counts: {}, errors: {} });
    mockValidateRecoveryCompletionGate.mockReturnValue({
      ok: true,
      failures: [],
      warnings: [],
      inventoryWarnings: false,
      message: "ok",
    });

    const { runBackgroundRecoveryCertification } = await import("./backgroundRecoveryCertification");
    await runBackgroundRecoveryCertification(fakeOpts());

    expect(mockRecordCertificationWarnings).not.toHaveBeenCalled();
    expect(mockCompleteCloudRecoverySession).toHaveBeenCalledTimes(1);
  });
});
