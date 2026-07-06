import type { EnterpriseStockTransfer, StockTransferStatus } from "../../types/enterprise";

/** Valid transfer lifecycle transitions (offline-safe state machine). */
const TRANSFER_TRANSITIONS: Record<StockTransferStatus, StockTransferStatus[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["shipped", "cancelled"],
  shipped: ["in_transit"],
  in_transit: ["received"],
  received: ["completed"],
  completed: [],
  cancelled: [],
  rejected: [],
};

export function canTransitionTransfer(from: StockTransferStatus, to: StockTransferStatus): boolean {
  return TRANSFER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextTransferStatuses(current: StockTransferStatus): StockTransferStatus[] {
  return TRANSFER_TRANSITIONS[current] ?? [];
}

export function transferRequiresApproval(transfer: Pick<EnterpriseStockTransfer, "controlledTransfer">): boolean {
  return transfer.controlledTransfer;
}

export function validateTransferLines(
  lines: EnterpriseStockTransfer["lines"],
): { ok: boolean; errorKey?: string } {
  if (!lines.length) return { ok: false, errorKey: "enterpriseTransferLinesRequired" };
  for (const line of lines) {
    if (line.quantity <= 0) return { ok: false, errorKey: "enterpriseTransferInvalidQty" };
    if (line.receivedQuantity > line.quantity) return { ok: false, errorKey: "enterpriseTransferOverReceive" };
  }
  return { ok: true };
}

export function transferStatusLabelKey(status: StockTransferStatus): string {
  return `enterpriseTransferStatus_${status}`;
}
