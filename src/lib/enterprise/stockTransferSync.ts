import { supabase } from "../supabase";
import { enqueueSync } from "../../offline/syncEngine";
import { getActiveShopId } from "../../offline/shopScope";
import type { TransferLineReceiveInput } from "./stockTransferEngine";

export type CloudTransferLine = {
  id: string;
  productId: string | null;
  destinationProductId: string | null;
  productName: string;
  quantity: number;
  receivedQuantity: number;
  unitCostUgx: number;
};

export type CloudTransfer = {
  id: string;
  organizationId: string;
  fromShopId: string;
  toShopId: string;
  status: string;
  reason: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  lines: CloudTransferLine[];
};

export async function upsertTransferDraftCloud(payload: {
  id?: string;
  clientId?: string;
  fromShopId: string;
  toShopId: string;
  reason?: string;
  lines: { sourceProductId: string; destinationProductId: string; quantity: number }[];
}): Promise<{ ok: boolean; transferId?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("enterprise_transfer_upsert_draft", {
    p_payload: {
      id: payload.id ?? null,
      client_id: payload.clientId ?? null,
      from_shop_id: payload.fromShopId,
      to_shop_id: payload.toShopId,
      reason: payload.reason ?? "",
      lines: payload.lines.map((l) => ({
        source_product_id: l.sourceProductId,
        destination_product_id: l.destinationProductId,
        quantity: l.quantity,
      })),
    },
  });
  if (error) return { ok: false, error: error.message };
  const j = (data ?? {}) as { ok?: boolean; transfer_id?: string; error?: string };
  if (!j.ok) return { ok: false, error: j.error ?? "upsert_failed" };
  return { ok: true, transferId: j.transfer_id };
}

export async function dispatchTransferCloud(transferId: string): Promise<{ ok: boolean; error?: string; idempotent?: boolean }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("enterprise_transfer_dispatch", { p_transfer_id: transferId });
  if (error) return { ok: false, error: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string; idempotent?: boolean };
  if (!j.ok) return { ok: false, error: j.error ?? "dispatch_failed" };
  return { ok: true, idempotent: j.idempotent === true };
}

export async function receiveTransferCloud(
  transferId: string,
  receiveEventId: string,
  lines: TransferLineReceiveInput[],
): Promise<{ ok: boolean; error?: string; idempotent?: boolean; status?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("enterprise_transfer_receive", {
    p_transfer_id: transferId,
    p_receive_event_id: receiveEventId,
    p_lines: lines.map((l) => ({ line_id: l.lineId, quantity: l.quantity })),
  });
  if (error) return { ok: false, error: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string; idempotent?: boolean; status?: string };
  if (!j.ok) return { ok: false, error: j.error ?? "receive_failed" };
  return { ok: true, idempotent: j.idempotent === true, status: j.status };
}

export async function cancelTransferDraftCloud(transferId: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("enterprise_transfer_cancel", { p_transfer_id: transferId });
  if (error) return { ok: false, error: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (!j.ok) return { ok: false, error: j.error ?? "cancel_failed" };
  return { ok: true };
}

export async function listTransfersForShopCloud(
  shopId: string,
  status?: string,
): Promise<CloudTransfer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("enterprise_transfer_list_for_shop", {
    p_shop_id: shopId,
    p_status: status ?? null,
  });
  if (error) return [];
  return Array.isArray(data) ? (data as CloudTransfer[]) : [];
}

export type DestinationShopProductOption = {
  id: string;
  name: string;
  sku: string;
  stockOnHand: number;
};

/** Read-only destination-shop catalog for transfer mapping (RLS: user_can_access_shop). */
export async function listDestinationShopProductsCloud(
  destinationShopId: string,
): Promise<DestinationShopProductOption[]> {
  if (!supabase || !destinationShopId) return [];
  const { data, error } = await supabase
    .from("products")
    .select("id, name, sku, stock_on_hand, is_active, shop_id")
    .eq("shop_id", destinationShopId)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(500);
  if (error || !Array.isArray(data)) return [];
  return filterDestinationShopProductRows(destinationShopId, data);
}

/** Pure filter: never return a product row that does not belong to the destination shop. */
export function filterDestinationShopProductRows(
  destinationShopId: string,
  rows: unknown[],
): DestinationShopProductOption[] {
  return rows
    .map((row) => row as {
      id?: string;
      name?: string | null;
      sku?: string | null;
      stock_on_hand?: number | null;
      shop_id?: string | null;
      is_active?: boolean | null;
    })
    .filter((row) => String(row.shop_id ?? "") === destinationShopId && row.is_active !== false && Boolean(row.id))
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "").trim() || String(r.id).slice(0, 8),
      sku: String(r.sku ?? "").trim(),
      stockOnHand: Number(r.stock_on_hand ?? 0),
    }));
}

/** Queue dispatch for offline-first retry (MB-1 shop stamp at enqueue). */
export async function queueTransferDispatch(transferId: string, fromShopId?: string | null): Promise<void> {
  const shopId = fromShopId ?? getActiveShopId();
  await enqueueSync({
    id: crypto.randomUUID(),
    kind: "pending_transfer_dispatch",
    shopId: shopId ?? undefined,
    payload: { transferId },
    createdAt: new Date().toISOString(),
  });
}

export async function queueTransferReceive(
  transferId: string,
  receiveEventId: string,
  lines: TransferLineReceiveInput[],
  toShopId?: string | null,
): Promise<void> {
  const shopId = toShopId ?? getActiveShopId();
  await enqueueSync({
    id: crypto.randomUUID(),
    kind: "pending_transfer_receive",
    shopId: shopId ?? undefined,
    payload: { transferId, receiveEventId, lines },
    createdAt: new Date().toISOString(),
  });
}

export async function syncTransferDispatchFromQueue(transferId: string): Promise<boolean> {
  const result = await dispatchTransferCloud(transferId);
  return result.ok;
}

export async function syncTransferReceiveFromQueue(payload: {
  transferId: string;
  receiveEventId: string;
  lines: TransferLineReceiveInput[];
}): Promise<boolean> {
  const result = await receiveTransferCloud(payload.transferId, payload.receiveEventId, payload.lines);
  return result.ok;
}
