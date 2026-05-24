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
