import { describe, expect, it } from "vitest";
import {
  computeRecoveryProgressPct,
  DOWNLOAD_PROGRESS_CAP,
  progressPctForStep,
  VALIDATING_PROGRESS,
} from "./recoveryProgress";
import type { CloudRecoverySessionState } from "./cloudRecoverySession";

function session(partial: Partial<CloudRecoverySessionState>): CloudRecoverySessionState {
  return {
    status: "active",
    progressPhase: "downloading",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    currentStep: null,
    lastCompletedStep: null,
    progressFloorPct: 0,
    manualProgressPct: 0,
    runtime: {
      sessionId: null,
      currentStage: null,
      stageStartedAt: null,
      timeoutCount: 0,
      retryCount: 0,
      idbPersistDurationMs: null,
      lastCloudRequestDurationMs: null,
    },
    downloadedCounts: { products: 0, sales: 0, customers: 0, inventory: 0, shifts: 0, dayCloses: 0, cashRecords: 0 },
    restoredCounts: { products: 0, sales: 0, customers: 0, inventory: 0, shifts: 0, dayCloses: 0, cashRecords: 0 },
    entityCounts: { products: 0, sales: 0, customers: 0, inventory: 0, shifts: 0, dayCloses: 0, cashRecords: 0 },
    integrityDiagnostics: {} as CloudRecoverySessionState["integrityDiagnostics"],
    certification: null,
    certificationWarnings: [],
    errorMessage: null,
    errorKey: null,
    validation: null,
    completeness: null,
    completedWithInventoryWarnings: false,
    completionMessage: null,
    ...partial,
  };
}

describe("recoveryProgress", () => {
  it("caps download progress at 90%", () => {
    const pct = computeRecoveryProgressPct(session({ lastCompletedStep: "staff" }));
    expect(pct).toBe(DOWNLOAD_PROGRESS_CAP);
  });

  it("never shows 100% until complete", () => {
    expect(computeRecoveryProgressPct(session({ progressPhase: "validating" }))).toBe(VALIDATING_PROGRESS);
    expect(computeRecoveryProgressPct(session({ status: "complete", progressPhase: "complete" }))).toBe(100);
  });

  it("does not reset progress for audit step", () => {
    const pct = computeRecoveryProgressPct(session({ lastCompletedStep: "audit" }));
    expect(pct).toBe(DOWNLOAD_PROGRESS_CAP);
  });

  it("maps returns step into ladder (not 0%)", () => {
    expect(progressPctForStep("returns")).toBeGreaterThan(progressPctForStep("customers"));
    expect(computeRecoveryProgressPct(session({ lastCompletedStep: "returns" }))).toBeGreaterThan(0);
  });

  it("respects monotonic progress floor", () => {
    const pct = computeRecoveryProgressPct(
      session({ lastCompletedStep: "probing", progressFloorPct: 40, manualProgressPct: 0 }),
    );
    expect(pct).toBe(40);
  });
});
