import { jsPDF } from "jspdf";
import { t, tTemplate } from "./i18n";
import {
  reportDocumentGeneratedStamp,
  reportDocumentStatusLabel,
  type ReportDocumentModel,
  type ReportDocumentSection,
  type ReportDocumentTable,
} from "./reportDocumentModel";

const MARGIN = 48;
const FOOTER_H = 48;
const HEADER_MARK = 22;

function pageCount(doc: jsPDF): number {
  const n = (doc as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  return typeof n === "number" && n > 0 ? n : 1;
}

function fitText(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  const ellipsis = "...";
  let s = text;
  while (s.length > 1 && doc.getTextWidth(s + ellipsis) > maxW) s = s.slice(0, -1);
  return `${s}${ellipsis}`;
}

function drawBrandMark(doc: jsPDF, x: number, y: number): void {
  doc.setFillColor(28, 28, 28);
  doc.roundedRect(x, y, HEADER_MARK, HEADER_MARK, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("W", x + 5.5, y + 16);
  doc.setTextColor(17, 17, 17);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("WAKA POS", x + HEADER_MARK + 8, y + 16);
}

function drawHeader(doc: jsPDF, model: ReportDocumentModel, pageW: number): number {
  const stamp = reportDocumentGeneratedStamp(model.generatedAtIso);
  let y = MARGIN;
  drawBrandMark(doc, MARGIN, y);
  y += HEADER_MARK + 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(17, 17, 17);
  doc.text(model.shopName, MARGIN, y);
  y += 16;
  const org = model.organizationName?.trim();
  if (org && org !== model.shopName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(org, MARGIN, y);
    y += 14;
  }
  const address = model.shopAddress?.trim();
  if (address) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y = writeWrapped(doc, address, MARGIN, y, pageW - MARGIN * 2, 13, 10_000);
  }
  const phone = model.shopPhone?.trim();
  if (phone) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y = writeWrapped(doc, phone, MARGIN, y, pageW - MARGIN * 2, 13, 10_000);
  }
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(model.title, MARGIN, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(model.periodLabel, MARGIN, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(reportDocumentStatusLabel(model.lang, model.status), MARGIN, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(t(model.lang, "reportDocGenerated"), MARGIN, y);
  y += 12;
  doc.text(`${t(model.lang, "reportDocDate")}: ${stamp.dateKey}`, MARGIN, y);
  y += 12;
  doc.text(`${t(model.lang, "reportDocTime")}: ${stamp.time}`, MARGIN, y);
  y += 12;
  doc.text(`${t(model.lang, "reportDocTimezoneLabel")}: ${stamp.timeZone}`, MARGIN, y);
  y += 10;
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  return y + 16;
}

function drawFooter(doc: jsPDF, model: ReportDocumentModel, pageIndex: number, totalPages: number): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const stamp = reportDocumentGeneratedStamp(model.generatedAtIso);
  const maxW = pageW - MARGIN * 2;
  const line1Y = pageH - 32;
  const line2Y = pageH - 20;
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, pageH - FOOTER_H + 6, pageW - MARGIN, pageH - FOOTER_H + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  const pageLabel = tTemplate(model.lang, "reportDocPageOf", { current: pageIndex, total: totalPages });
  const left = fitText(doc, `WAKA POS  ·  ${model.shopName}`, maxW * 0.62);
  doc.text(left, MARGIN, line1Y);
  const pageWidth = doc.getTextWidth(pageLabel);
  doc.text(pageLabel, pageW - MARGIN - pageWidth, line1Y);
  const meta = fitText(
    doc,
    `${stamp.display}  ·  ${t(model.lang, "reportDocConfidential")}`,
    maxW,
  );
  doc.text(meta, MARGIN, line2Y);
  doc.setTextColor(17, 17, 17);
}

function ensureSpace(doc: jsPDF, y: number, needed: number, pageH: number): number {
  if (y + needed <= pageH - FOOTER_H) return y;
  doc.addPage();
  return MARGIN;
}

function writeWrapped(doc: jsPDF, text: string, x: number, y: number, maxW: number, lineH: number, pageH: number): number {
  const lines = doc.splitTextToSize(text, maxW) as string[];
  let cursor = y;
  for (const line of lines) {
    cursor = ensureSpace(doc, cursor, lineH, pageH);
    doc.text(line, x, cursor);
    cursor += lineH;
  }
  return cursor;
}

function writeTable(
  doc: jsPDF,
  table: ReportDocumentTable,
  y: number,
  pageW: number,
  pageH: number,
): number {
  const maxW = pageW - MARGIN * 2;
  const colWidths = table.columns.map((c) => Math.max(24, c.width * maxW));
  const lineH = 12;
  const rowPad = 5;

  const drawRow = (cells: string[], bold: boolean): number => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 8 : 9);
    const wrapped = cells.map((cell, i) => doc.splitTextToSize(cell || " ", colWidths[i]! - 6) as string[]);
    const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
    const height = lineCount * lineH + rowPad;
    let cursor = ensureSpace(doc, y, height + 2, pageH);
    let x = MARGIN;
    for (let i = 0; i < table.columns.length; i++) {
      const lines = wrapped[i] ?? [""];
      const align = table.columns[i]?.align ?? "left";
      const colW = colWidths[i] ?? 40;
      for (let li = 0; li < lines.length; li++) {
        const text = lines[li] ?? "";
        const textY = cursor + li * lineH;
        if (align === "right") {
          const tw = doc.getTextWidth(text);
          doc.text(text, x + colW - 2 - tw, textY);
        } else {
          doc.text(text, x + 2, textY);
        }
      }
      x += colW;
    }
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, cursor + height - 2, pageW - MARGIN, cursor + height - 2);
    y = cursor + height;
    return y;
  };

  y = drawRow(
    table.columns.map((c) => c.header),
    true,
  );
  for (const record of table.records) {
    y = drawRow(record, false);
  }
  return y + 6;
}

function writeSection(
  doc: jsPDF,
  lang: ReportDocumentModel["lang"],
  section: ReportDocumentSection,
  y: number,
  pageW: number,
  pageH: number,
): number {
  if (section.rows.length === 0 && !section.title && !section.table) return y;
  const maxW = pageW - MARGIN * 2;
  let cursor = y;
  const blockStart = 28 + (section.title ? 18 : 0) + 13;
  cursor = ensureSpace(doc, cursor, Math.min(blockStart, 44), pageH);
  if (section.live) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    cursor = writeWrapped(doc, t(lang, "reportDocLiveBreakdown"), MARGIN, cursor, maxW, 12, pageH);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    cursor = writeWrapped(doc, t(lang, "reportDocLiveBreakdownHint"), MARGIN, cursor, maxW, 11, pageH);
    cursor += 4;
  }
  if (section.title) {
    cursor = ensureSpace(doc, cursor, 18 + 13, pageH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    cursor = writeWrapped(doc, section.title, MARGIN, cursor, maxW, 14, pageH);
    cursor += 2;
  }
  if (section.table) {
    cursor = writeTable(doc, section.table, cursor, pageW, pageH);
  }
  for (const row of section.rows) {
    const label = row.value ? `${row.label}: ${row.value}` : row.label;
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(10);
    cursor = writeWrapped(doc, label, MARGIN, cursor, maxW, 13, pageH);
  }
  return cursor + 8;
}

export function renderReportDocumentPdf(model: ReportDocumentModel): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = drawHeader(doc, model, pageW);

  if (model.empty) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    y = writeWrapped(
      doc,
      model.emptyMessage?.trim() || t(model.lang, "reportDocEmpty"),
      MARGIN,
      y,
      pageW - MARGIN * 2,
      16,
      pageH,
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y = writeWrapped(doc, model.shopName, MARGIN, y + 6, pageW - MARGIN * 2, 14, pageH);
    y = writeWrapped(doc, model.periodLabel, MARGIN, y, pageW - MARGIN * 2, 14, pageH);
    y = writeWrapped(
      doc,
      `${t(model.lang, "reportDocGenerated")}: ${reportDocumentGeneratedStamp(model.generatedAtIso).display}`,
      MARGIN,
      y,
      pageW - MARGIN * 2,
      14,
      pageH,
    );
  } else {
    for (const section of model.sections) {
      y = writeSection(doc, model.lang, section, y, pageW, pageH);
    }
  }

  const total = pageCount(doc);
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawFooter(doc, model, i, total);
  }
  return doc.output("blob");
}
