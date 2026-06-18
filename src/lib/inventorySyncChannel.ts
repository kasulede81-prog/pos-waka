/**
 * Cross-tab inventory sync — BroadcastChannel with localStorage storage-event fallback.
 */

import { getActiveAccountKey } from "../offline/accountScope";

export const INVENTORY_SYNC_CHANNEL_NAME = "waka-pos-inventory";
export const INVENTORY_SYNC_STORAGE_KEY = "waka-pos-inventory-sync";

export type InventorySyncEventType =
  | "stock_changed"
  | "sale_completed"
  | "purchase_saved"
  | "stock_adjusted"
  | "sale_void"
  | "sale_return"
  | "purchase_void";

export type InventoryStockSyncMessage = {
  accountKey: string;
  type: InventorySyncEventType;
  productId: string;
  newStock: number;
  version: number;
  timestamp: number;
  tabId: string;
};

export type InventoryStockUpdate = Pick<InventoryStockSyncMessage, "productId" | "newStock" | "version">;

const tabId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `tab-${Date.now()}`;

let channel: BroadcastChannel | null = null;
let storageListener: ((ev: StorageEvent) => void) | null = null;
let messageHandler: ((msg: InventoryStockSyncMessage) => void) | null = null;

function isInventoryMessage(raw: unknown): raw is InventoryStockSyncMessage {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as InventoryStockSyncMessage;
  return (
    typeof m.accountKey === "string" &&
    typeof m.type === "string" &&
    typeof m.productId === "string" &&
    typeof m.newStock === "number" &&
    typeof m.version === "number" &&
    typeof m.timestamp === "number" &&
    typeof m.tabId === "string"
  );
}

function deliverMessage(msg: InventoryStockSyncMessage): void {
  if (msg.tabId === tabId) return;
  const activeKey = getActiveAccountKey();
  if (!activeKey || msg.accountKey !== activeKey) return;
  messageHandler?.(msg);
}

function postViaStorage(msg: InventoryStockSyncMessage): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(INVENTORY_SYNC_STORAGE_KEY, JSON.stringify(msg));
    localStorage.removeItem(INVENTORY_SYNC_STORAGE_KEY);
  } catch {
    /* quota / private mode */
  }
}

function postMessage(msg: InventoryStockSyncMessage): void {
  try {
    channel?.postMessage(msg);
  } catch {
    /* channel closed */
  }
  postViaStorage(msg);
}

/** Broadcast stock updates to other tabs (same account only). */
export function emitInventoryStockChanges(updates: InventoryStockUpdate[], type: InventorySyncEventType): void {
  const accountKey = getActiveAccountKey();
  if (!accountKey || updates.length === 0) return;
  const timestamp = Date.now();
  for (const u of updates) {
    postMessage({
      accountKey,
      type,
      productId: u.productId,
      newStock: u.newStock,
      version: u.version,
      timestamp,
      tabId,
    });
  }
}

/** Subscribe to inventory updates from other tabs. Returns dispose function. */
export function initInventorySyncChannel(onMessage: (msg: InventoryStockSyncMessage) => void): () => void {
  messageHandler = onMessage;

  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(INVENTORY_SYNC_CHANNEL_NAME);
      channel.onmessage = (ev: MessageEvent) => {
        if (isInventoryMessage(ev.data)) deliverMessage(ev.data);
      };
    } catch {
      channel = null;
    }
  }

  if (typeof window !== "undefined") {
    storageListener = (ev: StorageEvent) => {
      if (ev.key !== INVENTORY_SYNC_STORAGE_KEY || !ev.newValue) return;
      try {
        const parsed: unknown = JSON.parse(ev.newValue);
        if (isInventoryMessage(parsed)) deliverMessage(parsed);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", storageListener);
  }

  return () => {
    messageHandler = null;
    if (channel) {
      channel.close();
      channel = null;
    }
    if (storageListener && typeof window !== "undefined") {
      window.removeEventListener("storage", storageListener);
      storageListener = null;
    }
  };
}

/** @internal Test-only reset */
export function resetInventorySyncChannelForTests(): void {
  messageHandler = null;
  if (channel) {
    channel.close();
    channel = null;
  }
  if (storageListener && typeof window !== "undefined") {
    window.removeEventListener("storage", storageListener);
    storageListener = null;
  }
}

export function inventorySyncTabIdForTests(): string {
  return tabId;
}
