/**
 * Completed-sale cloud merge — financial header fields are immutable; only safe metadata merges.
 */

import type { Sale, SaleLine } from "../types";
import { isCompletedSale } from "./saleStatus";

export type SaleFinancialFields = Pick<
  Sale,
  | "totalUgx"
  | "cashPaidUgx"
  | "debtUgx"
  | "discountTotalUgx"
  | "subtotalUgx"
  | "voidedTotalUgx"
  | "estimatedProfitUgx"
  | "createdAt"
>;

export function saleCompletedAt(sale: Sale): string {
  return sale.createdAt;
}

function financialFields(sale: Sale): SaleFinancialFields {
  return {
    totalUgx: sale.totalUgx,
    cashPaidUgx: sale.cashPaidUgx,
    debtUgx: sale.debtUgx,
    discountTotalUgx: sale.discountTotalUgx,
    subtotalUgx: sale.subtotalUgx,
    voidedTotalUgx: sale.voidedTotalUgx,
    estimatedProfitUgx: sale.estimatedProfitUgx,
    createdAt: sale.createdAt,
  };
}

/** Higher rank = more void/return adjustments applied (authoritative financial copy). */
export function completedSaleAdjustmentRank(sale: Sale): [number, number, number] {
  const voided = sale.voidedTotalUgx ?? 0;
  const list = sale.subtotalUgx ?? sale.totalUgx;
  const shrink = Math.max(0, list - sale.totalUgx);
  return [voided, shrink, -sale.totalUgx];
}

function rankCompare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

/** Prefer return/void-adjusted sale; stale higher totals cannot win on recency alone. */
export function pickAuthoritativeCompletedFinancial(local: Sale, remote: Sale): Sale {
  const cmp = rankCompare(completedSaleAdjustmentRank(local), completedSaleAdjustmentRank(remote));
  if (cmp > 0) return local;
  if (cmp < 0) return remote;
  return local;
}

function mergeLinePreservingFinancial(baseLine: SaleLine, other: SaleLine | undefined): SaleLine {
  if (!other) return baseLine;
  return {
    ...baseLine,
    voided: Boolean(baseLine.voided || other.voided),
    voidedAt: baseLine.voidedAt ?? other.voidedAt ?? null,
    name: other.name || baseLine.name,
    updatedAt: other.updatedAt ?? baseLine.updatedAt,
  };
}

function mergeLinesPreservingFinancial(base: Sale, incoming: Sale): SaleLine[] {
  const otherByKey = new Map(incoming.lines.map((l) => [l.id ?? `${l.productId}:${l.lineTotalUgx}`, l]));
  const merged = base.lines.map((line) => {
    const key = line.id ?? `${line.productId}:${line.lineTotalUgx}`;
    return mergeLinePreservingFinancial(line, otherByKey.get(key));
  });
  for (const line of incoming.lines) {
    const key = line.id ?? `${line.productId}:${line.lineTotalUgx}`;
    if (!base.lines.some((l) => (l.id ?? `${l.productId}:${l.lineTotalUgx}`) === key)) {
      merged.push(line);
    }
  }
  return merged;
}

function recencyMs(sale: Sale): number {
  const t = new Date(sale.updatedAt ?? sale.createdAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mergeCompletedSaleMetadata(financialBase: Sale, other: Sale): Sale {
  const newerIsRemote = recencyMs(other) > recencyMs(financialBase);
  const meta = newerIsRemote ? other : financialBase;
  const fin = financialFields(financialBase);
  return {
    ...financialBase,
    ...fin,
    status: "completed",
    referenceLabel: meta.referenceLabel ?? financialBase.referenceLabel,
    tableSessionId: meta.tableSessionId ?? financialBase.tableSessionId,
    updatedAt: meta.updatedAt ?? financialBase.updatedAt,
    receiptSeq: meta.receiptSeq ?? financialBase.receiptSeq,
    soldByUserId: meta.soldByUserId ?? financialBase.soldByUserId,
    customerId: meta.customerId ?? financialBase.customerId,
    paymentMethod: meta.paymentMethod ?? financialBase.paymentMethod,
    amountPaidUgx: meta.amountPaidUgx ?? financialBase.amountPaidUgx,
    changeGivenUgx: meta.changeGivenUgx ?? financialBase.changeGivenUgx,
    splitBreakdown: meta.splitBreakdown ?? financialBase.splitBreakdown,
    lines: mergeLinesPreservingFinancial(financialBase, other),
    pendingSync: financialBase.pendingSync || other.pendingSync,
    lastSyncError: financialBase.lastSyncError ?? other.lastSyncError,
  };
}

/**
 * Merge local and remote sale rows without LWW overwriting completed financial headers.
 */
export function mergeSaleFromCloudPull(local: Sale, remote: Sale): Sale {
  if (local.status === "pending" && remote.status === "pending") {
    return recencyMs(remote) >= recencyMs(local)
      ? { ...remote, updatedAt: remote.updatedAt ?? remote.createdAt }
      : local;
  }

  const localDone = isCompletedSale(local);
  const remoteDone = isCompletedSale(remote);

  if (localDone && remoteDone) {
    const financialBase = pickAuthoritativeCompletedFinancial(local, remote);
    return mergeCompletedSaleMetadata(financialBase, local === financialBase ? remote : local);
  }

  if (localDone && !remoteDone) {
    return mergeCompletedSaleMetadata(local, remote);
  }

  if (!localDone && remoteDone) {
    return mergeCompletedSaleMetadata(remote, local);
  }

  return recencyMs(remote) >= recencyMs(local) ? remote : local;
}
