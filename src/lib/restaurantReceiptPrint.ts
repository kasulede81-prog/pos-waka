import type {
  BillSplitLine,
  Language,
  Product,
  ReceiptTemplateConfig,
  Sale,
  SaleLine,
  ShopPreferences,
} from "../types";
import { EscPosBuilder, padColumns } from "./escPosBuilder";
import { computeRestaurantBillTotals, billDraftFromSale } from "./restaurantBilling";
import { computeSaleDiscountBreakdown } from "./discountBreakdown";
import { t } from "./i18n";
import { saleReportingDayKey } from "./datesUg";

export type RestaurantReceiptKind = "restaurant" | "guest" | "master" | "void" | "reprint";

export type RestaurantReceiptContext = {
  sale: Sale;
  products: Product[];
  prefs: ShopPreferences;
  lang: Language;
  tableLabel?: string | null;
  waiterLabel?: string | null;
  guestCount?: number | null;
  cashierLabel?: string | null;
  template?: ReceiptTemplateConfig;
  voidReceipt?: boolean;
  voidReason?: string | null;
  receiptKind?: RestaurantReceiptKind;
  reprint?: boolean;
  printedBy?: string | null;
  businessDate?: string | null;
  orderRound?: number | null;
  splitId?: string | null;
  splitLabel?: string | null;
  splitIndex?: number | null;
};

function modifierSuffix(line: SaleLine): string {
  const parts: string[] = [];
  if (line.variantId) parts.push("variant");
  for (const m of line.selectedModifiers ?? []) {
    if (m.optionLabel?.trim()) parts.push(m.optionLabel.trim());
    else if (m.optionId) parts.push(m.optionId);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function lineNoteSuffix(line: SaleLine): string {
  return line.notes?.trim() ? ` [${line.notes.trim()}]` : "";
}

export function buildRestaurantReceiptLines(ctx: RestaurantReceiptContext): string[] {
  const template = ctx.template ?? ctx.prefs.hospitalityHardware?.receiptTemplate;
  const tmpl = template ?? {
    kind: "restaurant" as const,
    showTableNumber: true,
    showWaiter: true,
    showGuests: true,
    showModifiers: true,
    showDiscounts: true,
    showSplitSummary: true,
    showQrPlaceholder: false,
  };
  const shop = ctx.prefs.shopDisplayName?.trim() || "Waka POS";
  const draft = billDraftFromSale(ctx.sale, ctx.prefs);
  const cartDiscountUgx = ctx.sale.lines.reduce((sum, l) => sum + (l.cartDiscountUgx ?? 0), 0);
  const split =
    ctx.splitId != null ? draft.splits.find((s) => s.id === ctx.splitId) ?? null : null;
  const splitIndex =
    ctx.splitIndex ??
    (split?.id != null ? draft.splits.findIndex((s) => s.id === split.id) : null);
  const receiptLines =
    split?.lineIds?.length && (ctx.receiptKind === "guest" || ctx.splitId)
      ? ctx.sale.lines.filter((l) => split.lineIds!.includes(l.id ?? l.productId))
      : ctx.sale.lines;
  const totals = computeRestaurantBillTotals({
    lines: receiptLines,
    cartDiscountUgx: ctx.receiptKind === "guest" && split ? 0 : cartDiscountUgx,
    billDraft: ctx.receiptKind === "guest" && split ? { ...draft, splits: [split] } : draft,
    prefs: ctx.prefs,
  });
  const discount = computeSaleDiscountBreakdown(ctx.sale);
  const lines: string[] = [];
  const isVoid = ctx.voidReceipt || ctx.receiptKind === "void";
  const isReprint = ctx.reprint || ctx.receiptKind === "reprint";
  if (isVoid) {
    lines.push("*** VOID ***");
    if (ctx.voidReason?.trim() || ctx.sale.saleVoidReason?.trim()) {
      lines.push(`${t(ctx.lang, "restaurantReceiptVoidReason")}: ${ctx.voidReason?.trim() || ctx.sale.saleVoidReason}`);
    }
    lines.push("—");
  } else if (isReprint) {
    lines.push(`*** ${t(ctx.lang, "restaurantReceiptReprintBanner")} ***`);
    lines.push("—");
  }
  const kind = ctx.receiptKind ?? (isVoid ? "void" : isReprint ? "reprint" : "restaurant");
  const kindTitleKey =
    kind === "guest"
      ? "restaurantReceiptKindGuest"
      : kind === "master"
        ? "restaurantReceiptKindMaster"
        : kind === "void"
          ? "restaurantReceiptKindVoid"
          : kind === "reprint"
            ? "restaurantReceiptKindReprint"
            : "restaurantReceiptTitle";
  lines.push(shop.toUpperCase());
  if (ctx.prefs.shopAddressLine?.trim()) lines.push(ctx.prefs.shopAddressLine.trim());
  if (ctx.prefs.shopPhoneE164?.trim()) lines.push(ctx.prefs.shopPhoneE164.trim());
  lines.push("—");
  lines.push(t(ctx.lang, kindTitleKey));
  if (tmpl.showTableNumber && ctx.tableLabel) {
    lines.push(`${t(ctx.lang, "restaurantReceiptTable")}: ${ctx.tableLabel}`);
  }
  if (tmpl.showWaiter && ctx.waiterLabel) {
    lines.push(`${t(ctx.lang, "restaurantReceiptWaiter")}: ${ctx.waiterLabel}`);
  }
  if (tmpl.showGuests && ctx.guestCount != null && ctx.guestCount > 0) {
    lines.push(`${t(ctx.lang, "restaurantReceiptGuests")}: ${ctx.guestCount}`);
  }
  if (ctx.orderRound != null && ctx.orderRound > 0) {
    lines.push(`${t(ctx.lang, "restaurantReceiptRound")}: ${ctx.orderRound}`);
  }
  if (ctx.cashierLabel) lines.push(`${t(ctx.lang, "restaurantReceiptCashier")}: ${ctx.cashierLabel}`);
  const receiptNo = ctx.sale.referenceLabel ?? ctx.sale.id.slice(0, 8).toUpperCase();
  lines.push(`${t(ctx.lang, "restaurantReceiptNo")}: ${receiptNo}`);
  const businessDate = ctx.businessDate ?? saleReportingDayKey(ctx.sale);
  lines.push(`${t(ctx.lang, "restaurantReceiptBusinessDate")}: ${businessDate}`);
  const d = new Date(ctx.sale.createdAt);
  lines.push(`${t(ctx.lang, "restaurantReceiptTime")}: ${d.toLocaleString("en-UG", { dateStyle: "short", timeStyle: "short" })}`);
  if (ctx.splitLabel || (splitIndex != null && splitIndex >= 0)) {
    const splitNo = splitIndex != null && splitIndex >= 0 ? splitIndex + 1 : null;
    const splitText =
      ctx.splitLabel?.trim() ||
      split?.label?.trim() ||
      (splitNo != null ? `${t(ctx.lang, "restaurantReceiptSplit")} ${splitNo}` : null);
    if (splitText) lines.push(`${t(ctx.lang, "restaurantReceiptSplitNo")}: ${splitText}`);
  }
  if (ctx.printedBy?.trim()) {
    lines.push(`${t(ctx.lang, "restaurantReceiptPrintedBy")}: ${ctx.printedBy.trim()}`);
  }
  lines.push("—");
  const cols = 42;
  for (const line of receiptLines) {
    const name = line.name + (tmpl.showModifiers ? modifierSuffix(line) + lineNoteSuffix(line) : "");
    lines.push(padColumns(`${line.quantity}x`, name.slice(0, cols - 8), cols));
    lines.push(padColumns("", `UGX ${(line.lineTotalUgx ?? 0).toLocaleString()}`, cols));
  }
  lines.push("—");
  lines.push(padColumns(t(ctx.lang, "restaurantReceiptSubtotal"), `UGX ${totals.listSubtotalUgx.toLocaleString()}`, cols));
  if (tmpl.showDiscounts && discount.totalDiscountUgx > 0) {
    lines.push(padColumns(t(ctx.lang, "restaurantReceiptDiscount"), `-UGX ${discount.totalDiscountUgx.toLocaleString()}`, cols));
  }
  if (totals.serviceChargeUgx > 0) {
    lines.push(padColumns(t(ctx.lang, "restaurantReceiptService"), `UGX ${totals.serviceChargeUgx.toLocaleString()}`, cols));
  }
  if (totals.tipUgx > 0) {
    lines.push(padColumns(t(ctx.lang, "restaurantReceiptTip"), `UGX ${totals.tipUgx.toLocaleString()}`, cols));
  }
  if (totals.taxUgx > 0) {
    lines.push(padColumns(t(ctx.lang, "restaurantReceiptTax"), `UGX ${totals.taxUgx.toLocaleString()}`, cols));
  }
  lines.push(padColumns(t(ctx.lang, "restaurantReceiptTotal"), `UGX ${totals.grandTotalUgx.toLocaleString()}`, cols));
  if (draft.payments.length) {
    lines.push("—");
    const payments =
      ctx.receiptKind === "guest" && split?.id
        ? draft.payments.filter((p) => p.splitId === split.id)
        : draft.payments;
    for (const p of payments) {
      lines.push(padColumns(p.method, `UGX ${p.amountUgx.toLocaleString()}`, cols));
    }
  }
  if (tmpl.showSplitSummary && draft.splits.length > 0 && ctx.receiptKind !== "guest") {
    lines.push("—");
    lines.push(t(ctx.lang, "restaurantReceiptSplits"));
    for (const split of draft.splits) {
      lines.push(splitSummaryLine(split, cols));
    }
  }
  const thanks = ctx.prefs.receiptCustomFooterText?.trim() || t(ctx.lang, "restaurantReceiptThanks");
  lines.push("—");
  lines.push(thanks);
  if (tmpl.showQrPlaceholder) lines.push("[ QR ]");
  return lines;
}

function splitSummaryLine(split: BillSplitLine, cols: number): string {
  const label = split.label?.trim() || `Split ${(split.id ?? "x").slice(0, 4)}`;
  return padColumns(label, `UGX ${split.amountUgx.toLocaleString()}`, cols);
}

export function buildVoidRestaurantReceiptEscPos(
  ctx: RestaurantReceiptContext,
  paperWidth: "58mm" | "80mm" = "80mm",
): Uint8Array {
  return buildRestaurantReceiptEscPos(
    {
      ...ctx,
      voidReceipt: true,
      voidReason: ctx.voidReason ?? ctx.sale.saleVoidReason ?? null,
    },
    paperWidth,
  );
}

export function splitRemainingUgx(split: BillSplitLine): number {
  return Math.max(0, split.amountUgx - (split.paidUgx ?? 0));
}

export function buildRestaurantReceiptEscPos(ctx: RestaurantReceiptContext, paperWidth: "58mm" | "80mm" = "80mm"): Uint8Array {
  const textLines = buildRestaurantReceiptLines(ctx);
  const b = new EscPosBuilder(paperWidth);
  b.align("center").doubleSize(true).textLine(textLines[0] ?? "WAKA POS").doubleSize(false);
  b.align("left");
  for (const line of textLines.slice(1)) {
    if (line === "—") b.rule();
    else if (line.includes("TOTAL") || line === t(ctx.lang, "restaurantReceiptTitle")) b.bold(true).textLine(line).bold(false);
    else if (line === "[ QR ]") b.qrPlaceholder(t(ctx.lang, "restaurantReceiptQrHint"));
    else b.textLine(line);
  }
  b.feed(4).partialCut();
  return b.build();
}

export function restaurantReceiptSummary(ctx: RestaurantReceiptContext): string {
  const table = ctx.tableLabel ?? "—";
  const cartDiscountUgx = ctx.sale.lines.reduce((sum, l) => sum + (l.cartDiscountUgx ?? 0), 0);
  const total = computeRestaurantBillTotals({
    lines: ctx.sale.lines,
    cartDiscountUgx,
    billDraft: billDraftFromSale(ctx.sale, ctx.prefs),
    prefs: ctx.prefs,
  }).grandTotalUgx;
  return `Receipt ${table} UGX ${total.toLocaleString()}`;
}
