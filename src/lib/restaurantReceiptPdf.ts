import type { ReceiptPaperSize } from "../types";
import { buildRestaurantReceiptLines, type RestaurantReceiptContext } from "./restaurantReceiptPrint";
import { createPdfLayout, ensurePdfSpace, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob, sharePdfBlob } from "./documentPrint";
import { dateKeyKampala } from "./datesUg";

let jsPdfModule: Promise<typeof import("jspdf")> | undefined;

async function loadJsPdf(): Promise<typeof import("jspdf").jsPDF> {
  jsPdfModule ??= import("jspdf");
  return (await jsPdfModule).jsPDF;
}

function restaurantPdfFilename(saleId: string): string {
  const day = dateKeyKampala(new Date());
  return sanitizePdfStem(`waka-receipt-restaurant-${saleId.slice(0, 8)}-${day}`) + ".pdf";
}

/**
 * PDF/export path for the shared Hospitality receipt builder. It renders the
 * same lines as the thermal/print path, so table, waiter, service charge, tax,
 * payments and the recorded total stay identical across outputs.
 */
export async function buildRestaurantReceiptPdfBlob(
  ctx: RestaurantReceiptContext,
  paper: ReceiptPaperSize = "80mm",
): Promise<Blob> {
  const width = paper === "58mm" ? "58mm" : "80mm";
  const lines = buildRestaurantReceiptLines(ctx, width);
  const JsPDF = await loadJsPdf();

  if (paper === "58mm" || paper === "80mm") {
    const widthMm = paper === "58mm" ? 58 : 80;
    const marginMm = 3;
    const lineMm = 3.1;
    const heightMm = Math.max(60, marginMm * 2 + lines.length * lineMm + 8);
    const doc = new JsPDF({ unit: "mm", format: [widthMm, heightMm], orientation: "portrait" });
    doc.setFont("courier", "normal");
    doc.setFontSize(6);
    let y = marginMm;
    const maxW = widthMm - marginMm * 2;
    for (const line of lines) {
      const parts = doc.splitTextToSize(line, maxW) as string[];
      for (const part of parts) {
        doc.text(part, marginMm, y);
        y += lineMm;
      }
    }
    return doc.output("blob");
  }

  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  const fontSize = 8.5;
  const lineGap = 11;
  const applyFont = () => {
    doc.setFont("courier", "normal");
    doc.setFontSize(fontSize);
  };
  applyFont();
  for (const line of lines) {
    const parts = doc.splitTextToSize(line, layout.maxW) as string[];
    for (const part of parts) {
      ensurePdfSpace(layout, doc, lineGap);
      if (layout.y === layout.margin) applyFont();
      doc.text(part, layout.margin, layout.y);
      layout.y += lineGap;
    }
  }
  return doc.output("blob");
}

export async function downloadRestaurantReceiptPdf(
  ctx: RestaurantReceiptContext,
  paper: ReceiptPaperSize = "80mm",
): Promise<boolean> {
  const blob = await buildRestaurantReceiptPdfBlob(ctx, paper);
  return downloadPdfBlob(restaurantPdfFilename(ctx.sale.id), blob);
}

export async function shareRestaurantReceiptPdf(
  ctx: RestaurantReceiptContext,
  paper: ReceiptPaperSize = "80mm",
): Promise<boolean> {
  const blob = await buildRestaurantReceiptPdfBlob(ctx, paper);
  return sharePdfBlob(restaurantPdfFilename(ctx.sale.id), blob);
}
