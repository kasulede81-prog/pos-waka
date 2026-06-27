import type { Sale } from "../types";
import type { AttentionItem } from "./ownerCommandCenter";
import type { IntegritySignal } from "./ownerCommandCenterBuilders";
import type { OwnerFinancialExtended, OwnerInventoryExtended } from "./ownerCommandCenterBuilders";
import type { DateFilterBounds } from "./dateFilters";
import { dateKeyKampala, dateKeyDaysAgoKampala } from "./datesUg";
import { isCompletedSale } from "./saleStatus";

export type DomainHealth = "healthy" | "warning" | "critical";

export type DomainStatusRow = {
  id: string;
  labelKey: string;
  status: DomainHealth;
};

export type SparkPoint = { value: number };

export type CommandCenterRecommendation = {
  id: string;
  titleKey: string;
  titleVars?: Record<string, string | number>;
  actionTo: string;
  actionLabelKey: string;
  tone: "orange" | "teal" | "blue" | "rose" | "amber";
};

export function formatShortUgx(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `UGX ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `UGX ${Math.round(n / 1_000)}K`;
  return `UGX ${n.toLocaleString()}`;
}

export function computeBusinessHealthScore(
  integritySignals: IntegritySignal[],
  criticalCount: number,
  warningCount: number,
  cloudScorePct: number,
): number {
  let score = Math.round(cloudScorePct * 0.35 + 65);
  for (const sig of integritySignals) {
    if (sig.status === "critical") score -= 12;
    else if (sig.status === "warning") score -= 4;
  }
  score -= criticalCount * 8;
  score -= warningCount * 2;
  return Math.max(0, Math.min(100, score));
}

export function healthScoreLabelKey(score: number): string {
  if (score >= 90) return "cmdCenterHealthExcellent";
  if (score >= 75) return "cmdCenterHealthGood";
  if (score >= 50) return "cmdCenterHealthFair";
  return "cmdCenterHealthPoor";
}

export function starCountFromScore(score: number): number {
  if (score >= 95) return 5;
  if (score >= 85) return 4;
  if (score >= 70) return 3;
  if (score >= 50) return 2;
  return 1;
}

function signalStatus(signals: IntegritySignal[], ids: string[]): DomainHealth {
  const matches = signals.filter((s) => ids.includes(s.id));
  if (matches.some((s) => s.status === "critical")) return "critical";
  if (matches.some((s) => s.status === "warning")) return "warning";
  return "healthy";
}

export function deriveDomainStatuses(
  integritySignals: IntegritySignal[],
  criticalAttention: number,
  devicesStale: number,
  cashUnresolved: boolean,
): DomainStatusRow[] {
  return [
    {
      id: "sales",
      labelKey: "cmdCenterDomainSales",
      status: criticalAttention > 0 ? "warning" : "healthy",
    },
    {
      id: "inventory",
      labelKey: "cmdCenterDomainInventory",
      status: signalStatus(integritySignals, ["inventory"]),
    },
    {
      id: "cash",
      labelKey: "cmdCenterDomainCash",
      status: cashUnresolved ? "warning" : signalStatus(integritySignals, ["drawer", "cash"]),
    },
    {
      id: "devices",
      labelKey: "cmdCenterDomainDevices",
      status: devicesStale > 0 ? "warning" : "healthy",
    },
    {
      id: "investigation",
      labelKey: "cmdCenterDomainInvestigation",
      status: criticalAttention > 0 ? "critical" : "healthy",
    },
  ];
}

export function countUniqueCustomers(sales: Sale[], bounds: DateFilterBounds): number {
  const ids = new Set<string>();
  for (const s of sales) {
    if (!isCompletedSale(s)) continue;
    const key = dateKeyKampala(s.createdAt);
    if (key < bounds.fromKey || key > bounds.toKey) continue;
    const cid = s.customerId?.trim();
    if (cid) ids.add(cid);
  }
  return ids.size;
}

export function computeDailyRevenueSparkline(sales: Sale[], days = 7): SparkPoint[] {
  const today = dateKeyKampala(new Date());
  const points: SparkPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dateKeyDaysAgoKampala(i);
    let total = 0;
    for (const s of sales) {
      if (!isCompletedSale(s)) continue;
      if (dateKeyKampala(s.createdAt) !== key) continue;
      total += Math.max(0, s.totalUgx);
    }
    points.push({ value: total });
  }
  if (points.every((p) => p.value === 0) && today) {
    return Array.from({ length: days }, () => ({ value: 0 }));
  }
  return points;
}

export function buildCoachInsights(params: {
  pctRevenue: number | null;
  inventoryIssues: number;
  cashUnresolved: boolean;
  lowStockCount: number;
  topLowStockName: string | null;
}): string[] {
  const keys: string[] = [];
  if (params.pctRevenue != null) {
    keys.push(params.pctRevenue >= 0 ? "cmdCenterInsightRevenueUp" : "cmdCenterInsightRevenueDown");
  }
  if (params.inventoryIssues > 0) keys.push("cmdCenterInsightInventoryIssue");
  if (params.cashUnresolved) keys.push("cmdCenterInsightCashUnreconciled");
  if (params.lowStockCount > 0 && params.topLowStockName) keys.push("cmdCenterInsightReorder");
  if (keys.length === 0) keys.push("cmdCenterInsightAllClear");
  return keys;
}

export function buildSmartRecommendations(params: {
  inventory: OwnerInventoryExtended;
  receivablesUgx: number;
  cashUnresolved: boolean;
  pendingCountSessions: number;
  slowMoversCount: number;
}): CommandCenterRecommendation[] {
  const recs: CommandCenterRecommendation[] = [];
  if (params.inventory.lowStockCount > 0 && params.inventory.fastMovers[0]) {
    recs.push({
      id: "reorder",
      titleKey: "cmdCenterRecReorder",
      titleVars: { name: params.inventory.fastMovers[0]!.name },
      actionTo: "/stock",
      actionLabelKey: "cmdCenterRecReorderAction",
      tone: "orange",
    });
  }
  if (params.receivablesUgx > 0) {
    recs.push({
      id: "debts",
      titleKey: "cmdCenterRecDebts",
      titleVars: { amount: formatShortUgx(params.receivablesUgx) },
      actionTo: "/debts",
      actionLabelKey: "cmdCenterRecDebtsAction",
      tone: "teal",
    });
  }
  if (params.cashUnresolved) {
    recs.push({
      id: "close-cash",
      titleKey: "cmdCenterRecCloseCash",
      actionTo: "/close-day",
      actionLabelKey: "cmdCenterRecCloseCashAction",
      tone: "blue",
    });
  }
  if (params.slowMoversCount > 0) {
    recs.push({
      id: "archive",
      titleKey: "cmdCenterRecArchive",
      actionTo: "/stock",
      actionLabelKey: "cmdCenterRecArchiveAction",
      tone: "amber",
    });
  }
  if (params.pendingCountSessions > 0) {
    recs.push({
      id: "count",
      titleKey: "cmdCenterRecCount",
      actionTo: "/stock",
      actionLabelKey: "cmdCenterRecCountAction",
      tone: "rose",
    });
  }
  return recs.slice(0, 4);
}

export function buildExecutiveSummary(params: {
  score: number;
  criticalCount: number;
  warningCount: number;
}): string {
  if (params.criticalCount === 0 && params.warningCount === 0) {
    return "cmdCenterSummaryAllClear";
  }
  if (params.criticalCount > 0 && params.warningCount > 0) {
    return "cmdCenterSummaryMixed";
  }
  if (params.criticalCount > 0) return "cmdCenterSummaryCritical";
  return "cmdCenterSummaryWarnings";
}

export function buildCommandCenterExportText(params: {
  shopName: string;
  periodLabel: string;
  score: number;
  revenueUgx: number;
  profitUgx: number;
  transactions: number;
  expectedCashUgx: number;
}): string {
  return [
    `${params.shopName} — Command Center`,
    params.periodLabel,
    "",
    `Business health: ${params.score}/100`,
    `Revenue: UGX ${params.revenueUgx.toLocaleString()}`,
    `Profit: UGX ${params.profitUgx.toLocaleString()}`,
    `Transactions: ${params.transactions}`,
    `Expected cash: UGX ${params.expectedCashUgx.toLocaleString()}`,
    "",
    "Generated by Waka POS",
  ].join("\n");
}

export function pctChangeLabel(pct: number | null): string | null {
  if (pct == null) return null;
  const arrow = pct >= 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(pct).toFixed(0)}%`;
}

export function averageSaleUgx(revenueUgx: number, transactionCount: number): number {
  if (transactionCount <= 0) return 0;
  return Math.round(revenueUgx / transactionCount);
}

export type KpiCardModel = {
  id: string;
  labelKey: string;
  value: string;
  pctChange: string | null;
  sparkline: SparkPoint[];
  valueClass?: string;
};

export function buildKpiCards(
  financial: OwnerFinancialExtended,
  expectedCashUgx: number,
  customerCount: number,
  revenueSparkline: SparkPoint[],
): KpiCardModel[] {
  const avg = averageSaleUgx(financial.revenueUgx, financial.transactionCount);
  const pct = financial.trendVsPriorDay?.pctRevenue ?? null;
  return [
    {
      id: "revenue",
      labelKey: "cmdCenterKpiRevenue",
      value: formatShortUgx(financial.revenueUgx),
      pctChange: pctChangeLabel(pct),
      sparkline: revenueSparkline,
    },
    {
      id: "profit",
      labelKey: "cmdCenterKpiProfit",
      value: formatShortUgx(financial.profitUgx),
      pctChange: pctChangeLabel(financial.trendVsPriorDay?.pctProfit ?? null),
      sparkline: revenueSparkline,
      valueClass: financial.profitUgx >= 0 ? "text-teal-800" : "text-rose-700",
    },
    {
      id: "transactions",
      labelKey: "cmdCenterKpiTransactions",
      value: String(financial.transactionCount),
      pctChange: null,
      sparkline: revenueSparkline,
    },
    {
      id: "expected-cash",
      labelKey: "cmdCenterKpiExpectedCash",
      value: formatShortUgx(expectedCashUgx),
      pctChange: null,
      sparkline: revenueSparkline,
    },
    {
      id: "customers",
      labelKey: "cmdCenterKpiCustomers",
      value: String(customerCount),
      pctChange: null,
      sparkline: revenueSparkline,
    },
    {
      id: "avg-sale",
      labelKey: "cmdCenterKpiAvgSale",
      value: formatShortUgx(avg),
      pctChange: null,
      sparkline: revenueSparkline,
    },
  ];
}

export function filterAttentionByQuery(items: AttentionItem[], query: string): AttentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const title = item.titleKey.toLowerCase();
    const actor = item.actorLabel?.toLowerCase() ?? "";
    return title.includes(q) || actor.includes(q) || item.id.includes(q);
  });
}
