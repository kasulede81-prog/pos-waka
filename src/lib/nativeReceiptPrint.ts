import type { ReceiptPaperSize } from "../types";
import { dateKeyKampala } from "./datesUg";
import { saveExportedFile } from "./fileDownload";
import { sanitizePdfStem } from "./pdfLayout";

export { isNativePrintPlatform } from "./nativePrintPlatform";

let jsPdfModule: Promise<typeof import("jspdf")> | undefined;

async function loadJsPdf(): Promise<typeof import("jspdf").jsPDF> {
  jsPdfModule ??= import("jspdf");
  return (await jsPdfModule).jsPDF;
}

function thermalWidthMm(paper: ReceiptPaperSize): number {
  if (paper === "58mm") return 58;
  if (paper === "a4") return 210;
  return 80;
}

const THERMAL_FONT_MM = 2.6;
const THERMAL_LINE_MM = 3.35;
const THERMAL_BLANK_MM = 1.1;

function estimatePlainReceiptHeightMm(lineCount: number, paper: ReceiptPaperSize): number {
  const margin = paper === "a4" ? 12 : 3;
  const body = lineCount * THERMAL_LINE_MM;
  return Math.max(paper === "a4" ? 297 : 48, margin * 2 + body);
}

/** Plain-text receipt as a narrow thermal PDF for Android/iOS share → Print. */
export async function buildPlainReceiptPdfBlob(receiptPlain: string, paper: ReceiptPaperSize = "80mm"): Promise<Blob> {
  const jsPDF = await loadJsPdf();
  const widthMm = thermalWidthMm(paper);
  const marginMm = paper === "a4" ? 12 : 3;
  const lines = receiptPlain.split("\n");
  const pageHeightMm = estimatePlainReceiptHeightMm(lines.length, paper);
  const pageFormat: string | [number, number] = paper === "a4" ? "a4" : [widthMm, pageHeightMm];

  const doc = new jsPDF({
    unit: "mm",
    format: pageFormat,
    orientation: "portrait",
  });
  doc.setFont("courier", "normal");
  doc.setFontSize(THERMAL_FONT_MM);

  let y = marginMm;
  const maxTextW = widthMm - marginMm * 2;

  for (const line of lines) {
    if (!line.trim()) {
      y += THERMAL_BLANK_MM;
      continue;
    }
    const wrapped = doc.splitTextToSize(line, maxTextW) as string[];
    for (const ln of wrapped) {
      doc.text(ln, marginMm, y);
      y += THERMAL_LINE_MM;
    }
  }

  return doc.output("blob");
}

export function plainReceiptPdfFilename(stem = "waka-receipt"): string {
  const day = dateKeyKampala(new Date());
  return sanitizePdfStem(`${stem}-${day}`) + ".pdf";
}

/** Opens the system share sheet; user can pick Print, Drive, Files, etc. */
export async function sharePlainReceiptForPrint(
  receiptPlain: string,
  paper: ReceiptPaperSize = "80mm",
  filenameStem = "waka-receipt",
): Promise<boolean> {
  const blob = await buildPlainReceiptPdfBlob(receiptPlain, paper);
  return saveExportedFile(plainReceiptPdfFilename(filenameStem), blob, "application/pdf", {
    shareDialogTitle: "Share receipt",
  });
}
