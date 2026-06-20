import { describe, expect, it } from "vitest";
import type { SyncOperation } from "../types";
import { evaluateAuditDeletionGate } from "./auditPreservation";

const baseOp = (partial: Partial<SyncOperation>): SyncOperation => ({
  id: "op-1",
  kind: "audit_log",
  payload: {},
  createdAt: new Date().toISOString(),
  attempts: 0,
  lastAttemptAt: null,
  ...partial,
});

describe("auditPreservation", () => {
  it("blocks deletion when audit_log ops are pending", () => {
    const gate = evaluateAuditDeletionGate([baseOp({ kind: "audit_log" })], {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastPullAt: null,
      lastPushAt: null,
      lastIssueAt: null,
      lastIssueCode: "none",
      offlineSinceAt: null,
      lastOnlineAt: null,
      queueHealth: "healthy",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.errorKey).toBe("audit_sync_pending");
      expect(gate.pendingAuditOps).toBe(1);
    }
  });

  it("blocks deletion when sync health is degraded", () => {
    const gate = evaluateAuditDeletionGate([], {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastPullAt: null,
      lastPushAt: null,
      lastIssueAt: null,
      lastIssueCode: "none",
      offlineSinceAt: null,
      lastOnlineAt: null,
      queueHealth: "degraded",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.errorKey).toBe("sync_health_degraded");
  });

  it("allows deletion when queue and sync health are clean", () => {
    const gate = evaluateAuditDeletionGate([], {
      lastAttemptAt: null,
      lastSuccessAt: "2026-06-01T00:00:00.000Z",
      lastPullAt: "2026-06-01T00:00:00.000Z",
      lastPushAt: "2026-06-01T00:00:00.000Z",
      lastIssueAt: null,
      lastIssueCode: "none",
      offlineSinceAt: null,
      lastOnlineAt: null,
      queueHealth: "healthy",
    });
    expect(gate.ok).toBe(true);
  });
});
