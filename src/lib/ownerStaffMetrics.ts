/**
 * UI-only staff performance rows for Owner Dashboard — aggregates existing audit/sales data.
 */

import type { AuditLogEntry, Language } from "../types";
import type { CashierTrustRow } from "./ownerIntelligence";
import { actorDisplayLabel } from "./activityNarrative";

export type OwnerStaffPerformanceRow = {
  userId: string;
  label: string;
  trustScore: number;
  trustLevel: CashierTrustRow["trustLevel"];
  salesUgx: number;
  returns: number;
  voids: number;
  discounts: number;
};

type CashierPerf = { userId: string; label: string; count: number; revenue: number };

export function buildOwnerStaffPerformanceRows(
  lang: Language,
  trustRows: CashierTrustRow[],
  cashierPerf: CashierPerf[],
  todayAuditLogs: AuditLogEntry[],
): OwnerStaffPerformanceRow[] {
  const trustByUser = new Map(trustRows.map((r) => [r.userId, r]));
  const perfByUser = new Map(cashierPerf.map((r) => [r.userId, r]));

  const metrics = new Map<string, { returns: number; voids: number; discounts: number }>();
  const touchMetrics = (uid: string) => {
    const id = uid || "unknown";
    if (!metrics.has(id)) metrics.set(id, { returns: 0, voids: 0, discounts: 0 });
    return metrics.get(id)!;
  };

  for (const e of todayAuditLogs) {
    const uid = e.actorUserId || "unknown";
    const m = touchMetrics(uid);
    if (e.action === "sale_return") m.returns += 1;
    else if (e.action === "sale_void") m.voids += 1;
    else if (e.action === "discount_given") m.discounts += 1;
  }

  const userIds = new Set<string>([
    ...trustRows.map((r) => r.userId),
    ...cashierPerf.map((r) => r.userId),
    ...metrics.keys(),
  ]);

  const rows: OwnerStaffPerformanceRow[] = [...userIds].map((userId) => {
    const trust = trustByUser.get(userId);
    const perf = perfByUser.get(userId);
    const m = metrics.get(userId) ?? { returns: 0, voids: 0, discounts: 0 };
    return {
      userId,
      label: trust?.displayLabel ?? perf?.label ?? actorDisplayLabel(userId, lang),
      trustScore: trust?.reliabilityScore ?? 0,
      trustLevel: trust?.trustLevel ?? "good",
      salesUgx: perf?.revenue ?? 0,
      returns: m.returns,
      voids: m.voids,
      discounts: m.discounts,
    };
  });

  return rows.sort((a, b) => b.salesUgx - a.salesUgx);
}
