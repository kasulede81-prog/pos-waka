import { describe, expect, it } from "vitest";
import { markBootstrapEnd, markBootstrapStart, readPerformanceSnapshot, recordBootstrapIdbRead } from "./performanceMetrics";

describe("performanceMetrics", () => {
  it("tracks bootstrap idb reads and duration", () => {
    markBootstrapStart();
    recordBootstrapIdbRead(120);
    recordBootstrapIdbRead(5000, { fullTable: true });
    markBootstrapEnd();
    const snap = readPerformanceSnapshot();
    expect(snap.bootstrapIdbReads).toBe(2);
    expect(snap.bootstrapRecordsScanned).toBe(5120);
    expect(snap.bootstrapUsedFullTableScan).toBe(true);
    expect(snap.bootstrapDurationMs).not.toBeNull();
  });
});
