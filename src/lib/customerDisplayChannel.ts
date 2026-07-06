/**
 * BroadcastChannel bridge for customer-facing second screen.
 */

export type CustomerDisplayPayload = {
  shopName: string;
  tableLabel: string | null;
  lines: Array<{ name: string; quantity: number; lineTotalUgx: number }>;
  subtotalUgx: number;
  totalUgx: number;
  state: "ordering" | "paying" | "thanks";
  updatedAt: string;
};

const CHANNEL = "waka-customer-display";

export function publishCustomerDisplay(payload: CustomerDisplayPayload) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(payload);
    ch.close();
  } catch {
    /* ignore */
  }
}

export function subscribeCustomerDisplay(handler: (payload: CustomerDisplayPayload) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (ev) => {
    const data = ev.data as CustomerDisplayPayload;
    if (data && typeof data === "object") handler(data);
  };
  return () => ch.close();
}
