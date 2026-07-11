/**
 * Phase 17.3 — enterprise-scale performance certification.
 */

import { describe, expect, it } from "vitest";
import type { Product, Sale, SaleLine } from "../types";
import { buildProductSellSearchIndex, filterIndexedProductsForSellView } from "./posProductSearch";
import { buildAuditLogSearchIndex, filterAuditLogsIndexed } from "./auditSearch";
import { partitionReceiptsSales } from "./receiptsGrouping";
import { localGetRangeSummary } from "./localReporting";

const TARGETS_MS = {
  /** Warm CI machines can spike ~200ms; production target remains ~100ms (Phase 17.3). */
  posSearch20k: 220,
  receiptsPartition100k: 400,
  reports100k: 4_000,
  investigation20kAudit: 600,
} as const;

function mkLine(productId: string, idx: number): SaleLine {
  return {
    id: `line-${idx}`,
    productId,
    name: `Item ${idx % 50}`,
    inputMode: "quantity",
    quantity: 1,
    unitPriceUgx: 5_000,
    unitCostUgx: 3_000,
    lineTotalUgx: 5_000,
    estimatedProfitUgx: 2_000,
  };
}

function mkSale(i: number): Sale {
  const line = mkLine(`p-${i % 200}`, i);
  return {
    id: `sale-${i}`,
    status: "completed",
    createdAt: `2026-07-10T${String(i % 23).padStart(2, "0")}:${String(i % 59).padStart(2, "0")}:00.000Z`,
    updatedAt: `2026-07-10T${String(i % 23).padStart(2, "0")}:${String(i % 59).padStart(2, "0")}:00.000Z`,
    lines: [line],
    subtotalUgx: 5_000,
    totalUgx: 5_000,
    cashPaidUgx: 5_000,
    debtUgx: 0,
    estimatedProfitUgx: 2_000,
    pendingSync: false,
  };
}

function mkProducts(count: number): Product[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p-${i}`,
    name: `Product ${i}`,
    sellingMode: "unit" as const,
    baseUnit: "ea",
    sellingPricePerUnitUgx: 5_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 20,
    minimumStockAlert: 5,
    category: "General",
    sku: `SKU-${i}`,
    updatedAt: "2026-07-01T00:00:00.000Z",
    version: 1,
  }));
}

function benchBest(fn: () => void, runs = 5): number {
  fn();
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("enterprise performance scalability certification", () => {
  it(
    "POS indexed search: 20k products under threshold",
    () => {
      const products = mkProducts(20_000);
      const index = buildProductSellSearchIndex(products);
      const ms = benchBest(() => {
        filterIndexedProductsForSellView(index, "__waka_all__", "Product 15000", [], new Set());
      });
      // eslint-disable-next-line no-console
      console.log(`pos search 20k: ${ms.toFixed(1)}ms`);
      expect(ms).toBeLessThan(TARGETS_MS.posSearch20k);
    },
    30_000,
  );

  it(
    "receipts partition: 100k sales under threshold",
    () => {
      const sales = Array.from({ length: 100_000 }, (_, i) => mkSale(i));
      const ms = benchBest(() => partitionReceiptsSales(sales));
      // eslint-disable-next-line no-console
      console.log(`receipts partition 100k: ${ms.toFixed(1)}ms`);
      expect(ms).toBeLessThan(TARGETS_MS.receiptsPartition100k);
    },
    60_000,
  );

  it(
    "reports summary: 100k sales under threshold",
    () => {
      const sales = Array.from({ length: 100_000 }, (_, i) => mkSale(i));
      const products = mkProducts(200);
      const ms = benchBest(() =>
        localGetRangeSummary(sales, products, [], [], [], { kind: "day", dateKey: "2026-07-10" }),
      );
      // eslint-disable-next-line no-console
      console.log(`reports 100k: ${ms.toFixed(1)}ms`);
      expect(ms).toBeLessThan(TARGETS_MS.reports100k);
    },
    60_000,
  );

  it(
    "investigation audit filter: 20k rows under threshold",
    () => {
      const auditLogs = Array.from({ length: 20_000 }, (_, i) => ({
        id: `audit-${i}`,
        at: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
        action: "sale_completed" as const,
        actorUserId: `staff:${i % 8}`,
        actorName: `Staff ${i % 8}`,
        role: "cashier" as const,
        payloadSummary: `Event ${i}`,
        payload: { productName: `Product ${i % 50}` },
      }));
      const index = buildAuditLogSearchIndex(auditLogs);
      const ms = benchBest(() =>
        filterAuditLogsIndexed(
          index,
          { dateFrom: "2026-07-01", dateTo: "2026-07-10", action: "all", searchText: "Product 42" },
          { products: mkProducts(50), customers: [], suppliers: [] },
        ),
      );
      // eslint-disable-next-line no-console
      console.log(`investigation 20k: ${ms.toFixed(1)}ms`);
      expect(ms).toBeLessThan(TARGETS_MS.investigation20kAudit);
    },
    30_000,
  );
});
