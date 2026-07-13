import { beforeEach, describe, expect, it, vi } from "vitest";

describe("syncDiagnostics", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("records enqueue and ack latencies in snapshot timeline", async () => {
    const diag = await import("./syncDiagnostics");
    diag.recordEnqueueLatency(12);
    diag.recordPushDuration(340);
    diag.recordAckLatency(380);
    const snap = diag.readSyncDiagnosticsSnapshot();
    expect(snap.lastEnqueueLatencyMs).toBe(12);
    expect(snap.lastPushDurationMs).toBe(340);
    expect(snap.lastAckLatencyMs).toBe(380);
    expect(snap.timelineMs.commitToQueue).toBe(12);
    expect(snap.timelineMs.queueToUpload).toBe(340);
    expect(snap.timelineMs.uploadToAck).toBe(380);
  });

  it("measures realtime event to pull latency", async () => {
    const diag = await import("./syncDiagnostics");
    diag.markRealtimeEventReceived();
    const latency = diag.consumeRealtimeToPullLatency();
    expect(latency).not.toBeNull();
    expect(latency).toBeGreaterThanOrEqual(0);
    expect(diag.readSyncDiagnosticsSnapshot().lastRealtimeLatencyMs).toBe(latency);
  });

  it("classifies connection quality from push history", async () => {
    const diag = await import("./syncDiagnostics");
    expect(diag.syncConnectionQuality(true)).toBe("good");
    diag.recordPushDuration(900);
    expect(diag.syncConnectionQuality(true)).toBe("excellent");
    diag.recordPushDuration(4000);
    expect(diag.syncConnectionQuality(true)).toBe("good");
    diag.recordPushDuration(7000);
    expect(diag.syncConnectionQuality(true)).toBe("slow");
    expect(diag.syncConnectionQuality(false)).toBe("offline");
  });

  it("adapts coalesce delay by connection quality", async () => {
    const diag = await import("./syncDiagnostics");
    const base = 200;
    diag.recordPushDuration(4000);
    expect(diag.coalesceMsForConnection(true, base)).toBe(base);
    diag.recordPushDuration(7000);
    expect(diag.coalesceMsForConnection(true, base)).toBe(base * 2);
    diag.markSyncReconnecting(10_000);
    expect(diag.coalesceMsForConnection(true, base)).toBe(base * 3);
  });

  it("records queue depth and retries", async () => {
    const diag = await import("./syncDiagnostics");
    diag.recordQueueDepth(7);
    diag.recordSyncRetry("pending_sales", 3);
    const snap = diag.readSyncDiagnosticsSnapshot();
    expect(snap.lastQueueDepth).toBe(7);
    expect(snap.lastRetryCount).toBe(3);
  });
});
