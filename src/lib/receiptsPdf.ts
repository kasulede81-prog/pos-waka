import { jsPDF } from "jspdf";
import type { Sale } from "../types";

const UG_LOCALE = "en-UG";

function sanitizeFileStem(stem: string): string {
  return stem.replace(/[^\w\-]+/g, "_").slice(0, 80) || "waka-sales";
}

/**
 * Build a simple text PDF of sales for sharing/archiving. Uses Helvetica only;
 * some product names (non-Latin scripts) may not render fully in the PDF.
 */
export function saveSalesListPdf(opts: {
  sales: Sale[];
  title: string;
  subtitle?: string;
  fileStem: string;
}): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageH - margin) return;
    doc.addPage();
    y = margin;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  ensureSpace(24);
  doc.text(opts.title, margin, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (opts.subtitle) {
    for (const line of doc.splitTextToSize(opts.subtitle, maxW)) {
      ensureSpace(16);
      doc.text(line, margin, y);
      y += 14;
    }
    y += 4;
  }

  const sorted = [...opts.sales].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  for (const sale of sorted) {
    ensureSpace(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const head = `#${sale.id.slice(0, 8)} · ${new Date(sale.createdAt).toLocaleString(UG_LOCALE)}`;
    for (const line of doc.splitTextToSize(head, maxW)) {
      ensureSpace(14);
      doc.text(line, margin, y);
      y += 14;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const money = `Total UGX ${sale.totalUgx.toLocaleString(UG_LOCALE)} · Cash UGX ${sale.cashPaidUgx.toLocaleString(UG_LOCALE)}${
      sale.debtUgx > 0 ? ` · Credit UGX ${sale.debtUgx.toLocaleString(UG_LOCALE)}` : ""
    }`;
    for (const line of doc.splitTextToSize(money, maxW)) {
      ensureSpace(13);
      doc.text(line, margin, y);
      y += 13;
    }

    doc.setFontSize(9);
    for (const line of sale.lines) {
      const mode = line.inputMode === "money" ? "money" : "qty";
      const lump = `· ${line.name} (${mode}) — UGX ${line.lineTotalUgx.toLocaleString(UG_LOCALE)}`;
      for (const w of doc.splitTextToSize(lump, maxW)) {
        ensureSpace(12);
        doc.text(w, margin, y);
        y += 12;
      }
    }
    y += 10;
  }

  doc.save(`${sanitizeFileStem(opts.fileStem)}.pdf`);
}
