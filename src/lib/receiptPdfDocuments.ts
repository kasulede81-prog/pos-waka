import type { jsPDF } from "jspdf";
import type { Customer, ReceiptPaperSize } from "../types";
import {
  buildReceiptDisplayData,
  receiptLineDetailLabel,
  type ReceiptDisplayData,
} from "./receiptPrint";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob, sharePdfBlob } from "./documentPrint";
import { dateKeyKampala } from "./datesUg";
import { formatReceiptLineCalculation } from "./saleQuantityLabel";
import type { DebtPaymentReceiptContext, ReturnReceiptContext, SaleReceiptContext } from "./receiptDocuments";

let jsPdfModule: Promise<typeof import("jspdf")> | undefined;

async function loadJsPdf(): Promise<typeof import("jspdf").jsPDF> {
  jsPdfModule ??= import("jspdf");
  return (await jsPdfModule).jsPDF;
}

function renderDisplayToPdf(doc: jsPDF, display: ReceiptDisplayData, title: string): void {
  const layout = createPdfLayout(doc);
  const headerBlock = display.headerLines.length ? display.headerLines : display.customHeaderLines;
  if (headerBlock?.length) {
    for (const line of headerBlock) pdfLine(layout, doc, line, { size: 9, bold: line === headerBlock[0] });
  } else {
    pdfLine(layout, doc, display.shopName.toUpperCase(), { size: 14, bold: true });
    if (display.displayOptions.showShopAddress && display.shopAddress) pdfLine(layout, doc, display.shopAddress, { size: 9 });
    if (display.displayOptions.showShopPhone && display.shopPhone) pdfLine(layout, doc, display.shopPhone, { size: 9 });
  }
  pdfGap(layout, 6);
  pdfLine(layout, doc, title, { size: 12, bold: true });
  if (display.displayOptions.showReceiptNumber) pdfLine(layout, doc, `Receipt No: ${display.receiptNumber}`);
  pdfLine(layout, doc, `Date: ${display.dateText}  Time: ${display.timeText}`);
  if (display.displayOptions.showCashier) pdfLine(layout, doc, `Cashier: ${display.cashier}`);
  pdfGap(layout, 4);
  pdfLine(layout, doc, "Items", { bold: true });
  for (const ln of display.lines) {
    if (ln.showCalculation) {
      pdfLine(layout, doc, ln.name, { bold: true });
      pdfLine(layout, doc, formatReceiptLineCalculation(ln.quantityLabel, ln.unitPriceUgx, ln.lineTotalUgx), {
        size: 9,
      });
    } else {
      if (ln.name?.trim()) pdfLine(layout, doc, ln.name, { bold: true });
      pdfLine(layout, doc, receiptLineDetailLabel(ln), { size: 9 });
    }
  }
  pdfGap(layout, 4);
  pdfLine(layout, doc, `Subtotal: UGX ${display.subtotalUgx.toLocaleString()}`);
  if (display.discountUgx > 0) pdfLine(layout, doc, `Discount: -UGX ${display.discountUgx.toLocaleString()}`);
  pdfLine(layout, doc, `Grand Total: UGX ${display.totalUgx.toLocaleString()}`, { bold: true });
  pdfLine(layout, doc, `Paid: UGX ${display.paidUgx.toLocaleString()}`);
  pdfLine(layout, doc, `Change: UGX ${display.changeUgx.toLocaleString()}`);
  if (display.displayOptions.showPaymentMethod) {
    pdfLine(layout, doc, `Method: ${display.paymentMethodLabel}`);
  }
  if (display.displayOptions.showDebtInfo && display.outstandingDebtUgx > 0) {
    pdfLine(layout, doc, `Outstanding Debt: UGX ${display.outstandingDebtUgx.toLocaleString()}`, { bold: true });
    if (display.displayOptions.showCustomerName) {
      pdfLine(layout, doc, `Customer: ${display.customerName?.trim() || "Not Recorded"}`);
    }
    if (display.displayOptions.showCustomerPhone && display.customerPhone?.trim()) {
      pdfLine(layout, doc, `Phone: ${display.customerPhone.trim()}`);
    }
  }
  if (display.returnPolicy && !display.footerLines.includes(display.returnPolicy)) {
    pdfLine(layout, doc, display.returnPolicy, { size: 8 });
  }
  pdfGap(layout, 6);
  for (const line of display.footerLines) pdfLine(layout, doc, line, { size: 9 });
  if (display.footerPowered) pdfLine(layout, doc, display.footerPowered, { size: 8 });
}

function thermalWidthMm(paper: ReceiptPaperSize): number {
  if (paper === "58mm") return 58;
  return 80;
}

async function renderDisplayToThermalPdf(
  display: ReceiptDisplayData,
  title: string,
  paper: ReceiptPaperSize,
): Promise<Blob> {
  const jsPDF = await loadJsPdf();
  const widthMm = thermalWidthMm(paper);
  const marginMm = 3;
  const fontMm = 2.6;
  const lineMm = 3.35;
  const sectionGapMm = 2;

  const lineCount =
    (display.headerLines.length || display.customHeaderLines?.length || 3) +
    6 +
    display.lines.length * 2 +
    8 +
    display.footerLines.length;
  const pageHeightMm = Math.max(48, marginMm * 2 + lineCount * lineMm + sectionGapMm * 4);

  const doc = new jsPDF({ unit: "mm", format: [widthMm, pageHeightMm], orientation: "portrait" });
  let y = marginMm;
  const maxW = widthMm - marginMm * 2;

  const write = (text: string, opts?: { bold?: boolean; gap?: number }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(fontMm);
    for (const ln of doc.splitTextToSize(text, maxW) as string[]) {
      doc.text(ln, marginMm, y);
      y += opts?.gap ?? lineMm;
    }
  };

  const headerBlock = display.headerLines.length ? display.headerLines : display.customHeaderLines;
  if (headerBlock?.length) {
    for (const line of headerBlock) write(line, { bold: line === headerBlock[0] });
  } else {
    write(display.shopName.toUpperCase(), { bold: true });
    if (display.displayOptions.showShopAddress && display.shopAddress) write(display.shopAddress);
    if (display.displayOptions.showShopPhone && display.shopPhone) write(display.shopPhone);
  }
  y += sectionGapMm;
  write(title, { bold: true });
  if (display.displayOptions.showReceiptNumber) write(`Receipt No: ${display.receiptNumber}`);
  write(`Date: ${display.dateText}  Time: ${display.timeText}`);
  if (display.displayOptions.showCashier) write(`Cashier: ${display.cashier}`);
  y += sectionGapMm;
  write("Items", { bold: true });
  for (const ln of display.lines) {
    if (ln.showCalculation) {
      write(ln.name, { bold: true });
      write(formatReceiptLineCalculation(ln.quantityLabel, ln.unitPriceUgx, ln.lineTotalUgx));
    } else {
      if (ln.name?.trim()) write(ln.name, { bold: true });
      write(receiptLineDetailLabel(ln));
    }
  }
  y += sectionGapMm;
  write(`Subtotal: UGX ${display.subtotalUgx.toLocaleString()}`);
  if (display.discountUgx > 0) write(`Discount: -UGX ${display.discountUgx.toLocaleString()}`);
  write(`Grand Total: UGX ${display.totalUgx.toLocaleString()}`, { bold: true });
  write(`Paid: UGX ${display.paidUgx.toLocaleString()}`);
  write(`Change: UGX ${display.changeUgx.toLocaleString()}`);
  if (display.displayOptions.showPaymentMethod) write(`Method: ${display.paymentMethodLabel}`);
  if (display.displayOptions.showDebtInfo && display.outstandingDebtUgx > 0) {
    write(`Outstanding Debt: UGX ${display.outstandingDebtUgx.toLocaleString()}`, { bold: true });
  }
  y += sectionGapMm;
  for (const line of display.footerLines) write(line);
  if (display.footerPowered) write(display.footerPowered);

  return doc.output("blob");
}

function saleDisplay(ctx: SaleReceiptContext): ReceiptDisplayData {
  return buildReceiptDisplayData({
    shopName: ctx.shopName,
    shopAddress: ctx.shopAddress,
    shopPhone: ctx.shopPhone,
    cashier: ctx.cashier,
    receiptNumber: ctx.receiptNumber,
    sale: ctx.sale,
    productById: ctx.productById,
    customHeaderLines: ctx.customHeaderLines,
    headerLines: ctx.headerLines,
    footerLines: ctx.footerLines,
    footerThanks: ctx.footerThanks,
    footerPowered: ctx.footerPowered ?? undefined,
    returnPolicy: ctx.returnPolicy,
    displayOptions: ctx.displayOptions,
    customerName: ctx.customerName,
    customerPhone: ctx.customerPhone,
    customerBalanceUgx: ctx.customerBalanceUgx,
  });
}

export async function buildSaleReceiptPdfBlob(ctx: SaleReceiptContext): Promise<Blob> {
  const display = saleDisplay(ctx);
  const paper = ctx.paper ?? "80mm";
  if (paper === "80mm" || paper === "58mm") {
    return renderDisplayToThermalPdf(display, "SALE RECEIPT", paper);
  }
  const jsPDF = await loadJsPdf();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  renderDisplayToPdf(doc, display, "SALE RECEIPT");
  return doc.output("blob");
}

export async function buildReturnReceiptPdfBlob(ctx: ReturnReceiptContext): Promise<Blob> {
  const jsPDF = await loadJsPdf();
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

function debtCustomerLabel(customer: Customer): string {
  return customer.name?.trim() || "Not Recorded";
}

export async function buildDebtPaymentReceiptPdfBlob(ctx: DebtPaymentReceiptContext): Promise<Blob> {
  const jsPDF = await loadJsPdf();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  const when = new Date(ctx.payment.createdAt).toLocaleString("en-UG", { timeZone: "Africa/Kampala" });
  const header = ctx.headerLines?.length ? ctx.headerLines : [ctx.shopName.toUpperCase()];
  for (const line of header) pdfLine(layout, doc, line, { size: line === header[0] ? 14 : 10, bold: line === header[0] });
  pdfGap(layout, 6);
  pdfLine(layout, doc, "DEBT PAYMENT RECEIPT", { size: 12, bold: true });
  pdfLine(layout, doc, `Receipt No: ${ctx.receiptNumber}`);
  pdfLine(layout, doc, `Date: ${when}`);
  pdfLine(layout, doc, `Cashier: ${ctx.cashier}`);
  pdfLine(layout, doc, `Customer: ${debtCustomerLabel(ctx.customer)}`);
  if (ctx.customer.phone?.trim()) pdfLine(layout, doc, `Phone: ${ctx.customer.phone.trim()}`);
  pdfGap(layout, 4);
  pdfLine(layout, doc, `Amount paid: UGX ${ctx.payment.amountUgx.toLocaleString()}`, { bold: true });
  pdfLine(layout, doc, `Balance after: UGX ${ctx.balanceAfterUgx.toLocaleString()}`);
  pdfGap(layout, 4);
  for (const foot of ctx.footerLines ?? []) pdfLine(layout, doc, foot);
  if (ctx.footerPowered) pdfLine(layout, doc, ctx.footerPowered, { size: 8 });
  return doc.output("blob");
}

export function receiptPdfFilename(kind: "sale" | "return" | "debt", id: string): string {
  const day = dateKeyKampala(new Date());
  return sanitizePdfStem(`waka-receipt-${kind}-${id.slice(0, 8)}-${day}`) + ".pdf";
}

export async function downloadSaleReceiptPdf(ctx: SaleReceiptContext): Promise<boolean> {
  const blob = await buildSaleReceiptPdfBlob(ctx);
  return downloadPdfBlob(receiptPdfFilename("sale", ctx.sale.id), blob);
}

export async function shareSaleReceiptPdf(ctx: SaleReceiptContext): Promise<boolean> {
  const blob = await buildSaleReceiptPdfBlob(ctx);
  return sharePdfBlob(receiptPdfFilename("sale", ctx.sale.id), blob);
}

export async function downloadReturnReceiptPdf(ctx: ReturnReceiptContext): Promise<boolean> {
  const blob = await buildReturnReceiptPdfBlob(ctx);
  return downloadPdfBlob(receiptPdfFilename("return", ctx.returnRecord.id), blob);
}

export async function shareReturnReceiptPdf(ctx: ReturnReceiptContext): Promise<boolean> {
  const blob = await buildReturnReceiptPdfBlob(ctx);
  return sharePdfBlob(receiptPdfFilename("return", ctx.returnRecord.id), blob);
}

export async function downloadDebtPaymentReceiptPdf(ctx: DebtPaymentReceiptContext): Promise<boolean> {
  const blob = await buildDebtPaymentReceiptPdfBlob(ctx);
  return downloadPdfBlob(receiptPdfFilename("debt", ctx.payment.id), blob);
}

export async function shareDebtPaymentReceiptPdf(ctx: DebtPaymentReceiptContext): Promise<boolean> {
  const blob = await buildDebtPaymentReceiptPdfBlob(ctx);
  return sharePdfBlob(receiptPdfFilename("debt", ctx.payment.id), blob);
}
