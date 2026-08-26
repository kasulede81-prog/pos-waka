/**
 * Phase 1A — pure retail ReceiptDisplayData → ESC/POS bytes.
 *
 * No transport, queue, UI, sale, sync, or printer profile access.
 * Hospitality formatters are intentionally not reused.
 */

import type { ReceiptDisplayData, ReceiptDisplayLine } from "./receiptPrint";
import { receiptLineDetailLabel } from "./receiptPrint";
import { EscPosBuilder, padColumns, type EscPosPaperWidth } from "./escPosBuilder";

export type { EscPosPaperWidth };

/** Fixed locale for deterministic money formatting across environments. */
function fmtUgx(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  return `UGX ${v.toLocaleString("en-US")}`;
}

function pushItem(b: EscPosBuilder, line: ReceiptDisplayLine): void {
  const name = line.name?.trim() || "";
  const total = fmtUgx(line.lineTotalUgx);
  if (name) {
    b.wrapped(name);
  }
  if (line.showCalculation) {
    b.textLine(padColumns(line.quantityLabel, total, b.cols));
  } else if (line.showCustomerPaid) {
    b.textLine(line.quantityLabel);
    b.wrapped(`List ${fmtUgx(line.listPriceUgx)} · Paid ${fmtUgx(line.customerPaidUgx)}`);
    b.textLine(padColumns("", total, b.cols));
  } else {
    const detail = receiptLineDetailLabel(line);
    // Prefer qty on left / total on right when detail is the qty—total form.
    if (detail.includes(" — ")) {
      b.textLine(padColumns(line.quantityLabel, total, b.cols));
    } else {
      b.wrapped(detail);
      b.textLine(padColumns("", total, b.cols));
    }
  }
}

/**
 * Pure retail ESC/POS renderer.
 * Same `display` + `paperWidth` → identical `Uint8Array` (byte-for-byte).
 * Does not mutate `display` or its nested lines.
 */
export function buildRetailReceiptEscPos(
  display: ReceiptDisplayData,
  paperWidth: EscPosPaperWidth = "80mm",
): Uint8Array {
  const b = new EscPosBuilder(paperWidth);
  const opts = display.displayOptions;

  // Header
  const headerSource =
    display.headerLines.length > 0
      ? display.headerLines
      : display.customHeaderLines?.length
        ? display.customHeaderLines
        : null;

  b.align("center");
  if (headerSource?.length) {
    b.bold(true).doubleSize(true);
    b.wrapped(headerSource[0] ?? display.shopName);
    b.doubleSize(false).bold(false);
    for (const line of headerSource.slice(1)) {
      if (line.trim()) b.wrapped(line);
    }
  } else {
    b.bold(true).doubleSize(true).wrapped(display.shopName).doubleSize(false).bold(false);
    if (opts.showShopAddress && display.shopAddress?.trim()) b.wrapped(display.shopAddress.trim());
    if (opts.showShopPhone && display.shopPhone?.trim()) b.wrapped(display.shopPhone.trim());
  }
  b.align("left").rule();

  // Meta
  if (opts.showReceiptNumber && display.receiptNumber.trim()) {
    b.textLine(padColumns("Receipt No:", display.receiptNumber.trim(), b.cols));
  }
  if (display.dateText.trim()) b.textLine(padColumns("Date:", display.dateText.trim(), b.cols));
  if (display.timeText.trim()) b.textLine(padColumns("Time:", display.timeText.trim(), b.cols));
  if (opts.showCashier && display.cashier.trim()) {
    b.textLine(padColumns("Cashier:", display.cashier.trim(), b.cols));
  }
  b.rule();

  // Items
  for (const line of display.lines) {
    pushItem(b, line);
  }
  b.rule();

  // Totals
  b.textLine(padColumns("Subtotal", fmtUgx(display.subtotalUgx), b.cols));
  if (display.lineDiscountsUgx > 0) {
    b.textLine(padColumns("Line discounts", `-${fmtUgx(display.lineDiscountsUgx)}`, b.cols));
  }
  if (display.cartDiscountUgx > 0) {
    b.textLine(padColumns("Cart discount", `-${fmtUgx(display.cartDiscountUgx)}`, b.cols));
  }
  if (display.discountUgx > 0 && display.lineDiscountsUgx <= 0 && display.cartDiscountUgx <= 0) {
    b.textLine(padColumns("Discount", `-${fmtUgx(display.discountUgx)}`, b.cols));
  }
  b.bold(true);
  b.textLine(padColumns("Grand Total", fmtUgx(display.totalUgx), b.cols));
  b.bold(false);
  b.rule();

  // Payment
  b.textLine(padColumns("Paid", fmtUgx(display.paidUgx), b.cols));
  b.textLine(padColumns("Change", fmtUgx(display.changeUgx), b.cols));
  if (opts.showPaymentMethod && display.paymentMethodLabel.trim()) {
    b.textLine(padColumns("Method", display.paymentMethodLabel.trim(), b.cols));
  }
  if (opts.showDebtInfo && display.outstandingDebtUgx > 0) {
    b.textLine(padColumns("Outstanding Debt", fmtUgx(display.outstandingDebtUgx), b.cols));
    if (opts.showCustomerName) {
      const name = display.customerName?.trim() || "Not Recorded";
      b.textLine(padColumns("Customer", name, b.cols));
    }
    if (opts.showCustomerPhone && display.customerPhone?.trim()) {
      b.wrapped(display.customerPhone.trim());
    }
  }

  // Footer
  b.rule();
  b.align("center");
  if (display.returnPolicy?.trim() && !display.footerLines.includes(display.returnPolicy)) {
    b.wrapped(display.returnPolicy.trim());
  }
  for (const foot of display.footerLines) {
    if (foot.trim() || foot === "") b.textLine(foot);
  }
  if (display.footerPowered?.trim()) {
    b.wrapped(display.footerPowered.trim());
  }
  b.align("left");

  b.feed(4).partialCut();
  return b.build();
}
