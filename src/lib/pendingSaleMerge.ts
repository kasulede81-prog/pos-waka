import type { Sale, SaleLine } from "../types";
import { computeDraftCheckoutTotals, cartDiscountFromPendingSale, estimatedProfitAfterCartDiscount } from "./draftCart";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSaleLineId(id: string | undefined | null): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}

/** Assign stable ids to legacy lines missing them. */
export function ensureSaleLineId(line: SaleLine): SaleLine {
  const now = new Date().toISOString();
  return {
    ...line,
    id: isSaleLineId(line.id) ? line.id : crypto.randomUUID(),
    updatedAt: line.updatedAt ?? now,
  };
}

function lineTimestamp(line: SaleLine): number {
  const t = Date.parse(line.updatedAt ?? "");
  return Number.isFinite(t) ? t : 0;
}

/** Union lines by stable id; newer updatedAt wins per line. */
export function mergePendingSaleLines(base: SaleLine[], incoming: SaleLine[]): SaleLine[] {
  const map = new Map<string, SaleLine>();
  for (const line of base.map(ensureSaleLineId)) {
    map.set(line.id!, line);
  }
  for (const line of incoming.map(ensureSaleLineId)) {
    const prev = map.get(line.id!);
    if (!prev || lineTimestamp(line) >= lineTimestamp(prev)) {
      map.set(line.id!, line);
    }
  }
  return [...map.values()];
}

/** Merge two pending sales (symmetric line union). Header fields from the newer sale. */
export function mergePendingSales(a: Sale, b: Sale): Sale {
  const ta = Date.parse(a.updatedAt ?? a.createdAt ?? "");
  const tb = Date.parse(b.updatedAt ?? b.createdAt ?? "");
  const newerHeader = Number.isFinite(ta) && Number.isFinite(tb) && tb > ta ? b : a;
  const olderHeader = newerHeader === a ? b : a;
  const mergedLines = mergePendingSaleLines(olderHeader.lines, newerHeader.lines);
  const cartDiscount = cartDiscountFromPendingSale(newerHeader);
  const checkout = computeDraftCheckoutTotals(mergedLines, cartDiscount);
  const listSubtotal = mergedLines.reduce((sum, l) => sum + (l.originalLineTotalUgx ?? l.lineTotalUgx), 0);
  const discountTotal = Math.max(0, listSubtotal - checkout.payableUgx);
  const now = new Date().toISOString();
  return {
    ...newerHeader,
    status: "pending",
    lines: mergedLines,
    subtotalUgx: listSubtotal,
    totalUgx: checkout.payableUgx,
    discountTotalUgx: discountTotal,
    estimatedProfitUgx: estimatedProfitAfterCartDiscount(mergedLines, checkout.cartDiscountUgx),
    updatedAt: now,
    pendingSync: true,
    lastSyncError: null,
  };
}

/** Line ids removed locally since the last known server snapshot. */
export function deletedLineIdsFromDraft(existing: SaleLine[], draft: SaleLine[]): string[] {
  const draftIds = new Set(draft.map((l) => l.id).filter(isSaleLineId));
  const draftProducts = new Set(draft.map((l) => l.productId));
  const ids: string[] = [];
  for (const line of existing) {
    if (line.id && draftIds.has(line.id)) continue;
    if (!line.id && draftProducts.has(line.productId)) continue;
    if (isSaleLineId(line.id)) ids.push(line.id!);
  }
  return ids;
}

export function mergePendingSalePair(local: Sale, remote: Sale): Sale {
  if (local.status !== "pending" || remote.status !== "pending") {
    const ta = Date.parse(local.updatedAt ?? local.createdAt ?? "");
    const tb = Date.parse(remote.updatedAt ?? remote.createdAt ?? "");
    return Number.isFinite(ta) && Number.isFinite(tb) && ta >= tb ? local : remote;
  }
  return mergePendingSales(local, remote);
}

/** Simulate server line merge: upsert payload lines, keep unmentioned server lines, apply deletions. */
export function simulateServerPendingSaleMerge(input: {
  serverLines: SaleLine[];
  payloadLines: SaleLine[];
  deletedLineIds?: string[];
}): SaleLine[] {
  const deleted = new Set((input.deletedLineIds ?? []).filter(isSaleLineId));
  let lines = input.serverLines.filter((l) => !l.id || !deleted.has(l.id)).map(ensureSaleLineId);
  const map = new Map(lines.map((l) => [l.id!, l]));
  for (const line of input.payloadLines.map(ensureSaleLineId)) {
    const prev = map.get(line.id!);
    if (!prev || lineTimestamp(line) >= lineTimestamp(prev)) {
      map.set(line.id!, line);
    }
  }
  return [...map.values()];
}
