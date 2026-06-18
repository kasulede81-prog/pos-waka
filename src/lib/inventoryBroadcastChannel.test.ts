import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveAccountKey } from "../offline/accountScope";
import {
  INVENTORY_SYNC_CHANNEL_NAME,
  INVENTORY_SYNC_STORAGE_KEY,
  emitInventoryStockChanges,
  initInventorySyncChannel,
  resetInventorySyncChannelForTests,
  type InventoryStockSyncMessage,
} from "./inventorySyncChannel";

const ACCOUNT = "sb:test-user";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

class MockBroadcastChannel {
  static readonly instances = new Map<string, Set<MockBroadcastChannel>>();
  readonly name: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.instances.has(name)) {
      MockBroadcastChannel.instances.set(name, new Set());
    }
    MockBroadcastChannel.instances.get(name)!.add(this);
  }

  postMessage(data: unknown): void {
    for (const peer of MockBroadcastChannel.instances.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    MockBroadcastChannel.instances.get(this.name)?.delete(this);
  }
}

describe("inventoryBroadcastChannel", () => {
  beforeEach(() => {
    setActiveAccountKey(ACCOUNT);
    MockBroadcastChannel.instances.clear();
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  });

  afterEach(() => {
    resetInventorySyncChannelForTests();
    setActiveAccountKey(null);
    vi.unstubAllGlobals();
  });

  it("propagates stock updates from another tab via BroadcastChannel", () => {
    const received: InventoryStockSyncMessage[] = [];
    const dispose = initInventorySyncChannel((msg) => received.push(msg));

    const foreignMsg: InventoryStockSyncMessage = {
      accountKey: ACCOUNT,
      type: "stock_changed",
      productId: PRODUCT_ID,
      newStock: 7,
      version: 3,
      timestamp: Date.now(),
      tabId: "foreign-tab",
    };

    const instances = MockBroadcastChannel.instances.get(INVENTORY_SYNC_CHANNEL_NAME);
    const channel = instances ? [...instances][0] : null;
    channel?.onmessage?.({ data: foreignMsg } as MessageEvent);

    expect(received).toHaveLength(1);
    expect(received[0]!.productId).toBe(PRODUCT_ID);
    expect(received[0]!.newStock).toBe(7);
    expect(received[0]!.version).toBe(3);
    expect(received[0]!.type).toBe("stock_changed");

    dispose();
  });

  it("emit posts to BroadcastChannel peers", () => {
    const peer = new MockBroadcastChannel(INVENTORY_SYNC_CHANNEL_NAME);
    const peerReceived: unknown[] = [];
    peer.onmessage = (ev) => peerReceived.push(ev.data);

    initInventorySyncChannel(() => undefined);
    emitInventoryStockChanges([{ productId: PRODUCT_ID, newStock: 2, version: 2 }], "sale_completed");

    expect(peerReceived.length).toBeGreaterThanOrEqual(1);
    resetInventorySyncChannelForTests();
    peer.close();
  });

  it("ignores messages from the same tab", () => {
    const received: InventoryStockSyncMessage[] = [];
    const dispose = initInventorySyncChannel((msg) => received.push(msg));

    emitInventoryStockChanges([{ productId: PRODUCT_ID, newStock: 1, version: 1 }], "sale_completed");

    expect(received).toHaveLength(0);
    dispose();
  });

  it("storage-event fallback delivers updates when BroadcastChannel is unavailable", () => {
    vi.stubGlobal("BroadcastChannel", undefined as unknown as typeof BroadcastChannel);

    const storageListeners: Array<(ev: StorageEvent) => void> = [];
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: (ev: StorageEvent) => void) => {
        if (type === "storage") storageListeners.push(fn);
      },
      removeEventListener: (type: string, fn: (ev: StorageEvent) => void) => {
        if (type === "storage") {
          const idx = storageListeners.indexOf(fn);
          if (idx >= 0) storageListeners.splice(idx, 1);
        }
      },
    });

    const received: InventoryStockSyncMessage[] = [];
    const dispose = initInventorySyncChannel((msg) => received.push(msg));

    const msg = {
      accountKey: ACCOUNT,
      type: "stock_adjusted" as const,
      productId: PRODUCT_ID,
      newStock: 12,
      version: 4,
      timestamp: Date.now(),
      tabId: "other-tab",
    };

    for (const fn of storageListeners) {
      fn({
        key: INVENTORY_SYNC_STORAGE_KEY,
        newValue: JSON.stringify(msg),
      } as StorageEvent);
    }

    expect(received).toHaveLength(1);
    expect(received[0]!.newStock).toBe(12);
    dispose();
  });

  it("filters messages for a different account key", () => {
    const received: InventoryStockSyncMessage[] = [];
    const disposePeer = initInventorySyncChannel((msg) => received.push(msg));
    const disposeSelf = initInventorySyncChannel(() => undefined);

    setActiveAccountKey("sb:other-account");
    emitInventoryStockChanges([{ productId: PRODUCT_ID, newStock: 99, version: 9 }], "purchase_saved");
    setActiveAccountKey(ACCOUNT);

    expect(received).toHaveLength(0);
    disposePeer();
    disposeSelf();
  });
});
