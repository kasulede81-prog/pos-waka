import type { HospitalityFloorState, Language, Product, Sale, ShopPreferences } from "../types";
import type { RestaurantReceiptContext } from "./restaurantReceiptPrint";
import { resolveHospitalityHardware } from "./hospitalityHardware";
import { saleReportingDayKey } from "./datesUg";

/**
 * Sales settled as Hospitality table/named bills. The shared POS (takeaway/bar)
 * does not set these fields, so its retail receipt behavior stays untouched.
 */
export function isHospitalityBillSale(sale: Sale): boolean {
  return Boolean(
    sale.tableSessionId ||
      sale.billDraft ||
      (sale.serviceChargeUgx ?? 0) > 0 ||
      (sale.tipUgx ?? 0) > 0 ||
      (sale.taxUgx ?? 0) > 0 ||
      (sale.billPayments?.length ?? 0) > 0,
  );
}

type BuildHospitalityReprintInput = {
  sale: Sale;
  products: Product[];
  prefs: ShopPreferences;
  lang: Language;
  floor?: HospitalityFloorState | null;
  /** Original seller label, when resolvable. Never the reprinting actor. */
  cashierLabel?: string | null;
  /** Current actor printing the copy. */
  printedBy?: string | null;
};

/**
 * Build the restaurant receipt context for a historical Hospitality sale.
 *
 * Financial fields come from the SALE (subtotal, service charge, tax, tip,
 * total, voided total). Current settings are only used for display branding and
 * the template, never to recompute money. Table/waiter/guest are shown only
 * when persisted on the sale or still present in the floor session; otherwise
 * they are omitted rather than invented.
 */
export function buildHospitalityReprintContext(
  input: BuildHospitalityReprintInput,
): RestaurantReceiptContext {
  const { sale, prefs, floor } = input;
  const session = sale.tableSessionId
    ? floor?.sessions.find((s) => s.id === sale.tableSessionId) ?? null
    : null;
  const table = session?.tableId
    ? floor?.tables.find((t) => t.id === session.tableId) ?? null
    : null;

  // referenceLabel is the label frozen on the sale at settlement. The current
  // floor label is only a fallback for older records that never stored one.
  const persistedReference = sale.referenceLabel?.trim() || null;
  const tableLabel = persistedReference || table?.label?.trim() || session?.tabLabel?.trim() || null;
  const waiterLabel = sale.waiterName?.trim() || session?.waiterLabel?.trim() || null;
  const guestCount =
    session?.guestCount != null && Number.isFinite(session.guestCount) && session.guestCount > 0
      ? session.guestCount
      : null;
  const voided = Boolean(sale.saleVoidedAt);

  return {
    sale,
    products: input.products,
    prefs,
    lang: input.lang,
    tableLabel,
    waiterLabel,
    guestCount,
    cashierLabel: input.cashierLabel?.trim() || null,
    template: resolveHospitalityHardware(prefs).receiptTemplate,
    voidReceipt: voided,
    voidReason: sale.saleVoidReason?.trim() || sale.billDraft?.voidReason?.trim() || null,
    receiptKind: voided ? "void" : "reprint",
    reprint: true,
    businessDate: saleReportingDayKey(sale),
    printedBy: input.printedBy?.trim() || null,
  };
}
