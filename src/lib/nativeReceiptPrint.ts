import { Capacitor } from "@capacitor/core";
import { jsPDF } from "jspdf";
import type { ReceiptPaperSize } from "../types";
import { dateKeyKampala } from "./datesUg";
import { saveExportedFile } from "./fileDownload";
import { createPdfLayout, pdfLine, sanitizePdfStem } from "./pdfLayout";

export function isNativePrintPlatform(): boolean {
  return typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();
}

function thermalPdfFormat(paper: ReceiptPaperSize): string | [number, number] {
  if (paper === "a4") return "a4";
  const w = paper === "58mm" ? 58 : 80;
  return [w, 200];
}

/** Plain-text receipt as a narrow PDF for Android/iOS share → Print. */
export function buildPlainReceiptPdfBlob(receiptPlain: string, paper: ReceiptPaperSize = "80mm"): Blob {
  const doc = new jsPDF({
    unit: "mm",
    format: thermalPdfFormat(paper),
    orientation: "portrait",
  });
  const layout = createPdfLayout(doc, paper === "a4" ? 40 : 4);
  const size = paper === "a4" ? 10 : 8;
  for (const line of receiptPlain.split("\n")) {
    pdfLine(layout, doc, line.length ? line : " ", { size });
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
  const blob = buildPlainReceiptPdfBlob(receiptPlain, paper);
  return saveExportedFile(plainReceiptPdfFilename(filenameStem), blob, "application/pdf", {
    shareDialogTitle: "Share receipt",
  });
}
