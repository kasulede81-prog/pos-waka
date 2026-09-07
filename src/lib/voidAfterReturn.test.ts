import { beforeEach, describe, expect, it } from "vitest";
import type { Customer, Product, ReturnRecord, Sale, SaleLine } from "../types";
import { remainingVoidableLine } from "./returnLimits";
import { r3SaleVoidStockPayload } from "./stockDurableSync";
import { planWholeBillVoid } from "./voidCompletedSale";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";

const PRODUCT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function line(productId: string, quantity: number, lineTotalUgx: number): SaleLine {
  return {
    id: `line-${productId}`,
    productId,
    name: productId,
    inputMode: "quantity",
    quantity,
    unitPriceUgx: lineTotalUgx / quantity,
    unitCostUgx: 2_000,
    lineTotalUgx,
    estimatedProfitUgx: lineTotalUgx - quantity * 2_000,
    updatedAt: "2026-06-02T10:00:00.000Z",
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "totalUgx" | "lines">): Sale {
  const debt = partial.debtUgx ?? 0;
  return {
    id: SALE_ID,
    status: "completed",
    createdAt: "2026-06-02T10:00:00.000Z",
    updatedAt: "2026-06-02T10:00:00.000Z",
    subtotalUgx: partial.lines.reduce((a, l) => a + l.lineTotalUgx, 0),
    cashPaidUgx: partial.cashPaidUgx ?? Math.max(0, partial.totalUgx - debt),
    debtUgx: debt,
    estimatedProfitUgx: partial.estimatedProfitUgx ?? 20_000,
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

function ret(productId: string, quantity: number, refundAmountUgx: number, reason: ReturnRecord["reason"] = "wrong_item"): ReturnRecord {
  return {
    id: crypto.randomUUID(),
    saleId: SALE_ID,
    productId,
    productName: productId,
    quantity,
    refundAmountUgx,
    reason,
    actorUserId: "u1",
    createdAt: "2026-06-02T11:00:00.000Z",
  };
}

function product(id: string, stockOnHand: number): Product {
  return {
    id,
    name: id,
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 2_000,
    stockOnHand,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 2,
    updatedAt: "2026-06-02T09:00:00.000Z",
    version: 1,
  };
}

function customer(debtBalanceUgx: number): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Jane",
    phone: "",
    location: "",
    debtBalanceUgx,
    createdAt: "2026-06-02T08:00:00.000Z",
    version: 1,
  };
}

describe("SALES-VOID-01 remainingVoidableLine", () => {
  it("CASE A — no return leaves the full line voidable", () => {
    const s = sale({ totalUgx: 50_000, lines: [line(PRODUCT_A, 5, 50_000)] });
    expect(remainingVoidableLine(s, PRODUCT_A, [])).toEqual({ quantity: 5, amountUgx: 50_000 });
  });

  it("CASE B — partial return leaves remaining qty and remaining paid value", () => {
    const s = sale({ totalUgx: 40_000, cashPaidUgx: 40_000, lines: [line(PRODUCT_A, 5, 50_000)] });
    const remaining = remainingVoidableLine(s, PRODUCT_A, [ret(PRODUCT_A, 1, 10_000)]);
    expect(remaining.quantity).toBe(4);
    expect(remaining.amountUgx).toBe(40_000);
  });

  it("CASE C — full return leaves nothing to void", () => {
    const s = sale({ totalUgx: 0, cashPaidUgx: 0, lines: [line(PRODUCT_A, 5, 50_000)] });
    expect(remainingVoidableLine(s, PRODUCT_A, [ret(PRODUCT_A, 5, 50_000)])).toEqual({
      quantity: 0,
      amountUgx: 0,
    });
  });

  it("CASE D — multiple partial returns leave the remainder", () => {
    const s = sale({ totalUgx: 50_000, lines: [line(PRODUCT_A, 10, 100_000)] });
    const remaining = remainingVoidableLine(s, PRODUCT_A, [
      ret(PRODUCT_A, 2, 20_000),
      ret(PRODUCT_A, 3, 30_000),
    ]);
    expect(remaining.quantity).toBe(5);
    expect(remaining.amountUgx).toBe(50_000);
  });

  it("uses stored refund amounts, not a blind proportional remainder", () => {
    const s = sale({ totalUgx: 42_000, cashPaidUgx: 42_000, lines: [line(PRODUCT_A, 5, 50_000)] });
    const remaining = remainingVoidableLine(s, PRODUCT_A, [ret(PRODUCT_A, 1, 8_000)]);
    expect(remaining.quantity).toBe(4);
    expect(remaining.amountUgx).toBe(42_000);
  });

  it("CASE I — returns on A do not change B", () => {
    const s = sale({
      totalUgx: 64_000,
      lines: [line(PRODUCT_A, 5, 50_000), line(PRODUCT_B, 3, 30_000)],
    });
    const returns = [ret(PRODUCT_A, 2, 16_000)];
    expect(remainingVoidableLine(s, PRODUCT_A, returns).quantity).toBe(3);
    expect(remainingVoidableLine(s, PRODUCT_B, returns).quantity).toBe(3);
  });
});

describe("SALES-VOID-01 planWholeBillVoid", () => {
  it("CASE A — no return restocks the full line", () => {
    const planned = planWholeBillVoid({
      sale: sale({ totalUgx: 50_000, lines: [line(PRODUCT_A, 5, 50_000)] }),
      products: [product(PRODUCT_A, 10)],
      customers: [customer(0)],
      shopKey: "shop:test",
      at: "2026-06-02T12:00:00.000Z",
      reason: "other",
      note: "void",
      actorUserId: "owner:1",
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.products[0]!.stockOnHand).toBe(15);
    expect(planned.plan.movements[0]!.deltaBaseUnits).toBe(5);
    expect(planned.plan.voidRecords[0]!.quantity).toBe(5);
    expect(planned.plan.amountVoidedUgx).toBe(50_000);
  });

  it("CASE B — void after return restocks only the remainder", () => {
    const planned = planWholeBillVoid({
      sale: sale({ totalUgx: 40_000, cashPaidUgx: 40_000, lines: [line(PRODUCT_A, 5, 50_000)] }),
      products: [product(PRODUCT_A, 11)],
      customers: [customer(0)],
      shopKey: "shop:test",
      at: "2026-06-02T12:00:00.000Z",
      reason: "other",
      note: "void",
      actorUserId: "owner:1",
      returnRecords: [ret(PRODUCT_A, 1, 10_000, "wrong_item")],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.products[0]!.stockOnHand).toBe(15);
    expect(planned.plan.movements[0]!.deltaBaseUnits).toBe(4);
    expect(planned.plan.voidRecords[0]!.quantity).toBe(4);
    expect(planned.plan.voidRecords[0]!.amountUgx).toBe(40_000);
    expect(1 + planned.plan.movements[0]!.deltaBaseUnits).toBe(5);
  });

  it("CASE C — full return does not restock again", () => {
    const planned = planWholeBillVoid({
      sale: sale({ totalUgx: 0, cashPaidUgx: 0, lines: [line(PRODUCT_A, 5, 50_000)] }),
      products: [product(PRODUCT_A, 15)],
      customers: [customer(0)],
      shopKey: "shop:test",
      at: "2026-06-02T12:00:00.000Z",
      reason: "other",
      note: "void",
      actorUserId: "owner:1",
      returnRecords: [ret(PRODUCT_A, 5, 50_000, "wrong_item")],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.products[0]!.stockOnHand).toBe(15);
    expect(planned.plan.movements).toHaveLength(0);
    expect(planned.plan.voidRecords).toHaveLength(0);
  });

  it("CASE J — damaged return still voids remaining qty only", () => {
    const planned = planWholeBillVoid({
      sale: sale({ totalUgx: 40_000, cashPaidUgx: 40_000, lines: [line(PRODUCT_A, 5, 50_000)] }),
      products: [product(PRODUCT_A, 10)],
      customers: [customer(0)],
      shopKey: "shop:test",
      at: "2026-06-02T12:00:00.000Z",
      reason: "other",
      note: "void",
      actorUserId: "owner:1",
      returnRecords: [ret(PRODUCT_A, 1, 10_000, "damaged")],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.movements[0]!.deltaBaseUnits).toBe(4);
    expect(planned.plan.products[0]!.stockOnHand).toBe(14);
  });

  it("CASE H — credit remainder reduces remaining debt only", () => {
    const planned = planWholeBillVoid({
      sale: sale({
        totalUgx: 40_000,
        cashPaidUgx: 0,
        debtUgx: 40_000,
        customerId: CUSTOMER_ID,
        lines: [line(PRODUCT_A, 5, 50_000)],
      }),
      products: [product(PRODUCT_A, 11)],
      customers: [customer(40_000)],
      shopKey: "shop:test",
      at: "2026-06-02T12:00:00.000Z",
      reason: "other",
      note: "void",
      actorUserId: "owner:1",
      returnRecords: [ret(PRODUCT_A, 1, 10_000)],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.sale.debtUgx).toBe(0);
    expect(planned.plan.customers[0]!.debtBalanceUgx).toBe(0);
    expect(planned.plan.voidRecords[0]!.amountUgx).toBe(40_000);
  });

  it("CASE G — mixed tender void applies remaining collected then remaining physical cash", () => {
    const planned = planWholeBillVoid({
      sale: sale({
        totalUgx: 70_000,
        cashPaidUgx: 35_000,
        debtUgx: 35_000,
        tenderCashUgx: 21_000,
        paymentMethod: "mixed",
        customerId: CUSTOMER_ID,
        lines: [line(PRODUCT_A, 10, 100_000)],
      }),
      products: [product(PRODUCT_A, 13)],
      customers: [customer(35_000)],
      shopKey: "shop:test",
      at: "2026-06-02T12:00:00.000Z",
      reason: "other",
      note: "void",
      actorUserId: "owner:1",
      returnRecords: [ret(PRODUCT_A, 3, 30_000)],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.movements[0]!.deltaBaseUnits).toBe(7);
    expect(planned.plan.sale.totalUgx).toBe(0);
    expect(planned.plan.sale.cashPaidUgx).toBe(0);
    expect(planned.plan.sale.debtUgx).toBe(0);
    expect(planned.plan.sale.tenderCashUgx).toBe(0);
  });

  it("queues the remaining quantity, not the original line quantity", () => {
    const payload = r3SaleVoidStockPayload({
      productId: PRODUCT_A,
      delta: remainingVoidableLine(
        sale({ totalUgx: 40_000, lines: [line(PRODUCT_A, 5, 50_000)] }),
        PRODUCT_A,
        [ret(PRODUCT_A, 1, 10_000)],
      ).quantity,
      voidRecordId: "void-1",
    });
    expect(payload.delta).toBe(4);
    expect(payload.referenceId).toBe("void-1");
  });
});

describe("SALES-VOID-01 voidSaleLine store path", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      products: [product(PRODUCT_A, 20), product(PRODUCT_B, 20)],
      customers: [customer(0)],
      sales: [],
      returnRecords: [],
      archivedReturnRecords: [],
      stockMovements: [],
      archivedStockMovements: [],
      voidRecords: [],
      archivedVoidRecords: [],
      draftLines: [line(PRODUCT_A, 5, 50_000)],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      draftInput: null,
      draftSaleCustomerId: "",
      draftSaleCustomerName: "",
      draftSaleCustomerPhone: "",
      draftPaymentMethod: "cash",
    });
    expect(openTestShift().ok).toBe(true);
  });

  it("CASE A — void without return restores the full sold qty", () => {
    const complete = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(complete.ok).toBe(true);
    const first = usePosStore.getState().voidSaleLine({
      saleId: complete.saleId!,
      lineIndex: 0,
      reason: "other",
    });
    expect(first.ok).toBe(true);
    expect(usePosStore.getState().products.find((p) => p.id === PRODUCT_A)?.stockOnHand).toBe(20);
    const movement = usePosStore.getState().stockMovements.find((m) => m.kind === "adjust_other");
    expect(movement?.deltaBaseUnits).toBe(5);
  });

  it("CASE B / J — wrong_item return then void restores only the remainder", () => {
    const complete = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    const saleId = complete.saleId!;
    const returned = usePosStore.getState().returnProduct({
      saleId,
      productId: PRODUCT_A,
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "wrong_item",
    });
    expect(returned.ok).toBe(true);
    const afterReturn = usePosStore.getState().products.find((p) => p.id === PRODUCT_A)!.stockOnHand;
    const voided = usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "other" });
    expect(voided.ok).toBe(true);
    const afterVoid = usePosStore.getState().products.find((p) => p.id === PRODUCT_A)!.stockOnHand;
    expect(afterVoid - afterReturn).toBe(4);
    expect(afterVoid).toBe(20);
    const voidRec = usePosStore.getState().voidRecords[0]!;
    expect(voidRec.quantity).toBe(4);
    expect(voidRec.amountUgx).toBe(40_000);
    expect(1 + voidRec.quantity).toBe(5);
  });

  it("CASE C — full return then void is rejected and does not restock", () => {
    const complete = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    const saleId = complete.saleId!;
    expect(
      usePosStore.getState().returnProduct({
        saleId,
        productId: PRODUCT_A,
        quantity: 5,
        refundAmountUgx: 50_000,
        reason: "wrong_item",
      }).ok,
    ).toBe(true);
    const stock = usePosStore.getState().products.find((p) => p.id === PRODUCT_A)!.stockOnHand;
    const voided = usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "other" });
    expect(voided.ok).toBe(false);
    expect(usePosStore.getState().products.find((p) => p.id === PRODUCT_A)?.stockOnHand).toBe(stock);
    expect(usePosStore.getState().voidRecords).toHaveLength(0);
  });

  it("CASE E — void then return remains blocked", () => {
    const complete = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    const saleId = complete.saleId!;
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "other" }).ok).toBe(true);
    const stock = usePosStore.getState().products.find((p) => p.id === PRODUCT_A)!.stockOnHand;
    const returned = usePosStore.getState().returnProduct({
      saleId,
      productId: PRODUCT_A,
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "wrong_item",
    });
    expect(returned.ok).toBe(false);
    expect(usePosStore.getState().products.find((p) => p.id === PRODUCT_A)?.stockOnHand).toBe(stock);
  });

  it("CASE F — repeated void remains blocked", () => {
    const complete = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    const saleId = complete.saleId!;
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "other" }).ok).toBe(true);
    const stock = usePosStore.getState().products.find((p) => p.id === PRODUCT_A)!.stockOnHand;
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "other" }).ok).toBe(false);
    expect(usePosStore.getState().products.find((p) => p.id === PRODUCT_A)?.stockOnHand).toBe(stock);
  });

  it("CASE J — damaged return then void restocks only remaining units", () => {
    const complete = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    const saleId = complete.saleId!;
    expect(
      usePosStore.getState().returnProduct({
        saleId,
        productId: PRODUCT_A,
        quantity: 1,
        refundAmountUgx: 10_000,
        reason: "damaged",
      }).ok,
    ).toBe(true);
    const afterReturn = usePosStore.getState().products.find((p) => p.id === PRODUCT_A)!.stockOnHand;
    expect(afterReturn).toBe(15);
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "other" }).ok).toBe(true);
    expect(usePosStore.getState().products.find((p) => p.id === PRODUCT_A)?.stockOnHand).toBe(19);
    expect(usePosStore.getState().voidRecords[0]!.quantity).toBe(4);
  });
});
