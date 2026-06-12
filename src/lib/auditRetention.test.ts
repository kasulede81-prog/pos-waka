import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import type { AuditLogEntry } from "../types";

function auditEntry(partial: Partial<AuditLogEntry> & Pick<AuditLogEntry, "at" | "action">): AuditLogEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    actorUserId: partial.actorUserId ?? "owner-1",
    actorName: partial.actorName ?? "Owner",
    role: partial.role ?? "owner",
    payloadSummary: partial.payloadSummary ?? "test",
    payload: partial.payload ?? {},
    deviceId: partial.deviceId ?? "dev-1",
    ...partial,
  };
}

describe("audit retention on shift close", () => {
  beforeEach(() => {
    const startAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      preferences: {
        ...usePosStore.getState().preferences,
        shifts: [
          {
            id: "shift-1",
            actorUserId: "owner-1",
            actorName: "Owner",
            role: "owner",
            startAt,
            endAt: null,
            salesTotalUgx: 0,
            debtTotalUgx: 0,
            refundsUgx: 0,
            estimatedCashUgx: 0,
          },
        ],
      },
      auditLogs: [
        auditEntry({ id: "a1", at: startAt, action: "sale_completed", payloadSummary: "Sale during shift" }),
        auditEntry({
          id: "a2",
          at: new Date().toISOString(),
          action: "stock_adjust",
          payloadSummary: "Stock adjust during shift",
        }),
      ],
    });
  });

  it("endActiveShift never deletes audit logs from the shift window", () => {
    expect(usePosStore.getState().auditLogs).toHaveLength(2);
    usePosStore.getState().endActiveShift("owner-1");
    const logs = usePosStore.getState().auditLogs;
    expect(logs.some((l) => l.id === "a1")).toBe(true);
    expect(logs.some((l) => l.id === "a2")).toBe(true);
  });

  it("endActiveShift adds shift_end audit without removing prior entries", () => {
    usePosStore.getState().endActiveShift("owner-1");
    const logs = usePosStore.getState().auditLogs;
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.some((l) => l.action === "shift_end")).toBe(true);
    expect(logs.some((l) => l.id === "a1")).toBe(true);
    expect(logs.some((l) => l.id === "a2")).toBe(true);
  });
});
