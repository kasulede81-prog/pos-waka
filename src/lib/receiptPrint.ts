import type { ReceiptPaperSize, Sale } from "../types";

export type ReceiptLabels = {
  cashier: string;
  items: string;
  total: string;
  paid: string;
  debtSale: string;
  balance: string;
  time: string;
};

export function buildSaleReceiptText(params: {
  shopName: string;
  cashier: string;
  sale: Sale;
  customerName: string | null;
  customerBalanceUgx: number | null;
  labels: ReceiptLabels;
}): string {
  const { shopName, cashier, sale, customerName, customerBalanceUgx, labels } = params;
  const lines: string[] = [];
  lines.push(shopName);
  lines.push("");
  lines.push(`${labels.cashier}: ${cashier}`);
  lines.push(`${labels.time}: ${new Date(sale.createdAt).toLocaleString()}`);
  lines.push("");
  lines.push(labels.items);
  for (const ln of sale.lines) {
    const q =
      ln.inputMode === "money"
        ? `${ln.name} (${(ln.moneyAmountUgx ?? ln.lineTotalUgx).toLocaleString()} UGX)`
        : `${ln.name} × ${ln.quantity}`;
    lines.push(`· ${q}  →  UGX ${ln.lineTotalUgx.toLocaleString()}`);
  }
  lines.push("");
  lines.push(`${labels.total}: UGX ${sale.totalUgx.toLocaleString()}`);
  lines.push(`${labels.paid}: UGX ${sale.cashPaidUgx.toLocaleString()}`);
  if (sale.debtUgx > 0) {
    lines.push(`${labels.debtSale}: UGX ${sale.debtUgx.toLocaleString()}`);
    if (customerName) {
      lines.push(`${labels.balance} (${customerName}): UGX ${(customerBalanceUgx ?? 0).toLocaleString()}`);
    } else {
      lines.push(`${labels.balance}: UGX ${(customerBalanceUgx ?? 0).toLocaleString()}`);
    }
  }
  lines.push("");
  lines.push("—");
  lines.push("Waka POS");
  return lines.join("\n");
}

function paperCss(paper: ReceiptPaperSize): string {
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

/** Opens a print window (AirPrint / system printer on desktop & mobile browsers). */
export function printReceiptText(receiptPlain: string, paper: ReceiptPaperSize = "80mm"): boolean {
  const w = window.open("", "_blank", "noopener,noreferrer,width=420,height=720");
  if (!w) return false;
  const css = paperCss(paper);
  w.document.open();
  w.document.write(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Receipt</title>
<style>
${css}
body { font-family: ui-monospace, "Courier New", monospace; padding: 8px; color: #111; }
pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
@media print { body { padding: 0; } }
</style></head>
<body><pre id="waka-r"></pre></body></html>`);
  w.document.close();
  const el = w.document.getElementById("waka-r");
  if (!el) {
    w.close();
    return false;
  }
  el.textContent = receiptPlain;
  w.focus();
  w.print();
  w.setTimeout(() => w.close(), 500);
  return true;
}
