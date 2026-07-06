import type { Customer, Language, PharmacyPatientProfile, PharmacyPatientTimelineEvent, ShopPreferences } from "../types";
import { t } from "./i18n";
import { computePatientAge, ensurePharmacyPatientProfile, patientDisplayId } from "./pharmacyPatientProfile";
import { activeChronicMedications } from "./pharmacyChronicMeds";

function printHtml(title: string, body: string): void {
  const html = `<!DOCTYPE html><html><head><title>${title}</title>
<style>body{font-family:system-ui;padding:24px;max-width:800px;margin:0 auto}
h1,h2{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:12px}
td,th{border:1px solid #ddd;padding:8px;text-align:left;font-size:14px}
.muted{color:#666;font-size:13px}ul{margin:8px 0;padding-left:20px}</style></head><body>${body}
<script>window.print();</script></body></html>`;
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

export function printPatientSummary(
  lang: Language,
  customer: Customer,
  prefs: ShopPreferences,
): void {
  const shop = prefs.shopDisplayName?.trim() || "Pharmacy";
  const profile = ensurePharmacyPatientProfile(customer);
  const age = computePatientAge(profile.dateOfBirth);
  const body = `
<h1>${shop}</h1>
<h2>${t(lang, "pharmacyPatientPrintSummary")}</h2>
<p><strong>${customer.name}</strong> · ${patientDisplayId(customer)}</p>
<p class="muted">${customer.phone}${profile.email ? ` · ${profile.email}` : ""}</p>
<table><tbody>
<tr><th>${t(lang, "pharmacyPatientDob")}</th><td>${profile.dateOfBirth ?? "—"}${age != null ? ` (${age})` : ""}</td></tr>
<tr><th>${t(lang, "pharmacyPatientGender")}</th><td>${profile.gender ?? "—"}</td></tr>
<tr><th>${t(lang, "pharmacyPatientBloodGroup")}</th><td>${profile.bloodGroup ?? "—"}</td></tr>
<tr><th>${t(lang, "pharmacyPatientAllergies")}</th><td>${(profile.allergies ?? []).join(", ") || "—"}</td></tr>
<tr><th>${t(lang, "pharmacyPatientChronicConditions")}</th><td>${profile.chronicConditions ?? "—"}</td></tr>
</tbody></table>`;
  printHtml(t(lang, "pharmacyPatientPrintSummary"), body);
}

export function printPatientMedicationHistory(
  lang: Language,
  customer: Customer,
  events: PharmacyPatientTimelineEvent[],
  prefs: ShopPreferences,
): void {
  const shop = prefs.shopDisplayName?.trim() || "Pharmacy";
  const rows = events
    .map(
      (e) =>
        `<tr><td>${e.at.slice(0, 10)}</td><td>${e.title}</td><td>${e.productName ?? e.detail ?? ""}</td><td>${e.doctorName ?? ""}</td><td>${e.batchNumber ?? ""}</td><td>${e.quantity ?? ""}</td></tr>`,
    )
    .join("");
  const body = `
<h1>${shop}</h1>
<h2>${t(lang, "pharmacyPatientPrintHistory")}</h2>
<p><strong>${customer.name}</strong></p>
<table><thead><tr><th>${t(lang, "pharmacyRxDate")}</th><th>${t(lang, "pharmacyPatientEvent")}</th><th>${t(lang, "pharmacyTerm_medicine")}</th><th>${t(lang, "pharmacyRxDoctor")}</th><th>${t(lang, "pharmacyBatchNumber")}</th><th>Qty</th></tr></thead>
<tbody>${rows || `<tr><td colspan="6">${t(lang, "pharmacyPatientNoHistory")}</td></tr>`}</tbody></table>`;
  printHtml(t(lang, "pharmacyPatientPrintHistory"), body);
}

export function printRefillSchedule(
  lang: Language,
  customer: Customer,
  profile: PharmacyPatientProfile,
  prefs: ShopPreferences,
): void {
  const shop = prefs.shopDisplayName?.trim() || "Pharmacy";
  const meds = activeChronicMedications(profile);
  const rows = meds
    .map(
      (m) =>
        `<tr><td>${m.productName}</td><td>${m.lastDispensedAt?.slice(0, 10) ?? "—"}</td><td>${m.nextExpectedAt ?? "—"}</td><td>${m.status}</td></tr>`,
    )
    .join("");
  const body = `
<h1>${shop}</h1>
<h2>${t(lang, "pharmacyPatientPrintRefillSchedule")}</h2>
<p><strong>${customer.name}</strong></p>
<table><thead><tr><th>${t(lang, "pharmacyTerm_medicine")}</th><th>${t(lang, "pharmacyChronicLastDispense")}</th><th>${t(lang, "pharmacyChronicNextRefill")}</th><th>${t(lang, "pharmacyChronicStatus")}</th></tr></thead>
<tbody>${rows || `<tr><td colspan="4">${t(lang, "pharmacyChronicNone")}</td></tr>`}</tbody></table>`;
  printHtml(t(lang, "pharmacyPatientPrintRefillSchedule"), body);
}

export function printCounselingSummary(
  lang: Language,
  customer: Customer,
  profile: PharmacyPatientProfile,
  prefs: ShopPreferences,
): void {
  const shop = prefs.shopDisplayName?.trim() || "Pharmacy";
  const pinned = (profile.notes ?? []).filter((n) => n.pinned);
  const flags = profile.medicalFlags ?? {};
  const flagLines = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => `<li>${k}</li>`)
    .join("");
  const body = `
<h1>${shop}</h1>
<h2>${t(lang, "pharmacyPatientPrintCounseling")}</h2>
<p><strong>${customer.name}</strong></p>
<h3>${t(lang, "pharmacyPatientAllergies")}</h3>
<p>${(profile.allergies ?? []).join(", ") || "—"}</p>
<h3>${t(lang, "pharmacyPatientMedicalFlags")}</h3>
<ul>${flagLines || `<li>—</li>`}</ul>
<h3>${t(lang, "pharmacyPatientPinnedNotes")}</h3>
<ul>${pinned.map((n) => `<li>${n.text}</li>`).join("") || `<li>—</li>`}</ul>`;
  printHtml(t(lang, "pharmacyPatientPrintCounseling"), body);
}
