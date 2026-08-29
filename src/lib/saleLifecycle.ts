import type { Sale, SaleLine } from "../types";
import { saleStatusOf, UNSAVED_CART_VOID_REASON } from "./saleStatus";
import { stableInventoryMovementId } from "./inventoryIntegrity";
import { computeDraftCheckoutTotals } from "./draftCart";
import { ensureSaleLineId } from "./pendingSaleMerge";
import { estimatedProfitAfterCartDiscount } from "./saleFinancialEngine";

export type DraftPaymentMethod = "cash" | "atm" | "mobile_money" | "mixed" | "credit" | "voucher";

export const DRAFT_PAYMENT_METHODS: readonly DraftPaymentMethod[] = [
  "cash",
  "atm",
  "mobile_money",
  "mixed",
  "credit",
  "voucher",
] as const;

export function isDraftPaymentMethod(value: unknown): value is DraftPaymentMethod {
  return typeof value === "string" && (DRAFT_PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * Restore a draft's pending-sale binding.
 * Keep the id when the sale is still pending (resume) or already completed (idempotent finalize).
 * Drop cancelled / unknown ids once sales have finished hydrating.
 */
export function resolvePersistedDraftSaleBinding(
  sales: readonly Sale[],
  candidate: string | null | undefined,
  salesReady: boolean,
): string | null {
  const id = candidate?.trim() || null;
  if (!id) return null;
  const sale = sales.find((s) => s.id === id);
  if (!sale) return salesReady ? null : id;
  const status = saleStatusOf(sale);
  if (status === "pending" || status === "completed") return id;
  return null;
}

export type CompletionTarget =
  | { kind: "new" }
  | { kind: "pending"; sale: Sale }
  | { kind: "already_completed"; sale: Sale }
  | { kind: "cancelled"; sale: Sale }
  | { kind: "stale_reference" };

export function resolveFinalizeCompletionTarget(
  sales: readonly Sale[],
  activePendingSaleId: string | null | undefined,
): CompletionTarget {
  const id = activePendingSaleId?.trim();
  if (!id) return { kind: "new" };
  const sale = sales.find((s) => s.id === id);
  if (!sale) return { kind: "stale_reference" };
  const status = saleStatusOf(sale);
  if (status === "completed") return { kind: "already_completed", sale };
  if (status === "cancelled") return { kind: "cancelled", sale };
  if (status === "pending") return { kind: "pending", sale };
  return { kind: "stale_reference" };
}

/** True when resume would clobber an unsaved cart that is not already bound to this pending sale. */
export function resumeWouldOverwriteUnrelatedCart(input: {
  draftLineCount: number;
  activePendingSaleId: string | null | undefined;
  resumeSaleId: string;
}): boolean {
  if (input.draftLineCount <= 0) return false;
  const bound = input.activePendingSaleId?.trim();
  if (!bound) return true;
  return bound !== input.resumeSaleId;
}

export type CartVoidKind = "unsaved" | "pending";
export type CartVoidMode = "retail" | "hospitality" | "pharmacy" | "wholesale";

export type CartVoidCopyKeys = {
  kind: CartVoidKind;
  /** Store method the confirmed action must call. Never `voidSaleLine`. */
  storeAction: "voidUnsavedCart" | "cancelPendingSale";
  labelKey: string;
  titleKey: string;
  bodyKey: string;
  keepKey: string;
  confirmKey: string;
};

export function cartVoidKind(activePendingSaleId: string | null | undefined): CartVoidKind {
  return activePendingSaleId?.trim() ? "pending" : "unsaved";
}

/**
 * Cashier-facing Void Sale copy.
 * Unsaved cart → persist cancelled+void history record, then clear draft.
 * Resumed pending → cancelPendingSale (pending → cancelled + VOIDED history, no stock reversal).
 */
export function cartVoidCopyKeys(input: {
  activePendingSaleId: string | null | undefined;
  mode?: CartVoidMode;
}): CartVoidCopyKeys {
  const kind = cartVoidKind(input.activePendingSaleId);
  const mode = input.mode ?? "retail";
  if (kind === "pending") {
    if (mode === "hospitality") {
      return {
        kind,
        storeAction: "cancelPendingSale",
        labelKey: "voidPendingOrderLabel",
        titleKey: "voidPendingOrderTitle",
        bodyKey: "voidPendingOrderBody",
        keepKey: "voidCartKeepOrder",
        confirmKey: "voidPendingOrderConfirm",
      };
    }
    if (mode === "pharmacy") {
      return {
        kind,
        storeAction: "cancelPendingSale",
        labelKey: "voidPendingBasketLabel",
        titleKey: "voidPendingBasketTitle",
        bodyKey: "voidPendingBasketBody",
        keepKey: "voidCartKeepBasket",
        confirmKey: "voidPendingBasketConfirm",
      };
    }
    if (mode === "wholesale") {
      return {
        kind,
        storeAction: "cancelPendingSale",
        labelKey: "voidPendingInvoiceLabel",
        titleKey: "voidPendingInvoiceTitle",
        bodyKey: "voidPendingInvoiceBody",
        keepKey: "voidCartKeepInvoice",
        confirmKey: "voidPendingInvoiceConfirm",
      };
    }
    return {
      kind,
      storeAction: "cancelPendingSale",
      labelKey: "voidPendingSaleLabel",
      titleKey: "voidPendingSaleTitle",
      bodyKey: "voidPendingSaleBody",
      keepKey: "voidCartKeepSale",
      confirmKey: "voidPendingSaleConfirm",
    };
  }
  if (mode === "hospitality") {
    return {
      kind,
      storeAction: "voidUnsavedCart",
      labelKey: "hospitalityTerm_clearOrder",
      titleKey: "voidUnsavedOrderTitle",
      bodyKey: "voidUnsavedOrderBody",
      keepKey: "voidCartKeepOrder",
      confirmKey: "voidUnsavedOrderConfirm",
    };
  }
  if (mode === "pharmacy") {
    return {
      kind,
      storeAction: "voidUnsavedCart",
      labelKey: "pharmacyTerm_clearBasket",
      titleKey: "voidUnsavedBasketTitle",
      bodyKey: "voidUnsavedBasketBody",
      keepKey: "voidCartKeepBasket",
      confirmKey: "voidUnsavedBasketConfirm",
    };
  }
  if (mode === "wholesale") {
    return {
      kind,
      storeAction: "voidUnsavedCart",
      labelKey: "wholesaleTerm_clearInvoice",
      titleKey: "voidUnsavedInvoiceTitle",
      bodyKey: "voidUnsavedInvoiceBody",
      keepKey: "voidCartKeepInvoice",
      confirmKey: "voidUnsavedInvoiceConfirm",
    };
  }
  return {
    kind,
    storeAction: "voidUnsavedCart",
    labelKey: "clearSale",
    titleKey: "voidUnsavedCartTitle",
    bodyKey: "voidUnsavedCartBody",
    keepKey: "voidCartKeepSale",
    confirmKey: "voidUnsavedCartConfirm",
  };
}

/** Leave-Sell copy: resumed pending discards local edits only — does not cancel the pending sale. */
export function leaveSellConfirmKey(
  activePendingSaleId: string | null | undefined,
): "clearResumedPendingConfirm" | "posLeaveActiveSaleConfirm" {
  return activePendingSaleId?.trim() ? "clearResumedPendingConfirm" : "posLeaveActiveSaleConfirm";
}

export type CartAbandonIntent = "clear" | "leave";
export type CartAbandonDecision = { kind: "noop" } | { kind: "confirm_void" } | { kind: "discard_pending_edits" };

/**
 * Clear vs leave for the active POS cart.
 * Unsaved cart (Clear or Leave) → Void confirmation → voidCurrentCart.
 * Resumed pending Clear → pending-cancel confirmation → voidCurrentCart.
 * Resumed pending Leave → discard local edits only (pending stays pending).
 */
export function resolveCartAbandon(input: {
  draftLineCount: number;
  activePendingSaleId: string | null | undefined;
  intent: CartAbandonIntent;
}): CartAbandonDecision {
  if (input.draftLineCount <= 0) return { kind: "noop" };
  const pending = Boolean(input.activePendingSaleId?.trim());
  if (input.intent === "leave" && pending) return { kind: "discard_pending_edits" };
  return { kind: "confirm_void" };
}

export type RemoveDraftLineDecision = "noop" | "remove_line" | "confirm_void";

/**
 * Line ✕ / last-item qty→0 must not silently empty the cart.
 * Last remaining line → same Void confirmation as Clear.
 * Other lines can still be removed without voiding the whole sale.
 */
export function resolveRemoveDraftLine(input: {
  draftLines: readonly { productId: string }[];
  productId: string;
}): RemoveDraftLineDecision {
  if (input.draftLines.length <= 0) return "noop";
  const remaining = input.draftLines.filter((l) => l.productId !== input.productId);
  if (remaining.length === 0) return "confirm_void";
  return "remove_line";
}

export type DraftQtyChangeDecision = "apply" | "remove_line" | "confirm_void";

export function resolveDraftQtyChange(input: {
  draftLines: readonly { productId: string }[];
  productId: string;
  nextQuantity: number;
}): DraftQtyChangeDecision {
  if (input.nextQuantity > 0) return "apply";
  const remaining = input.draftLines.filter((l) => l.productId !== input.productId);
  if (input.draftLines.length <= 0) return "apply";
  if (remaining.length === 0) return "confirm_void";
  return "remove_line";
}

/** True when the VOIDED historical row is in `sales` after voidCurrentCart persist. */
export function unsavedCartVoidRecordPresent(sales: readonly Sale[], saleId: string): boolean {
  return sales.some((s) => s.id === saleId && s.status === "cancelled" && s.saleVoidReason === UNSAVED_CART_VOID_REASON);
}

/** Persist-then-clear gate: VOIDED row must exist and the cart must already be empty. */
export function unsavedCartVoidPersistSucceeded(
  sales: readonly Sale[],
  saleId: string,
  draftLineCount: number,
): boolean {
  return unsavedCartVoidRecordPresent(sales, saleId) && draftLineCount === 0;
}

export function stableVoidLineIdentity(saleId: string, lineIndex: number, lineId?: string | null): string {
  return lineId?.trim() || `${saleId}:${lineIndex}`;
}

export function stableVoidRecordId(shopKey: string, saleId: string, lineIdentity: string): string {
  return stableInventoryMovementId(shopKey, "void_record", saleId, lineIdentity);
}

export function stableVoidLineMovementId(
  shopKey: string,
  saleId: string,
  lineIdentity: string,
  productId: string,
): string {
  return stableInventoryMovementId(shopKey, "void_line", `${saleId}:${lineIdentity}`, productId);
}

export function emptyDraftCheckoutFields(): {
  draftSaleCustomerId: string;
  draftSaleCustomerName: string;
  draftSaleCustomerPhone: string;
  draftPaymentMethod: DraftPaymentMethod;
} {
  return {
    draftSaleCustomerId: "",
    draftSaleCustomerName: "",
    draftSaleCustomerPhone: "",
    draftPaymentMethod: "cash",
  };
}

export function buildUnsavedCartVoidedSale(input: {
  saleId: string;
  lines: SaleLine[];
  cartDiscountUgx: number;
  at: string;
  actorUserId: string | null;
  actorLabel: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  paymentMethod?: DraftPaymentMethod;
}): Sale {
  const saleLines = input.lines.map(ensureSaleLineId);
  const checkout = computeDraftCheckoutTotals(saleLines, input.cartDiscountUgx);
  const listSubtotal = saleLines.reduce((a, l) => a + (l.originalLineTotalUgx ?? l.lineTotalUgx), 0);
  const discountTotal = Math.max(0, listSubtotal - checkout.payableUgx);
  const customerName = input.customerName?.trim() || null;
  const customerPhone = input.customerPhone?.trim() || null;
  return {
    id: input.saleId,
    status: "cancelled",
    updatedAt: input.at,
    lines: saleLines,
    subtotalUgx: listSubtotal,
    totalUgx: checkout.payableUgx,
    cashPaidUgx: 0,
    debtUgx: 0,
    discountTotalUgx: discountTotal,
    voidedTotalUgx: 0,
    estimatedProfitUgx: estimatedProfitAfterCartDiscount(saleLines, checkout.cartDiscountUgx),
    createdAt: input.at,
    pendingSync: true,
    lastSyncError: null,
    customerId: input.customerId?.trim() || null,
    soldByUserId: input.actorUserId,
    receiptCustomerName: customerName,
    receiptCustomerPhone: customerPhone,
    paymentMethod: input.paymentMethod ?? "cash",
    saleVoidedAt: input.at,
    saleVoidReason: UNSAVED_CART_VOID_REASON,
    saleVoidedByUserId: input.actorUserId,
    saleVoidedByLabel: input.actorLabel,
  };
}

/** Parked/pending sale the cashier chose not to complete — same VOIDED history marker as an unsaved cart. */
export function markPendingSaleAsPreCompletionVoid(
  sale: Sale,
  input: { at: string; actorUserId: string | null; actorLabel: string | null },
): Sale {
  return {
    ...sale,
    status: "cancelled",
    updatedAt: input.at,
    pendingSync: true,
    lastSyncError: null,
    saleVoidedAt: input.at,
    saleVoidReason: UNSAVED_CART_VOID_REASON,
    saleVoidedByUserId: input.actorUserId,
    saleVoidedByLabel: input.actorLabel,
  };
}
