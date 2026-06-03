import type { Product, ReceiptDisplayOptions, ReceiptPaperSize, Sale, SaleLine } from "../types";
import { defaultReceiptDisplayOptions } from "./receiptBranding";
import { dateKeyKampala } from "./datesUg";
import { formatMedicineFullLabel } from "./pharmacyMedicine";
import { formatPharmacySaleQtyLabel, isPharmacyPackagingActive } from "./pharmacyPackaging";
import { buildReceiptLineQuantityDisplay } from "./saleQuantityLabel";
import { detectPrinterCapabilities, testPrint, type PrinterPaperWidth } from "../services/hardware/printerAdapter";

export type ReceiptLabels = {
  cashier: string;
  items: string;
  total: string;
  paid: string;
  debtSale: string;
  balance: string;
  time: string;
  outstandingDebt: string;
  customer: string;
  customerNotRecorded: string;
  receiptNo: string;
  date: string;
  method: string;
  change: string;
  subtotal: string;
  discount: string;
  grandTotal: string;
};

export type ReceiptDisplayLine = {
  name: string;
  quantityLabel: string;
  unitPriceUgx: number;
  lineTotalUgx: number;
  showCalculation: boolean;
};

/** Product title for receipt lines (medicine name, not qty-only text). */
export function resolveReceiptLineName(line: SaleLine, product?: Product): string {
  const stored = line.name?.trim() ?? "";
  if (!product) return stored;
  const canonical = isPharmacyPackagingActive(product)
    ? formatMedicineFullLabel(product)
    : product.name.trim();
  if (!stored) return canonical;
  if (isPharmacyPackagingActive(product)) {
    const qtyOnly = formatPharmacySaleQtyLabel(product, line, "receipt").trim();
    if (stored.toLowerCase() === qtyOnly.toLowerCase()) return canonical;
  }
  return stored;
}

/** Qty/price line when unit breakdown is shown instead of per-unit math. */
export function receiptLineDetailLabel(line: ReceiptDisplayLine): string {
  if (/UGX\s*[\d,]+/i.test(line.quantityLabel)) return line.quantityLabel;
  return `${line.quantityLabel} — UGX ${line.lineTotalUgx.toLocaleString()}`;
}

export type ReceiptDisplayData = {
  shopName: string;
  shopAddress: string | null;
  shopPhone: string | null;
  /** When set, replaces the default shop name / address / phone block. */
  customHeaderLines: string[] | null;
  headerLines: string[];
  receiptNumber: string;
  dateText: string;
  timeText: string;
  cashier: string;
  lines: ReceiptDisplayLine[];
  subtotalUgx: number;
  discountUgx: number;
  totalUgx: number;
  paidUgx: number;
  changeUgx: number;
  paymentMethodLabel: string;
  footerLines: string[];
  footerThanks: string;
  footerPowered: string | null;
  returnPolicy: string | null;
  displayOptions: ReceiptDisplayOptions;
  customerName: string | null;
  customerPhone: string | null;
  outstandingDebtUgx: number;
  customerBalanceUgx: number | null;
};

function formatDateUg(value: string): string {
  return new Intl.DateTimeFormat("en-UG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(new Date(value));
}

function formatTimeUg(value: string): string {
  return new Intl.DateTimeFormat("en-UG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Kampala",
  }).format(new Date(value));
}

export function buildReceiptNumberForSale(sale: Sale, allSales: Sale[]): string {
  if (Number.isFinite(sale.receiptSeq) && (sale.receiptSeq ?? 0) > 0) {
    return String(Math.floor(sale.receiptSeq ?? 0)).padStart(3, "0");
  }
  const dayKey = dateKeyKampala(sale.createdAt);
  const daySales = allSales
    .filter((s) => dateKeyKampala(s.createdAt) === dayKey)
    .sort((a, b) => {
      if (a.createdAt === b.createdAt) return a.id.localeCompare(b.id);
      return a.createdAt.localeCompare(b.createdAt);
    });
  const idx = daySales.findIndex((s) => s.id === sale.id);
  const seq = idx >= 0 ? idx + 1 : daySales.length + 1;
  return String(seq).padStart(3, "0");
}

function inferPaymentMethodLabel(
  sale: Sale & { paymentMethod?: "cash" | "atm" | "mobile_money" | "mixed" | "credit" },
): string {
  if (sale.paymentMethod === "atm") return "ATM";
  if (sale.paymentMethod === "mobile_money") return "MOMO PAY";
  if (sale.paymentMethod === "mixed") return "Mixed";
  if (sale.paymentMethod === "credit") return "Pay Later";
  if (sale.paymentMethod === "cash") return "CASH";
  if (sale.debtUgx > 0 && sale.cashPaidUgx > 0) return "Mixed";
  if (sale.debtUgx > 0) return "Pay Later";
  return "CASH";
}

export function buildReceiptDisplayData(params: {
  shopName: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
  cashier: string;
  receiptNumber: string;
  sale: Sale & { paymentMethod?: "cash" | "atm" | "mobile_money" | "mixed" | "credit" };
  productById?: Map<string, Product>;
  customHeaderLines?: string[] | null;
  headerLines?: string[] | null;
  footerLines?: string[];
  footerThanks?: string;
  footerPowered?: string | null;
  returnPolicy?: string | null;
  displayOptions?: ReceiptDisplayOptions;
  customerName?: string | null;
  customerPhone?: string | null;
  customerBalanceUgx?: number | null;
}): ReceiptDisplayData {
  const {
    shopName,
    shopAddress,
    shopPhone,
    cashier,
    receiptNumber,
    sale,
    productById,
    customHeaderLines,
    headerLines,
    footerLines,
    footerThanks,
    footerPowered,
    returnPolicy,
    displayOptions,
    customerName,
    customerPhone,
    customerBalanceUgx,
  } = params;
  const opts = displayOptions ?? defaultReceiptDisplayOptions();
  const resolvedHeader =
    headerLines?.length ? headerLines : customHeaderLines?.length ? customHeaderLines : null;
  const resolvedFooter = (footerLines ?? []).map((l) => l.trim()).filter(Boolean);
  const lines: ReceiptDisplayLine[] = sale.lines
    .filter((ln) => !ln.voided)
    .map((ln) => {
      const product = productById?.get(ln.productId);
      const { quantityLabel, showCalculation } = buildReceiptLineQuantityDisplay(ln, product);
      return {
        name: resolveReceiptLineName(ln, product),
        quantityLabel,
        unitPriceUgx: ln.unitPriceUgx,
        lineTotalUgx: ln.lineTotalUgx,
        showCalculation,
      };
    });
  const subtotalUgx = Math.max(0, sale.subtotalUgx);
  const discountUgx = Math.max(0, sale.discountTotalUgx ?? subtotalUgx - sale.totalUgx);
  const paidUgx = Math.max(
    0,
    Number.isFinite(sale.amountPaidUgx) ? Math.floor(sale.amountPaidUgx ?? 0) : sale.cashPaidUgx,
  );
  const changeUgx = Math.max(
    0,
    Number.isFinite(sale.changeGivenUgx)
      ? Math.floor(sale.changeGivenUgx ?? 0)
      : paidUgx - sale.totalUgx,
  );
  const saleCustomerName = customerName ?? sale.receiptCustomerName ?? null;
  const saleCustomerPhone = customerPhone ?? sale.receiptCustomerPhone ?? null;

  return {
    shopName,
    shopAddress: shopAddress?.trim() || null,
    shopPhone: shopPhone?.trim() || null,
    customHeaderLines: resolvedHeader,
    headerLines: resolvedHeader ?? [],
    receiptNumber,
    dateText: formatDateUg(sale.createdAt),
    timeText: formatTimeUg(sale.createdAt),
    cashier,
    lines,
    subtotalUgx,
    discountUgx,
    totalUgx: Math.max(0, sale.totalUgx),
    paidUgx,
    changeUgx,
    paymentMethodLabel: inferPaymentMethodLabel(sale),
    footerLines: resolvedFooter.length ? resolvedFooter : [footerThanks?.trim() || "Thank you for shopping with us"],
    footerThanks: footerThanks?.trim() || resolvedFooter[0] || "Thank you for shopping with us",
    footerPowered: footerPowered?.trim() ? footerPowered.trim() : footerPowered === null ? null : "Powered by Waka POS",
    returnPolicy: returnPolicy?.trim() || null,
    displayOptions: opts,
    customerName: saleCustomerName,
    customerPhone: saleCustomerPhone,
    outstandingDebtUgx: Math.max(0, Math.floor(sale.debtUgx)),
    customerBalanceUgx: customerBalanceUgx ?? null,
  };
}

export function buildSaleReceiptText(params: {
  shopName: string;
  cashier: string;
  sale: Sale;
  receiptNumber?: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
  productById?: Map<string, Product>;
  customHeaderLines?: string[] | null;
  paymentMethodLabel?: string;
  amountPaidUgx?: number;
  changeUgx?: number;
  footerThanks?: string;
  footerPowered?: string;
  returnPolicy?: string | null;
  customerName: string | null;
  customerPhone?: string | null;
  customerBalanceUgx: number | null;
  headerLines?: string[];
  footerLines?: string[];
  displayOptions?: ReceiptDisplayOptions;
  labels: ReceiptLabels;
}): string {
  const {
    shopName,
    cashier,
    sale,
    customerName,
    customerBalanceUgx,
    labels,
    shopAddress,
    shopPhone,
    receiptNumber,
    productById,
    amountPaidUgx,
    changeUgx,
    paymentMethodLabel,
    customHeaderLines,
    footerThanks,
    footerPowered,
    returnPolicy,
    displayOptions,
    customerPhone,
    headerLines,
    footerLines,
  } = params;
  const display = buildReceiptDisplayData({
    shopName,
    shopAddress,
    shopPhone,
    cashier,
    receiptNumber: receiptNumber ?? "001",
    sale: { ...sale, paymentMethod: (sale as Sale & { paymentMethod?: "cash" | "atm" | "mobile_money" | "mixed" | "credit" }).paymentMethod },
    productById,
    customHeaderLines,
    headerLines,
    footerLines,
    footerThanks,
    footerPowered,
    returnPolicy,
    displayOptions,
    customerName,
    customerPhone,
    customerBalanceUgx,
  });
  const lines: string[] = [];
  const headerBlock = display.headerLines.length ? display.headerLines : display.customHeaderLines;
  if (headerBlock?.length) {
    for (const line of headerBlock) lines.push(line);
  } else {
    lines.push(display.shopName.toUpperCase());
    if (display.displayOptions.showShopAddress && display.shopAddress) lines.push(display.shopAddress);
    if (display.displayOptions.showShopPhone && display.shopPhone) lines.push(display.shopPhone);
  }
  lines.push("");
  if (display.displayOptions.showReceiptNumber) {
    lines.push(`${labels.receiptNo}: ${display.receiptNumber}`);
  }
  lines.push(`${labels.date}: ${display.dateText}`);
  lines.push(`${labels.time}: ${display.timeText}`);
  if (display.displayOptions.showCashier) {
    lines.push(`${labels.cashier}: ${display.cashier}`);
  }
  lines.push("");
  lines.push(labels.items);
  for (const ln of display.lines) {
    if (ln.showCalculation) {
      lines.push(ln.name);
      lines.push(`${ln.quantityLabel} x ${ln.unitPriceUgx.toLocaleString()} UGX = ${ln.lineTotalUgx.toLocaleString()} UGX`);
    } else {
      const title = ln.name?.trim();
      if (title) lines.push(title);
      lines.push(receiptLineDetailLabel(ln));
    }
  }
  lines.push("");
  lines.push(`${labels.subtotal}: UGX ${display.subtotalUgx.toLocaleString()}`);
  if (display.discountUgx > 0) lines.push(`${labels.discount}: -UGX ${display.discountUgx.toLocaleString()}`);
  lines.push(`${labels.grandTotal}: UGX ${display.totalUgx.toLocaleString()}`);
  lines.push(`${labels.paid}: UGX ${(amountPaidUgx ?? display.paidUgx).toLocaleString()}`);
  lines.push(`${labels.change}: UGX ${(changeUgx ?? display.changeUgx).toLocaleString()}`);
  if (display.displayOptions.showPaymentMethod) {
    lines.push(`${labels.method}: ${paymentMethodLabel ?? display.paymentMethodLabel}`);
  }
  if (display.displayOptions.showDebtInfo && display.outstandingDebtUgx > 0) {
    lines.push(`${labels.outstandingDebt}: UGX ${display.outstandingDebtUgx.toLocaleString()}`);
    if (display.displayOptions.showCustomerName) {
      const name = display.customerName?.trim() || customerName?.trim();
      lines.push(`${labels.customer}: ${name || labels.customerNotRecorded}`);
    }
    if (display.displayOptions.showCustomerPhone && display.customerPhone?.trim()) {
      lines.push(`${display.customerPhone.trim()}`);
    }
  }
  lines.push("");
  for (const foot of display.footerLines) lines.push(foot);
  if (display.returnPolicy && !display.footerLines.includes(display.returnPolicy)) {
    lines.push(display.returnPolicy);
  }
  if (display.footerPowered) lines.push(display.footerPowered);
  return lines.join("\n");
}

export function buildSaleReceiptHtml(display: ReceiptDisplayData): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmt = (n: number) => `UGX ${Math.max(0, Math.round(n)).toLocaleString()}`;
  const rows = display.lines
    .map(
      (ln) => `
        <div class="line">
          ${
            ln.showCalculation
              ? `<div class="line-name">${esc(ln.name)}</div><div class="line-meta">${esc(ln.quantityLabel)} x ${fmt(ln.unitPriceUgx)} = <strong>${fmt(ln.lineTotalUgx)}</strong></div>`
              : ln.name?.trim()
                ? `<div class="line-name">${esc(ln.name)}</div><div class="line-meta"><strong>${esc(receiptLineDetailLabel(ln))}</strong></div>`
                : `<div class="line-name">${esc(receiptLineDetailLabel(ln))}</div>`
          }
        </div>`,
    )
    .join("");
  const discountBlock =
    display.discountUgx > 0
      ? `<div class="row"><span>Discount</span><span>- ${fmt(display.discountUgx)}</span></div>`
      : "";
  const policyBlock =
    display.returnPolicy && !display.footerLines.includes(display.returnPolicy)
      ? `<p class="policy">${esc(display.returnPolicy)}</p>`
      : "";
  const headerSource = display.headerLines.length ? display.headerLines : display.customHeaderLines;
  const headerBlock = headerSource?.length
    ? headerSource.map((line) => `<p>${esc(line)}</p>`).join("")
    : `<h2>${esc(display.shopName)}</h2>
        ${display.displayOptions.showShopAddress && display.shopAddress ? `<p>${esc(display.shopAddress)}</p>` : ""}
        ${display.displayOptions.showShopPhone && display.shopPhone ? `<p>${esc(display.shopPhone)}</p>` : ""}`;

  const metaRows: string[] = [];
  if (display.displayOptions.showReceiptNumber) {
    metaRows.push(`<div><span>Receipt No:</span><strong>${esc(display.receiptNumber)}</strong></div>`);
  }
  metaRows.push(`<div><span>Date:</span><strong>${esc(display.dateText)}</strong></div>`);
  metaRows.push(`<div><span>Time:</span><strong>${esc(display.timeText)}</strong></div>`);
  if (display.displayOptions.showCashier) {
    metaRows.push(`<div><span>Cashier:</span><strong>${esc(display.cashier)}</strong></div>`);
  }

  const debtRows =
    display.displayOptions.showDebtInfo && display.outstandingDebtUgx > 0
      ? `<div class="row"><span>Outstanding Debt</span><span>${fmt(display.outstandingDebtUgx)}</span></div>
         ${
           display.displayOptions.showCustomerName
             ? `<div class="row"><span>Customer</span><span>${esc(display.customerName?.trim() || "Not Recorded")}</span></div>`
             : ""
         }
         ${
           display.displayOptions.showCustomerPhone && display.customerPhone?.trim()
             ? `<div class="row"><span>Phone</span><span>${esc(display.customerPhone.trim())}</span></div>`
             : ""
         }`
      : "";

  const footerBlock = display.footerLines.map((line) => `<p>${esc(line)}</p>`).join("");
  const poweredBlock = display.footerPowered
    ? `<p class="powered">${esc(display.footerPowered)}</p>`
    : "";

  return `
    <style>
      .waka-receipt { font-family: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; }
      .waka-receipt .header { text-align: center; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; margin-bottom: 10px; }
      .waka-receipt .header h2 { margin: 0; font-size: 1.1rem; font-weight: 900; letter-spacing: 0.02em; text-transform: uppercase; }
      .waka-receipt .header p { margin: 2px 0; font-size: 0.8rem; color: #334155; }
      .waka-receipt .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; font-size: 0.77rem; margin-bottom: 10px; }
      .waka-receipt .meta div { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px dotted #e2e8f0; padding-bottom: 2px; }
      .waka-receipt .items { border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 8px 0; }
      .waka-receipt .line { padding: 6px 0; border-bottom: 1px dotted #f1f5f9; }
      .waka-receipt .line:last-child { border-bottom: none; }
      .waka-receipt .line-name { font-size: 0.88rem; font-weight: 700; }
      .waka-receipt .line-meta { margin-top: 2px; font-size: 0.77rem; color: #334155; }
      .waka-receipt .totals, .waka-receipt .payment { padding-top: 8px; }
      .waka-receipt .row { display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; padding: 2px 0; }
      .waka-receipt .grand { margin-top: 4px; padding-top: 6px; border-top: 1px solid #cbd5e1; font-size: 1rem; font-weight: 900; }
      .waka-receipt footer { margin-top: 10px; border-top: 1px dashed #cbd5e1; padding-top: 10px; text-align: center; }
      .waka-receipt footer p { margin: 3px 0; font-size: 0.78rem; font-weight: 700; color: #1e293b; }
      .waka-receipt .powered { color: #475569; font-weight: 600; }
      .waka-receipt .policy { margin: 0 0 6px; font-size: 0.72rem; color: #64748b; font-weight: 500; }
    </style>
    <article class="waka-receipt">
      <header class="header">
        ${headerBlock}
      </header>
      <section class="meta">${metaRows.join("")}</section>
      <section class="items">${rows}</section>
      <section class="totals">
        <div class="row"><span>Subtotal</span><span>${fmt(display.subtotalUgx)}</span></div>
        ${discountBlock}
        <div class="row grand"><span>Grand Total</span><span>${fmt(display.totalUgx)}</span></div>
      </section>
      <section class="payment">
        <div class="row"><span>Paid</span><span>${fmt(display.paidUgx)}</span></div>
        <div class="row"><span>Change</span><span>${fmt(display.changeUgx)}</span></div>
        ${
          display.displayOptions.showPaymentMethod
            ? `<div class="row"><span>Method</span><span>${esc(display.paymentMethodLabel)}</span></div>`
            : ""
        }
        ${debtRows}
      </section>
      <footer>
        ${policyBlock}
        ${footerBlock}
        ${poweredBlock}
      </footer>
    </article>`;
}

export function paperCss(paper: ReceiptPaperSize): string {
  switch (paper) {
    case "58mm":
      return `@page { size: 58mm auto; margin: 4mm; }
body { max-width: 58mm; font-size: 11px; line-height: 1.35; }`;
    case "80mm":
      return `@page { size: 80mm auto; margin: 5mm; }
body { max-width: 80mm; font-size: 12px; line-height: 1.4; }`;
    case "a4":
      return `@page { size: A4; margin: 18mm; }
body { max-width: 180mm; font-size: 13px; line-height: 1.5; }`;
    default:
      return `@page { size: 80mm auto; margin: 5mm; }
body { max-width: 80mm; font-size: 12px; }`;
  }
}

function receiptHtml(receiptPlain: string, paper: ReceiptPaperSize): string {
  const css = paperCss(paper);
  const safe = receiptPlain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Receipt</title>
<style>
${css}
body { font-family: ui-monospace, "Courier New", monospace; padding: 8px; color: #111; margin: 0; }
pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
@media print { body { padding: 0; } }
</style></head>
<body><pre>${safe}</pre></body></html>`;
}

/** Print via hidden iframe (avoids popup blockers; works with AirPrint / system dialog). */
export function printReceiptText(receiptPlain: string, paper: ReceiptPaperSize = "80mm"): boolean {
  if (typeof document === "undefined") return false;

  const html = receiptHtml(receiptPlain, paper);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Waka receipt print");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument ?? win?.document;
  if (!win || !doc) {
    document.body.removeChild(iframe);
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    window.setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 800);
  };

  const doPrint = () => {
    try {
      win.focus();
      win.print();
      cleanup();
    } catch {
      cleanup();
      return false;
    }
    return true;
  };

  if (doc.readyState === "complete") {
    window.setTimeout(doPrint, 150);
    return true;
  }

  iframe.onload = () => {
    window.setTimeout(doPrint, 150);
  };

  return true;
}

function toThermalWidth(paper: ReceiptPaperSize): PrinterPaperWidth {
  return paper === "58mm" ? "58mm" : "80mm";
}

/**
 * Prefer native ESC/POS path when available, fallback to browser print.
 * Returns true if either native or browser path was started successfully.
 */
export async function printReceiptWithFallback(
  receiptPlain: string,
  paper: ReceiptPaperSize = "80mm",
): Promise<{ ok: boolean; mode: "native" | "browser" | "none"; error?: string }> {
  try {
    const caps = await detectPrinterCapabilities();
    if (caps.escPosAvailable) {
      const native = await testPrint({
        width: toThermalWidth(paper),
        lines: receiptPlain.split("\n"),
      });
      if (native.ok) return { ok: true, mode: "native" };
    }
  } catch {
    // Continue into browser fallback.
  }

  const browserOk = printReceiptText(receiptPlain, paper);
  if (browserOk) return { ok: true, mode: "browser" };
  return { ok: false, mode: "none", error: "No printing method available." };
}
