import type { DayCloseSummary, Language, Sale } from "../types";
import { t, tTemplate } from "./i18n";
import type { AttentionItem } from "./ownerCommandCenter";
import type { IntegritySignal } from "./ownerCommandCenterBuilders";
import type { OwnerFinancialExtended, OwnerInventoryExtended } from "./ownerCommandCenterBuilders";
import { addDaysToDateKey, type DateFilterBounds } from "./dateFilters";
import { dateKeyKampala, dateKeyDaysAgoKampala } from "./datesUg";
import { periodSalesBreakdownsUnavailable, resolveReportAuthority, type PeriodReportAuthority } from "./closedDayAuthority";
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

import { formatUgx } from "./formatUgx";
import {
  canExportReportsData,
  type FrozenPeriodHeadlines,
  type ReportsFinancialReadiness,
} from "./reportsDataCompleteness";

export function formatShortUgx(n: number): string {
  return formatUgx(n);
}

export type CommandCenterOfficialHeadlineSource = "overlay" | "frozen" | "hidden";

export type CommandCenterOfficialFinancials = {
  headlineSource: CommandCenterOfficialHeadlineSource;
  presentHeadlinesAsFinal: boolean;
  canExport: boolean;
  revenueUgx: number | null;
  profitUgx: number | null;
  transactionCount: number | null;
  costIncomplete: boolean;
};

/**
 * CC-P2-03 — official Command Center Revenue / Profit / Transactions follow the
 * shared Reports readiness contract. Does not invent a second hydration system.
 */
export function presentCommandCenterOfficialFinancials(input: {
  readiness: ReportsFinancialReadiness;
  overlaid: {
    revenueUgx: number;
    profitUgx: number;
    transactionCount: number;
    costIncomplete: boolean;
  };
  frozenHeadlines: FrozenPeriodHeadlines | null;
}): CommandCenterOfficialFinancials {
  if (input.readiness.dataComplete) {
    return {
      headlineSource: "overlay",
      presentHeadlinesAsFinal: true,
      canExport: canExportReportsData(input.readiness),
      revenueUgx: input.overlaid.revenueUgx,
      profitUgx: input.overlaid.profitUgx,
      transactionCount: input.overlaid.transactionCount,
      costIncomplete: input.overlaid.costIncomplete,
    };
  }
  if (input.readiness.canShowFrozenHeadlines && input.frozenHeadlines) {
    return {
      headlineSource: "frozen",
      presentHeadlinesAsFinal: true,
      canExport: canExportReportsData(input.readiness),
      revenueUgx: input.frozenHeadlines.revenue,
      profitUgx: input.frozenHeadlines.profit,
      transactionCount: input.frozenHeadlines.count,
      costIncomplete: false,
    };
  }
  return {
    headlineSource: "hidden",
    presentHeadlinesAsFinal: false,
    canExport: false,
    revenueUgx: null,
    profitUgx: null,
    transactionCount: null,
    costIncomplete: false,
  };
}

export function formatOfficialHeadlineUgx(value: number | null): string {
  return value == null ? "—" : formatShortUgx(value);
}

export function commandCenterOfficialExportValues(
  official: CommandCenterOfficialFinancials,
): {
  revenueUgx: number;
  profitUgx: number;
  transactionCount: number;
  costIncomplete: boolean;
} | null {
  if (
    !official.canExport ||
    official.revenueUgx == null ||
    official.profitUgx == null ||
    official.transactionCount == null
  ) {
    return null;
  }
  return {
    revenueUgx: official.revenueUgx,
    profitUgx: official.profitUgx,
    transactionCount: official.transactionCount,
    costIncomplete: official.costIncomplete,
  };
}

/** Command Center selected-day Expected Cash: frozen close when authoritative, else live Drawer V2. Ranges stay null. */
export function presentCommandCenterExpectedCash(
  bounds: DateFilterBounds,
  dayCloses: DayCloseSummary[] | undefined,
  liveExpectedCashUgx: number | null,
): number | null {
  if (!bounds.isSingleDay) return null;
  const auth = resolveReportAuthority(dayCloses, bounds.fromKey);
  if (!auth.closed) return liveExpectedCashUgx;
  const frozen = auth.frozenTotals?.expectedCashUgx;
  if (typeof frozen !== "number" || !Number.isFinite(frozen)) return null;
  return frozen;
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

/**
 * CC-P2-04 — Command Center KPI sparklines stay on the selected period.
 * The rolling last-7-day series is only valid for today's open live day.
 * Historical / closed / mixed / incomplete periods hide the chart rather than
 * pairing an official KPI with an unrelated live window.
 */
export function presentCommandCenterSparkline(
  existingSeries: SparkPoint[],
  opts: {
    bounds: DateFilterBounds;
    authority: PeriodReportAuthority;
    dataComplete: boolean;
  },
): SparkPoint[] {
  if (!opts.dataComplete) return [];
  if (periodSalesBreakdownsUnavailable(opts.authority)) return [];
  const today = dateKeyKampala(new Date());
  if (!opts.bounds.isSingleDay || opts.bounds.fromKey !== today || opts.bounds.toKey !== today) {
    return [];
  }
  return existingSeries;
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
  profitUgx?: number;
  costIncomplete?: boolean;
  transactions: number;
  expectedCashUgx: number | null;
  includeProfit?: boolean;
}): string {
  const includeProfit = params.includeProfit !== false && params.profitUgx != null;
  const profitLabel = params.costIncomplete ? "Gross profit (estimated)" : "Gross profit";
  const expectedCashLine =
    params.expectedCashUgx == null
      ? "Expected cash: —"
      : `Expected cash: UGX ${params.expectedCashUgx.toLocaleString()}`;
  const lines = [
    `${params.shopName} — Command Center`,
    params.periodLabel,
    "",
    `Business health: ${params.score}/100`,
    `Revenue: UGX ${params.revenueUgx.toLocaleString()}`,
  ];
  if (includeProfit) {
    lines.push(`${profitLabel}: UGX ${params.profitUgx!.toLocaleString()}`);
  }
  lines.push(`Transactions: ${params.transactions}`, expectedCashLine, "", "Generated by Waka POS");
  return lines.join("\n");
}

export function pctChangeLabel(pct: number | null): string | null {
  if (pct == null) return null;
  const arrow = pct >= 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(pct).toFixed(0)}%`;
}

/**
 * CC-P2-05 — KPI comparison copy names the window already used by
 * `trendVsPriorDay`: the single Kampala day immediately before `bounds.fromKey`.
 * Does not recalculate percentages or prior-period financials.
 */
export function commandCenterComparisonLabelKey(bounds: DateFilterBounds): string {
  const yesterday = addDaysToDateKey(dateKeyKampala(new Date()), -1);
  const priorDayKey = addDaysToDateKey(bounds.fromKey, -1);
  return priorDayKey === yesterday ? "cmdCenterVsYesterday" : "cmdCenterVsPreviousDay";
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
  expectedCashUgx: number | null,
  customerCount: number,
  revenueSparkline: SparkPoint[],
  official?: CommandCenterOfficialFinancials,
  canProfit = true,
): KpiCardModel[] {
  const ready = official ? official.presentHeadlinesAsFinal : true;
  const revenueUgx = ready ? (official?.revenueUgx ?? financial.revenueUgx) : null;
  const profitUgx = ready ? (official?.profitUgx ?? financial.profitUgx) : null;
  const transactionCount = ready ? (official?.transactionCount ?? financial.transactionCount) : null;
  const costIncomplete = ready ? (official?.costIncomplete ?? financial.costIncomplete) : false;
  const avg = revenueUgx != null && transactionCount != null ? averageSaleUgx(revenueUgx, transactionCount) : null;
  const pct = ready ? financial.trendVsPriorDay?.pctRevenue ?? null : null;
  return [
    {
      id: "revenue",
      labelKey: "cmdCenterKpiRevenue",
      value: formatOfficialHeadlineUgx(revenueUgx),
      pctChange: pctChangeLabel(pct),
      sparkline: revenueSparkline,
    },
    ...(canProfit
      ? [
          {
            id: "profit",
            labelKey: costIncomplete ? "profitGrossProfitEstimated" : "cmdCenterKpiProfit",
            value: formatOfficialHeadlineUgx(profitUgx),
            pctChange: ready ? pctChangeLabel(financial.trendVsPriorDay?.pctProfit ?? null) : null,
            sparkline: revenueSparkline,
            valueClass: profitUgx == null || profitUgx >= 0 ? "text-teal-800" : "text-rose-700",
          } satisfies KpiCardModel,
        ]
      : []),
    {
      id: "transactions",
      labelKey: "cmdCenterKpiTransactions",
      value: transactionCount == null ? "—" : String(transactionCount),
      pctChange: null,
      sparkline: revenueSparkline,
    },
    {
      id: "expected-cash",
      labelKey: "cmdCenterKpiExpectedCash",
      value: expectedCashUgx == null ? "—" : formatShortUgx(expectedCashUgx),
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
      value: formatOfficialHeadlineUgx(avg),
      pctChange: null,
      sparkline: revenueSparkline,
    },
  ];
}

export function filterAttentionByQuery(items: AttentionItem[], query: string, lang: Language): AttentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const title = (
      item.titleVars ? tTemplate(lang, item.titleKey, item.titleVars) : t(lang, item.titleKey)
    ).toLowerCase();
    const detail = item.detailKey
      ? (item.detailVars ? tTemplate(lang, item.detailKey, item.detailVars) : t(lang, item.detailKey)).toLowerCase()
      : "";
    const actor = item.actorLabel?.toLowerCase() ?? "";
    return title.includes(q) || detail.includes(q) || actor.includes(q) || item.id.includes(q);
  });
}
