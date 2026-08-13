import { afterEach, describe, expect, it, vi } from "vitest";
import { createIncrementalPullCoalescer } from "./incrementalPullCoalesce";

describe("incrementalPullCoalesce", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces overlapping incremental pulls into one in-flight job", async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const coalescer = createIncrementalPullCoalescer({
      delayMsForReason: () => 0,
      run: async (job) => {
        started.push(job.reason);
        await gate;
        return true;
      },
    });
    coalescer.schedule("sale_ack");
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["sale_ack"]);
    coalescer.schedule("sale_ack");
    coalescer.schedule("sale_ack");
    expect(started).toEqual(["sale_ack"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["sale_ack"]);
  });

  it("upgrades a sale ACK follow-up to a resume bundle", async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const coalescer = createIncrementalPullCoalescer({
      delayMsForReason: () => 0,
      run: async (job) => {
        started.push(job.reason);
        if (started.length === 1) await gate;
        return true;
      },
    });
    coalescer.schedule("sale_ack");
    await vi.advanceTimersByTimeAsync(0);
    coalescer.schedule("resume", { force: true });
    release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(started).toEqual(["sale_ack", "resume"]);
  });

  it("collapses a realtime burst into one scheduled pull", async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const coalescer = createIncrementalPullCoalescer({
      delayMsForReason: (reason) => (reason === "realtime" ? 300 : 0),
      run: async (job) => {
        started.push(job.reason);
        return true;
      },
    });
    coalescer.schedule("realtime", { force: true });
    coalescer.schedule("realtime", { force: true });
    coalescer.schedule("realtime", { force: true });
    expect(started).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(started).toEqual(["realtime"]);
  });
});
