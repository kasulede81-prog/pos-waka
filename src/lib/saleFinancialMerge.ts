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

/** Prefer the copy that reflects more void/return adjustments (lower remaining total). */
export function pickAuthoritativeCompletedFinancial(local: Sale, remote: Sale): Sale {
  if (local.totalUgx !== remote.totalUgx) {
    return local.totalUgx < remote.totalUgx ? local : remote;
  }
  const localVoided = local.voidedTotalUgx ?? 0;
  const remoteVoided = remote.voidedTotalUgx ?? 0;
  if (localVoided !== remoteVoided) {
    return localVoided > remoteVoided ? local : remote;
  }
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
