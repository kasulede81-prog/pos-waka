/**
 * Pre-payment "bill check" for a restaurant table (printing audit, P1.11).
 *
 * This is the paper the waiter hands the guest *before* payment. It is built purely
 * from the numbers already shown in `BillPreviewSheet` — it reads no store, writes
 * nothing, and settles nothing: printing a bill must never create a sale, mark an
 * order paid, move stock, or record a financial transaction.
 */
import type { Language } from "../types";
import { t } from "./i18n";
import { formatUgx } from "./formatUgx";
import { printReceiptFallback, type ReceiptFallbackResult } from "./receiptNativeFallback";

export type RestaurantBillPreviewLine = {
  id: string;
  name: string;
  quantity: number;
  lineTotalUgx: number;
};

export type RestaurantBillPreviewPayment = {
  id: string;
  method: string;
  amountUgx: number;
};

export type RestaurantBillPreviewInput = {
  lang: Language;
  shopName: string;
  headerLine?: string | null;
  tableLabel: string;
  areaName?: string | null;
  guestCount: number;
  waiterLabel?: string | null;
  lines: RestaurantBillPreviewLine[];
  listSubtotalUgx: number;
  discountUgx: number;
  serviceChargeUgx: number;
  tipUgx: number;
  grandTotalUgx: number;
  payments: RestaurantBillPreviewPayment[];
  remainingBalanceUgx: number;
  footerNote?: string | null;
};

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildRestaurantBillPreviewPlain(input: RestaurantBillPreviewInput): string {
  const { lang } = input;
  const rows: string[] = [];
  rows.push(input.shopName);
  if (input.headerLine?.trim()) rows.push(input.headerLine.trim());
  rows.push(t(lang, "restaurantBillPreviewTitle"));
  rows.push("");
  rows.push(`${t(lang, "restaurantBillTable")}: ${input.tableLabel}`);
  if (input.areaName) rows.push(`${t(lang, "restaurantBillArea")}: ${input.areaName}`);
  rows.push(`${t(lang, "tableOrderGuests")}: ${input.guestCount}`);
  if (input.waiterLabel) rows.push(`${t(lang, "restaurantBillWaiter")}: ${input.waiterLabel}`);
  rows.push("");
  for (const line of input.lines) {
    rows.push(`${line.quantity} x ${line.name}`);
    rows.push(formatUgx(line.lineTotalUgx));
  }
  rows.push("");
  rows.push(`${t(lang, "receiptSubtotalLabel")}: ${formatUgx(input.listSubtotalUgx)}`);
  if (input.discountUgx > 0) rows.push(`${t(lang, "receiptDiscountLabel")}: -${formatUgx(input.discountUgx)}`);
  if (input.serviceChargeUgx > 0) {
    rows.push(`${t(lang, "restaurantBillServiceCharge")}: ${formatUgx(input.serviceChargeUgx)}`);
  }
  if (input.tipUgx > 0) rows.push(`${t(lang, "restaurantBillTip")}: ${formatUgx(input.tipUgx)}`);
  rows.push(`${t(lang, "receiptGrandTotalLabel")}: ${formatUgx(input.grandTotalUgx)}`);
  if (input.payments.length) {
    rows.push("");
    rows.push(t(lang, "restaurantBillPaymentSummary"));
    for (const p of input.payments) {
      rows.push(`${t(lang, `paymentMethod_${p.method}`)}: ${formatUgx(p.amountUgx)}`);
    }
    rows.push(`${t(lang, "restaurantBillBalance")}: ${formatUgx(input.remainingBalanceUgx)}`);
  }
  if (input.footerNote?.trim()) {
    rows.push("");
    rows.push(input.footerNote.trim());
  }
  return rows.join("\n");
}

export function buildRestaurantBillPreviewHtml(input: RestaurantBillPreviewInput): string {
  const { lang } = input;
  const linesHtml = input.lines
    .map(
      (line) =>
        `<div style="display:flex;justify-content:space-between;gap:8px"><span>${line.quantity} ${esc(line.name)}</span><span>${esc(formatUgx(line.lineTotalUgx))}</span></div>`,
    )
    .join("");
  const optional = [
    input.discountUgx > 0
      ? `<div style="display:flex;justify-content:space-between"><span>${esc(t(lang, "receiptDiscountLabel"))}</span><span>-${esc(formatUgx(input.discountUgx))}</span></div>`
      : "",
    input.serviceChargeUgx > 0
      ? `<div style="display:flex;justify-content:space-between"><span>${esc(t(lang, "restaurantBillServiceCharge"))}</span><span>${esc(formatUgx(input.serviceChargeUgx))}</span></div>`
      : "",
    input.tipUgx > 0
      ? `<div style="display:flex;justify-content:space-between"><span>${esc(t(lang, "restaurantBillTip"))}</span><span>${esc(formatUgx(input.tipUgx))}</span></div>`
      : "",
  ].join("");
  const paymentsHtml = input.payments.length
    ? `<hr style="border:none;border-top:1px dashed #cbd5e1;margin:8px 0"/>` +
      `<p style="font-weight:900;margin:4px 0">${esc(t(lang, "restaurantBillPaymentSummary"))}</p>` +
      input.payments
        .map(
          (p) =>
            `<div style="display:flex;justify-content:space-between"><span>${esc(t(lang, `paymentMethod_${p.method}`))}</span><span>${esc(formatUgx(p.amountUgx))}</span></div>`,
        )
        .join("") +
      `<div style="display:flex;justify-content:space-between;font-weight:700"><span>${esc(t(lang, "restaurantBillBalance"))}</span><span>${esc(formatUgx(input.remainingBalanceUgx))}</span></div>`
    : "";

  return `<article class="waka-receipt">
  <header class="header"><h2>${esc(input.shopName)}</h2>${input.headerLine?.trim() ? `<p>${esc(input.headerLine.trim())}</p>` : ""}<p>${esc(t(lang, "restaurantBillPreviewTitle"))}</p></header>
  <p>${esc(t(lang, "restaurantBillTable"))}: <strong>${esc(input.tableLabel)}</strong>${input.areaName ? ` · ${esc(input.areaName)}` : ""}</p>
  <p>${esc(t(lang, "tableOrderGuests"))}: ${input.guestCount}${input.waiterLabel ? ` · ${esc(t(lang, "restaurantBillWaiter"))}: ${esc(input.waiterLabel)}` : ""}</p>
  <section>${linesHtml}</section>
  <hr style="border:none;border-top:1px dashed #cbd5e1;margin:8px 0"/>
  <div style="display:flex;justify-content:space-between"><span>${esc(t(lang, "receiptSubtotalLabel"))}</span><span>${esc(formatUgx(input.listSubtotalUgx))}</span></div>
  ${optional}
  <div style="display:flex;justify-content:space-between;font-weight:900;font-size:1.05em"><span>${esc(t(lang, "receiptGrandTotalLabel"))}</span><span>${esc(formatUgx(input.grandTotalUgx))}</span></div>
  ${paymentsHtml}
  ${input.footerNote?.trim() ? `<footer><p>${esc(input.footerNote.trim())}</p></footer>` : ""}
</article>`;
}

/** Print the bill check. Pure presentation — no sale, stock, or ledger effect. */
export async function printRestaurantBillPreview(
  input: RestaurantBillPreviewInput,
): Promise<ReceiptFallbackResult> {
  return printReceiptFallback({
    plainText: buildRestaurantBillPreviewPlain(input),
    html: buildRestaurantBillPreviewHtml(input),
    paper: "80mm",
    filenameStem: `bill-${input.tableLabel}`,
    title: t(input.lang, "restaurantBillPreviewTitle"),
  });
}
