import { describe, expect, it } from "vitest";
import type {
  AuditLogEntry,
  PrepBatch,
  Product,
  ReturnRecord,
  Sale,
  SaleLine,
} from "../types";
import { computeHospitalityReports } from "./hospitalityReports";

const RANGE = { fromKey: "2026-06-02", toKey: "2026-06-04" };

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-06-02T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

function batch(
  partial: Partial<PrepBatch> & Pick<PrepBatch, "id" | "preparedAt">,
): PrepBatch {
  return {
    menuProductId: "dish",
    portionsPrepared: 0,
    remainingPortions: 0,
    unitCostUgx: 0,
    status: "active",
    createdAt: partial.preparedAt,
    updatedAt: partial.preparedAt,
    ...partial,
  };
}

function line(
  partial: Partial<SaleLine> & Pick<SaleLine, "productId" | "name" | "quantity">,
): SaleLine {
  const quantity = partial.quantity;
  return {
    inputMode: "quantity",
    unitPriceUgx: 10_000,
    unitCostUgx: 0,
    lineTotalUgx: Math.round(10_000 * quantity),
    estimatedProfitUgx: 0,
    ...partial,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "lines">): Sale {
  return {
    status: "completed",
    subtotalUgx: 0,
    totalUgx: 0,
    cashPaidUgx: 0,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-06-02T12:00:00.000Z",
    pendingSync: false,
    ...partial,
  };
}

function ret(partial: Partial<ReturnRecord> & Pick<ReturnRecord, "id" | "productId" | "quantity">): ReturnRecord {
  return {
    productName: "Chicken plate",
    refundAmountUgx: 0,
    reason: "other",
    actorUserId: "actor",
    createdAt: "2026-06-02T13:00:00.000Z",
    ...partial,
  };
}

function cancelEvent(id: string, batchId: string, portions: number, at = "2026-06-04T12:00:00.000Z"): AuditLogEntry {
  return {
    id,
    at,
    actorUserId: "actor",
    role: "owner",
    action: "hospitality_prep_cancel",
    payloadSummary: `cancel ${batchId}`,
    payload: { batchId, reversedPortions: portions },
  };
}

function dishWith(batches: PrepBatch[]): Product {
  return product({
    id: "dish",
    name: "Chicken plate",
    menu: {
      productKind: "finished_menu",
      prepMode: "batch_prepared",
      prepBatches: batches,
    },
  });
}

function reportFor(
  products: Product[],
  sales: Sale[] = [],
  returns: readonly ReturnRecord[] | null = [],
  auditLogs: readonly AuditLogEntry[] | null = [],
) {
  return computeHospitalityReports(
    sales,
    products,
    RANGE,
    { returns, auditLogs },
  ).prepBatches;
}

describe("hospitality prep-batch aggregate report", () => {
  const batchA = batch({
    id: "batch-a",
    preparedAt: "2026-06-02T09:00:00.000Z",
    portionsPrepared: 10,
    remainingPortions: 3,
    wastedPortions: 1,
    unitCostUgx: 2_000,
    batchCostPerPlateUgx: 2_500,
    totalCostUgx: 25_000,
    expectedPortions: 12,
    actualPortions: 10,
    yieldBasis: "actual",
  });
  const batchB = batch({
    id: "batch-b",
    preparedAt: "2026-06-03T09:00:00.000Z",
    portionsPrepared: 8,
    remainingPortions: 6,
    unitCostUgx: 2_000,
    batchCostPerPlateUgx: 2_500,
    totalCostUgx: 20_000,
  });
  const batchC = batch({
    id: "batch-c",
    preparedAt: "2026-06-04T09:00:00.000Z",
    portionsPrepared: 6,
    remainingPortions: 0,
    wastedPortions: 1,
    status: "cancelled",
    unitCostUgx: 2_000,
    batchCostPerPlateUgx: 2_500,
    totalCostUgx: 15_000,
  });
  const outsideBatch = batch({
    id: "batch-outside",
    preparedAt: "2026-05-01T09:00:00.000Z",
    portionsPrepared: 99,
    remainingPortions: 99,
    unitCostUgx: 1_000,
  });
  const undatedBatch = batch({
    id: "batch-undated",
    preparedAt: "not-a-date",
    portionsPrepared: 5,
    remainingPortions: 5,
    unitCostUgx: 1_000,
  });

  const saleA = sale({
    id: "sale-a",
    createdAt: "2026-06-02T12:00:00.000Z",
    totalUgx: 100_000,
    subtotalUgx: 100_000,
    cashPaidUgx: 100_000,
    lines: [
      line({
        id: "line-a",
        productId: "dish",
        name: "Chicken plate",
        quantity: 10,
        unitCostUgx: 4_000,
        lineTotalUgx: 100_000,
        cogsUgx: 40_000,
        netRevenueUgx: 100_000,
        grossProfitUgx: 60_000,
        estimatedProfitUgx: 60_000,
        prepAllocation: [
          { batchId: "batch-a", portions: 6 },
          { batchId: "batch-b", portions: 4 },
        ],
      }),
    ],
  });
  // Outside the reporting period on purpose: batch usage is lifetime.
  const saleC = sale({
    id: "sale-c",
    createdAt: "2026-07-01T12:00:00.000Z",
    totalUgx: 30_000,
    subtotalUgx: 30_000,
    cashPaidUgx: 30_000,
    lines: [
      line({
        id: "line-c",
        productId: "dish",
        name: "Chicken plate",
        quantity: 3,
        unitCostUgx: 4_000,
        lineTotalUgx: 30_000,
        cogsUgx: 12_000,
        netRevenueUgx: 30_000,
        grossProfitUgx: 18_000,
        estimatedProfitUgx: 18_000,
        prepAllocation: [{ batchId: "batch-c", portions: 3 }],
      }),
    ],
  });
  const saleOutsideBatch = sale({
    id: "sale-outside-batch",
    lines: [
      line({
        id: "line-outside",
        productId: "dish",
        name: "Chicken plate",
        quantity: 2,
        prepAllocation: [{ batchId: "batch-outside", portions: 2 }],
      }),
    ],
  });

  it("links completed-sale allocations to the prepared batches in the period", () => {
    const report = reportFor(
      [dishWith([batchA, { ...batchB, remainingPortions: 4 }, batchC, outsideBatch, undatedBatch])],
      [saleA, saleC, saleOutsideBatch],
    );

    expect(report.rows.map((row) => row.batchId)).toEqual(["batch-a", "batch-b", "batch-c"]);
    expect(report.undatedBatchCount).toBe(1);
    expect(report.outsideRangeBatchCount).toBe(1);

    const a = report.rows.find((row) => row.batchId === "batch-a")!;
    expect(a).toMatchObject({
      soldPortionsGross: 6,
      returnedPortions: 0,
      soldPortionsNet: 6,
      grossSalesRevenueUgx: 60_000,
      grossSalesCogsUgx: 24_000,
      salesRevenueUgx: 60_000,
      salesCogsUgx: 24_000,
      salesSnapshotEvidence: "complete",
      reconciliation: "reconciled",
      reconciliationDeltaPortions: 0,
    });

    const b = report.rows.find((row) => row.batchId === "batch-b")!;
    expect(b).toMatchObject({
      soldPortionsGross: 4,
      soldPortionsNet: 4,
      grossSalesRevenueUgx: 40_000,
      grossSalesCogsUgx: 16_000,
      reconciliation: "reconciled",
    });

    // Prepared in the period, sold after it: lifetime usage still counts once.
    const c = report.rows.find((row) => row.batchId === "batch-c")!;
    expect(c).toMatchObject({
      soldPortionsGross: 3,
      soldPortionsNet: 3,
      salesRevenueUgx: 30_000,
      salesCogsUgx: 12_000,
    });
    // Without a recorded cancel quantity the cancellation stays unknown.
    expect(c.cancelledPortions).toBeNull();
    expect(c.cancelledEvidence).toBe("unavailable");
    expect(c.reconciliation).toBe("unknown");

    expect(report.soldPortionsGross).toBe(13);
    expect(report.returnedPortions).toBe(0);
    expect(report.soldPortionsNet).toBe(13);
    expect(report.grossSalesRevenueUgx).toBe(130_000);
    expect(report.grossSalesCogsUgx).toBe(52_000);
    expect(report.salesRevenueUgx).toBe(130_000);
    expect(report.salesCogsUgx).toBe(52_000);
    expect(report.missingAllocationLineCount).toBe(0);
    expect(report.returnsEvidence).toBe("included");
    expect(report.auditEvidence).toBe("included");
    expect(report.usageScope).toBe("batch_lifetime");
    expect(report.batchSource).toBe("device_product_records");
  });

  it("nets recorded returns tail-first and never double counts the same return", () => {
    const returnA = ret({
      id: "return-a",
      saleId: "sale-a",
      saleLineId: "line-a",
      productId: "dish",
      quantity: 2,
      refundAmountUgx: 20_000,
      cogsUgx: 8_000,
    });
    // Duplicated record id must be counted once.
    const report = reportFor(
      [dishWith([batchA, batchB, batchC])],
      [saleA, saleC],
      [returnA, { ...returnA }],
      [cancelEvent("cancel-c", "batch-c", 2)],
    );

    const a = report.rows.find((row) => row.batchId === "batch-a")!;
    const b = report.rows.find((row) => row.batchId === "batch-b")!;
    const c = report.rows.find((row) => row.batchId === "batch-c")!;

    expect(a).toMatchObject({
      soldPortionsGross: 6,
      returnedPortions: 0,
      soldPortionsNet: 6,
      salesRevenueUgx: 60_000,
      salesCogsUgx: 24_000,
    });
    expect(b).toMatchObject({
      soldPortionsGross: 4,
      returnedPortions: 2,
      soldPortionsNet: 2,
      grossSalesRevenueUgx: 40_000,
      returnRefundUgx: 20_000,
      returnCogsUgx: 8_000,
      salesRevenueUgx: 20_000,
      salesCogsUgx: 8_000,
    });
    expect(c.cancelledPortions).toBe(2);
    expect(c.cancelledEvidence).toBe("audit_event");
    expect(c.reconciliation).toBe("reconciled");

    expect(report.returnedPortions).toBe(2);
    expect(report.soldPortionsNet).toBe(11);
    expect(report.grossSalesRevenueUgx).toBe(130_000);
    expect(report.returnRefundUgx).toBe(20_000);
    expect(report.salesRevenueUgx).toBe(110_000);
    expect(report.salesCogsUgx).toBe(44_000);
    expect(report.cancelledPortions).toBe(2);
    expect(report.cancelledPortionsKnown).toBe(2);
    expect(report.cancelledPortionsUnknownBatchCount).toBe(0);
    expect(report.reconciledBatchCount).toBe(3);
    expect(report.unreconciledBatchCount).toBe(0);
    expect(report.unknownReconciliationBatchCount).toBe(0);
  });

  it("does not count a voided line or a voided sale as sold", () => {
    const voidedLineSale = sale({
      id: "sale-voided-line",
      lines: [
        line({
          id: "line-voided",
          productId: "dish",
          name: "Chicken plate",
          quantity: 10,
          voided: true,
          prepAllocation: [{ batchId: "batch-a", portions: 10 }],
        }),
      ],
    });
    const wholeVoidSale = sale({
      id: "sale-whole-void",
      status: "cancelled",
      lines: [
        line({
          id: "line-whole-void",
          productId: "dish",
          name: "Chicken plate",
          quantity: 8,
          prepAllocation: [{ batchId: "batch-a", portions: 8 }],
        }),
      ],
    });
    const report = reportFor([dishWith([batchA])], [voidedLineSale, wholeVoidSale]);

    expect(report.soldPortionsGross).toBe(0);
    expect(report.soldPortionsNet).toBe(0);
    expect(report.missingAllocationLineCount).toBe(0);
    expect(report.rows[0]!.salesSnapshotEvidence).toBe("complete");
  });

  it("treats missing allocation evidence as unknown, not zero", () => {
    const saleWithoutAllocation = sale({
      id: "sale-no-allocation",
      totalUgx: 20_000,
      lines: [
        line({
          id: "line-no-allocation",
          productId: "dish",
          name: "Chicken plate",
          quantity: 2,
          cogsUgx: 8_000,
          netRevenueUgx: 20_000,
          grossProfitUgx: 12_000,
          estimatedProfitUgx: 12_000,
          unitCostUgx: 4_000,
        }),
      ],
    });
    const report = reportFor([dishWith([batchA])], [saleWithoutAllocation], [], []);

    expect(report.soldPortionsGross).toBe(0);
    expect(report.missingAllocationLineCount).toBe(1);
    expect(report.missingAllocationQuantity).toBe(2);
    expect(report.unallocatedSalesRevenueUgx).toBe(20_000);
    expect(report.unallocatedSalesCogsUgx).toBe(8_000);
    expect(report.rows[0]!.allocationEvidenceIncomplete).toBe(true);
    expect(report.rows[0]!.reconciliation).toBe("unknown");
    expect(report.unknownReconciliationBatchCount).toBe(1);
  });

  it("marks missing sale snapshots as missing, never zero revenue", () => {
    const soloBatch = batch({
      id: "batch-a",
      preparedAt: "2026-06-02T09:00:00.000Z",
      portionsPrepared: 10,
      remainingPortions: 0,
      wastedPortions: 0,
    });
    const noSnapshotSale = sale({
      id: "sale-no-snapshot",
      lines: [
        line({
          id: "line-no-snapshot",
          productId: "dish",
          name: "Chicken plate",
          quantity: 10,
          prepAllocation: [{ batchId: "batch-a", portions: 10 }],
        }),
      ],
    });
    const report = reportFor([dishWith([soloBatch])], [noSnapshotSale], [], []);

    expect(report.rows[0]!.soldPortionsNet).toBe(10);
    expect(report.rows[0]!.salesSnapshotEvidence).toBe("missing");
    expect(report.rows[0]!.salesRevenueUgx).toBe(0);
    expect(report.missingFinancialSnapshotLineCount).toBe(1);
    expect(report.salesRevenueUgx).toBe(0);
    // Portion reconciliation is independent of the financial snapshot.
    expect(report.rows[0]!.reconciliation).toBe("reconciled");
  });

  it("uses partial snapshots but flags them as partial", () => {
    const soloBatch = batch({
      id: "batch-a",
      preparedAt: "2026-06-02T09:00:00.000Z",
      portionsPrepared: 10,
      remainingPortions: 0,
      wastedPortions: 0,
    });
    const partialSale = sale({
      id: "sale-partial",
      lines: [
        line({
          id: "line-partial",
          productId: "dish",
          name: "Chicken plate",
          quantity: 10,
          unitCostUgx: 4_000,
          netRevenueUgx: 100_000,
          prepAllocation: [{ batchId: "batch-a", portions: 10 }],
        }),
      ],
    });
    const report = reportFor([dishWith([soloBatch])], [partialSale], [], []);

    expect(report.rows[0]!.salesSnapshotEvidence).toBe("partial");
    expect(report.rows[0]!.grossSalesRevenueUgx).toBe(100_000);
    expect(report.rows[0]!.grossSalesCogsUgx).toBe(40_000);
    expect(report.partialFinancialSnapshotLineCount).toBe(1);
  });

  it("reports unknown when return records are not supplied", () => {
    const report = reportFor([dishWith([batchA])], [saleA], null, []);

    expect(report.returnsEvidence).toBe("unavailable");
    expect(report.returnedPortions).toBeNull();
    expect(report.soldPortionsNet).toBeNull();
    expect(report.salesRevenueUgx).toBeNull();
    expect(report.grossSalesRevenueUgx).toBe(60_000);
    expect(report.rows[0]!.reconciliation).toBe("unknown");
  });

  it("keeps cancelled portions unknown without a recorded cancel event", () => {
    const report = reportFor([dishWith([batchC])], [saleC], [], []);

    expect(report.rows[0]!.status).toBe("cancelled");
    expect(report.rows[0]!.cancelledPortions).toBeNull();
    expect(report.cancelledPortions).toBeNull();
    expect(report.cancelledPortionsKnown).toBe(0);
    expect(report.cancelledPortionsUnknownBatchCount).toBe(1);
    expect(report.unknownReconciliationBatchCount).toBe(1);
  });

  it("dedupes duplicate cancel events by batch and audit id", () => {
    const event = cancelEvent("cancel-c", "batch-c", 2);
    const report = reportFor(
      [dishWith([batchC])],
      [saleC],
      [],
      [event, { ...event }, cancelEvent("cancel-c-copy", "batch-c", 2)],
    );

    expect(report.rows[0]!.cancelledPortions).toBe(2);
    expect(report.cancelledPortionsKnown).toBe(2);
    expect(report.cancelledPortionsUnknownBatchCount).toBe(0);
    expect(report.rows[0]!.reconciliation).toBe("reconciled");
  });

  it("accepts a numeric-string cancelled quantity from a cloud audit payload", () => {
    const event = cancelEvent("cancel-c-string", "batch-c", 2);
    const report = reportFor(
      [dishWith([batchC])],
      [saleC],
      [],
      [{ ...event, payload: { ...event.payload, reversedPortions: "2" } }],
    );

    expect(report.rows[0]!.cancelledPortions).toBe(2);
    expect(report.rows[0]!.reconciliation).toBe("reconciled");
  });

  it("dedupes duplicate sale input by sale id", () => {
    const report = reportFor([dishWith([batchA])], [saleA, { ...saleA }], [], []);

    expect(report.soldPortionsGross).toBe(6);
    expect(report.grossSalesRevenueUgx).toBe(60_000);
    expect(report.salesRevenueUgx).toBe(60_000);
  });

  it("counts an actual yield even when no expected yield was recorded", () => {
    const actualOnly = batch({
      id: "batch-actual-only",
      preparedAt: "2026-06-02T09:00:00.000Z",
      portionsPrepared: 5,
      remainingPortions: 5,
      actualPortions: 5,
      yieldBasis: "actual",
    });
    const report = reportFor([dishWith([actualOnly])], [], [], []);

    expect(report.recordedActualPortions).toBe(5);
    expect(report.actualPortionBatchCount).toBe(1);
    // Yield variance still needs both figures and is not inferred.
    expect(report.yieldMeasuredBatchCount).toBe(0);
    expect(report.actualPortions).toBe(0);
    expect(report.rows[0]!.yieldVariancePortions).toBeNull();
  });

  it("reports unreconciled batches when the recorded quantities do not add up", () => {
    const broken = batch({
      id: "batch-broken",
      preparedAt: "2026-06-02T09:00:00.000Z",
      portionsPrepared: 10,
      remainingPortions: 1,
      wastedPortions: 0,
    });
    const report = reportFor([dishWith([broken])], [], [], []);

    expect(report.rows[0]!.reconciliation).toBe("unreconciled");
    expect(report.rows[0]!.reconciliationDeltaPortions).toBe(9);
    expect(report.unreconciledBatchCount).toBe(1);
  });

  it("flags partial allocations without pretending the uncovered portions sold elsewhere", () => {
    const partialBatch = batch({
      id: "batch-partial",
      preparedAt: "2026-06-02T09:00:00.000Z",
      portionsPrepared: 10,
      remainingPortions: 5,
      wastedPortions: 0,
    });
    const partialSale = sale({
      id: "sale-partial-allocation",
      totalUgx: 100_000,
      lines: [
        line({
          id: "line-partial-allocation",
          productId: "dish",
          name: "Chicken plate",
          quantity: 10,
          cogsUgx: 40_000,
          netRevenueUgx: 100_000,
          grossProfitUgx: 60_000,
          estimatedProfitUgx: 60_000,
          prepAllocation: [{ batchId: "batch-partial", portions: 5 }],
        }),
      ],
    });
    const report = reportFor([dishWith([partialBatch])], [partialSale], [], []);

    expect(report.rows[0]!.soldPortionsGross).toBe(5);
    expect(report.rows[0]!.soldPortionsNet).toBe(5);
    expect(report.rows[0]!.grossSalesRevenueUgx).toBe(50_000);
    expect(report.rows[0]!.grossSalesCogsUgx).toBe(20_000);
    expect(report.rows[0]!.allocationEvidenceIncomplete).toBe(true);
    expect(report.rows[0]!.reconciliation).toBe("unknown");
    expect(report.unallocatedPortions).toBe(5);
    expect(report.inconsistentAllocationLineCount).toBe(1);
  });

  it("treats allocations to unknown batch ids as unreconciled, not sold", () => {
    const cleanBatch = batch({
      id: "batch-clean",
      preparedAt: "2026-06-02T09:00:00.000Z",
      portionsPrepared: 10,
      remainingPortions: 10,
      wastedPortions: 0,
    });
    const ghostSale = sale({
      id: "sale-ghost",
      totalUgx: 20_000,
      lines: [
        line({
          id: "line-ghost",
          productId: "dish",
          name: "Chicken plate",
          quantity: 2,
          cogsUgx: 8_000,
          netRevenueUgx: 20_000,
          grossProfitUgx: 12_000,
          estimatedProfitUgx: 12_000,
          prepAllocation: [{ batchId: "ghost-batch", portions: 2 }],
        }),
      ],
    });
    const report = reportFor([dishWith([cleanBatch])], [ghostSale], [], []);

    expect(report.rows[0]!.soldPortionsGross).toBe(0);
    expect(report.rows[0]!.reconciliation).toBe("unknown");
    expect(report.unallocatedPortions).toBe(2);
    expect(report.inconsistentAllocationLineCount).toBe(1);
  });

  it("flags returns without a recorded COGS reversal instead of treating it as zero", () => {
    const returnWithoutCogs = ret({
      id: "return-no-cogs",
      saleId: "sale-a",
      saleLineId: "line-a",
      productId: "dish",
      quantity: 2,
      refundAmountUgx: 20_000,
    });
    const report = reportFor(
      [dishWith([batchA, batchB, batchC])],
      [saleA, saleC],
      [returnWithoutCogs],
      [cancelEvent("cancel-c", "batch-c", 2)],
    );

    expect(report.missingReturnCogsCount).toBe(1);
    expect(report.rows.find((row) => row.batchId === "batch-b")!.returnCogsUgx).toBe(0);
    expect(report.rows.find((row) => row.batchId === "batch-b")!.salesCogsUgx).toBe(16_000);
  });

  it("reports a return whose sale is absent as unattributed", () => {
    const orphanReturn = ret({
      id: "return-orphan",
      saleId: "missing-sale",
      productId: "dish",
      quantity: 1,
      refundAmountUgx: 10_000,
      cogsUgx: 4_000,
    });
    const report = reportFor([dishWith([batchA])], [], [orphanReturn], []);

    expect(report.unattributedReturnCount).toBe(1);
    expect(report.rows[0]!.allocationEvidenceIncomplete).toBe(true);
    expect(report.rows[0]!.reconciliation).toBe("unknown");
  });

  it("nets returns from unallocated sales when a line has no allocation", () => {
    const noAllocationSale = sale({
      id: "sale-no-allocation-return",
      lines: [
        line({
          id: "line-no-allocation-return",
          productId: "dish",
          name: "Chicken plate",
          quantity: 2,
          cogsUgx: 8_000,
          netRevenueUgx: 20_000,
          grossProfitUgx: 12_000,
          estimatedProfitUgx: 12_000,
        }),
      ],
    });
    const returnRecord = ret({
      id: "return-no-allocation",
      saleId: "sale-no-allocation-return",
      saleLineId: "line-no-allocation-return",
      productId: "dish",
      quantity: 1,
      refundAmountUgx: 10_000,
      cogsUgx: 4_000,
    });
    const report = reportFor(
      [dishWith([batchA])],
      [noAllocationSale],
      [returnRecord],
      [],
    );

    expect(report.unallocatedSalesRevenueUgx).toBe(10_000);
    expect(report.unallocatedSalesCogsUgx).toBe(4_000);
    expect(report.rows[0]!.reconciliation).toBe("unknown");
  });
});
