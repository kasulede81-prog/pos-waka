/**
 * Shared A4 renderer for the simple "title + text lines" reports added in printing
 * phase 2 (cash variance history, pharmacy inventory/patient reports, inventory count
 * sheet, menu).
 *
 * These pages already hold their data on screen; this only turns that data into paper.
 * It reads no stores and mutates nothing, so printing a report can never change stock,
 * cash, or sales.
 */
import { jsPDF } from "jspdf";
import { createPdfLayout, pdfGap, pdfLine } from "./pdfLayout";

export type ListDocumentInput = {
  title: string;
  subtitle?: string | null;
  lines: string[];
};

export function buildListDocumentPdfBlob(input: ListDocumentInput): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, input.title, { size: 14, bold: true });
  if (input.subtitle) pdfLine(layout, doc, input.subtitle, { size: 11, bold: true });
  pdfLine(layout, doc, new Date().toLocaleString("en-UG", { timeZone: "Africa/Kampala" }), { size: 9 });
  pdfGap(layout, 8);
  if (!input.lines.length) {
    pdfLine(layout, doc, "—", { size: 9 });
  } else {
    for (const line of input.lines) pdfLine(layout, doc, line, { size: 9 });
  }
  return doc.output("blob");
}

export function escapeListHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildListDocumentHtml(input: ListDocumentInput): string {
  const lines = input.lines.map((l) => escapeListHtml(l)).join("\n");
  const subtitle = input.subtitle ? `<h2>${escapeListHtml(input.subtitle)}</h2>` : "";
  return `<article><h1>${escapeListHtml(input.title)}</h1>${subtitle}<pre>${lines}</pre></article>`;
}
