import { describe, expect, it } from "vitest";
import { currentGlobalSyncKind, isGlobalSyncInFlight, withGlobalSyncMutex } from "./globalSyncMutex";

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

  it("allows reentrant nested calls", async () => {
    await withGlobalSyncMutex("syncShopWithCloud", async () => {
      expect(isGlobalSyncInFlight()).toBe(true);
      await withGlobalSyncMutex("pushPending", async () => {
        expect(currentGlobalSyncKind()).toBe("syncShopWithCloud");
      });
    });
    expect(isGlobalSyncInFlight()).toBe(false);
  });
});
