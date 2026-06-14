/**
 * Owner dashboard refund activity — read-only aggregation.
 */

import type { ReturnRecord } from "../types";
import { dateKeyKampala } from "./datesUg";

export type RefundStaffRow = {
  actorUserId: string;
  label: string;
  count: number;
  valueUgx: number;
};

export type RefundProductRow = {
  productId: string;
  name: string;
  count: number;
  valueUgx: number;
};

export type RefundActivityStats = {
  countToday: number;
  valueTodayUgx: number;
  topStaff: RefundStaffRow[];
  topProducts: RefundProductRow[];
};

export function buildRefundActivityStats(
  returnRecords: ReturnRecord[],
  todayKey: string,
): RefundActivityStats {
  const todayReturns = returnRecords.filter((r) => dateKeyKampala(r.createdAt) === todayKey);

  let valueTodayUgx = 0;
  const staffMap = new Map<string, RefundStaffRow>();
  const productMap = new Map<string, RefundProductRow>();

  for (const r of todayReturns) {
    const amt = Math.max(0, Math.floor(r.refundAmountUgx));
    valueTodayUgx += amt;

    const staffKey = r.actorUserId || "unknown";
    const staffLabel = r.actorName?.trim() || staffKey;
    const staffRow = staffMap.get(staffKey) ?? {
      actorUserId: staffKey,
      label: staffLabel,
      count: 0,
      valueUgx: 0,
    };
    staffRow.count += 1;
    staffRow.valueUgx += amt;
    staffMap.set(staffKey, staffRow);

    const prodRow = productMap.get(r.productId) ?? {
      productId: r.productId,
      name: r.productName,
      count: 0,
      valueUgx: 0,
    };
    prodRow.count += 1;
    prodRow.valueUgx += amt;
    productMap.set(r.productId, prodRow);
  }

  const topStaff = [...staffMap.values()].sort((a, b) => b.valueUgx - a.valueUgx).slice(0, 5);
  const topProducts = [...productMap.values()].sort((a, b) => b.valueUgx - a.valueUgx).slice(0, 5);

  return {
    countToday: todayReturns.length,
    valueTodayUgx,
    topStaff,
    topProducts,
  };
}
