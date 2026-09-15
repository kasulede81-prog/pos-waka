import type { Language, PharmacyPrescription, PharmacyPrescriptionLine, ShopPreferences } from "../types";
import { t } from "./i18n";

export function printPrescriptionSummary(
  lang: Language,
  prescription: PharmacyPrescription,
  prefs: ShopPreferences,
  opts?: { voided?: boolean },
): void {
  const shop = prefs.shopDisplayName?.trim() || "Pharmacy";
  const lines = prescription.lines
    .map(
      (l: PharmacyPrescriptionLine) =>
        `<tr><td>${l.productName}</td><td>${l.strength ?? ""}</td><td>${l.quantityPrescribed}</td><td>${l.directions ?? ""}</td></tr>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><title>${prescription.prescriptionNumber}</title>
<style>body{font-family:system-ui;padding:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px;text-align:left}
.void{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:4rem;color:rgba(220,38,38,.25);transform:rotate(-20deg);pointer-events:none}</style></head>
<body>
${opts?.voided ? `<div class="void">${t(lang, "pharmacyRxVoidWatermark")}</div>` : ""}
<h1>${shop}</h1>
<h2>${t(lang, "pharmacyRxPrintSummary")}</h2>
<p><strong>${prescription.prescriptionNumber}</strong> · ${prescription.patientName ?? ""}</p>
<p>${t(lang, "pharmacyRxDoctor")}: ${prescription.doctorName ?? "—"} · ${prescription.prescriptionDate}</p>
<table><thead><tr><th>${t(lang, "pharmacyTerm_medicine")}</th><th>${t(lang, "pharmacyStrengthLabel")}</th><th>Qty</th><th>${t(lang, "pharmacyRxDirections")}</th></tr></thead><tbody>${lines}</tbody></table>
<script>window.print();</script></body></html>`;
  const w = window.open("", "_blank", "width=640,height=800");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
