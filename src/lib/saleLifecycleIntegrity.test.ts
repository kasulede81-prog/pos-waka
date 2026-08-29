import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, SaleLine } from "../types";
import { getCashDrawerSalesInput } from "./cashDrawerSales";
import { getCompletedRevenue } from "./financialMetrics";
import { dateKeyKampala } from "./datesUg";
import { resolveDraftFromPersisted, type PersistedDraftV1 } from "../offline/draftStorage";
import {
  resolveCartAbandon,
  resolvePersistedDraftSaleBinding,
  resolveRemoveDraftLine,
  resumeWouldOverwriteUnrelatedCart,
} from "./saleLifecycle";
import { isPreCompletionVoidedSale, isRevenueSale, isCancelledPendingSale } from "./saleStatus";
import { usePosStore } from "../store/usePosStore";
import { emptyHospitalityFloor } from "./hospitality";
import { openTestShift } from "../test/shiftTestSetup";
import { deleteKv } from "../offline/localDb";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Soap",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 3_000,
  stockOnHand: 20,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const draftLine: SaleLine = {
  id: "line-1",
  productId: PRODUCT_ID,
  name: "Soap",
  inputMode: "quantity",
  quantity: 2,
  unitPriceUgx: 10_000,
  unitCostUgx: 3_000,
  lineTotalUgx: 20_000,
  estimatedProfitUgx: 14_000,
  updatedAt: "2026-06-02T10:00:00.000Z",
};

function snapshotIntegrity() {
  const s = usePosStore.getState();
  return {
    stock: s.products.find((p) => p.id === PRODUCT_ID)?.stockOnHand ?? 0,
    sales: s.sales.length,
    completed: s.sales.filter((x) => x.status === "completed").length,
    pending: s.sales.filter((x) => x.status === "pending").length,
    movements: s.stockMovements.length,
    debt: s.customers.find((c) => c.id === CUSTOMER_ID)?.debtBalanceUgx ?? 0,
    cashShift: s.preferences.shifts?.[0]?.estimatedCashUgx ?? 0,
    saleOut: s.stockMovements.filter((m) => m.kind === "sale_out").length,
    voidAdjust: s.stockMovements.filter((m) => m.kind === "adjust_other").length,
  };
}

function seedRetailCart(extra?: Record<string, unknown>) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products: [{ ...baseProduct }],
    customers: [
      {
        id: CUSTOMER_ID,
        name: "Jane",
        phone: "0700000000",
        location: "",
        debtBalanceUgx: 0,
        createdAt: "2026-06-01T08:00:00.000Z",
        version: 1,
      },
    ],
    sales: [],
    stockMovements: [],
    archivedStockMovements: [],
    voidRecords: [],
    archivedVoidRecords: [],
    draftLines: [draftLine],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    draftInput: null,
    draftSaleCustomerId: "",
    draftSaleCustomerName: "",
    draftSaleCustomerPhone: "",
    draftPaymentMethod: "cash",
    ...extra,
  });
  expect(openTestShift().ok).toBe(true);
}

describe("sale lifecycle integrity", () => {
  beforeEach(() => {
    seedRetailCart();
  });

  it("cart add does not change stock, revenue, cash, debt, movements, or sales", () => {
    seedRetailCart({ draftLines: [] });
    const before = snapshotIntegrity();
    usePosStore.getState().setDraftInput({
      product: usePosStore.getState().products[0]!,
      inputMode: "quantity",
      value: 1,
    });
    const added = usePosStore.getState().addDraftLineFromInput();
    expect(added.ok).toBe(true);
    expect(usePosStore.getState().draftLines.length).toBe(1);
    expect(snapshotIntegrity()).toEqual(before);
  });

  it("clear cart does not modify completed history", () => {
    const complete = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(complete.ok).toBe(true);
    seedRetailCart({
      sales: usePosStore.getState().sales,
      products: usePosStore.getState().products,
      stockMovements: usePosStore.getState().stockMovements,
      draftLines: [draftLine],
    });
    const before = usePosStore.getState().sales.filter((s) => s.status === "completed").map((s) => s.id);
    usePosStore.getState().clearDraft();
    expect(usePosStore.getState().draftLines).toHaveLength(0);
    expect(usePosStore.getState().activePendingSaleId).toBeNull();
    expect(usePosStore.getState().sales.filter((s) => s.status === "completed").map((s) => s.id)).toEqual(before);
  });

  it("save pending has zero stock, revenue, cash, debt, or movement effect", () => {
    const before = snapshotIntegrity();
    const save = usePosStore.getState().savePendingSale("Hold");
    expect(save.ok).toBe(true);
    const after = snapshotIntegrity();
    expect(after.stock).toBe(before.stock);
    expect(after.movements).toBe(before.movements);
    expect(after.debt).toBe(before.debt);
    expect(after.cashShift).toBe(before.cashShift);
    expect(after.pending).toBe(1);
    expect(after.completed).toBe(0);
    const held = usePosStore.getState().sales.find((s) => s.id === save.saleId)!;
    expect(isRevenueSale(held)).toBe(false);
    expect(getCompletedRevenue(usePosStore.getState().sales, [], usePosStore.getState().products, dateKeyKampala(held.createdAt))).toBe(0);
  });

  it("resume preserves pending id with no financial or inventory effect", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    const before = snapshotIntegrity();
    const resume = usePosStore.getState().resumePendingSale(save.saleId!);
    expect(resume.ok).toBe(true);
    expect(usePosStore.getState().activePendingSaleId).toBe(save.saleId);
    expect(snapshotIntegrity()).toEqual(before);
  });

  it("refuses resume when an unrelated unsaved cart exists, but allows a restored cart bound to P", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    usePosStore.setState({ draftLines: [draftLine], activePendingSaleId: null });
    expect(usePosStore.getState().resumePendingSale(save.saleId!).ok).toBe(false);
    expect(
      resumeWouldOverwriteUnrelatedCart({
        draftLineCount: 1,
        activePendingSaleId: save.saleId,
        resumeSaleId: save.saleId!,
      }),
    ).toBe(false);
    usePosStore.setState({ draftLines: [draftLine], activePendingSaleId: save.saleId! });
    expect(usePosStore.getState().resumePendingSale(save.saleId!).ok).toBe(true);
  });

  it("cancel pending stamps VOIDED history on the same sale with no inventory reversal", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    const before = snapshotIntegrity();
    expect(usePosStore.getState().cancelPendingSale(save.saleId!).ok).toBe(true);
    const after = snapshotIntegrity();
    const held = usePosStore.getState().sales.find((s) => s.id === save.saleId);
    expect(held?.status).toBe("cancelled");
    expect(isPreCompletionVoidedSale(held!)).toBe(true);
    expect(isCancelledPendingSale(held!)).toBe(false);
    expect(usePosStore.getState().sales.filter((s) => s.id === save.saleId)).toHaveLength(1);
    expect(after.stock).toBe(before.stock);
    expect(after.movements).toBe(before.movements);
    expect(after.debt).toBe(before.debt);
    expect(after.cashShift).toBe(before.cashShift);
    expect(after.pending).toBe(0);
    expect(after.sales).toBe(before.sales);
  });

  it("draft restore keeps activePendingSaleId and finalize completes P without creating C", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    expect(usePosStore.getState().resumePendingSale(save.saleId!).ok).toBe(true);
    usePosStore.getState().adjustDraftLineQuantity(PRODUCT_ID, 1);
    const persisted: PersistedDraftV1 = {
      v: 2,
      draftLines: usePosStore.getState().draftLines,
      draftInput: null,
      activePendingSaleId: usePosStore.getState().activePendingSaleId,
      draftPaymentMethod: "mobile_money",
      draftSaleCustomerName: "Jane",
    };
    const resolved = resolveDraftFromPersisted(persisted, usePosStore.getState().products);
    const bound = resolvePersistedDraftSaleBinding(
      usePosStore.getState().sales,
      resolved.activePendingSaleId,
      true,
    );
    usePosStore.setState({
      draftLines: resolved.draftLines,
      activePendingSaleId: bound,
      draftPaymentMethod: resolved.draftPaymentMethod,
      draftSaleCustomerName: resolved.draftSaleCustomerName,
    });
    expect(usePosStore.getState().activePendingSaleId).toBe(save.saleId);
    expect(resolved.draftPaymentMethod).toBe("mobile_money");
    expect(resolved.draftSaleCustomerName).toBe("Jane");

    const beforeStock = snapshotIntegrity().stock;
    const r = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(r.ok).toBe(true);
    expect(r.saleId).toBe(save.saleId);
    const sales = usePosStore.getState().sales;
    expect(sales.filter((s) => s.status === "completed")).toHaveLength(1);
    expect(sales.find((s) => s.id === save.saleId)?.status).toBe("completed");
    expect(sales.filter((s) => s.id !== save.saleId && s.status === "completed")).toHaveLength(0);
    expect(snapshotIntegrity().stock).toBe(beforeStock - 3);
  });

  it("completing a pending sale is idempotent and cannot deduct stock or debt twice", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    usePosStore.getState().resumePendingSale(save.saleId!);
    const first = usePosStore.getState().finalizeDraftSale({
      debtUgx: 5_000,
      customerId: CUSTOMER_ID,
      customerName: "Jane",
      paymentMethod: "credit",
    });
    expect(first.ok).toBe(true);
    const afterFirst = snapshotIntegrity();
    expect(afterFirst.stock).toBe(18);
    expect(afterFirst.debt).toBe(5_000);
    expect(afterFirst.saleOut).toBe(1);
    expect(afterFirst.completed).toBe(1);

    usePosStore.setState({
      draftLines: [draftLine],
      activePendingSaleId: save.saleId!,
    });
    const second = usePosStore.getState().finalizeDraftSale({
      debtUgx: 5_000,
      customerId: CUSTOMER_ID,
      customerName: "Jane",
      paymentMethod: "credit",
    });
    expect(second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(second.saleId).toBe(save.saleId);
    expect(snapshotIntegrity()).toEqual({ ...afterFirst, sales: afterFirst.sales });
    expect(usePosStore.getState().sales.filter((s) => s.status === "completed")).toHaveLength(1);
  });

  it("stale pending reference cannot create a new sale", () => {
    usePosStore.setState({ activePendingSaleId: "missing-pending-id" });
    const before = snapshotIntegrity();
    const r = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("stalePendingCannotComplete");
    expect(snapshotIntegrity()).toEqual(before);
  });

  it("cancelled pending cannot be completed", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    usePosStore.getState().cancelPendingSale(save.saleId!);
    usePosStore.setState({ draftLines: [draftLine], activePendingSaleId: save.saleId! });
    const r = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("saleCancelledCannotComplete");
    expect(snapshotIntegrity().stock).toBe(20);
    expect(snapshotIntegrity().completed).toBe(0);
  });

  it("device B seeing completed P ACKs without a second stock or debt effect", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    usePosStore.getState().resumePendingSale(save.saleId!);
    expect(usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);
    const afterA = snapshotIntegrity();
    usePosStore.setState({
      draftLines: [draftLine],
      activePendingSaleId: save.saleId!,
    });
    const b = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(b.idempotent).toBe(true);
    expect(snapshotIntegrity()).toEqual(afterA);
  });

  it("pending sale cannot be line-voided at store level", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    const before = snapshotIntegrity();
    const r = usePosStore.getState().voidSaleLine({
      saleId: save.saleId!,
      lineIndex: 0,
      reason: "other",
    });
    expect(r.ok).toBe(false);
    expect(snapshotIntegrity()).toEqual(before);
  });

  it("completed line void restores stock once and replay is rejected", () => {
    const complete = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(complete.ok).toBe(true);
    const saleId = complete.saleId!;
    const first = usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "other" });
    expect(first.ok).toBe(true);
    expect(snapshotIntegrity().stock).toBe(20);
    expect(snapshotIntegrity().voidAdjust).toBe(1);
    const second = usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "other" });
    expect(second.ok).toBe(false);
    expect(snapshotIntegrity().stock).toBe(20);
    expect(snapshotIntegrity().voidAdjust).toBe(1);
  });

  it("clear of a resumed pending sale leaves the pending sale unchanged", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    usePosStore.getState().resumePendingSale(save.saleId!);
    usePosStore.getState().adjustDraftLineQuantity(PRODUCT_ID, 1);
    usePosStore.getState().clearDraft();
    const held = usePosStore.getState().sales.find((s) => s.id === save.saleId);
    expect(held?.status).toBe("pending");
    expect(held?.lines[0]?.quantity).toBe(2);
    expect(usePosStore.getState().activePendingSaleId).toBeNull();
    expect(usePosStore.getState().draftLines).toHaveLength(0);
  });

  it("void unsaved cart persists a VOIDED history record with no stock, cash, debt, revenue, or movement change", async () => {
    const before = snapshotIntegrity();
    const saleVoidAudits = usePosStore.getState().auditLogs.filter((a) => a.action === "sale_void").length;
    vi.mocked(deleteKv).mockClear();
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("unsaved");
    expect(res.saleId).toBeTruthy();
    expect(usePosStore.getState().draftLines).toHaveLength(0);
    expect(usePosStore.getState().activePendingSaleId).toBeNull();
    const record = usePosStore.getState().sales.find((s) => s.id === res.saleId);
    expect(record).toBeTruthy();
    expect(isPreCompletionVoidedSale(record!)).toBe(true);
    expect(record!.lines).toHaveLength(1);
    expect(record!.lines[0]?.quantity).toBe(2);
    expect(record!.totalUgx).toBe(20_000);
    expect(record!.saleVoidedByUserId).toBe("owner:1");
    expect(record!.saleVoidedByLabel).toBe("Owner");
    expect(record!.saleVoidedAt).toBeTruthy();
    expect(record!.receiptSeq).toBeUndefined();
    expect(isRevenueSale(record!)).toBe(false);
    const after = snapshotIntegrity();
    expect(after.stock).toBe(before.stock);
    expect(after.movements).toBe(before.movements);
    expect(after.saleOut).toBe(before.saleOut);
    expect(after.voidAdjust).toBe(before.voidAdjust);
    expect(after.debt).toBe(before.debt);
    expect(after.cashShift).toBe(before.cashShift);
    expect(after.completed).toBe(before.completed);
    expect(after.pending).toBe(before.pending);
    expect(after.sales).toBe(before.sales + 1);
    expect(getCompletedRevenue(usePosStore.getState().sales, [], usePosStore.getState().products, dateKeyKampala(record!.createdAt))).toBe(0);
    expect(getCashDrawerSalesInput(usePosStore.getState().sales, dateKeyKampala(record!.createdAt)).cashSalesUgx).toBe(0);
    expect(usePosStore.getState().auditLogs.filter((a) => a.action === "sale_void")).toHaveLength(saleVoidAudits);
    await Promise.resolve();
    expect(deleteKv).toHaveBeenCalled();
  });

  it("void of a resumed pending sale cancels the pending record with no stock reversal", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    usePosStore.getState().resumePendingSale(save.saleId!);
    const before = snapshotIntegrity();
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("pending");
    const held = usePosStore.getState().sales.find((s) => s.id === save.saleId);
    expect(held?.status).toBe("cancelled");
    expect(isPreCompletionVoidedSale(held!)).toBe(true);
    expect(isCancelledPendingSale(held!)).toBe(false);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(1);
    expect(usePosStore.getState().sales.filter((s) => s.id === save.saleId)).toHaveLength(1);
    expect(snapshotIntegrity().stock).toBe(before.stock);
    expect(snapshotIntegrity().movements).toBe(before.movements);
    expect(snapshotIntegrity().debt).toBe(before.debt);
    expect(snapshotIntegrity().cashShift).toBe(before.cashShift);
    expect(usePosStore.getState().draftLines).toHaveLength(0);
    expect(usePosStore.getState().activePendingSaleId).toBeNull();
  });

  it("void pending without pending_sales.manage does not clear the cart or cancel the sale", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    usePosStore.getState().resumePendingSale(save.saleId!);
    usePosStore.setState({
      sessionActor: {
        userId: "cashier:1",
        role: "cashier",
        displayName: "Cashier",
        authRole: "cashier",
        authPermissions: ["pos.sell"],
      },
    });
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("pending");
    expect(usePosStore.getState().activePendingSaleId).toBe(save.saleId);
    expect(usePosStore.getState().draftLines.length).toBeGreaterThan(0);
    expect(usePosStore.getState().sales.find((s) => s.id === save.saleId)?.status).toBe("pending");
  });

  it("unsaved cart void never restocks via completed-sale voidSaleLine", () => {
    const beforeStock = snapshotIntegrity().stock;
    usePosStore.getState().voidCurrentCart();
    seedRetailCart({ draftLines: [draftLine], sales: usePosStore.getState().sales });
    const complete = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(complete.ok).toBe(true);
    expect(snapshotIntegrity().stock).toBe(beforeStock - 2);
    const voided = usePosStore.getState().voidSaleLine({
      saleId: complete.saleId!,
      lineIndex: 0,
      reason: "other",
    });
    expect(voided.ok).toBe(true);
    expect(snapshotIntegrity().stock).toBe(beforeStock);
  });

  it("whole hospitality bill void reverses stock/cash/debt once and is excluded from revenue and drawer", () => {
    const complete = usePosStore.getState().finalizeDraftSale({
      debtUgx: 5_000,
      customerId: CUSTOMER_ID,
      customerName: "Jane",
      paymentMethod: "credit",
    });
    expect(complete.ok).toBe(true);
    const saleId = complete.saleId!;
    const sessionId = "table-session-1";
    const sale = usePosStore.getState().sales.find((s) => s.id === saleId)!;
    const floor = emptyHospitalityFloor();
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        hospitalityFloor: {
          ...floor,
          sessions: [
            {
              id: sessionId,
              saleId,
              guestCount: 2,
              status: "closed",
              openedAt: sale.createdAt,
              closedAt: sale.createdAt,
            },
          ],
        },
      },
    });
    const day = dateKeyKampala(sale.createdAt);
    expect(isRevenueSale(sale)).toBe(true);
    const first = usePosStore.getState().voidSettledTableBill({
      sessionId,
      reason: "wrong table",
      managerPin: "",
    });
    expect(first.ok).toBe(true);
    const voided = usePosStore.getState().sales.find((s) => s.id === saleId)!;
    expect(isRevenueSale(voided)).toBe(false);
    expect(snapshotIntegrity().stock).toBe(20);
    expect(snapshotIntegrity().debt).toBe(0);
    expect(getCompletedRevenue(usePosStore.getState().sales, [], usePosStore.getState().products, day)).toBe(0);
    expect(getCashDrawerSalesInput(usePosStore.getState().sales, day).cashSalesUgx).toBe(0);

    const second = usePosStore.getState().voidSettledTableBill({
      sessionId,
      reason: "wrong table",
      managerPin: "",
    });
    expect(second.ok).toBe(false);
    expect(snapshotIntegrity().stock).toBe(20);
    expect(snapshotIntegrity().debt).toBe(0);
    expect(snapshotIntegrity().voidAdjust).toBe(1);
  });

  it("double void of an unsaved cart does not duplicate the historical record", () => {
    const first = usePosStore.getState().voidCurrentCart();
    expect(first.ok).toBe(true);
    expect(first.saleId).toBeTruthy();
    const second = usePosStore.getState().voidCurrentCart();
    expect(second.ok).toBe(true);
    expect(second.noop).toBe(true);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(1);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)[0]?.id).toBe(first.saleId);
  });

  it("empty cart void is a no-op and does not create a history record", () => {
    seedRetailCart({ draftLines: [] });
    const before = snapshotIntegrity();
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    expect(res.noop).toBe(true);
    expect(snapshotIntegrity()).toEqual(before);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(0);
  });

  it("unsaved cart void does not require sale_void", () => {
    usePosStore.setState({
      sessionActor: {
        userId: "cashier:1",
        role: "cashier",
        displayName: "Sarah",
        authRole: "cashier",
        authPermissions: ["pos.sell"],
      },
    });
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("unsaved");
    const record = usePosStore.getState().sales.find((s) => s.id === res.saleId);
    expect(isPreCompletionVoidedSale(record!)).toBe(true);
    expect(record!.saleVoidedByLabel).toBe("Sarah");
  });

  it("Clear of a non-empty unsaved cart is confirm_void; Keep leaves the cart untouched", () => {
    const beforeLines = usePosStore.getState().draftLines.map((l) => ({ ...l }));
    const decision = resolveCartAbandon({
      draftLineCount: beforeLines.length,
      activePendingSaleId: usePosStore.getState().activePendingSaleId,
      intent: "clear",
    });
    expect(decision.kind).toBe("confirm_void");
    expect(usePosStore.getState().draftLines).toHaveLength(beforeLines.length);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(0);
  });

  it("confirmed Clear of an unsaved cart persists VOIDED history and empties the cart", () => {
    const decision = resolveCartAbandon({
      draftLineCount: usePosStore.getState().draftLines.length,
      activePendingSaleId: null,
      intent: "clear",
    });
    expect(decision.kind).toBe("confirm_void");
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    expect(usePosStore.getState().draftLines).toHaveLength(0);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(1);
  });

  it("empty cart Clear/Leave is a no-op: no confirmation path and no VOIDED record", () => {
    seedRetailCart({ draftLines: [] });
    expect(resolveCartAbandon({ draftLineCount: 0, activePendingSaleId: null, intent: "clear" }).kind).toBe("noop");
    expect(resolveCartAbandon({ draftLineCount: 0, activePendingSaleId: null, intent: "leave" }).kind).toBe("noop");
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(0);
  });

  it("Leave of an unsaved cart is confirm_void; confirmed Leave voids then can continue navigation", () => {
    const decision = resolveCartAbandon({
      draftLineCount: usePosStore.getState().draftLines.length,
      activePendingSaleId: null,
      intent: "leave",
    });
    expect(decision.kind).toBe("confirm_void");
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    expect(usePosStore.getState().draftLines).toHaveLength(0);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(1);
  });

  it("Leave of a resumed pending sale discards local edits only — no extra VOIDED record", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    usePosStore.getState().resumePendingSale(save.saleId!);
    usePosStore.getState().adjustDraftLineQuantity(PRODUCT_ID, 1);
    const decision = resolveCartAbandon({
      draftLineCount: usePosStore.getState().draftLines.length,
      activePendingSaleId: usePosStore.getState().activePendingSaleId,
      intent: "leave",
    });
    expect(decision.kind).toBe("discard_pending_edits");
    usePosStore.getState().clearDraft();
    const held = usePosStore.getState().sales.find((s) => s.id === save.saleId);
    expect(held?.status).toBe("pending");
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(0);
    expect(usePosStore.getState().draftLines).toHaveLength(0);
  });

  it("Clear of a resumed pending sale cancels pending and does not add a second history row", () => {
    const save = usePosStore.getState().savePendingSale("Hold");
    usePosStore.getState().resumePendingSale(save.saleId!);
    const decision = resolveCartAbandon({
      draftLineCount: usePosStore.getState().draftLines.length,
      activePendingSaleId: usePosStore.getState().activePendingSaleId,
      intent: "clear",
    });
    expect(decision.kind).toBe("confirm_void");
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("pending");
    expect(usePosStore.getState().sales.find((s) => s.id === save.saleId)?.status).toBe("cancelled");
    expect(isPreCompletionVoidedSale(usePosStore.getState().sales.find((s) => s.id === save.saleId)!)).toBe(true);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(1);
    expect(usePosStore.getState().sales.filter((s) => s.id === save.saleId)).toHaveLength(1);
  });

  it("preserves discounted cart snapshot on unsaved VOIDED history", () => {
    seedRetailCart({
      draftCartDiscountUgx: 2_000,
      draftSaleCustomerName: "Jane",
      draftSaleCustomerPhone: "0700000000",
      draftPaymentMethod: "credit",
    });
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    const record = usePosStore.getState().sales.find((s) => s.id === res.saleId)!;
    expect(record.totalUgx).toBe(18_000);
    expect(record.discountTotalUgx).toBe(2_000);
    expect(record.receiptCustomerName).toBe("Jane");
    expect(record.receiptCustomerPhone).toBe("0700000000");
    expect(record.paymentMethod).toBe("credit");
    expect(record.lines[0]?.quantity).toBe(2);
  });

  it("missing VOIDED persist after commit restores the cart and does not leave a history row", () => {
    const beforeLines = usePosStore.getState().draftLines.length;
    const unsub = usePosStore.subscribe((state, prev) => {
      if (state.sales.length > prev.sales.length) {
        const added = state.sales.find((s) => !prev.sales.some((p) => p.id === s.id));
        if (added) usePosStore.setState({ sales: state.sales.filter((s) => s.id !== added.id) });
      }
    });
    const res = usePosStore.getState().voidCurrentCart();
    unsub();
    expect(res.ok).toBe(false);
    expect(usePosStore.getState().draftLines).toHaveLength(beforeLines);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(0);
  });

  it("in-flight Clear + Leave race does not duplicate the VOIDED record", () => {
    let raced: { ok: boolean; kind?: string; errorKey?: string; noop?: boolean } | null = null;
    const unsub = usePosStore.subscribe((state, prev) => {
      if (state.sales.length > prev.sales.length && state.draftLines.length === 0) {
        raced = usePosStore.getState().voidCurrentCart();
      }
    });
    const first = usePosStore.getState().voidCurrentCart();
    unsub();
    expect(first.ok).toBe(true);
    expect(raced).toBeTruthy();
    expect(raced!.ok === false || raced!.noop === true).toBe(true);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(1);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)[0]?.id).toBe(first.saleId);
  });

  it("last cart-line ✕ is Void confirmation; Keep leaves the line; confirm writes VOIDED history", () => {
    expect(
      resolveRemoveDraftLine({
        draftLines: usePosStore.getState().draftLines,
        productId: PRODUCT_ID,
      }),
    ).toBe("confirm_void");
    expect(usePosStore.getState().draftLines).toHaveLength(1);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(0);
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    expect(usePosStore.getState().draftLines).toHaveLength(0);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(1);
  });

  it("✕ on a non-last line removes only that line and does not create VOIDED history", () => {
    seedRetailCart({
      draftLines: [draftLine, { ...draftLine, id: "line-2", productId: "other-prod", name: "Bread", lineTotalUgx: 5_000 }],
    });
    expect(
      resolveRemoveDraftLine({
        draftLines: usePosStore.getState().draftLines,
        productId: PRODUCT_ID,
      }),
    ).toBe("remove_line");
    usePosStore.getState().removeDraftLine(PRODUCT_ID);
    expect(usePosStore.getState().draftLines.map((l) => l.productId)).toEqual(["other-prod"]);
    expect(usePosStore.getState().sales.filter(isPreCompletionVoidedSale)).toHaveLength(0);
  });
});
