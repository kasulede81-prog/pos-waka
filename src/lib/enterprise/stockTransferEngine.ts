/**
 * MB-4B — transfer durable identity helpers + receive validation.
 */

import { weightedCostAfterStockInPrecise } from "../costPrecision";

export type TransferDispatchOperationKey = {
  shopId: string;
  referenceType: "transfer_dispatch";
  referenceId: string;
  productId: string;
};

export type TransferReceiveOperationKey = {
  shopId: string;
  referenceType: "transfer_receive";
  referenceId: string;
  productId: string;
};

export function transferDispatchOperationKey(
  shopId: string,
  transferId: string,
  sourceProductId: string,
): string {
  return `transfer_dispatch:${shopId}:${transferId}:${sourceProductId}`;
}

export function transferReceiveOperationKey(
  shopId: string,
  receiveEventId: string,
  destinationProductId: string,
): string {
  return `transfer_receive:${shopId}:${receiveEventId}:${destinationProductId}`;
}

export type TransferLineReceiveInput = {
  lineId: string;
  quantity: number;
};

export function validateReceiveLinesInput(
  lines: TransferLineReceiveInput[],
  lineState: Map<string, { quantity: number; receivedQuantity: number }>,
): { ok: true } | { ok: false; error: string } {
  if (!lines.length) return { ok: false, error: "no_lines" };
  for (const row of lines) {
    if (!row.lineId?.trim()) return { ok: false, error: "invalid_line_id" };
    const qty = Math.floor(Number(row.quantity));
    if (qty <= 0) return { ok: false, error: "invalid_quantity" };
    const st = lineState.get(row.lineId);
    if (!st) return { ok: false, error: "line_not_found" };
    const remaining = st.quantity - st.receivedQuantity;
    if (qty > remaining) return { ok: false, error: "over_receive" };
  }
  return { ok: true };
}

/** Destination WAC after transfer receipt — canonical WAKA formula. */
export function destinationWacAfterTransferReceive(
  existingQty: number,
  existingWac: number,
  receivedQty: number,
  dispatchCostSnapshot: number,
): number {
  return weightedCostAfterStockInPrecise(existingQty, existingWac, receivedQty, dispatchCostSnapshot);
}

export type SimTransferLine = {
  id: string;
  sourceProductId: string;
  destinationProductId: string;
  quantity: number;
  receivedQuantity: number;
  unitCostUgx: number;
};

export type SimTransfer = {
  id: string;
  fromShopId: string;
  toShopId: string;
  status: "draft" | "in_transit" | "received" | "cancelled";
  lines: SimTransferLine[];
};

export type SimProduct = {
  id: string;
  shopId: string;
  stockOnHand: number;
  costPricePerUnitUgx: number;
};

export type SimMovement = TransferDispatchOperationKey | TransferReceiveOperationKey;

/** In-memory simulator mirroring migration 167 RPC semantics for tests. */
export class TransferEngineSimulator {
  transfers = new Map<string, SimTransfer>();
  products = new Map<string, SimProduct>();
  appliedMovements = new Set<string>();
  receiveEvents = new Set<string>();

  movementKey(m: SimMovement): string {
    return `${m.referenceType}:${m.shopId}:${m.referenceId}:${m.productId}`;
  }

  addProduct(p: SimProduct): void {
    this.products.set(p.id, { ...p });
  }

  upsertDraft(transfer: SimTransfer): { ok: true } | { ok: false; error: string } {
    const src = new Set<string>();
    const dst = new Set<string>();
    for (const line of transfer.lines) {
      if (src.has(line.sourceProductId)) return { ok: false, error: "duplicate_source_product" };
      if (dst.has(line.destinationProductId)) return { ok: false, error: "duplicate_destination_product" };
      src.add(line.sourceProductId);
      dst.add(line.destinationProductId);
    }
    this.transfers.set(transfer.id, {
      ...transfer,
      status: "draft",
      lines: transfer.lines.map((l) => ({ ...l, receivedQuantity: 0 })),
    });
    return { ok: true };
  }

  dispatch(transferId: string): { ok: true; idempotent?: boolean } | { ok: false; error: string } {
    const t = this.transfers.get(transferId);
    if (!t) return { ok: false, error: "transfer_not_found" };
    if (t.status === "in_transit") {
      const all = t.lines.every((l) =>
        this.appliedMovements.has(
          this.movementKey({
            shopId: t.fromShopId,
            referenceType: "transfer_dispatch",
            referenceId: transferId,
            productId: l.sourceProductId,
          }),
        ),
      );
      return all ? { ok: true, idempotent: true } : { ok: false, error: "partial_dispatch_state" };
    }
    if (t.status !== "draft") return { ok: false, error: "invalid_status" };
    if (!t.lines.length) return { ok: false, error: "no_lines" };

    for (const line of t.lines) {
      const prod = this.products.get(line.sourceProductId);
      if (!prod || prod.shopId !== t.fromShopId) return { ok: false, error: "source_product_not_found" };
      if (prod.stockOnHand < line.quantity) return { ok: false, error: "insufficient_stock" };
      const dest = this.products.get(line.destinationProductId);
      if (!dest || dest.shopId !== t.toShopId) return { ok: false, error: "destination_product_not_found" };
    }

    for (const line of t.lines) {
      const key = this.movementKey({
        shopId: t.fromShopId,
        referenceType: "transfer_dispatch",
        referenceId: transferId,
        productId: line.sourceProductId,
      });
      if (this.appliedMovements.has(key)) continue;
      const prod = this.products.get(line.sourceProductId)!;
      line.unitCostUgx = prod.costPricePerUnitUgx;
      prod.stockOnHand -= line.quantity;
      this.appliedMovements.add(key);
    }
    t.status = "in_transit";
    return { ok: true };
  }

  receive(
    transferId: string,
    receiveEventId: string,
    items: TransferLineReceiveInput[],
  ): { ok: true; idempotent?: boolean; status: SimTransfer["status"] } | { ok: false; error: string } {
    const t = this.transfers.get(transferId);
    if (!t) return { ok: false, error: "transfer_not_found" };
    if (t.status !== "in_transit" && t.status !== "received") return { ok: false, error: "invalid_status" };

    const lineMap = new Map(t.lines.map((l) => [l.id, l]));
    const validation = validateReceiveLinesInput(
      items,
      new Map(
        [...lineMap.entries()].map(([id, l]) => [id, { quantity: l.quantity, receivedQuantity: l.receivedQuantity }]),
      ),
    );
    if (!validation.ok) return validation;

    const destIds = new Set<string>();
    for (const item of items) {
      const line = lineMap.get(item.lineId)!;
      if (destIds.has(line.destinationProductId)) {
        return { ok: false, error: "duplicate_destination_product" };
      }
      destIds.add(line.destinationProductId);
    }

    const allApplied = items.every((item) => {
      const line = lineMap.get(item.lineId)!;
      return this.appliedMovements.has(
        this.movementKey({
          shopId: t.toShopId,
          referenceType: "transfer_receive",
          referenceId: receiveEventId,
          productId: line.destinationProductId,
        }),
      );
    });
    if (allApplied) return { ok: true, idempotent: true, status: t.status };

    this.receiveEvents.add(receiveEventId);

    for (const item of items) {
      const line = lineMap.get(item.lineId)!;
      const key = this.movementKey({
        shopId: t.toShopId,
        referenceType: "transfer_receive",
        referenceId: receiveEventId,
        productId: line.destinationProductId,
      });
      if (this.appliedMovements.has(key)) continue;

      const dest = this.products.get(line.destinationProductId)!;
      const qty = Math.floor(item.quantity);
      dest.costPricePerUnitUgx = destinationWacAfterTransferReceive(
        dest.stockOnHand,
        dest.costPricePerUnitUgx,
        qty,
        line.unitCostUgx,
      );
      dest.stockOnHand += qty;
      line.receivedQuantity += qty;
      this.appliedMovements.add(key);
    }

    const fullyReceived = t.lines.every((l) => l.receivedQuantity >= l.quantity);
    if (fullyReceived) t.status = "received";
    return { ok: true, status: t.status };
  }

  cancel(transferId: string): { ok: true; idempotent?: boolean } | { ok: false; error: string } {
    const t = this.transfers.get(transferId);
    if (!t) return { ok: false, error: "transfer_not_found" };
    if (t.status === "cancelled") return { ok: true, idempotent: true };
    if (t.status !== "draft") return { ok: false, error: "invalid_status" };
    t.status = "cancelled";
    return { ok: true };
  }
}
