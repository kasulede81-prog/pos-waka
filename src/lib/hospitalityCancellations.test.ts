import { describe, expect, it } from "vitest";
import type {
  HospitalityFloorState,
  Product,
  Sale,
  SaleLine,
  VoidRecord,
} from "../types";
import { computeHospitalityReports } from "./hospitalityReports";

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "plate",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 2_000,
    stockOnHand: 0,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-06-02T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const dish = product({
  id: "dish",
  name: "Dish",
  menu: { productKind: "finished_menu", recipe: null },
});

const wasteDish = product({
  id: "waste-dish",
  name: "Waste Dish",
  menu: {
    productKind: "finished_menu",
    recipe: null,
    prepBatches: [
      {
        id: "waste-batch",
        menuProductId: "waste-dish",
        preparedAt: "2026-06-02T09:00:00.000Z",
        portionsPrepared: 10,
        remainingPortions: 0,
        unitCostUgx: 1_000,
        wastedPortions: 10,
        wasteCostUgx: 10_000,
        status: "wasted",
        createdAt: "2026-06-02T09:00:00.000Z",
        updatedAt: "2026-06-02T09:00:00.000Z",
      },
    ],
  },
});

function saleLine(partial: Partial<SaleLine> & Pick<SaleLine, "id" | "quantity">): SaleLine {
  const lineTotal = 10_000 * partial.quantity;
  return {
    productId: "dish",
    name: "Dish",
    inputMode: "quantity",
    unitPriceUgx: 10_000,
    unitCostUgx: 2_000,
    lineTotalUgx: lineTotal,
    estimatedProfitUgx: lineTotal - 2_000 * partial.quantity,
    cogsUgx: 2_000 * partial.quantity,
    netRevenueUgx: lineTotal,
    grossProfitUgx: lineTotal - 2_000 * partial.quantity,
    financialDataStatus: "complete",
    ...partial,
  };
}

function completedSale(
  id: string,
  createdAt: string,
  lines: SaleLine[],
  overrides: Partial<Sale> = {},
): Sale {
  const total = lines.reduce((sum, line) => sum + line.lineTotalUgx, 0);
  return {
    id,
    status: "completed",
    lines,
    subtotalUgx: total,
    totalUgx: total,
    cashPaidUgx: total,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt,
    pendingSync: false,
    ...overrides,
  };
}

function voidRecord(
  partial: Partial<VoidRecord> & Pick<VoidRecord, "id" | "saleId">,
): VoidRecord {
  return {
    lineIndex: 0,
    productId: "dish",
    productName: "Dish",
    quantity: 1,
    amountUgx: 10_000,
    reason: "wrong_item",
    actorUserId: "user-1",
    actorName: "Alice",
    createdAt: "2026-06-02T13:00:00.000Z",
    ...partial,
  };
}

const lineVoidSale = completedSale("sale-line-void", "2026-06-02T12:00:00.000Z", [
  saleLine({ id: "line-1", quantity: 4, voided: true, voidedAt: "2026-06-02T13:00:00.000Z" }),
]);

const wholeBillSale = completedSale(
  "sale-whole-bill",
  "2026-06-03T12:00:00.000Z",
  [saleLine({ id: "line-2", quantity: 2, voided: true, voidedAt: "2026-06-03T14:00:00.000Z" })],
  {
    saleVoidedAt: "2026-06-03T14:00:00.000Z",
    saleVoidReason: "Customer cancelled order",
    saleVoidedByUserId: "user-2",
    saleVoidedByLabel: "Bob",
  },
);

const missingSnapshotSale = completedSale("sale-missing", "2026-06-02T15:00:00.000Z", [
  saleLine({
    id: "line-3",
    quantity: 1,
    voided: true,
    voidedAt: "2026-06-02T16:00:00.000Z",
    cogsUgx: undefined,
    netRevenueUgx: undefined,
    grossProfitUgx: undefined,
    financialDataStatus: "needs_repair",
  }),
]);

const outsideSale = completedSale("sale-outside", "2026-05-01T12:00:00.000Z", [
  saleLine({ id: "line-4", quantity: 1, voided: true, voidedAt: "2026-05-01T13:00:00.000Z" }),
]);

const lineVoid = voidRecord({
  id: "void-line",
  saleId: lineVoidSale.id,
  quantity: 1,
  amountUgx: 10_000,
  reason: "wrong_item",
  note: "sent back",
  createdAt: "2026-06-02T13:00:00.000Z",
  saleLineId: "line-1",
});
const wholeBillVoid = voidRecord({
  id: "void-whole",
  saleId: wholeBillSale.id,
  quantity: 2,
  amountUgx: 20_000,
  reason: "other",
  actorName: "Bob",
  createdAt: "2026-06-03T14:00:00.000Z",
  saleLineId: "line-2",
});
const missingSnapshotVoid = voidRecord({
  id: "void-missing",
  saleId: missingSnapshotSale.id,
  quantity: 1,
  amountUgx: 5_000,
  reason: "wrong_quantity",
  actorName: "Carol",
  createdAt: "2026-06-02T16:00:00.000Z",
  saleLineId: "line-3",
});
const outsideVoid = voidRecord({
  id: "void-outside",
  saleId: outsideSale.id,
  quantity: 1,
  amountUgx: 10_000,
  createdAt: "2026-05-01T13:00:00.000Z",
  saleLineId: "line-4",
});

const floor: HospitalityFloorState = {
  areas: [],
  tables: [],
  stations: [],
  sessions: [],
  kitchenTickets: [
    {
      id: "ticket-1",
      tableSessionId: "session-1",
      saleId: "sale-kitchen",
      stationId: "station-1",
      stationType: "kitchen",
      status: "cancelled",
      ticketNumber: 7,
      firedAt: "2026-06-04T14:00:00.000Z",
      tableLabel: "Table 5",
      items: [
        {
          id: "item-1",
          productId: "dish",
          productName: "Dish",
          quantity: 2,
          itemStatus: "cancelled",
          cancelledAt: "2026-06-04T15:00:00.000Z",
          cancelledBy: "Chef",
          cancelReason: "Out of stock",
        },
        {
          id: "item-outside",
          productId: "dish",
          productName: "Dish",
          quantity: 1,
          itemStatus: "cancelled",
          cancelledAt: "2026-05-01T15:00:00.000Z",
          cancelledBy: "Chef",
          cancelReason: "Old cancellation",
        },
      ],
    },
  ],
};

const report = computeHospitalityReports(
  [lineVoidSale, wholeBillSale, missingSnapshotSale, outsideSale],
  [dish, wasteDish],
  { fromKey: "2026-06-02", toKey: "2026-06-04" },
  {
    floor,
    voidRecords: [lineVoid, wholeBillVoid, outsideVoid],
    archivedVoidRecords: [missingSnapshotVoid],
  },
);
const cancellations = report.cancellations;
const row = (id: string) => cancellations.rows.find((entry) => entry.id === id);

describe("hospitality cancellation report", () => {
  it("reports line voids with recorded value and a prorated sale-time cost snapshot", () => {
    expect(row("void:void-line")).toMatchObject({
      source: "line_void",
      productId: "dish",
      quantity: 1,
      occurredAt: "2026-06-02T13:00:00.000Z",
      actorLabel: "Alice",
      reason: "wrong_item",
      note: "sent back",
      recordedValueUgx: 10_000,
      saleTimeCostUgx: 2_000,
      saleTimeCostBasis: "complete",
      costStatus: "snapshot",
    });
  });

  it("distinguishes whole-bill voids and uses the bill-level reason/actor when present", () => {
    expect(row("void:void-whole")).toMatchObject({
      source: "whole_bill_void",
      quantity: 2,
      actorLabel: "Bob",
      note: "Customer cancelled order",
      recordedValueUgx: 20_000,
      saleTimeCostUgx: 4_000,
      costStatus: "snapshot",
    });
  });

  it("includes archived voids and never substitutes current cost for a missing snapshot", () => {
    expect(row("void:void-missing")).toMatchObject({
      source: "line_void",
      actorLabel: "Carol",
      recordedValueUgx: 5_000,
      saleTimeCostUgx: null,
      saleTimeCostBasis: null,
      costStatus: "unavailable",
    });
    expect(row("kitchen:ticket-1:item-1")).toMatchObject({
      source: "kitchen_ticket",
      quantity: 2,
      actorLabel: "Chef",
      reason: "Out of stock",
      contextLabel: "Table 5",
      ticketNumber: 7,
      recordedValueUgx: null,
      saleTimeCostUgx: null,
      costStatus: "unavailable",
    });
  });

  it("filters by cancellation time and separates kitchen waste from cancellations", () => {
    expect(cancellations.rows.map((entry) => entry.id)).toEqual([
      "kitchen:ticket-1:item-1",
      "void:void-whole",
      "void:void-missing",
      "void:void-line",
    ]);
    expect(cancellations.rows.some((entry) => entry.id === "void:void-outside")).toBe(false);
    expect(cancellations.rows.some((entry) => entry.id === "kitchen:ticket-1:item-outside")).toBe(
      false,
    );
    expect(cancellations.rows.some((entry) => entry.productId === "waste-dish")).toBe(false);
  });

  it("summarizes counts and only the recorded/snapshot totals", () => {
    expect(cancellations.lineVoidCount).toBe(2);
    expect(cancellations.wholeBillVoidCount).toBe(1);
    expect(cancellations.kitchenCancellationCount).toBe(1);
    expect(cancellations.totalQuantity).toBe(6);
    expect(cancellations.totalRecordedValueUgx).toBe(35_000);
    expect(cancellations.totalSaleTimeCostUgx).toBe(6_000);
    expect(cancellations.saleTimeCostRowCount).toBe(2);
  });
});
