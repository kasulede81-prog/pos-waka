/**
 * Prescription summary document.
 *
 * Previously this called `printIsolatedHtmlDocument` directly: unguarded on native
 * (Capacitor WebViews block the popup and often do not implement `window.print()`),
 * and it returned nothing, so the caller could not tell whether anything printed.
 * It now uses the shared native fallback — Android/iOS share a generated PDF, web
 * and desktop print — and reports the outcome to the caller.
 */
import { jsPDF } from "jspdf";
import type { Language, PharmacyPrescription, PharmacyPrescriptionLine, ShopPreferences } from "../types";
import { t } from "./i18n";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { printDocumentNativeFallback } from "./nativePrintFallback";

function lineCells(l: PharmacyPrescriptionLine): string[] {
  return [l.productName, l.strength ?? "", String(l.quantityPrescribed), l.directions ?? ""];
}

function buildPrescriptionPdfBlob(
  shop: string,
  lang: Language,
  prescription: PharmacyPrescription,
  voided: boolean,
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, shop, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "pharmacyRxPrintSummary"), { size: 13, bold: true });
  if (voided) pdfLine(layout, doc, t(lang, "pharmacyRxVoidWatermark"), { bold: true });
  pdfLine(layout, doc, `${prescription.prescriptionNumber} · ${prescription.patientName ?? ""}`);
  pdfLine(layout, doc, `${t(lang, "pharmacyRxDoctor")}: ${prescription.doctorName ?? "—"} · ${prescription.prescriptionDate}`);
  pdfGap(layout, 8);
  const headers = [
    t(lang, "pharmacyTerm_medicine"),
    t(lang, "pharmacyStrengthLabel"),
    "Qty",
    t(lang, "pharmacyRxDirections"),
  ];
  pdfLine(layout, doc, headers.join("  |  "), { bold: true, size: 9 });
  if (!prescription.lines.length) {
    pdfLine(layout, doc, "—", { size: 9 });
  } else {
    for (const line of prescription.lines) {
      pdfLine(layout, doc, lineCells(line).join("  |  "), { size: 9 });
    }
  }
  return doc.output("blob");
}

function buildPrescriptionHtml(
  shop: string,
  lang: Language,
  prescription: PharmacyPrescription,
  voided: boolean,
): string {
  const rows = prescription.lines
    .map((l) => `<tr>${lineCells(l).map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<article>
${voided ? `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:4rem;color:rgba(220,38,38,.25);transform:rotate(-20deg);pointer-events:none">${t(lang, "pharmacyRxVoidWatermark")}</div>` : ""}
<h1>${shop}</h1>
<h2>${t(lang, "pharmacyRxPrintSummary")}</h2>
<p><strong>${prescription.prescriptionNumber}</strong> · ${prescription.patientName ?? ""}</p>
<p>${t(lang, "pharmacyRxDoctor")}: ${prescription.doctorName ?? "—"} · ${prescription.prescriptionDate}</p>
<table><thead><tr><th>${t(lang, "pharmacyTerm_medicine")}</th><th>${t(lang, "pharmacyStrengthLabel")}</th><th>Qty</th><th>${t(lang, "pharmacyRxDirections")}</th></tr></thead><tbody>${rows}</tbody></table>
</article>`;
}

/** Native: share a PDF. Web/desktop: isolated browser print. Returns false when neither worked. */
export async function printPrescriptionSummary(
  lang: Language,
  prescription: PharmacyPrescription,
  prefs: ShopPreferences,
  opts?: { voided?: boolean },
): Promise<boolean> {
  const shop = prefs.shopDisplayName?.trim() || "Pharmacy";
  const voided = opts?.voided ?? false;
  const title = t(lang, "pharmacyRxPrintSummary");
  return printDocumentNativeFallback({
    pdfFilename: `${sanitizePdfStem(`waka-prescription-${prescription.prescriptionNumber}`)}.pdf`,
    buildPdfBlob: () => buildPrescriptionPdfBlob(shop, lang, prescription, voided),
    htmlBody: buildPrescriptionHtml(shop, lang, prescription, voided),
    paper: "a4",
    title,
    shareDialogTitle: title,
  });
}
