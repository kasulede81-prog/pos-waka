import type {
  HospitalityFloorState,
  Language,
  Product,
  Recipe,
  Sale,
  StaffAccount,
  VoidRecord,
} from "../types";
import { t } from "./i18n";
import { completedSales } from "./saleStatus";
import { aggregateRecipeRequirements, effectiveRecipe } from "./recipeEngine";
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
  resolveTrustedProductCost,
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

/** One label used by both the on-screen report and its export. */
export function hospitalityMenuMarginLabel(
  lang: Language,
  row: HospitalityMenuPerformanceRow,
): string {
  if (row.realized) {
    const partial =
      row.realized.basis === "partial" || row.realized.missingSnapshotLineCount > 0;
    return `${t(
      lang,
      partial ? "hospitalityReportsSoldMarginPartial" : "hospitalityReportsSoldMargin",
    )} ${row.realized.marginPct.toFixed(0)}%`;
  }
  if (row.currentMarginPct != null) {
    return `${t(lang, "hospitalityReportsEstimatedMargin")} ${row.currentMarginPct.toFixed(0)}%`;
  }
  return t(lang, "hospitalityReportsMarginUnavailable");
}

export function formatIngredientDemandQty(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

const VOID_REASON_KEYS = new Set([
  "wrong_item",
  "customer_changed_mind",
  "returned_item",
  "wrong_quantity",
  "other",
]);

export function hospitalityCancellationSourceLabel(
  lang: Language,
  source: HospitalityCancellationSource,
): string {
  if (source === "whole_bill_void") return t(lang, "hospitalityCancelledSourceWholeBill");
  if (source === "kitchen_ticket") return t(lang, "hospitalityCancelledSourceKitchen");
  return t(lang, "hospitalityCancelledSourceLineVoid");
}

export function hospitalityCancellationReasonLabel(
  lang: Language,
  row: HospitalityCancelledMenuItem,
): string {
  const base = row.reason
    ? VOID_REASON_KEYS.has(row.reason)
      ? t(lang, `voidReason_${row.reason}`)
      : row.reason
    : t(lang, "hospitalityCancelledReasonUnknown");
  return row.note ? `${base} — ${row.note}` : base;
}

export function formatHospitalityCancellationTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export type HospitalityIngredientCostGap = {
  ingredientId: string;
  name: string;
  unit: string;
  /** How many menu dishes reference this ingredient. */
  dishCount: number;
  reason: "zero_cost" | "missing";
};

export type HospitalityIngredientDemandRow = {
  ingredientId: string;
  name: string;
  unit: string;
  /** Estimated base-unit demand from completed recipe sales; not stock usage. */
  quantityBase: number;
  /** Current shared product cost estimate, only when provenance is trustworthy. */
  estimatedCostUgx: number | null;
  costStatus: "trusted" | "unavailable";
  dishCount: number;
};

export type HospitalityMissingIngredientDemand = {
  ingredientId: string;
  unit: string;
  quantityBase: number;
  dishCount: number;
};

export type HospitalityNoRecipeDemand = {
  productId: string;
  name: string;
  unitsSold: number;
  reason: "no_recipe" | "missing_product";
};

/**
 * Estimated recipe-based demand from completed menu sales.
 * This is not stock usage, an inventory movement, or a Hospitality ledger.
 */
export type HospitalityIngredientDemandReport = {
  rows: HospitalityIngredientDemandRow[];
  missingIngredients: HospitalityMissingIngredientDemand[];
  noRecipeDishes: HospitalityNoRecipeDemand[];
};

export type HospitalityCancellationSource =
  | "line_void"
  | "whole_bill_void"
  | "kitchen_ticket";

export type HospitalityCancelledMenuItem = {
  id: string;
  source: HospitalityCancellationSource;
  productId: string;
  productName: string;
  quantity: number;
  occurredAt: string;
  actorLabel: string | null;
  /** VoidReason for sale voids, free-text reason for kitchen cancellations. */
  reason: string;
  note: string | null;
  saleId: string | null;
  /** Sale reference label or kitchen ticket table label, when recorded. */
  contextLabel: string | null;
  ticketNumber: number | null;
  /** Recorded value reversed by the shared void record, never a food-cost value. */
  recordedValueUgx: number | null;
  /** Prorated sale-time COGS snapshot from the linked sale line. */
  saleTimeCostUgx: number | null;
  saleTimeCostBasis: "complete" | "partial" | null;
  costStatus: "snapshot" | "unavailable";
};

export type HospitalityCancelledMenuReport = {
  rows: HospitalityCancelledMenuItem[];
  lineVoidCount: number;
  wholeBillVoidCount: number;
  kitchenCancellationCount: number;
  totalQuantity: number;
  totalRecordedValueUgx: number;
  totalSaleTimeCostUgx: number;
  saleTimeCostRowCount: number;
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
  ingredientDemand: HospitalityIngredientDemandReport;
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
  cancellations: HospitalityCancelledMenuReport;
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

function recipeLineUnit(recipe: Recipe, ingredientId: string): string {
  return (
    recipe.lines.find((line) => line.ingredientProductId === ingredientId)?.unitLabel?.trim() ?? ""
  );
}

function roundDemandQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function computeIngredientDemand(
  scopedSales: Sale[],
  products: Product[],
): HospitalityIngredientDemandReport {
  const productById = new Map(products.map((product) => [product.id, product]));
  const demand = new Map<
    string,
    { ingredient: Product; unit: string; quantityBase: number; dishIds: Set<string> }
  >();
  const missing = new Map<
    string,
    { ingredientId: string; unit: string; quantityBase: number; dishIds: Set<string> }
  >();
  const noRecipe = new Map<string, HospitalityNoRecipeDemand>();

  for (const sale of scopedSales) {
    for (const line of sale.lines) {
      if (line.voided) continue;
      const product = productById.get(line.productId);
      if (!product) {
        const key = `missing-product:${line.productId}`;
        const row = noRecipe.get(key) ?? {
          productId: line.productId,
          name: line.name,
          unitsSold: 0,
          reason: "missing_product" as const,
        };
        row.unitsSold += line.quantity;
        noRecipe.set(key, row);
        continue;
      }

      const recipe = effectiveRecipe(product, line.variantId);
      if (!recipe) {
        if (isHospitalityRecipeDish(product)) {
          const key = `no-recipe:${product.id}`;
          const row = noRecipe.get(key) ?? {
            productId: product.id,
            name: product.name,
            unitsSold: 0,
            reason: "no_recipe" as const,
          };
          row.unitsSold += line.quantity;
          noRecipe.set(key, row);
        }
        continue;
      }

      const requirements = aggregateRecipeRequirements([
        {
          product,
          quantity: line.quantity,
          variantId: line.variantId,
          modifiers: line.selectedModifiers,
        },
      ]);
      for (const [ingredientId, quantityBase] of requirements) {
        if (quantityBase <= 0) continue;
        const ingredient = productById.get(ingredientId);
        const unit = ingredient
          ? ingredient.baseUnit?.trim() || "ea"
          : recipeLineUnit(recipe, ingredientId) || "";
        if (!ingredient) {
          const key = `missing:${ingredientId}:${unit}`;
          const row = missing.get(key) ?? {
            ingredientId,
            unit,
            quantityBase: 0,
            dishIds: new Set<string>(),
          };
          row.quantityBase += quantityBase;
          row.dishIds.add(product.id);
          missing.set(key, row);
        } else {
          const key = `${ingredientId}:${unit}`;
          const row = demand.get(key) ?? {
            ingredient,
            unit,
            quantityBase: 0,
            dishIds: new Set<string>(),
          };
          row.quantityBase += quantityBase;
          row.dishIds.add(product.id);
          demand.set(key, row);
        }
      }
    }
  }

  return {
    rows: [...demand.values()]
      .map(({ ingredient, unit, quantityBase, dishIds }) => {
        const trusted = resolveTrustedProductCost(ingredient);
        return {
          ingredientId: ingredient.id,
          name: ingredient.name,
          unit,
          quantityBase: roundDemandQty(quantityBase),
          estimatedCostUgx: trusted ? Math.round(quantityBase * trusted.costUgx) : null,
          costStatus: trusted ? ("trusted" as const) : ("unavailable" as const),
          dishCount: dishIds.size,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    missingIngredients: [...missing.values()]
      .map(({ ingredientId, unit, quantityBase, dishIds }) => ({
        ingredientId,
        unit,
        quantityBase: roundDemandQty(quantityBase),
        dishCount: dishIds.size,
      }))
      .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId)),
    noRecipeDishes: [...noRecipe.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
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
    ingredientDemand: computeIngredientDemand(scopedSales, products),
  };
}

function inRange(iso: string, range: HospitalityReportRange): boolean {
  const key = dateKeyKampala(new Date(iso));
  return key >= range.fromKey && key <= range.toKey;
}

function computeCancelledMenuReport(
  sales: Sale[],
  voidRecords: readonly VoidRecord[],
  archivedVoidRecords: readonly VoidRecord[],
  floor: HospitalityFloorState | null,
  range: HospitalityReportRange,
): HospitalityCancelledMenuReport {
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const voidById = new Map<string, VoidRecord>();
  for (const record of [...voidRecords, ...archivedVoidRecords]) {
    voidById.set(record.id, record);
  }

  const rows: HospitalityCancelledMenuItem[] = [];

  for (const record of voidById.values()) {
    if (!inRange(record.createdAt, range)) continue;
    const sale = saleById.get(record.saleId) ?? null;
    const candidates = sale
      ? (record.saleLineId
          ? [sale.lines.find((line) => line.id === record.saleLineId), sale.lines[record.lineIndex]]
          : [sale.lines[record.lineIndex]])
      : [];
    const line =
      candidates.find((candidate) => candidate && candidate.productId === record.productId) ?? null;
    const historical = line
      ? resolveSaleLineHistoricalFinancials(line, sale ?? undefined, { includeVoided: true })
      : null;
    const saleTimeCostUgx =
      historical && line && line.quantity > 0
        ? Math.round(
            (historical.cogsUgx * Math.min(Math.max(0, record.quantity), line.quantity)) /
              line.quantity,
          )
        : null;
    const wholeBill = Boolean(
      record.saleVoidedAt || sale?.saleVoidedAt || sale?.billDraft?.voidedAt,
    );
    const note =
      record.note?.trim() ||
      sale?.saleVoidReason?.trim() ||
      sale?.billDraft?.voidReason?.trim() ||
      null;

    rows.push({
      id: `void:${record.id}`,
      source: wholeBill ? "whole_bill_void" : "line_void",
      productId: record.productId,
      productName: record.productName,
      quantity: record.quantity,
      occurredAt: record.createdAt,
      actorLabel: record.actorName?.trim() || sale?.saleVoidedByLabel?.trim() || record.actorUserId,
      reason: record.reason,
      note,
      saleId: record.saleId,
      contextLabel: sale?.referenceLabel?.trim() || null,
      ticketNumber: null,
      recordedValueUgx: Number.isFinite(record.amountUgx) ? Math.round(record.amountUgx) : null,
      saleTimeCostUgx,
      saleTimeCostBasis: historical?.basis ?? null,
      costStatus: saleTimeCostUgx != null ? "snapshot" : "unavailable",
    });
  }

  for (const ticket of floor?.kitchenTickets ?? []) {
    for (const item of ticket.items) {
      if (item.itemStatus !== "cancelled" || !item.cancelledAt) continue;
      if (!inRange(item.cancelledAt, range)) continue;
      rows.push({
        id: `kitchen:${ticket.id}:${item.id}`,
        source: "kitchen_ticket",
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        occurredAt: item.cancelledAt,
        actorLabel: item.cancelledBy?.trim() || null,
        reason: item.cancelReason?.trim() || "",
        note: null,
        saleId: ticket.saleId ?? null,
        contextLabel: ticket.tableLabel?.trim() || null,
        ticketNumber: ticket.ticketNumber ?? null,
        recordedValueUgx: null,
        saleTimeCostUgx: null,
        saleTimeCostBasis: null,
        costStatus: "unavailable",
      });
    }
  }

  rows.sort(
    (a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.productName.localeCompare(b.productName),
  );

  return {
    rows,
    lineVoidCount: rows.filter((row) => row.source === "line_void").length,
    wholeBillVoidCount: rows.filter((row) => row.source === "whole_bill_void").length,
    kitchenCancellationCount: rows.filter((row) => row.source === "kitchen_ticket").length,
    totalQuantity: roundDemandQty(rows.reduce((sum, row) => sum + row.quantity, 0)),
    totalRecordedValueUgx: Math.round(
      rows.reduce((sum, row) => sum + (row.recordedValueUgx ?? 0), 0),
    ),
    totalSaleTimeCostUgx: Math.round(
      rows.reduce((sum, row) => sum + (row.saleTimeCostUgx ?? 0), 0),
    ),
    saleTimeCostRowCount: rows.filter((row) => row.saleTimeCostUgx != null).length,
  };
}

export function computeHospitalityReports(
  sales: Sale[],
  products: Product[],
  range: HospitalityReportRange,
  options?: {
    floor?: HospitalityFloorState | null;
    staffAccounts?: StaffAccount[] | null;
    voidRecords?: readonly VoidRecord[] | null;
    archivedVoidRecords?: readonly VoidRecord[] | null;
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
    cancellations: computeCancelledMenuReport(
      sales,
      options?.voidRecords ?? [],
      options?.archivedVoidRecords ?? [],
      floor,
      range,
    ),
  };
}

/** Phase 6.3 — live production metrics for future analytics dashboards (Phase 6.7). */
export { computeKitchenProductionAnalytics, type KitchenProductionAnalytics } from "./kitchenProduction";
