/**
 * Pure Debt Payment receipt → ESC/POS bytes.
 *
 * Presentation only. Does not read stores, enqueue jobs, or recalculate
 * debt / cash / balances. Amount is payment.amountUgx as stored.
 * Remaining balance is ctx.balanceAfterUgx as already snapshotted.
 */

import type { DebtPaymentReceiptContext } from "./receiptDocuments";
import { formatDateTimeKampala } from "./datesUg";
import { EscPosBuilder, type EscPosPaperWidth } from "./escPosBuilder";

export type { EscPosPaperWidth };

/** Same money presentation as retail thermal receipts. Does not recalculate debt. */
function fmtUgx(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `UGX ${v.toLocaleString("en-US")}`;
}

function customerLabel(ctx: DebtPaymentReceiptContext): string {
  return ctx.customer.name?.trim() || "Not Recorded";
}

function customerPhone(ctx: DebtPaymentReceiptContext): string | null {
  const phone = ctx.customer.phone?.trim();
  return phone ? phone : null;
}

/**
 * Pure Debt Payment ESC/POS renderer.
 * Same context + paperWidth → identical Uint8Array.
 * Does not mutate ctx, payment, or customer.
 */
export function buildDebtReceiptEscPos(
  ctx: DebtPaymentReceiptContext,
  paperWidth: EscPosPaperWidth,
): Uint8Array {
  const b = new EscPosBuilder(paperWidth);
  const when = formatDateTimeKampala(ctx.payment.createdAt);
  const headerSource = ctx.headerLines?.length ? ctx.headerLines : [ctx.shopName];

  b.align("center");
  b.bold(true).doubleSize(true);
  b.wrapped(headerSource[0] ?? ctx.shopName);
  b.doubleSize(false).bold(false);
  for (const line of headerSource.slice(1)) {
    if (line.trim()) b.wrapped(line);
  }
  b.wrapped("DEBT PAYMENT RECEIPT");
  b.align("left").rule();

  if (ctx.receiptNumber.trim()) {
    b.aligned("Receipt No:", ctx.receiptNumber.trim());
  }
  b.aligned("Date:", when.dateKey);
  b.aligned("Time:", when.time);
  b.aligned("Customer:", customerLabel(ctx));
  const phone = customerPhone(ctx);
  if (phone) {
    b.aligned("Phone:", phone);
  }
  b.rule();

  b.bold(true);
  b.aligned("Amount paid", fmtUgx(ctx.payment.amountUgx));
  b.bold(false);
  b.aligned("Balance after", fmtUgx(ctx.balanceAfterUgx));
  b.rule();

  if (ctx.cashier.trim()) {
    b.aligned("Cashier:", ctx.cashier.trim());
  }

  b.align("center");
  for (const foot of ctx.footerLines ?? []) {
    if (foot.trim()) b.wrapped(foot);
  }
  if (ctx.footerPowered?.trim()) {
    b.wrapped(ctx.footerPowered.trim());
  }
  b.align("left");

  b.finalize();
  return b.build();
}
