/**
 * Pure Return/Refund receipt → ESC/POS bytes.
 *
 * Presentation only. Does not read stores, enqueue jobs, or recalculate
 * refund / stock / cash. Refund total is returnRecord.refundAmountUgx as stored.
 */

import type { ReturnReceiptContext } from "./receiptDocuments";
import { formatDateTimeKampala } from "./datesUg";
import { EscPosBuilder, type EscPosPaperWidth } from "./escPosBuilder";

export type { EscPosPaperWidth };

/** Same money presentation as retail thermal receipts. Does not recalculate refunds. */
function fmtUgx(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `UGX ${v.toLocaleString("en-US")}`;
}

function linkedSaleId(saleId: string | null | undefined): string | null {
  const id = saleId?.trim();
  return id ? id : null;
}

/**
 * Pure Return ESC/POS renderer.
 * Same context + paperWidth → identical Uint8Array.
 * Does not mutate ctx or returnRecord.
 */
export function buildReturnReceiptEscPos(
  ctx: ReturnReceiptContext,
  paperWidth: EscPosPaperWidth,
): Uint8Array {
  const r = ctx.returnRecord;
  const b = new EscPosBuilder(paperWidth);
  const when = formatDateTimeKampala(r.createdAt);
  const saleRef = linkedSaleId(r.saleId);

  b.align("center");
  b.bold(true).doubleSize(true).wrapped(ctx.shopName).doubleSize(false).bold(false);
  b.wrapped("RETURN RECEIPT");
  b.align("left").rule();

  if (ctx.receiptNumber.trim()) {
    b.aligned("Receipt No:", ctx.receiptNumber.trim());
  }
  b.aligned("Date:", when.dateKey);
  b.aligned("Time:", when.time);
  if (saleRef) {
    b.aligned("Sale:", `#${saleRef.slice(0, 8)}`);
  }
  b.rule();

  const name = r.productName?.trim() || "";
  if (name) b.wrapped(name);
  b.aligned(`Qty ${r.quantity}`, fmtUgx(r.refundAmountUgx));
  b.wrapped(`Reason: ${r.reason}`);
  const note = r.note?.trim();
  if (note) b.wrapped(`Note: ${note}`);
  b.rule();

  b.bold(true);
  b.aligned("Refund", fmtUgx(r.refundAmountUgx));
  b.bold(false);
  b.rule();

  if (ctx.cashier.trim()) {
    b.aligned("Cashier:", ctx.cashier.trim());
  }
  if (ctx.customerName?.trim()) {
    b.aligned("Customer:", ctx.customerName.trim());
  }

  b.align("center");
  b.wrapped("Powered by Waka POS");
  b.align("left");

  b.finalize();
  return b.build();
}
