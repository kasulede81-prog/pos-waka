import type { Customer, DebtPayment, Product, ReceiptPaperSize, ReturnRecord, Sale } from "../types";
import {
  buildReceiptDisplayData,
  buildSaleReceiptHtml,
  buildSaleReceiptText,
  printReceiptWithFallback,
  type ReceiptLabels,
} from "./receiptPrint";
import { printHtmlDocumentWithDesktop } from "./documentPrint";
import { isNativePrintPlatform } from "./nativePrintPlatform";
import { sharePlainReceiptForPrint } from "./nativeReceiptPrint";
import { dateKeyKampala } from "./datesUg";
import { sanitizePdfStem } from "./pdfLayout";

export type SaleReceiptContext = {
  shopName: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
  cashier: string;
  receiptNumber: string;
  sale: Sale;
  productById?: Map<string, Product>;
  customHeaderLines?: string[] | null;
  headerLines?: string[];
  footerLines?: string[];
  footerThanks?: string;
  footerPowered?: string | null;
  returnPolicy?: string | null;
  displayOptions?: import("../types").ReceiptDisplayOptions;
  customerName?: string | null;
  customerPhone?: string | null;
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
  headerLines?: string[];
  footerLines?: string[];
  footerPowered?: string | null;
  paper?: ReceiptPaperSize;
};

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
    headerLines: ctx.headerLines,
    footerLines: ctx.footerLines,
    footerThanks: ctx.footerThanks,
    footerPowered: ctx.footerPowered ?? undefined,
    returnPolicy: ctx.returnPolicy,
    displayOptions: ctx.displayOptions,
    customerName: ctx.customerName ?? null,
    customerPhone: ctx.customerPhone ?? null,
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
  const headerHtml = (ctx.headerLines?.length ? ctx.headerLines : [ctx.shopName])
    .map((l) => `<p>${l}</p>`)
    .join("");
  const footerHtml = [...(ctx.footerLines ?? []), ctx.footerPowered].filter(Boolean).map((l) => `<p>${l}</p>`).join("");
  return `<article class="waka-receipt">
    <header class="header">${headerHtml}</header>
    <p><strong>DEBT PAYMENT RECEIPT</strong></p>
    <p>Receipt No: ${ctx.receiptNumber}<br/>${when}<br/>Cashier: ${ctx.cashier}</p>
    <p>Customer: ${ctx.customer.name?.trim() || "Not Recorded"}</p>
    <p><strong>UGX ${ctx.payment.amountUgx.toLocaleString()}</strong><br/>Balance after: UGX ${ctx.balanceAfterUgx.toLocaleString()}</p>
    ${footerHtml}
  </article>`;
}

export function receiptPdfFilename(kind: "sale" | "return" | "debt", id: string): string {
  const day = dateKeyKampala(new Date());
  return sanitizePdfStem(`waka-receipt-${kind}-${id.slice(0, 8)}-${day}`) + ".pdf";
}

export async function printSaleReceipt(ctx: SaleReceiptContext): Promise<{ ok: boolean }> {
  const paper = ctx.paper ?? "80mm";
  const plain = saleReceiptPlain(ctx);
  const html = saleReceiptHtml(ctx);

  if (isNativePrintPlatform()) {
    const result = await printReceiptWithFallback(plain, paper);
    if (result.ok) return { ok: true };

    const shared = await sharePlainReceiptForPrint(plain, paper, `receipt-${ctx.sale.id.slice(0, 8)}`);
    if (shared) return { ok: true };

    const { shareSaleReceiptPdf } = await import("./receiptPdfDocuments");
    return { ok: await shareSaleReceiptPdf(ctx) };
  }

  const htmlOk = await printHtmlDocumentWithDesktop(html, paper, "Waka receipt");
  if (htmlOk) return { ok: true };

  const result = await printReceiptWithFallback(plain, paper);
  if (result.ok) return { ok: true };

  return { ok: false };
}

export async function downloadSaleReceiptPdf(ctx: SaleReceiptContext): Promise<boolean> {
  const { downloadSaleReceiptPdf: downloadPdf } = await import("./receiptPdfDocuments");
  return downloadPdf(ctx);
}

export async function shareSaleReceiptPdf(ctx: SaleReceiptContext): Promise<boolean> {
  const { shareSaleReceiptPdf: sharePdf } = await import("./receiptPdfDocuments");
  return sharePdf(ctx);
}

export async function printReturnReceipt(ctx: ReturnReceiptContext): Promise<{ ok: boolean }> {
  const paper = ctx.paper ?? "80mm";
  if (isNativePrintPlatform()) {
    const { shareReturnReceiptPdf } = await import("./receiptPdfDocuments");
    return { ok: await shareReturnReceiptPdf(ctx) };
  }
  const htmlOk = await printHtmlDocumentWithDesktop(returnReceiptHtml(ctx), paper, "Return receipt");
  if (htmlOk) return { ok: true };
  return { ok: false };
}

export async function downloadReturnReceiptPdf(ctx: ReturnReceiptContext): Promise<boolean> {
  const { downloadReturnReceiptPdf } = await import("./receiptPdfDocuments");
  return downloadReturnReceiptPdf(ctx);
}

export async function shareReturnReceiptPdf(ctx: ReturnReceiptContext): Promise<boolean> {
  const { shareReturnReceiptPdf } = await import("./receiptPdfDocuments");
  return shareReturnReceiptPdf(ctx);
}

export async function printDebtPaymentReceipt(ctx: DebtPaymentReceiptContext): Promise<{ ok: boolean }> {
  const paper = ctx.paper ?? "80mm";
  if (isNativePrintPlatform()) {
    const { shareDebtPaymentReceiptPdf } = await import("./receiptPdfDocuments");
    return { ok: await shareDebtPaymentReceiptPdf(ctx) };
  }
  const htmlOk = await printHtmlDocumentWithDesktop(debtReceiptHtml(ctx), paper, "Debt payment receipt");
  if (htmlOk) return { ok: true };
  return { ok: false };
}

export async function downloadDebtPaymentReceiptPdf(ctx: DebtPaymentReceiptContext): Promise<boolean> {
  const { downloadDebtPaymentReceiptPdf } = await import("./receiptPdfDocuments");
  return downloadDebtPaymentReceiptPdf(ctx);
}

export async function shareDebtPaymentReceiptPdf(ctx: DebtPaymentReceiptContext): Promise<boolean> {
  const { shareDebtPaymentReceiptPdf } = await import("./receiptPdfDocuments");
  return shareDebtPaymentReceiptPdf(ctx);
}

/** Short receipt number from record id + day */
export function documentReceiptNumber(prefix: string, id: string, createdAt: string): string {
  const day = dateKeyKampala(createdAt).replace(/-/g, "");
  return `${prefix}-${day}-${id.slice(0, 6).toUpperCase()}`;
}
