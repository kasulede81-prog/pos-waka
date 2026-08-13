import { afterEach, describe, expect, it, vi } from "vitest";
import {
  foregroundSyncTestCounters,
  resetForegroundSyncForTests,
  scheduleForegroundSync,
} from "./foregroundSync";

describe("foregroundSync", () => {
  afterEach(() => {
    resetForegroundSyncForTests();
    vi.useRealTimers();
  });

  it("collapses AppState + visibilitychange into one resume sync", () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    scheduleForegroundSync((job) => runs.push(job.reason), 250, { forcePull: false });
    scheduleForegroundSync((job) => runs.push(job.reason), 250, { forcePull: true });
    expect(foregroundSyncTestCounters().scheduled).toBe(2);
    expect(runs).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(runs).toEqual(["resume"]);
    expect(foregroundSyncTestCounters().fired).toBe(1);
  });

  it("ORs force flags from the collapsed events", () => {
    vi.useFakeTimers();
    const forces: boolean[] = [];
    scheduleForegroundSync((job) => forces.push(job.forcePull), 200, { forcePull: false });
    scheduleForegroundSync((job) => forces.push(job.forcePull), 200, { forcePull: true });
    vi.advanceTimersByTime(200);
    expect(forces).toEqual([true]);
  });
});
