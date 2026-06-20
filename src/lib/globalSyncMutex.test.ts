import { describe, expect, it } from "vitest";
import {
  currentGlobalSyncKind,
  globalSyncMutexDepth,
  isGlobalSyncInFlight,
  withGlobalSyncMutex,
} from "./globalSyncMutex";

describe("globalSyncMutex", () => {
  it("runs tasks sequentially when not nested", async () => {
    const order: string[] = [];
    const first = withGlobalSyncMutex("syncShopWithCloud", async () => {
      order.push("start-1");
      await new Promise((r) => setTimeout(r, 20));
      order.push("end-1");
    });
    const second = withGlobalSyncMutex("flushSyncQueue", async () => {
      order.push("start-2");
      order.push("end-2");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
    expect(isGlobalSyncInFlight()).toBe(false);
    expect(currentGlobalSyncKind()).toBeNull();
  });

  it("queues a second top-level call while the first is in flight", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withGlobalSyncMutex("syncShopWithCloud", async () => {
      order.push("start-1");
      await firstGate;
      order.push("end-1");
    });
    const second = withGlobalSyncMutex("flushSyncQueue", async () => {
      order.push("start-2");
      order.push("end-2");
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["start-1"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
    expect(isGlobalSyncInFlight()).toBe(false);
    expect(currentGlobalSyncKind()).toBeNull();
  });

  it("allows nested reentrant calls without deadlock (push → flush pattern)", async () => {
    const order: string[] = [];
    await withGlobalSyncMutex("pushPending", async () => {
      order.push("push-start");
      expect(globalSyncMutexDepth()).toBe(1);
      await withGlobalSyncMutex("flushSyncQueue", async () => {
        order.push("flush-inner");
        expect(globalSyncMutexDepth()).toBe(2);
      });
      order.push("push-end");
      expect(globalSyncMutexDepth()).toBe(1);
    });
    expect(order).toEqual(["push-start", "flush-inner", "push-end"]);
    expect(isGlobalSyncInFlight()).toBe(false);
  });
});
