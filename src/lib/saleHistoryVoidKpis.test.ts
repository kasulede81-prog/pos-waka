import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { getCompletedFinancialsFromScoped, getCompletedRevenue } from "./financialMetrics";
import { partitionReceiptsSales, revenueEligibleSales } from "./receiptsGrouping";
import { isRevenueSale, isVoidedSale } from "./saleStatus";
import { t } from "./i18n";

const DAY = "2026-08-30";
const AT = `${DAY}T10:00:00.000Z`;

const products: Product[] = [
  {
    id: "prod-1",
    name: "Widget",
    sellingPricePerUnitUgx: 100_000,
    costPricePerUnitUgx: 40_000,
    stockOnHand: 50,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt: AT,
    version: 1,
  },
];

function line(partial: Partial<SaleLine> & Pick<SaleLine, "name" | "lineTotalUgx">): SaleLine {
  const qty = partial.quantity ?? 1;
  const total = partial.lineTotalUgx;
  return {
    productId: "prod-1",
    quantity: qty,
    unitPriceUgx: total / qty,
    unitCostUgx: 40_000,
    estimatedProfitUgx: total - 40_000 * qty,
    inputMode: "quantity",
    ...partial,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "status" | "totalUgx">): Sale {
  return {
    createdAt: AT,
    updatedAt: AT,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: partial.estimatedProfitUgx ?? partial.totalUgx - 40_000,
    lines: partial.lines ?? [line({ name: "Widget", lineTotalUgx: partial.totalUgx })],
    pendingSync: false,
    ...partial,
  };
}

/** Mirrors ReceiptsPage KPI path: partition → revenueEligible → financials. */
function salesHistoryKpis(sales: Sale[], returns: ReturnRecord[] = []) {
  const completed = partitionReceiptsSales(sales).completed;
  const eligible = revenueEligibleSales(completed);
  const financials = getCompletedFinancialsFromScoped(eligible, returns, products);
  return {
    listCompletedIds: completed.map((s) => s.id),
    eligibleIds: eligible.map((s) => s.id),
    revenueUgx: getCompletedRevenue(eligible, returns, products),
    transactionCount: financials.transactionCount,
    averageTransactionUgx: financials.averageTransactionUgx,
    profitUgx: financials.profitUgx,
  };
}

describe("SALE-HISTORY-P1-VOID-1.0 KPIs", () => {
  it("T1 — normal completed sale is included in revenue, txn count, and average", () => {
    const a = sale({ id: "sale-a", status: "completed", totalUgx: 100_000 });
    const kpis = salesHistoryKpis([a]);
    expect(isRevenueSale(a)).toBe(true);
    expect(kpis.listCompletedIds).toEqual(["sale-a"]);
    expect(kpis.eligibleIds).toEqual(["sale-a"]);
    expect(kpis.revenueUgx).toBe(100_000);
    expect(kpis.transactionCount).toBe(1);
    expect(kpis.averageTransactionUgx).toBe(100_000);
  });

  it("T2 — whole-bill void stays in history list but is excluded from KPIs", () => {
    const voided = sale({
      id: "sale-void",
      status: "completed",
      totalUgx: 0,
      cashPaidUgx: 0,
      saleVoidedAt: `${DAY}T11:00:00.000Z`,
      saleVoidReason: "customer_left",
      estimatedProfitUgx: 0,
    });
    const kpis = salesHistoryKpis([voided]);
    expect(isVoidedSale(voided)).toBe(true);
    expect(isRevenueSale(voided)).toBe(false);
    expect(kpis.listCompletedIds).toEqual(["sale-void"]);
    expect(kpis.eligibleIds).toEqual([]);
    expect(kpis.revenueUgx).toBe(0);
    expect(kpis.transactionCount).toBe(0);
    expect(kpis.averageTransactionUgx).toBe(0);
    expect(t("en", "salesHistoryStatusVoided")).toBe("VOIDED");
  });

  it("T3 — line-level void is not a whole-bill void; sale remains revenue-eligible", () => {
    const partialLineVoid = sale({
      id: "sale-line-void",
      status: "completed",
      totalUgx: 60_000,
      cashPaidUgx: 60_000,
      voidedTotalUgx: 40_000,
      lines: [
        line({ name: "Kept", lineTotalUgx: 60_000 }),
        line({ name: "Voided line", lineTotalUgx: 40_000, voided: true, voidedAt: `${DAY}T10:30:00.000Z` }),
      ],
    });
    expect(isVoidedSale(partialLineVoid)).toBe(false);
    expect(isRevenueSale(partialLineVoid)).toBe(true);
    const kpis = salesHistoryKpis([partialLineVoid]);
    expect(kpis.eligibleIds).toEqual(["sale-line-void"]);
    expect(kpis.revenueUgx).toBe(60_000);
    expect(kpis.transactionCount).toBe(1);
  });

  it("T4 — mixed bag: two revenue sales + one whole-bill void", () => {
    const a = sale({ id: "sale-a", status: "completed", totalUgx: 100_000 });
    const b = sale({ id: "sale-b", status: "completed", totalUgx: 50_000, estimatedProfitUgx: 10_000 });
    const c = sale({
      id: "sale-c",
      status: "completed",
      totalUgx: 0,
      cashPaidUgx: 0,
      saleVoidedAt: `${DAY}T12:00:00.000Z`,
      estimatedProfitUgx: 0,
    });
    const kpis = salesHistoryKpis([a, b, c]);
    expect(kpis.listCompletedIds).toEqual(["sale-a", "sale-b", "sale-c"]);
    expect(kpis.eligibleIds).toEqual(["sale-a", "sale-b"]);
    expect(kpis.revenueUgx).toBe(150_000);
    expect(kpis.transactionCount).toBe(2);
    expect(kpis.averageTransactionUgx).toBe(75_000);
  });

  it("T5 — linked same-day return already in sale.totalUgx; no extra refund subtraction", () => {
    const original = sale({ id: "sale-ret", status: "completed", totalUgx: 100_000 });
    const linkedReturn: ReturnRecord = {
      id: "ret-1",
      saleId: original.id,
      productId: "prod-1",
      productName: "Widget",
      quantity: 1,
      refundAmountUgx: 40_000,
      reason: "wrong_item",
      actorUserId: "owner",
      actorName: "Owner",
      shiftId: null,
      createdAt: `${DAY}T14:00:00.000Z`,
    };
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 40_000) };
    const kpis = salesHistoryKpis([adjusted], [linkedReturn]);
    // Revenue uses adjusted sale total; external refund path must not double-subtract linked amount.
    expect(adjusted.totalUgx).toBe(60_000);
    expect(kpis.revenueUgx).toBe(60_000);
    expect(kpis.transactionCount).toBe(1);
    expect(kpis.averageTransactionUgx).toBe(60_000);
  });

  it("T6 — voided sale remains identifiable for detail/history presentation", () => {
    const voided = sale({
      id: "sale-detail-void",
      status: "completed",
      totalUgx: 0,
      cashPaidUgx: 0,
      saleVoidedAt: `${DAY}T11:00:00.000Z`,
      saleVoidReason: "manager_void",
      saleVoidedByLabel: "Owner",
    });
    expect(isVoidedSale(voided)).toBe(true);
    expect(isRevenueSale(voided)).toBe(false);
    expect(voided.status).toBe("completed");
    expect(partitionReceiptsSales([voided]).completed).toHaveLength(1);
  });
});
