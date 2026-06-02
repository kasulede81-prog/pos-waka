import { jsPDF } from "jspdf";
import type { Customer, DebtPayment, Product, ReceiptPaperSize, ReturnRecord, Sale } from "../types";
import {
  buildReceiptDisplayData,
  buildSaleReceiptHtml,
  buildSaleReceiptText,
  printReceiptWithFallback,
  type ReceiptDisplayData,
  type ReceiptLabels,
} from "./receiptPrint";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob, printHtmlDocumentWithDesktop, sharePdfBlob } from "./documentPrint";
import { dateKeyKampala } from "./datesUg";

export type SaleReceiptContext = {
  shopName: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
  cashier: string;
  receiptNumber: string;
  sale: Sale;
  productById?: Map<string, Product>;
  customHeaderLines?: string[] | null;
  footerThanks?: string;
  footerPowered?: string;
  returnPolicy?: string | null;
  customerName?: string | null;
  customerBalanceUgx?: number | null;
  labels: ReceiptLabels;
  paper?: ReceiptPaperSize;
};

export type ReturnReceiptContext = {
  shopName: string;
  receiptNumber: string;
  returnRecord: ReturnRecord;
  sale?: Sale | null;
  cashier: string;
  customerName?: string | null;
  paper?: ReceiptPaperSize;
};

export type DebtPaymentReceiptContext = {
  shopName: string;
  receiptNumber: string;
  payment: DebtPayment;
  customer: Customer;
  cashier: string;
  balanceAfterUgx: number;
  paper?: ReceiptPaperSize;
};

function renderDisplayToPdf(doc: jsPDF, display: ReceiptDisplayData, title: string): void {
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, display.shopName.toUpperCase(), { size: 14, bold: true });
  if (display.customHeaderLines?.length) {
    for (const line of display.customHeaderLines) pdfLine(layout, doc, line, { size: 9 });
  } else {
    if (display.shopAddress) pdfLine(layout, doc, display.shopAddress, { size: 9 });
    if (display.shopPhone) pdfLine(layout, doc, display.shopPhone, { size: 9 });
  }
  pdfGap(layout, 6);
  pdfLine(layout, doc, title, { size: 12, bold: true });
  pdfLine(layout, doc, `Receipt No: ${display.receiptNumber}`);
  pdfLine(layout, doc, `Date: ${display.dateText}  Time: ${display.timeText}`);
  pdfLine(layout, doc, `Cashier: ${display.cashier}`);
  pdfGap(layout, 4);
  pdfLine(layout, doc, "Items", { bold: true });
  for (const ln of display.lines) {
    if (ln.showCalculation) {
      pdfLine(layout, doc, ln.name, { bold: true });
      pdfLine(layout, doc, `${ln.quantityLabel} x UGX ${ln.unitPriceUgx.toLocaleString()} = UGX ${ln.lineTotalUgx.toLocaleString()}`, {
        size: 9,
      });
    } else {
      pdfLine(layout, doc, `${ln.quantityLabel} — UGX ${ln.lineTotalUgx.toLocaleString()}`, { size: 9 });
    }
  }
  pdfGap(layout, 4);
  pdfLine(layout, doc, `Subtotal: UGX ${display.subtotalUgx.toLocaleString()}`);
  if (display.discountUgx > 0) pdfLine(layout, doc, `Discount: -UGX ${display.discountUgx.toLocaleString()}`);
  pdfLine(layout, doc, `Grand Total: UGX ${display.totalUgx.toLocaleString()}`, { bold: true });
  pdfLine(layout, doc, `Paid: UGX ${display.paidUgx.toLocaleString()}`);
  pdfLine(layout, doc, `Change: UGX ${display.changeUgx.toLocaleString()}`);
  pdfLine(layout, doc, `Method: ${display.paymentMethodLabel}`);
  if (display.returnPolicy) pdfLine(layout, doc, display.returnPolicy, { size: 8 });
  pdfGap(layout, 6);
  pdfLine(layout, doc, display.footerThanks, { size: 9 });
  pdfLine(layout, doc, display.footerPowered, { size: 8 });
}

export function buildSaleReceiptPdfBlob(ctx: SaleReceiptContext): Blob {
  const display = buildReceiptDisplayData({
    shopName: ctx.shopName,
    shopAddress: ctx.shopAddress,
    shopPhone: ctx.shopPhone,
    cashier: ctx.cashier,
    receiptNumber: ctx.receiptNumber,
    sale: ctx.sale,
    productById: ctx.productById,
    customHeaderLines: ctx.customHeaderLines,
    footerThanks: ctx.footerThanks,
    footerPowered: ctx.footerPowered,
    returnPolicy: ctx.returnPolicy,
  });
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  renderDisplayToPdf(doc, display, "SALE RECEIPT");
  return doc.output("blob");
}

export function buildReturnReceiptPdfBlob(ctx: ReturnReceiptContext): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  const r = ctx.returnRecord;
  const when = new Date(r.createdAt).toLocaleString("en-UG", { timeZone: "Africa/Kampala" });
  pdfLine(layout, doc, ctx.shopName.toUpperCase(), { size: 14, bold: true });
  pdfGap(layout, 6);
  pdfLine(layout, doc, "RETURN RECEIPT", { size: 12, bold: true });
  pdfLine(layout, doc, `Receipt No: ${ctx.receiptNumber}`);
  pdfLine(layout, doc, `Date: ${when}`);
  pdfLine(layout, doc, `Cashier: ${ctx.cashier}`);
  if (ctx.customerName) pdfLine(layout, doc, `Customer: ${ctx.customerName}`);
  pdfGap(layout, 4);
  pdfLine(layout, doc, r.productName, { bold: true });
  pdfLine(layout, doc, `Qty: ${r.quantity}`);
  pdfLine(layout, doc, `Refund: UGX ${r.refundAmountUgx.toLocaleString()}`, { bold: true });
  pdfLine(layout, doc, `Reason: ${r.reason}`);
  if (r.note?.trim()) pdfLine(layout, doc, `Note: ${r.note.trim()}`);
  if (ctx.sale) pdfLine(layout, doc, `Original sale: #${ctx.sale.id.slice(0, 8)}`, { size: 9 });
  pdfGap(layout, 6);
  pdfLine(layout, doc, "Powered by Waka POS", { size: 8 });
  return doc.output("blob");
}

export function buildDebtPaymentReceiptPdfBlob(ctx: DebtPaymentReceiptContext): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  const when = new Date(ctx.payment.createdAt).toLocaleString("en-UG", { timeZone: "Africa/Kampala" });
  pdfLine(layout, doc, ctx.shopName.toUpperCase(), { size: 14, bold: true });
  pdfGap(layout, 6);
  pdfLine(layout, doc, "DEBT PAYMENT RECEIPT", { size: 12, bold: true });
  pdfLine(layout, doc, `Receipt No: ${ctx.receiptNumber}`);
  pdfLine(layout, doc, `Date: ${when}`);
  pdfLine(layout, doc, `Cashier: ${ctx.cashier}`);
  pdfLine(layout, doc, `Customer: ${ctx.customer.name}`);
  if (ctx.customer.phone) pdfLine(layout, doc, `Phone: ${ctx.customer.phone}`);
  pdfGap(layout, 4);
  pdfLine(layout, doc, `Amount paid: UGX ${ctx.payment.amountUgx.toLocaleString()}`, { bold: true });
  pdfLine(layout, doc, `Balance after: UGX ${ctx.balanceAfterUgx.toLocaleString()}`);
  pdfGap(layout, 6);
  pdfLine(layout, doc, "Powered by Waka POS", { size: 8 });
  return doc.output("blob");
}

export function saleReceiptPlain(ctx: SaleReceiptContext): string {
  return buildSaleReceiptText({
    shopName: ctx.shopName,
    shopAddress: ctx.shopAddress,
    shopPhone: ctx.shopPhone,
    cashier: ctx.cashier,
    receiptNumber: ctx.receiptNumber,
    sale: ctx.sale,
    productById: ctx.productById,
    customHeaderLines: ctx.customHeaderLines,
    footerThanks: ctx.footerThanks,
    footerPowered: ctx.footerPowered,
    returnPolicy: ctx.returnPolicy,
    customerName: ctx.customerName ?? null,
    customerBalanceUgx: ctx.customerBalanceUgx ?? null,
    labels: ctx.labels,
  });
}

export function saleReceiptHtml(ctx: SaleReceiptContext): string {
  const display = buildReceiptDisplayData({
    shopName: ctx.shopName,
    shopAddress: ctx.shopAddress,
    shopPhone: ctx.shopPhone,
    cashier: ctx.cashier,
    receiptNumber: ctx.receiptNumber,
    sale: ctx.sale,
    productById: ctx.productById,
    customHeaderLines: ctx.customHeaderLines,
    footerThanks: ctx.footerThanks,
    footerPowered: ctx.footerPowered,
    returnPolicy: ctx.returnPolicy,
  });
  return buildSaleReceiptHtml(display);
}

function returnReceiptHtml(ctx: ReturnReceiptContext): string {
  const r = ctx.returnRecord;
  const when = new Date(r.createdAt).toLocaleString("en-UG", { timeZone: "Africa/Kampala" });
  return `<article class="waka-receipt">
    <header class="header"><h2>${ctx.shopName}</h2></header>
    <p><strong>RETURN RECEIPT</strong></p>
    <p>Receipt No: ${ctx.receiptNumber}<br/>${when}<br/>Cashier: ${ctx.cashier}</p>
    ${ctx.customerName ? `<p>Customer: ${ctx.customerName}</p>` : ""}
    <p><strong>${r.productName}</strong><br/>Qty: ${r.quantity}<br/>Refund: UGX ${r.refundAmountUgx.toLocaleString()}<br/>Reason: ${r.reason}</p>
  </article>`;
}

function debtReceiptHtml(ctx: DebtPaymentReceiptContext): string {
  const when = new Date(ctx.payment.createdAt).toLocaleString("en-UG", { timeZone: "Africa/Kampala" });
  return `<article class="waka-receipt">
    <header class="header"><h2>${ctx.shopName}</h2></header>
    <p><strong>DEBT PAYMENT RECEIPT</strong></p>
    <p>Receipt No: ${ctx.receiptNumber}<br/>${when}<br/>Cashier: ${ctx.cashier}</p>
    <p>Customer: ${ctx.customer.name}</p>
    <p><strong>UGX ${ctx.payment.amountUgx.toLocaleString()}</strong><br/>Balance after: UGX ${ctx.balanceAfterUgx.toLocaleString()}</p>
  </article>`;
}

export function receiptPdfFilename(kind: "sale" | "return" | "debt", id: string): string {
  const day = dateKeyKampala(new Date());
  return sanitizePdfStem(`waka-receipt-${kind}-${id.slice(0, 8)}-${day}`) + ".pdf";
}

export async function printSaleReceipt(ctx: SaleReceiptContext): Promise<{ ok: boolean }> {
  const paper = ctx.paper ?? "80mm";
  const plain = saleReceiptPlain(ctx);
  const native = await printReceiptWithFallback(plain, paper);
  if (native.ok) return { ok: true };
  const html = saleReceiptHtml(ctx);
  return { ok: await printHtmlDocumentWithDesktop(html, paper, "Waka receipt") };
}

export async function downloadSaleReceiptPdf(ctx: SaleReceiptContext): Promise<boolean> {
  const blob = buildSaleReceiptPdfBlob(ctx);
  return downloadPdfBlob(receiptPdfFilename("sale", ctx.sale.id), blob);
}

export async function shareSaleReceiptPdf(ctx: SaleReceiptContext): Promise<boolean> {
  const blob = buildSaleReceiptPdfBlob(ctx);
  return sharePdfBlob(receiptPdfFilename("sale", ctx.sale.id), blob);
}

export async function printReturnReceipt(ctx: ReturnReceiptContext): Promise<{ ok: boolean }> {
  const paper = ctx.paper ?? "80mm";
  return { ok: await printHtmlDocumentWithDesktop(returnReceiptHtml(ctx), paper, "Return receipt") };
}

export async function downloadReturnReceiptPdf(ctx: ReturnReceiptContext): Promise<boolean> {
  const blob = buildReturnReceiptPdfBlob(ctx);
  return downloadPdfBlob(receiptPdfFilename("return", ctx.returnRecord.id), blob);
}

export async function shareReturnReceiptPdf(ctx: ReturnReceiptContext): Promise<boolean> {
  const blob = buildReturnReceiptPdfBlob(ctx);
  return sharePdfBlob(receiptPdfFilename("return", ctx.returnRecord.id), blob);
}

export async function printDebtPaymentReceipt(ctx: DebtPaymentReceiptContext): Promise<{ ok: boolean }> {
  const paper = ctx.paper ?? "80mm";
  return { ok: await printHtmlDocumentWithDesktop(debtReceiptHtml(ctx), paper, "Debt payment receipt") };
}

export async function downloadDebtPaymentReceiptPdf(ctx: DebtPaymentReceiptContext): Promise<boolean> {
  const blob = buildDebtPaymentReceiptPdfBlob(ctx);
  return downloadPdfBlob(receiptPdfFilename("debt", ctx.payment.id), blob);
}

export async function shareDebtPaymentReceiptPdf(ctx: DebtPaymentReceiptContext): Promise<boolean> {
  const blob = buildDebtPaymentReceiptPdfBlob(ctx);
  return sharePdfBlob(receiptPdfFilename("debt", ctx.payment.id), blob);
}

/** Short receipt number from record id + day */
export function documentReceiptNumber(prefix: string, id: string, createdAt: string): string {
  const day = dateKeyKampala(createdAt).replace(/-/g, "");
  return `${prefix}-${day}-${id.slice(0, 6).toUpperCase()}`;
}
