import type { LineInputMode, Product, SaleLine } from "../types";
import { deleteKv, readKv, writeKv } from "./localDb";
import {
  emptyDraftCheckoutFields,
  isDraftPaymentMethod,
  type DraftPaymentMethod,
} from "../lib/saleLifecycle";

const KEY = "draft_sale";
const VERSION = 2 as const;

export type PersistedDraftV1 = {
  v: 1 | 2;
  draftLines: SaleLine[];
  draftInput: { productId: string; inputMode: LineInputMode; value: number } | null;
  /** Cart-wide discount in UGX (after line-level discounts). */
  draftCartDiscountUgx?: number;
  activePendingSaleId?: string | null;
  draftSaleCustomerId?: string;
  draftSaleCustomerName?: string;
  draftSaleCustomerPhone?: string;
  draftPaymentMethod?: DraftPaymentMethod;
};

export type WritePersistedDraftInput = {
  lines: SaleLine[];
  input: PersistedDraftV1["draftInput"];
  cartDiscountUgx?: number;
  activePendingSaleId?: string | null;
  draftSaleCustomerId?: string;
  draftSaleCustomerName?: string;
  draftSaleCustomerPhone?: string;
  draftPaymentMethod?: DraftPaymentMethod;
};

export async function readPersistedDraft(): Promise<PersistedDraftV1 | null> {
  const row = await readKv<PersistedDraftV1>(KEY);
  if (!row || (row.v !== 1 && row.v !== 2) || !Array.isArray(row.draftLines)) return null;
  return row;
}

function draftPersistIsEmpty(input: WritePersistedDraftInput): boolean {
  const checkout = emptyDraftCheckoutFields();
  const payment = input.draftPaymentMethod ?? checkout.draftPaymentMethod;
  return (
    !input.lines.length &&
    !input.input &&
    (input.cartDiscountUgx ?? 0) <= 0 &&
    !input.activePendingSaleId?.trim() &&
    !(input.draftSaleCustomerId ?? "").trim() &&
    !(input.draftSaleCustomerName ?? "").trim() &&
    !(input.draftSaleCustomerPhone ?? "").trim() &&
    payment === "cash"
  );
}

export async function writePersistedDraft(
  linesOrInput: SaleLine[] | WritePersistedDraftInput,
  input?: PersistedDraftV1["draftInput"],
  cartDiscountUgx = 0,
): Promise<void> {
  const payload: WritePersistedDraftInput = Array.isArray(linesOrInput)
    ? { lines: linesOrInput, input: input ?? null, cartDiscountUgx }
    : linesOrInput;
  if (draftPersistIsEmpty(payload)) {
    await deleteKv(KEY);
    return;
  }
  const stored: PersistedDraftV1 = {
    v: VERSION,
    draftLines: payload.lines,
    draftInput: payload.input,
    draftCartDiscountUgx: (payload.cartDiscountUgx ?? 0) > 0 ? payload.cartDiscountUgx : undefined,
    activePendingSaleId: payload.activePendingSaleId?.trim() || undefined,
    draftSaleCustomerId: payload.draftSaleCustomerId?.trim() || undefined,
    draftSaleCustomerName: payload.draftSaleCustomerName?.trim() || undefined,
    draftSaleCustomerPhone: payload.draftSaleCustomerPhone?.trim() || undefined,
    draftPaymentMethod:
      payload.draftPaymentMethod && payload.draftPaymentMethod !== "cash"
        ? payload.draftPaymentMethod
        : undefined,
  };
  await writeKv(KEY, stored);
}

export async function clearPersistedDraft(): Promise<void> {
  await deleteKv(KEY);
}

/** Re-bind product objects from current catalog */
export function resolveDraftFromPersisted(
  draft: PersistedDraftV1,
  products: Product[],
): {
  draftLines: SaleLine[];
  draftInput: { product: Product; inputMode: LineInputMode; value: number } | null;
  activePendingSaleId: string | null;
  draftSaleCustomerId: string;
  draftSaleCustomerName: string;
  draftSaleCustomerPhone: string;
  draftPaymentMethod: DraftPaymentMethod;
} {
  const idSet = new Set(products.map((p) => p.id));
  const draftLines = draft.draftLines.filter((l) => idSet.has(l.productId));
  let draftInput: { product: Product; inputMode: LineInputMode; value: number } | null = null;
  if (draft.draftInput) {
    const p = products.find((x) => x.id === draft.draftInput!.productId);
    if (p) {
      draftInput = {
        product: p,
        inputMode: draft.draftInput.inputMode,
        value: draft.draftInput.value,
      };
    }
  }
  const checkout = emptyDraftCheckoutFields();
  return {
    draftLines,
    draftInput,
    activePendingSaleId: draft.activePendingSaleId?.trim() || null,
    draftSaleCustomerId: draft.draftSaleCustomerId?.trim() || checkout.draftSaleCustomerId,
    draftSaleCustomerName: draft.draftSaleCustomerName?.trim() || checkout.draftSaleCustomerName,
    draftSaleCustomerPhone: draft.draftSaleCustomerPhone?.trim() || checkout.draftSaleCustomerPhone,
    draftPaymentMethod: isDraftPaymentMethod(draft.draftPaymentMethod)
      ? draft.draftPaymentMethod
      : checkout.draftPaymentMethod,
  };
}
