/**
 * Phase SYNC-1.1-R2 — interpret cancel-upload RPC results and settle local ACK.
 * Does not change completed-sale upload, checkout, or pull scope.
 */

import type { Sale, SyncOperation } from "../types";
import { isPendingSale, saleStatusOf } from "./saleStatus";

export type CancelPendingSaleRpcData = {
  ok?: boolean;
  error?: string;
  already_cancelled?: boolean;
  sale_id?: string;
};

export type CancelPendingSaleAck =
  | { ok: true; alreadyCancelled: boolean }
  | { ok: false; error: string };

export type SaleUploadRpc =
  | "shop_push_pending_sale"
  | "shop_cancel_pending_sale"
  | "shop_push_sale_complete"
  | "shop_patch_hospitality_sale_metadata";

/** Map local sale status to the cloud RPC. Cancelled sales never upsert as draft. */
export function saleUploadRpcForLocalSale(sale: Sale): SaleUploadRpc {
  if (isPendingSale(sale)) return "shop_push_pending_sale";
  if (saleStatusOf(sale) === "cancelled") return "shop_cancel_pending_sale";
  if (sale.saleVoidedAt && sale.pendingSync) return "shop_patch_hospitality_sale_metadata";
  return "shop_push_sale_complete";
}

/**
 * Treat explicit RPC success (including already_cancelled) as ACK.
 * Do not treat not_found_or_not_draft, forbidden, or missing rows as success.
 */
export function interpretCancelPendingSaleResult(
  rpcError: { code?: string; message?: string } | null | undefined,
  data: CancelPendingSaleRpcData | null | undefined,
): CancelPendingSaleAck {
  if (rpcError) {
    return { ok: false, error: rpcError.code ?? rpcError.message ?? "cancel_pending_failed" };
  }
  if (data?.ok === true) {
    return { ok: true, alreadyCancelled: data.already_cancelled === true };
  }
  return { ok: false, error: data?.error ?? "cancel_pending_rejected" };
}

/** Local sale stays cancelled; pendingSync and lastSyncError clear. */
export function applyCancelAckToSale(sale: Sale): Sale {
  return {
    ...sale,
    status: "cancelled",
    pendingSync: false,
    lastSyncError: null,
  };
}

export function matchingCancelQueueOpIds(queue: SyncOperation[], saleId: string): string[] {
  return queue
    .filter((op) => {
      if (op.kind !== "pending_sales" && op.kind !== "sale") return false;
      const payload = op.payload as Record<string, unknown> | null;
      if (!payload) return false;
      if (String(payload.saleId ?? "") !== saleId) return false;
      return payload.kind === "pending_cancel";
    })
    .map((op) => op.id);
}

/**
 * Already-cancelled ACK does not start a pull. Fresh draft cancel may still use
 * the existing sales-only sale_ack path — never a full incremental bundle.
 */
export function cancelAckPullReason(alreadyCancelled: boolean): "sale_ack" | null {
  if (alreadyCancelled) return null;
  return "sale_ack";
}

export async function settleCancelPendingSaleQueueOps(saleId: string): Promise<number> {
  const { readSyncQueue, removeSyncOperation } = await import("../offline/localDb");
  const ids = matchingCancelQueueOpIds(await readSyncQueue(), saleId);
  for (const id of ids) {
    await removeSyncOperation(id);
  }
  return ids.length;
}
