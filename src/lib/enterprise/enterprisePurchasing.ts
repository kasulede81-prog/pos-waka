import type { EnterprisePurchaseOrderStatus } from "../../types/enterprise";

const PO_TRANSITIONS: Record<EnterprisePurchaseOrderStatus, EnterprisePurchaseOrderStatus[]> = {
  pending: ["approved", "cancelled"],
  approved: ["ordered", "cancelled"],
  ordered: ["partially_received", "received", "cancelled"],
  partially_received: ["received", "cancelled"],
  received: [],
  cancelled: [],
};

export function canTransitionPurchaseOrder(
  from: EnterprisePurchaseOrderStatus,
  to: EnterprisePurchaseOrderStatus,
): boolean {
  return PO_TRANSITIONS[from]?.includes(to) ?? false;
}

export function purchaseOrderStatusLabelKey(status: EnterprisePurchaseOrderStatus): string {
  return `enterprisePoStatus_${status}`;
}

export function computePoOutstanding(totalUgx: number, receivedFraction: number): number {
  const received = Math.min(1, Math.max(0, receivedFraction));
  return Math.round(totalUgx * (1 - received));
}
