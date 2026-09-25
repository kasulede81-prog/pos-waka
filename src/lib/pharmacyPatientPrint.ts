/**
 * Patient documents (summary, medication history, refill schedule, counselling).
 *
 * These used to call `printIsolatedHtmlDocument` directly, which is a silent no-op
 * inside a Capacitor WebView (no popup, and `window.print()` is unimplemented), so
 * the button looked like it worked and printed nothing. They now route through the
 * shared native fallback: Android/iOS share a generated PDF, web/desktop open the
 * isolated browser print dialog.
 */
import { jsPDF } from "jspdf";
import type { Customer, Language, PharmacyPatientProfile, PharmacyPatientTimelineEvent, ShopPreferences } from "../types";
import { t } from "./i18n";
import { computePatientAge, ensurePharmacyPatientProfile, patientDisplayId } from "./pharmacyPatientProfile";
import { activeChronicMedications } from "./pharmacyChronicMeds";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { printDocumentNativeFallback } from "./nativePrintFallback";

function shopNameOf(prefs: ShopPreferences): string {
  return prefs.shopDisplayName?.trim() || "Pharmacy";
}

type PdfRow = { label: string; value: string };
type PdfTable = { headers: string[]; rows: string[][] };

/** Flat A4 render of the same data as the on-screen document. */
function buildPatientPdfBlob(shop: string, title: string, rows: PdfRow[], tables: PdfTable[]): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, shop, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(layout, doc, title, { size: 13, bold: true });
  pdfLine(layout, doc, new Date().toLocaleString("en-UG", { timeZone: "Africa/Kampala" }), { size: 9 });
  pdfGap(layout, 8);
  for (const row of rows) {
    pdfLine(layout, doc, `${row.label}: ${row.value}`);
  }
  for (const table of tables) {
    pdfGap(layout, 8);
    pdfLine(layout, doc, table.headers.join("  |  "), { bold: true, size: 9 });
    if (!table.rows.length) {
      pdfLine(layout, doc, "—", { size: 9 });
      continue;
    }
    for (const row of table.rows) {
      pdfLine(layout, doc, row.join("  |  "), { size: 9 });
    }
  }
  return doc.output("blob");
}

function bodyHtml(shop: string, title: string, body: string): string {
  return `<article><h1>${shop}</h1><h2>${title}</h2>${body}</article>`;
}

export async function printPatientSummary(
  lang: Language,
  customer: Customer,
  prefs: ShopPreferences,
): Promise<boolean> {
  const shop = shopNameOf(prefs);
  const profile = ensurePharmacyPatientProfile(customer);
  const age = computePatientAge(profile.dateOfBirth);
  const title = t(lang, "pharmacyPatientPrintSummary");
  const rows: PdfRow[] = [
    { label: t(lang, "pharmacyPatientDob"), value: `${profile.dateOfBirth ?? "—"}${age != null ? ` (${age})` : ""}` },
    { label: t(lang, "pharmacyPatientGender"), value: profile.gender ?? "—" },
    { label: t(lang, "pharmacyPatientBloodGroup"), value: profile.bloodGroup ?? "—" },
    { label: t(lang, "pharmacyPatientAllergies"), value: (profile.allergies ?? []).join(", ") || "—" },
    { label: t(lang, "pharmacyPatientChronicConditions"), value: profile.chronicConditions ?? "—" },
  ];
  const body = `
<p><strong>${customer.name}</strong> · ${patientDisplayId(customer)}</p>
<p class="muted">${customer.phone}${profile.email ? ` · ${profile.email}` : ""}</p>
<table><tbody>
${rows.map((r) => `<tr><th>${r.label}</th><td>${r.value}</td></tr>`).join("")}
</tbody></table>`;
  return printDocumentNativeFallback({
    pdfFilename: `${sanitizePdfStem(`waka-patient-summary-${patientDisplayId(customer)}`)}.pdf`,
    buildPdfBlob: () => buildPatientPdfBlob(shop, title, [{ label: customer.name, value: patientDisplayId(customer) }, ...rows], []),
    htmlBody: bodyHtml(shop, title, body),
    paper: "a4",
    title,
    shareDialogTitle: title,
  });
}

export async function printPatientMedicationHistory(
  lang: Language,
  customer: Customer,
  events: PharmacyPatientTimelineEvent[],
  prefs: ShopPreferences,
): Promise<boolean> {
  const shop = shopNameOf(prefs);
  const title = t(lang, "pharmacyPatientPrintHistory");
  const headers = [
    t(lang, "pharmacyRxDate"),
    t(lang, "pharmacyPatientEvent"),
    t(lang, "pharmacyTerm_medicine"),
    t(lang, "pharmacyRxDoctor"),
    t(lang, "pharmacyBatchNumber"),
    "Qty",
  ];
  const rowValues = events.map((e) => [
    e.at.slice(0, 10),
    e.title,
    e.productName ?? e.detail ?? "",
    e.doctorName ?? "",
    e.batchNumber ?? "",
    String(e.quantity ?? ""),
  ]);
  const body = `
<p><strong>${customer.name}</strong></p>
<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${
    rowValues.length
      ? rowValues.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${headers.length}">${t(lang, "pharmacyPatientNoHistory")}</td></tr>`
  }</tbody></table>`;
  return printDocumentNativeFallback({
    pdfFilename: `${sanitizePdfStem(`waka-patient-history-${patientDisplayId(customer)}`)}.pdf`,
    buildPdfBlob: () =>
      buildPatientPdfBlob(
        shop,
        title,
        [{ label: t(lang, "pharmacyPatientProfileSection"), value: customer.name }],
        [{ headers, rows: rowValues }],
      ),
    htmlBody: bodyHtml(shop, title, body),
    paper: "a4",
    title,
    shareDialogTitle: title,
  });
}

export async function printRefillSchedule(
  lang: Language,
  customer: Customer,
  profile: PharmacyPatientProfile,
  prefs: ShopPreferences,
): Promise<boolean> {
  const shop = shopNameOf(prefs);
  const title = t(lang, "pharmacyPatientPrintRefillSchedule");
  const headers = [
    t(lang, "pharmacyTerm_medicine"),
    t(lang, "pharmacyChronicLastDispense"),
    t(lang, "pharmacyChronicNextRefill"),
    t(lang, "pharmacyChronicStatus"),
  ];
  const rowValues = activeChronicMedications(profile).map((m) => [
    m.productName,
    m.lastDispensedAt?.slice(0, 10) ?? "—",
    m.nextExpectedAt ?? "—",
    m.status,
  ]);
  const body = `
<p><strong>${customer.name}</strong></p>
<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${
    rowValues.length
      ? rowValues.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${headers.length}">${t(lang, "pharmacyChronicNone")}</td></tr>`
  }</tbody></table>`;
  return printDocumentNativeFallback({
    pdfFilename: `${sanitizePdfStem(`waka-refill-schedule-${patientDisplayId(customer)}`)}.pdf`,
    buildPdfBlob: () =>
      buildPatientPdfBlob(
        shop,
        title,
        [{ label: t(lang, "pharmacyPatientProfileSection"), value: customer.name }],
        [{ headers, rows: rowValues }],
      ),
    htmlBody: bodyHtml(shop, title, body),
    paper: "a4",
    title,
    shareDialogTitle: title,
  });
}

export async function printCounselingSummary(
  lang: Language,
  customer: Customer,
  profile: PharmacyPatientProfile,
  prefs: ShopPreferences,
): Promise<boolean> {
  const shop = shopNameOf(prefs);
  const title = t(lang, "pharmacyPatientPrintCounseling");
  const pinned = (profile.notes ?? []).filter((n) => n.pinned);
  const flags = Object.entries(profile.medicalFlags ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k);
  const allergies = (profile.allergies ?? []).join(", ") || "—";
  const body = `
<p><strong>${customer.name}</strong></p>
<h3>${t(lang, "pharmacyPatientAllergies")}</h3>
<p>${allergies}</p>
<h3>${t(lang, "pharmacyPatientMedicalFlags")}</h3>
<ul>${flags.map((f) => `<li>${f}</li>`).join("") || "<li>—</li>"}</ul>
<h3>${t(lang, "pharmacyPatientPinnedNotes")}</h3>
<ul>${pinned.map((n) => `<li>${n.text}</li>`).join("") || "<li>—</li>"}</ul>`;
  const rows: PdfRow[] = [
    { label: t(lang, "pharmacyPatientAllergies"), value: allergies },
    { label: t(lang, "pharmacyPatientMedicalFlags"), value: flags.join(", ") || "—" },
    { label: t(lang, "pharmacyPatientPinnedNotes"), value: pinned.map((n) => n.text).join(" · ") || "—" },
  ];
  return printDocumentNativeFallback({
    pdfFilename: `${sanitizePdfStem(`waka-counselling-${patientDisplayId(customer)}`)}.pdf`,
    buildPdfBlob: () =>
      buildPatientPdfBlob(shop, title, [{ label: t(lang, "pharmacyPatientProfileSection"), value: customer.name }, ...rows], []),
    htmlBody: bodyHtml(shop, title, body),
    paper: "a4",
    title,
    shareDialogTitle: title,
  });
}
