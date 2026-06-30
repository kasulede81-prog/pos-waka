import { describe, expect, it, vi } from "vitest";

vi.mock("./nativeApp", () => ({
  isNativeApp: () => false,
}));

describe("syncTiming desktop profile", () => {
  it("uses aggressive desktop cadence on fine pointer wide screens", async () => {
    vi.stubGlobal("window", {
      innerWidth: 1280,
      matchMedia: (query: string) => ({
        matches: query.includes("coarse") ? false : true,
      }),
    });
    vi.resetModules();
    const timing = await import("./syncTiming");
    expect(timing.activeSyncProfile()).toBe("desktop");
    expect(timing.POST_SALE_PUSH_DEBOUNCE_MS).toBeLessThanOrEqual(150);
    expect(timing.SYNC_SALE_PUSH_CONCURRENCY).toBeGreaterThanOrEqual(6);
    expect(timing.SYNC_PULL_MIN_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });

  it("uses mobile web cadence on narrow touch browsers", async () => {
    vi.stubGlobal("window", {
      innerWidth: 390,
      matchMedia: (query: string) => ({
        matches: query.includes("coarse"),
      }),
    });
    vi.resetModules();
    const timing = await import("./syncTiming");
    expect(timing.activeSyncProfile()).toBe("mobile_web");
    expect(timing.POST_SALE_PUSH_DEBOUNCE_MS).toBeGreaterThan(150);
  });
});
