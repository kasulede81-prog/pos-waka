import type { HospitalityFloorState, Product, Sale, StaffAccount } from "../types";
import { completedSales } from "./saleStatus";
import { resolveProductStationType } from "./kitchenRouting";
import { dateKeyKampala } from "./datesUg";
import { resolveSaleWaiterAttribution } from "./waiterAttribution";
import {
  aggregateDishSales,
  aggregateModifierPopularity,
  lowMarginMenuItems,
  type ModifierPopularityStat,
} from "./menuReports";
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

export type HospitalityMenuPerformanceRow = {
  productId: string;
  name: string;
  unitsSold: number;
  revenueUgx: number;
  sellPriceUgx: number;
  costStatus: HospitalityMenuCostStatus;
  /** Only present when the cost is trustworthy (verified product cost or complete recipe). */
  foodCostUgx: number | null;
  marginPct: number | null;
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

function computeHospitalityMenuReport(
  scopedSales: Sale[],
  products: Product[],
): HospitalityMenuReport {
  const soldById = new Map(aggregateDishSales(scopedSales).map((row) => [row.productId, row]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const menuProducts = products.filter(
    (product) => !product.menu?.hideFromMenu && isHospitalityMenuItem(product),
  );

  const entries = menuProducts.map((product) => {
    const state = hospitalityMenuCostState(product, products);
    const status = menuCostStatus(state);
    const sold = soldById.get(product.id);
    const trustworthy = status === "verified" || status === "estimated";
    const row: HospitalityMenuPerformanceRow = {
      productId: product.id,
      name: product.name,
      unitsSold: sold?.quantitySold ?? 0,
      revenueUgx: sold?.revenueUgx ?? 0,
      sellPriceUgx: product.sellingPricePerUnitUgx,
      costStatus: status,
      foodCostUgx:
        trustworthy && (state.status === "estimated" || state.status === "verified_product_cost")
          ? state.foodCostUgx
          : null,
      marginPct:
        trustworthy && (state.status === "estimated" || state.status === "verified_product_cost")
          ? state.marginPct
          : null,
    };
    return { product, state, row };
  });
  const entryById = new Map(entries.map((entry) => [entry.product.id, entry]));

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

  // lowMarginMenuItems already excludes incomplete, not-set and unverified costs.
  // Keep the report sales-scoped: an unsold low-margin item belongs in the menu
  // builder, not in a completed-sales period report with zero units/revenue.
  const lowMargin = lowMarginMenuItems(products, 35)
    .map((row) => entryById.get(row.product.id)?.row)
    .filter((row): row is HospitalityMenuPerformanceRow => row != null && row.unitsSold > 0)
    .slice(0, 5);

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
