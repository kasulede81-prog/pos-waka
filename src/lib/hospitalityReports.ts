import type { HospitalityFloorState, Product, Sale, StaffAccount } from "../types";
import { completedSales } from "./saleStatus";
import { resolveProductStationType } from "./kitchenRouting";
import { dateKeyKampala } from "./datesUg";
import { resolveSaleWaiterAttribution } from "./waiterAttribution";
import {
  aggregateDishSales,
  aggregateModifierPopularity,
  MENU_LOW_MARGIN_THRESHOLD_PCT,
  type ModifierPopularityStat,
} from "./menuReports";
import { resolveSaleLineHistoricalFinancials } from "./saleFinancialEngine";
import {
  hospitalityMenuCostState,
  isHospitalityMenuItem,
  isHospitalityRecipeDish,
  isHospitalityResaleItem,
} from "./hospitalityMenuCosting";

export type HospitalityReportRange = {
  fromKey: string;
  toKey: string;
};

export type WaiterPerformanceRow = {
  waiterId: string;
  label: string;
  billCount: number;
  revenueUgx: number;
  avgBillUgx: number;
};

export type CategoryMixRow = {
  kind: "food" | "drink" | "other";
  revenueUgx: number;
  quantity: number;
};

export type TableRevenueRow = {
  label: string;
  billCount: number;
  revenueUgx: number;
};

export type PeakHourRow = {
  hour: number;
  label: string;
  billCount: number;
  revenueUgx: number;
};

/** Honest cost confidence for one menu item, from the shared costing engine. */
export type HospitalityMenuCostStatus =
  | "verified"
  | "estimated"
  | "incomplete"
  | "not_set"
  | "unverified";

export type HospitalityMenuRealizedMargin = {
  /** complete: full sale-line snapshot. partial: old line with only unit-cost/COGS evidence. */
  basis: "complete" | "partial";
  /** Net revenue from the sale-line snapshot. */
  revenueUgx: number;
  costUgx: number;
  profitUgx: number;
  marginPct: number;
  snapshotLineCount: number;
  missingSnapshotLineCount: number;
};

export type HospitalityMenuPerformanceRow = {
  productId: string;
  name: string;
  unitsSold: number;
  revenueUgx: number;
  sellPriceUgx: number;
  costStatus: HospitalityMenuCostStatus;
  /** Current-cost estimate; only present when the shared costing engine has a trustworthy cost. */
  currentCostUgx: number | null;
  currentMarginPct: number | null;
  /** Historical realized figures from completed sale-line snapshots. Null when none are usable. */
  realized: HospitalityMenuRealizedMargin | null;
  /** Non-voided sale lines for this item in the period. */
  soldLineCount: number;
};

export type HospitalityIngredientCostGap = {
  ingredientId: string;
  name: string;
  unit: string;
  /** How many menu dishes reference this ingredient. */
  dishCount: number;
  reason: "zero_cost" | "missing";
};

/**
 * Read-only menu performance and cost coverage for the reporting period.
 * It is derived from completed sales plus the shared product/recipe model —
 * no second menu ledger and no new persisted data.
 */
export type HospitalityMenuReport = {
  menuItemCount: number;
  reliableCostCount: number;
  needsCostCount: number;
  unverifiedCostCount: number;
  topDishes: HospitalityMenuPerformanceRow[];
  topDrinks: HospitalityMenuPerformanceRow[];
  lowMargin: HospitalityMenuPerformanceRow[];
  topModifiers: ModifierPopularityStat[];
  ingredientCostGaps: HospitalityIngredientCostGap[];
};

export type HospitalityReportSummary = {
  completedBillCount: number;
  totalRevenueUgx: number;
  avgBillUgx: number;
  waiters: WaiterPerformanceRow[];
  categoryMix: CategoryMixRow[];
  tables: TableRevenueRow[];
  peakHours: PeakHourRow[];
  menu: HospitalityMenuReport;
};

function menuCostStatus(state: ReturnType<typeof hospitalityMenuCostState>): HospitalityMenuCostStatus {
  if (state.status === "verified_product_cost") return "verified";
  if (state.status === "unverified_product_cost") return "unverified";
  if (state.status === "estimated") return state.incomplete ? "incomplete" : "estimated";
  return "not_set";
}

type HistoricalMenuAggregate = {
  revenueUgx: number;
  costUgx: number;
  profitUgx: number;
  snapshotLineCount: number;
  missingSnapshotLineCount: number;
  partial: boolean;
};

function computeHospitalityMenuReport(
  scopedSales: Sale[],
  products: Product[],
): HospitalityMenuReport {
  const soldById = new Map(aggregateDishSales(scopedSales).map((row) => [row.productId, row]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const menuProducts = products.filter(
    (product) => !product.menu?.hideFromMenu && isHospitalityMenuItem(product),
  );

  // Historical sales evidence comes from the shared sale-line snapshots only.
  // Missing/legacy snapshots are counted, never replaced with a live product cost.
  const historicalByProduct = new Map<string, HistoricalMenuAggregate>();
  for (const sale of scopedSales) {
    for (const line of sale.lines) {
      if (line.voided) continue;
      const aggregate = historicalByProduct.get(line.productId) ?? {
        revenueUgx: 0,
        costUgx: 0,
        profitUgx: 0,
        snapshotLineCount: 0,
        missingSnapshotLineCount: 0,
        partial: false,
      };
      const historical = resolveSaleLineHistoricalFinancials(line, sale);
      if (!historical) {
        aggregate.missingSnapshotLineCount += 1;
      } else {
        aggregate.snapshotLineCount += 1;
        aggregate.revenueUgx += historical.revenueUgx;
        aggregate.costUgx += historical.cogsUgx;
        aggregate.profitUgx += historical.grossProfitUgx;
        if (historical.basis === "partial") aggregate.partial = true;
      }
      historicalByProduct.set(line.productId, aggregate);
    }
  }

  const entries = menuProducts.map((product) => {
    const state = hospitalityMenuCostState(product, products);
    const status = menuCostStatus(state);
    const sold = soldById.get(product.id);
    const historical = historicalByProduct.get(product.id);
    const trustworthy = status === "verified" || status === "estimated";
    const realizedRevenueUgx = Math.round(historical?.revenueUgx ?? 0);
    const realizedCostUgx = Math.round(historical?.costUgx ?? 0);
    const realizedProfitUgx = Math.round(historical?.profitUgx ?? 0);
    const realized: HospitalityMenuRealizedMargin | null =
      historical && historical.snapshotLineCount > 0
        ? {
            basis:
              historical.partial || historical.missingSnapshotLineCount > 0
                ? "partial"
                : "complete",
            revenueUgx: realizedRevenueUgx,
            costUgx: realizedCostUgx,
            profitUgx: realizedProfitUgx,
            marginPct:
              realizedRevenueUgx > 0 ? (realizedProfitUgx / realizedRevenueUgx) * 100 : 0,
            snapshotLineCount: historical.snapshotLineCount,
            missingSnapshotLineCount: historical.missingSnapshotLineCount,
          }
        : null;
    const row: HospitalityMenuPerformanceRow = {
      productId: product.id,
      name: product.name,
      unitsSold: sold?.quantitySold ?? 0,
      revenueUgx: sold?.revenueUgx ?? 0,
      sellPriceUgx: product.sellingPricePerUnitUgx,
      costStatus: status,
      currentCostUgx:
        trustworthy && (state.status === "estimated" || state.status === "verified_product_cost")
          ? state.foodCostUgx
          : null,
      currentMarginPct:
        trustworthy && (state.status === "estimated" || state.status === "verified_product_cost")
          ? state.marginPct
          : null,
      realized,
      soldLineCount:
        (historical?.snapshotLineCount ?? 0) + (historical?.missingSnapshotLineCount ?? 0),
    };
    return { product, state, row };
  });

  const topDishes = entries
    .filter((entry) => isHospitalityRecipeDish(entry.product) && entry.row.unitsSold > 0)
    .map((entry) => entry.row)
    .sort((a, b) => b.unitsSold - a.unitsSold || b.revenueUgx - a.revenueUgx)
    .slice(0, 5);
  const topDrinks = entries
    .filter((entry) => isHospitalityResaleItem(entry.product) && entry.row.unitsSold > 0)
    .map((entry) => entry.row)
    .sort((a, b) => b.unitsSold - a.unitsSold || b.revenueUgx - a.revenueUgx)
    .slice(0, 5);

  // Realized sale-time margin wins; current-cost estimates are the explicit
  // fallback for items without a usable snapshot. Unsold items stay out.
  const lowMargin = entries
    .map((entry) => {
      if (entry.row.soldLineCount === 0) return null;
      const margin = entry.row.realized?.marginPct ?? entry.row.currentMarginPct;
      if (margin == null || margin >= MENU_LOW_MARGIN_THRESHOLD_PCT) return null;
      return { row: entry.row, margin };
    })
    .filter(
      (entry): entry is { row: HospitalityMenuPerformanceRow; margin: number } => entry != null,
    )
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 5)
    .map((entry) => entry.row);

  const gapMap = new Map<string, HospitalityIngredientCostGap>();
  for (const entry of entries) {
    if (entry.state.status !== "estimated") continue;
    for (const ingredientId of entry.state.zeroCostIngredientIds) {
      const key = `zero:${ingredientId}`;
      const existing = gapMap.get(key) ?? {
        ingredientId,
        name: productById.get(ingredientId)?.name ?? ingredientId,
        unit: productById.get(ingredientId)?.baseUnit ?? "",
        dishCount: 0,
        reason: "zero_cost" as const,
      };
      existing.dishCount += 1;
      gapMap.set(key, existing);
    }
    for (const ingredientId of entry.state.missingIngredientIds) {
      const key = `missing:${ingredientId}`;
      const existing = gapMap.get(key) ?? {
        ingredientId,
        name: ingredientId,
        unit: "",
        dishCount: 0,
        reason: "missing" as const,
      };
      existing.dishCount += 1;
      gapMap.set(key, existing);
    }
  }

  return {
    menuItemCount: menuProducts.length,
    reliableCostCount: entries.filter(
      (entry) => entry.row.costStatus === "verified" || entry.row.costStatus === "estimated",
    ).length,
    needsCostCount: entries.filter(
      (entry) => entry.row.costStatus === "not_set" || entry.row.costStatus === "incomplete",
    ).length,
    unverifiedCostCount: entries.filter((entry) => entry.row.costStatus === "unverified").length,
    topDishes,
    topDrinks,
    lowMargin,
    topModifiers: aggregateModifierPopularity(scopedSales).slice(0, 5),
    ingredientCostGaps: [...gapMap.values()].sort(
      (a, b) => b.dishCount - a.dishCount || a.name.localeCompare(b.name),
    ),
  };
}

function inRange(iso: string, range: HospitalityReportRange): boolean {
  const key = dateKeyKampala(new Date(iso));
  return key >= range.fromKey && key <= range.toKey;
}

export function computeHospitalityReports(
  sales: Sale[],
  products: Product[],
  range: HospitalityReportRange,
  options?: {
    floor?: HospitalityFloorState | null;
    staffAccounts?: StaffAccount[] | null;
  },
): HospitalityReportSummary {
  const productById = new Map(products.map((p) => [p.id, p]));
  const scoped = completedSales(sales).filter((s) => inRange(s.createdAt, range));
  const floor = options?.floor ?? null;
  const staffAccounts = options?.staffAccounts ?? null;

  let totalRevenueUgx = 0;
  const waiterMap = new Map<string, WaiterPerformanceRow>();
  const tableMap = new Map<string, TableRevenueRow>();
  const mix = new Map<CategoryMixRow["kind"], CategoryMixRow>();
  const hourMap = new Map<number, PeakHourRow>();

  for (const sale of scoped) {
    totalRevenueUgx += sale.totalUgx;
    const attribution = resolveSaleWaiterAttribution(sale, floor, staffAccounts);
    const wKey = attribution.reportKey;
    const wRow = waiterMap.get(wKey) ?? {
      waiterId: wKey,
      label: attribution.reportLabel,
      billCount: 0,
      revenueUgx: 0,
      avgBillUgx: 0,
    };
    wRow.billCount += 1;
    wRow.revenueUgx += sale.totalUgx;
    waiterMap.set(wKey, wRow);

    const tLabel = sale.referenceLabel?.trim() || "Takeaway / other";
    const tRow = tableMap.get(tLabel) ?? { label: tLabel, billCount: 0, revenueUgx: 0 };
    tRow.billCount += 1;
    tRow.revenueUgx += sale.totalUgx;
    tableMap.set(tLabel, tRow);

    const hour = new Date(sale.createdAt).getHours();
    const hRow = hourMap.get(hour) ?? {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      billCount: 0,
      revenueUgx: 0,
    };
    hRow.billCount += 1;
    hRow.revenueUgx += sale.totalUgx;
    hourMap.set(hour, hRow);

    for (const line of sale.lines) {
      if (line.voided) continue;
      const product = productById.get(line.productId);
      const station = product ? resolveProductStationType(product) : "kitchen";
      const kind: CategoryMixRow["kind"] = station === "bar" ? "drink" : station === "kitchen" ? "food" : "other";
      const row = mix.get(kind) ?? { kind, revenueUgx: 0, quantity: 0 };
      row.revenueUgx += line.lineTotalUgx;
      row.quantity += line.quantity;
      mix.set(kind, row);
    }
  }

  const waiters = [...waiterMap.values()]
    .map((w) => ({ ...w, avgBillUgx: w.billCount > 0 ? Math.round(w.revenueUgx / w.billCount) : 0 }))
    .sort((a, b) => b.revenueUgx - a.revenueUgx);

  const tables = [...tableMap.values()].sort((a, b) => b.revenueUgx - a.revenueUgx);
  const peakHours = [...hourMap.values()].sort((a, b) => a.hour - b.hour);
  const categoryMix = [...mix.values()].sort((a, b) => b.revenueUgx - a.revenueUgx);

  return {
    completedBillCount: scoped.length,
    totalRevenueUgx,
    avgBillUgx: scoped.length > 0 ? Math.round(totalRevenueUgx / scoped.length) : 0,
    waiters,
    categoryMix,
    tables,
    peakHours,
    menu: computeHospitalityMenuReport(scoped, products),
  };
}

/** Phase 6.3 — live production metrics for future analytics dashboards (Phase 6.7). */
export { computeKitchenProductionAnalytics, type KitchenProductionAnalytics } from "./kitchenProduction";
