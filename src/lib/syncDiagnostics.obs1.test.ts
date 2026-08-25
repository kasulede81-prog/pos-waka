import { beforeEach, describe, expect, it, vi } from "vitest";

describe("OBS-1 syncDiagnostics", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("builds point-in-time depth by kind and current-row attempts histogram", async () => {
    const diag = await import("./syncDiagnostics");
    diag.observeCurrentQueueMetrics([
      { kind: "pending_sales", attempts: 0 },
      { kind: "pending_sales", attempts: 2 },
      { kind: "product", attempts: 1 },
      { kind: "pending_stock_updates", attempts: 100 },
    ]);
    const { obs1 } = diag.readSyncDiagnosticsSnapshot();
    expect(obs1.queueDepthByKind).toEqual({
      pending_sales: 2,
      product: 1,
      pending_stock_updates: 1,
    });
    expect(obs1.currentQueueAttemptsHistogram).toEqual({
      "0": 1,
      "1": 1,
      "2": 1,
      "100+": 1,
    });
    expect(obs1.softStopRetainedCount).toBe(1);
    expect(diag.readSyncDiagnosticsSnapshot().lastQueueDepth).toBe(4);
  });

  it("labels attempts >= 100 as soft_stop_retained (not dead-letter)", async () => {
    const diag = await import("./syncDiagnostics");
    diag.observeCurrentQueueMetrics([
      { kind: "sale", attempts: 99 },
      { kind: "sale", attempts: 100 },
      { kind: "sale", attempts: 250 },
    ]);
    const { obs1, marks } = diag.readSyncDiagnosticsSnapshot();
    expect(obs1.softStopRetainedCount).toBe(2);
    expect(obs1.currentQueueAttemptsHistogram["100+"]).toBe(2);
    expect(obs1.currentQueueAttemptsHistogram["99"]).toBe(1);
    const depthMark = marks.filter((m) => m.event === "queue_depth").at(-1);
    expect(depthMark?.detail?.soft_stop_retained).toBe(2);
    expect(JSON.stringify(diag.readSyncDiagnosticsSnapshot())).not.toMatch(/dead.?letter/i);
  });

  it("does not persist raw payloads or PII in OBS-1 state", async () => {
    const diag = await import("./syncDiagnostics");
    diag.observeCurrentQueueMetrics([
      {
        kind: "pending_sales",
        attempts: 1,
        // @ts-expect-error — prove extra fields are ignored even if passed
        payload: { customerName: "Alice", pin: "1234", lines: [{ name: "Rx" }] },
        saleId: "sale-secret",
      },
    ]);
    const snap = diag.readSyncDiagnosticsSnapshot();
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("Alice");
    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain("sale-secret");
    expect(serialized).not.toContain("Rx");
    expect(snap.obs1.queueDepthByKind.pending_sales).toBe(1);
  });

  it("increments sale path attempt counters independently (no business-event dedupe)", async () => {
    const diag = await import("./syncDiagnostics");
    diag.recordSalePushImmediateAttempt();
    diag.recordSalePushImmediateAttempt();
    diag.recordSalePushQueueAttempt();
    diag.recordSalePushPendingSyncAttempt();
    diag.recordPendingSyncScanPushAttempt();
    const { obs1 } = diag.readSyncDiagnosticsSnapshot();
    expect(obs1.salePushImmediateAttempts).toBe(2);
    expect(obs1.salePushQueueAttempts).toBe(1);
    expect(obs1.salePushPendingSyncAttempts).toBe(1);
    expect(obs1.pendingSyncScanPushAttempts).toBe(1);
  });

  it("isolates observer throws via safeObserve", async () => {
    const diag = await import("./syncDiagnostics");
    expect(() =>
      diag.safeObserve(() => {
        throw new Error("observer boom");
      }),
    ).not.toThrow();
    expect(() =>
      diag.observeCurrentQueueMetrics([
        {
          get kind() {
            throw new Error("kind boom");
          },
          attempts: 0,
        },
      ]),
    ).not.toThrow();
  });

  it("resetObs1DiagnosticsForTests clears in-memory OBS-1 state (restart semantics)", async () => {
    const diag = await import("./syncDiagnostics");
    diag.observeCurrentQueueMetrics([{ kind: "product", attempts: 100 }]);
    diag.recordSalePushImmediateAttempt();
    diag.recordPendingSyncScanPushAttempt();
    diag.resetObs1DiagnosticsForTests();
    const { obs1 } = diag.readSyncDiagnosticsSnapshot();
    expect(obs1.queueDepthByKind).toEqual({});
    expect(obs1.currentQueueAttemptsHistogram).toEqual({});
    expect(obs1.softStopRetainedCount).toBe(0);
    expect(obs1.salePushImmediateAttempts).toBe(0);
    expect(obs1.pendingSyncScanPushAttempts).toBe(0);
  });
});
