import type { jsPDF } from "jspdf";

export type PdfLayout = {
  margin: number;
  pageW: number;
  pageH: number;
  maxW: number;
  y: number;
};

export function createPdfLayout(doc: jsPDF, margin = 40): PdfLayout {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  return { margin, pageW, pageH, maxW: pageW - margin * 2, y: margin };
}

export function ensurePdfSpace(layout: PdfLayout, doc: jsPDF, needed: number): void {
  if (layout.y + needed <= layout.pageH - layout.margin) return;
  doc.addPage();
  layout.y = layout.margin;
}

export function pdfLine(
  layout: PdfLayout,
  doc: jsPDF,
  text: string,
  opts?: { size?: number; bold?: boolean; gap?: number },
): void {
  const size = opts?.size ?? 10;
  const gap = opts?.gap ?? 4;
  doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
  doc.setFontSize(size);
  for (const ln of doc.splitTextToSize(text, layout.maxW)) {
    ensurePdfSpace(layout, doc, size + gap);
    doc.text(ln, layout.margin, layout.y);
    layout.y += size + gap;
  }
}

export function pdfGap(layout: PdfLayout, px: number): void {
  layout.y += px;
}

export function sanitizePdfStem(stem: string): string {
  return stem.replace(/[^\w\-]+/g, "_").slice(0, 80) || "waka-document";
}
