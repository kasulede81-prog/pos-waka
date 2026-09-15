import { describe, expect, it } from "vitest";
import {
  currentGlobalSyncKind,
  globalSyncMutexDepth,
  isGlobalSyncInFlight,
  isPullSyncInFlight,
  isPushSyncInFlight,
  withGlobalSyncMutex,
  withPullSyncMutex,
  withPushSyncMutex,
} from "./globalSyncMutex";

describe("globalSyncMutex", () => {
  it("runs pull tasks sequentially when not nested", async () => {
    const order: string[] = [];
    const first = withPullSyncMutex("syncShopWithCloud", async () => {
      order.push("pull-start-1");
      await new Promise((r) => setTimeout(r, 20));
      order.push("pull-end-1");
    });
    const second = withPullSyncMutex("pullCloud", async () => {
      order.push("pull-start-2");
      order.push("pull-end-2");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["pull-start-1", "pull-end-1", "pull-start-2", "pull-end-2"]);
    expect(isPullSyncInFlight()).toBe(false);
  });

  it("runs push tasks sequentially when not nested", async () => {
    const order: string[] = [];
    await withPushSyncMutex("pushPending", async () => {
      order.push("push-start-1");
      await withPushSyncMutex("flushSyncQueue", async () => {
        order.push("flush-inner");
      });
      order.push("push-end-1");
    });
    expect(order).toEqual(["push-start-1", "flush-inner", "push-end-1"]);
    expect(isPushSyncInFlight()).toBe(false);
  });

  it("allows push while pull is in flight (split pipelines)", async () => {
    const order: string[] = [];
    let releasePull: (() => void) | undefined;
    const pullGate = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    const pull = withPullSyncMutex("syncShopWithCloud", async () => {
      order.push("pull-start");
      await pullGate;
      order.push("pull-end");
    });
    await new Promise((r) => setTimeout(r, 10));
    const push = withPushSyncMutex("pushPending", async () => {
      order.push("push-start");
      order.push("push-end");
    });
    await Promise.all([push, (async () => {
      await new Promise((r) => setTimeout(r, 10));
      releasePull?.();
      await pull;
    })()]);
    expect(order).toContain("pull-start");
    expect(order).toContain("push-start");
    expect(order).toContain("push-end");
    expect(isGlobalSyncInFlight()).toBe(false);
    expect(currentGlobalSyncKind()).toBeNull();
  });

  it("allows nested reentrant calls within the same pipeline", async () => {
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
