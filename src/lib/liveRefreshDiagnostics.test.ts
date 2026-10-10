import { beforeEach, describe, expect, it, vi } from "vitest";

const reportSwallowedSyncFailure = vi.fn();
vi.mock("./monitoring", () => ({
  reportSwallowedSyncFailure: (...args: unknown[]) => reportSwallowedSyncFailure(...args),
}));

const {
  clearLiveRefreshFailures,
  createRefreshFailureReporter,
  getRecentLiveRefreshFailures,
  logLiveRefreshFailure,
} = await import("./liveRefreshDiagnostics");

beforeEach(() => {
  clearLiveRefreshFailures();
  reportSwallowedSyncFailure.mockClear();
});

describe("liveRefreshDiagnostics — recording", () => {
  it("records the surface and the reason, newest first", () => {
    logLiveRefreshFailure("subscription", new Error("boom"));
    logLiveRefreshFailure("public_pricing", "rpc refused");

    const recent = getRecentLiveRefreshFailures();

    expect(recent).toHaveLength(2);
    expect(recent[0].surface).toBe("public_pricing");
    expect(recent[0].reason).toBe("rpc refused");
    expect(recent[1].surface).toBe("subscription");
    expect(recent[1].reason).toBe("boom");
  });

  it("reports through the existing monitoring path", () => {
    logLiveRefreshFailure("subscription", new Error("boom"));

    expect(reportSwallowedSyncFailure).toHaveBeenCalledTimes(1);
    expect(reportSwallowedSyncFailure.mock.calls[0][0]).toBe("live_refresh_failed:subscription");
  });

  it("bounds the reason so a long server message cannot be stored whole", () => {
    logLiveRefreshFailure("subscription", "x".repeat(5000));

    expect(getRecentLiveRefreshFailures()[0].reason).toHaveLength(180);
  });

  it("keeps only the most recent events", () => {
    for (let i = 0; i < 40; i += 1) logLiveRefreshFailure("subscription", `error ${i}`);

    expect(getRecentLiveRefreshFailures()).toHaveLength(25);
  });
});

describe("liveRefreshDiagnostics — once per episode, not once per attempt", () => {
  it("suppresses an identical repeat so a 60s poll cannot flood monitoring", () => {
    const reporter = createRefreshFailureReporter("subscription");

    for (let i = 0; i < 60; i += 1) reporter.report("subscription_read_unavailable");

    expect(getRecentLiveRefreshFailures()).toHaveLength(1);
  });

  it("reports again when the failure changes", () => {
    const reporter = createRefreshFailureReporter("subscription");

    reporter.report("subscription_read_unavailable");
    reporter.report(new Error("network unreachable"));

    expect(getRecentLiveRefreshFailures()).toHaveLength(2);
    expect(reporter.currentReason()).toBe("network unreachable");
  });

  it("reports again after the surface recovers", () => {
    const reporter = createRefreshFailureReporter("public_pricing");

    reporter.report("rpc refused");
    reporter.clear();
    reporter.report("rpc refused");

    expect(getRecentLiveRefreshFailures()).toHaveLength(2);
    expect(reporter.currentReason()).toBe("rpc refused");
  });

  it("starts with nothing suppressed", () => {
    expect(createRefreshFailureReporter("checkout_quote").currentReason()).toBeNull();
  });

  it("names an unusable error rather than recording an empty reason", () => {
    const reporter = createRefreshFailureReporter("device_limit");

    reporter.report(undefined);

    expect(getRecentLiveRefreshFailures()[0].reason).toBe("unknown_error");
  });
});
