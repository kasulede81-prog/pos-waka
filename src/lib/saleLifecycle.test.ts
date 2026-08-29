import { describe, expect, it } from "vitest";
import type { Sale } from "../types";
import { t } from "./i18n";
import {
  buildUnsavedCartVoidedSale,
  markPendingSaleAsPreCompletionVoid,
  cartVoidCopyKeys,
  cartVoidKind,
  leaveSellConfirmKey,
  resolveCartAbandon,
  resolveDraftQtyChange,
  resolveRemoveDraftLine,
  resolveFinalizeCompletionTarget,
  resolvePersistedDraftSaleBinding,
  resumeWouldOverwriteUnrelatedCart,
  stableVoidLineIdentity,
  stableVoidLineMovementId,
  stableVoidRecordId,
  unsavedCartVoidPersistSucceeded,
  unsavedCartVoidRecordPresent,
} from "./saleLifecycle";
import { isPreCompletionVoidedSale, UNSAVED_CART_VOID_REASON } from "./saleStatus";

const PENDING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "status">): Sale {
  return {
    createdAt: "2026-06-02T10:00:00.000Z",
    updatedAt: "2026-06-02T10:00:00.000Z",
    subtotalUgx: 10_000,
    totalUgx: 10_000,
    cashPaidUgx: 10_000,
    debtUgx: 0,
    estimatedProfitUgx: 7_000,
    lines: [],
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

describe("resolvePersistedDraftSaleBinding", () => {
  it("keeps a pending sale id", () => {
    const sales = [sale({ id: PENDING_ID, status: "pending" })];
    expect(resolvePersistedDraftSaleBinding(sales, PENDING_ID, true)).toBe(PENDING_ID);
  });

  it("keeps a completed sale id so finalize can ACK without forking", () => {
    const sales = [sale({ id: PENDING_ID, status: "completed" })];
    expect(resolvePersistedDraftSaleBinding(sales, PENDING_ID, true)).toBe(PENDING_ID);
  });

  it("drops cancelled and unknown ids once sales are ready", () => {
    const sales = [sale({ id: PENDING_ID, status: "cancelled" })];
    expect(resolvePersistedDraftSaleBinding(sales, PENDING_ID, true)).toBeNull();
    expect(resolvePersistedDraftSaleBinding([], PENDING_ID, true)).toBeNull();
  });

  it("keeps an unknown id until sales have hydrated", () => {
    expect(resolvePersistedDraftSaleBinding([], PENDING_ID, false)).toBe(PENDING_ID);
  });
});

describe("resolveFinalizeCompletionTarget", () => {
  it("treats a missing binding as a new sale", () => {
    expect(resolveFinalizeCompletionTarget([], null).kind).toBe("new");
  });

  it("classifies pending, completed, cancelled, and stale ids", () => {
    const pending = sale({ id: PENDING_ID, status: "pending" });
    expect(resolveFinalizeCompletionTarget([pending], PENDING_ID)).toEqual({
      kind: "pending",
      sale: pending,
    });
    const completed = sale({ id: PENDING_ID, status: "completed" });
    expect(resolveFinalizeCompletionTarget([completed], PENDING_ID).kind).toBe("already_completed");
    const cancelled = sale({ id: PENDING_ID, status: "cancelled" });
    expect(resolveFinalizeCompletionTarget([cancelled], PENDING_ID).kind).toBe("cancelled");
    expect(resolveFinalizeCompletionTarget([], PENDING_ID).kind).toBe("stale_reference");
  });
});

describe("resumeWouldOverwriteUnrelatedCart", () => {
  it("allows resume when the cart is empty", () => {
    expect(
      resumeWouldOverwriteUnrelatedCart({
        draftLineCount: 0,
        activePendingSaleId: null,
        resumeSaleId: PENDING_ID,
      }),
    ).toBe(false);
  });

  it("refuses resume when an unsaved unrelated cart exists", () => {
    expect(
      resumeWouldOverwriteUnrelatedCart({
        draftLineCount: 1,
        activePendingSaleId: null,
        resumeSaleId: PENDING_ID,
      }),
    ).toBe(true);
  });

  it("allows resume when the restored draft is already bound to the same pending sale", () => {
    expect(
      resumeWouldOverwriteUnrelatedCart({
        draftLineCount: 2,
        activePendingSaleId: PENDING_ID,
        resumeSaleId: PENDING_ID,
      }),
    ).toBe(false);
  });
});

describe("cartVoidCopyKeys", () => {
  it("treats an unsaved cart as Void sale — persist VOIDED history, not completed-sale void", () => {
    const copy = cartVoidCopyKeys({ activePendingSaleId: null });
    expect(cartVoidKind(null)).toBe("unsaved");
    expect(copy.kind).toBe("unsaved");
    expect(copy.storeAction).toBe("voidUnsavedCart");
    expect(copy.labelKey).toBe("clearSale");
    expect(t("en", copy.labelKey)).toBe("Clear");
    expect(t("en", copy.titleKey)).toBe("Void this sale?");
    expect(t("en", copy.bodyKey)).toMatch(/recorded as VOIDED in Sales History/);
    expect(t("en", copy.bodyKey)).toMatch(/No stock, cash, debt, or revenue will be affected/);
    expect(t("en", copy.keepKey)).toBe("Keep sale");
    expect(t("en", copy.confirmKey)).toBe("Void sale");
    expect(t("lg", copy.labelKey)).toContain("Jjawo");
    expect(t("lg", copy.keepKey)).toContain("Sigala");
  });

  it("treats a resumed pending cart as Void pending sale — cancelPendingSale", () => {
    const copy = cartVoidCopyKeys({ activePendingSaleId: PENDING_ID });
    expect(copy.kind).toBe("pending");
    expect(copy.storeAction).toBe("cancelPendingSale");
    expect(t("en", copy.labelKey)).toBe("Void pending sale");
    expect(t("en", copy.titleKey)).toBe("Void this pending sale?");
    expect(t("en", copy.bodyKey)).toMatch(/recorded as VOIDED in Sales History/);
    expect(t("en", copy.bodyKey)).toMatch(/No stock, cash, debt, or revenue will be affected/);
    expect(t("lg", copy.labelKey)).toContain("etannaggwa");
  });

  it("uses order vocabulary for hospitality unsaved and pending carts", () => {
    const unsaved = cartVoidCopyKeys({ activePendingSaleId: null, mode: "hospitality" });
    expect(unsaved.storeAction).toBe("voidUnsavedCart");
    expect(t("en", unsaved.labelKey).toLowerCase()).toContain("order");
    expect(t("en", unsaved.titleKey)).toBe("Void this order?");
    expect(t("en", unsaved.bodyKey)).toMatch(/recorded as VOIDED in Sales History/);
    const pending = cartVoidCopyKeys({ activePendingSaleId: PENDING_ID, mode: "hospitality" });
    expect(pending.storeAction).toBe("cancelPendingSale");
    expect(t("en", pending.labelKey).toLowerCase()).toContain("pending order");
  });

  it("uses basket / invoice vocabulary for pharmacy and wholesale unsaved carts", () => {
    const pharmacy = cartVoidCopyKeys({ activePendingSaleId: null, mode: "pharmacy" });
    expect(pharmacy.storeAction).toBe("voidUnsavedCart");
    expect(t("en", pharmacy.labelKey).toLowerCase()).toContain("basket");
    expect(t("en", pharmacy.bodyKey)).toMatch(/recorded as VOIDED in Sales History/);
    const wholesale = cartVoidCopyKeys({ activePendingSaleId: null, mode: "wholesale" });
    expect(wholesale.storeAction).toBe("voidUnsavedCart");
    expect(t("en", wholesale.labelKey).toLowerCase()).toContain("invoice");
    expect(t("en", wholesale.bodyKey)).toMatch(/recorded as VOIDED in Sales History/);
  });

  it("never maps cashier cart void onto completed-sale voidSaleLine", () => {
    for (const mode of ["retail", "hospitality", "pharmacy", "wholesale"] as const) {
      expect(["voidUnsavedCart", "cancelPendingSale"]).toContain(
        cartVoidCopyKeys({ activePendingSaleId: null, mode }).storeAction,
      );
      expect(["voidUnsavedCart", "cancelPendingSale"]).toContain(
        cartVoidCopyKeys({ activePendingSaleId: PENDING_ID, mode }).storeAction,
      );
    }
  });
});

describe("leaveSellConfirmKey", () => {
  it("discards local edits of a resumed pending sale without cancelling it", () => {
    expect(leaveSellConfirmKey(PENDING_ID)).toBe("clearResumedPendingConfirm");
    expect(t("en", "clearResumedPendingConfirm")).toContain("saved pending bill will remain unchanged");
    expect(t("lg", "clearResumedPendingConfirm")).toContain("Ebbili eyaterekebwa");
  });

  it("asks to discard an unsaved cart when leaving Sell", () => {
    expect(leaveSellConfirmKey(null)).toBe("posLeaveActiveSaleConfirm");
  });
});

describe("resolveCartAbandon", () => {
  it("does nothing when the cart is empty", () => {
    expect(resolveCartAbandon({ draftLineCount: 0, activePendingSaleId: null, intent: "clear" }).kind).toBe("noop");
    expect(resolveCartAbandon({ draftLineCount: 0, activePendingSaleId: null, intent: "leave" }).kind).toBe("noop");
  });

  it("Clear or Leave of an unsaved cart opens Void confirmation", () => {
    expect(resolveCartAbandon({ draftLineCount: 3, activePendingSaleId: null, intent: "clear" }).kind).toBe(
      "confirm_void",
    );
    expect(resolveCartAbandon({ draftLineCount: 3, activePendingSaleId: null, intent: "leave" }).kind).toBe(
      "confirm_void",
    );
  });

  it("Clear of a resumed pending cart uses pending cancellation, Leave discards local edits only", () => {
    expect(
      resolveCartAbandon({ draftLineCount: 2, activePendingSaleId: PENDING_ID, intent: "clear" }).kind,
    ).toBe("confirm_void");
    expect(
      resolveCartAbandon({ draftLineCount: 2, activePendingSaleId: PENDING_ID, intent: "leave" }).kind,
    ).toBe("discard_pending_edits");
  });
});

describe("resolveRemoveDraftLine / resolveDraftQtyChange", () => {
  it("last remaining line ✕ or qty→0 opens Void confirmation instead of emptying the cart", () => {
    const lines = [{ productId: "prod-1" }];
    expect(resolveRemoveDraftLine({ draftLines: lines, productId: "prod-1" })).toBe("confirm_void");
    expect(resolveDraftQtyChange({ draftLines: lines, productId: "prod-1", nextQuantity: 0 })).toBe("confirm_void");
  });

  it("removing one of several lines does not void the sale", () => {
    const lines = [{ productId: "prod-1" }, { productId: "prod-2" }];
    expect(resolveRemoveDraftLine({ draftLines: lines, productId: "prod-1" })).toBe("remove_line");
    expect(resolveDraftQtyChange({ draftLines: lines, productId: "prod-1", nextQuantity: 0 })).toBe("remove_line");
    expect(resolveDraftQtyChange({ draftLines: lines, productId: "prod-1", nextQuantity: 1 })).toBe("apply");
  });

  it("does nothing when the cart is already empty", () => {
    expect(resolveRemoveDraftLine({ draftLines: [], productId: "prod-1" })).toBe("noop");
  });
});

describe("stable void identities", () => {
  it("are deterministic for the same sale + line + product", () => {
    const identity = stableVoidLineIdentity(PENDING_ID, 0, "line-1");
    const a = stableVoidLineMovementId("shop", PENDING_ID, identity, "prod-1");
    const b = stableVoidLineMovementId("shop", PENDING_ID, identity, "prod-1");
    expect(a).toBe(b);
    expect(stableVoidRecordId("shop", PENDING_ID, identity)).toBe(
      stableVoidRecordId("shop", PENDING_ID, identity),
    );
  });
});

describe("buildUnsavedCartVoidedSale", () => {
  it("snapshots cart lines and totals as cancelled + VOIDED metadata, with no cash, debt, or receiptSeq", () => {
    const at = "2026-08-28T12:42:00.000Z";
    const record = buildUnsavedCartVoidedSale({
      saleId: PENDING_ID,
      lines: [
        {
          id: "line-1",
          productId: "prod-1",
          name: "Coca-Cola",
          inputMode: "quantity",
          quantity: 2,
          unitPriceUgx: 50_000,
          unitCostUgx: 20_000,
          lineTotalUgx: 100_000,
          estimatedProfitUgx: 60_000,
          updatedAt: at,
        },
        {
          id: "line-2",
          productId: "prod-2",
          name: "Bread",
          inputMode: "quantity",
          quantity: 1,
          unitPriceUgx: 25_000,
          unitCostUgx: 10_000,
          lineTotalUgx: 25_000,
          estimatedProfitUgx: 15_000,
          updatedAt: at,
        },
      ],
      cartDiscountUgx: 0,
      at,
      actorUserId: "cashier:1",
      actorLabel: "Sarah",
      customerName: "Walk-in",
      paymentMethod: "cash",
    });
    expect(record.id).toBe(PENDING_ID);
    expect(record.status).toBe("cancelled");
    expect(record.saleVoidReason).toBe(UNSAVED_CART_VOID_REASON);
    expect(isPreCompletionVoidedSale(record)).toBe(true);
    expect(record.lines).toHaveLength(2);
    expect(record.lines.map((l) => l.quantity)).toEqual([2, 1]);
    expect(record.totalUgx).toBe(125_000);
    expect(record.cashPaidUgx).toBe(0);
    expect(record.debtUgx).toBe(0);
    expect(record.saleVoidedAt).toBe(at);
    expect(record.saleVoidedByUserId).toBe("cashier:1");
    expect(record.saleVoidedByLabel).toBe("Sarah");
    expect(record.receiptSeq).toBeUndefined();
    expect(unsavedCartVoidRecordPresent([record], PENDING_ID)).toBe(true);
    expect(unsavedCartVoidRecordPresent([], PENDING_ID)).toBe(false);
    expect(unsavedCartVoidPersistSucceeded([record], PENDING_ID, 0)).toBe(true);
    expect(unsavedCartVoidPersistSucceeded([record], PENDING_ID, 1)).toBe(false);
    expect(unsavedCartVoidPersistSucceeded([], PENDING_ID, 0)).toBe(false);
  });
});

describe("markPendingSaleAsPreCompletionVoid", () => {
  it("keeps the pending sale id and stamps VOIDED metadata without changing cash, debt, or lines", () => {
    const at = "2026-08-29T09:15:00.000Z";
    const pending = sale({
      id: PENDING_ID,
      status: "pending",
      totalUgx: 40_000,
      cashPaidUgx: 0,
      debtUgx: 0,
      lines: [
        {
          id: "line-1",
          productId: "prod-1",
          name: "Coca-Cola",
          inputMode: "quantity",
          quantity: 2,
          unitPriceUgx: 20_000,
          unitCostUgx: 8_000,
          lineTotalUgx: 40_000,
          estimatedProfitUgx: 24_000,
          updatedAt: at,
        },
      ],
    });
    const record = markPendingSaleAsPreCompletionVoid(pending, {
      at,
      actorUserId: "cashier:1",
      actorLabel: "Sarah",
    });
    expect(record.id).toBe(PENDING_ID);
    expect(record.status).toBe("cancelled");
    expect(record.saleVoidReason).toBe(UNSAVED_CART_VOID_REASON);
    expect(isPreCompletionVoidedSale(record)).toBe(true);
    expect(record.lines).toHaveLength(1);
    expect(record.totalUgx).toBe(40_000);
    expect(record.cashPaidUgx).toBe(0);
    expect(record.debtUgx).toBe(0);
    expect(record.saleVoidedAt).toBe(at);
    expect(record.saleVoidedByUserId).toBe("cashier:1");
    expect(record.saleVoidedByLabel).toBe("Sarah");
  });
});
