import type { Customer, PharmacyDoctor, PharmacyPrescription, Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { computePatientAge, ensurePharmacyPatientProfile } from "./pharmacyPatientProfile";
import { prescriptionsByDoctorName } from "./pharmacyDoctors";
import { missedRefillsFromChronic, refillsDueFromChronic } from "./pharmacyChronicMeds";

export type PharmacyPatientReportBundle = {
  mostDispensedPatients: { patientId: string; name: string; dispenseCount: number }[];
  refillCompliance: { patientId: string; name: string; due: number; missed: number }[];
  chronicMedicinePatients: { patientId: string; name: string; activeChronic: number }[];
  doctorReferrals: { doctorName: string; rxCount: number }[];
  patientGrowth: { month: string; count: number }[];
  ageDistribution: { bucket: string; count: number }[];
};

export function computePharmacyPatientReports(
  customers: Customer[],
  prescriptions: PharmacyPrescription[],
  sales: Sale[],
  doctors: PharmacyDoctor[],
  today: Date = new Date(),
): PharmacyPatientReportBundle {
  const dispenseCountByPatient = new Map<string, number>();
  for (const sale of sales) {
    if (sale.status === "cancelled" || !sale.customerId) continue;
    dispenseCountByPatient.set(sale.customerId, (dispenseCountByPatient.get(sale.customerId) ?? 0) + 1);
  }
  for (const rx of prescriptions) {
    if (!rx.patientId || !rx.dispensedAt) continue;
    dispenseCountByPatient.set(rx.patientId, (dispenseCountByPatient.get(rx.patientId) ?? 0) + 1);
  }

  const mostDispensedPatients = customers
    .map((c) => ({
      patientId: c.id,
      name: c.name,
      dispenseCount: dispenseCountByPatient.get(c.id) ?? 0,
    }))
    .filter((r) => r.dispenseCount > 0)
    .sort((a, b) => b.dispenseCount - a.dispenseCount)
    .slice(0, 10);

  const refillCompliance = customers
    .map((c) => {
      const profile = ensurePharmacyPatientProfile(c);
      return {
        patientId: c.id,
        name: c.name,
        due: refillsDueFromChronic(profile, today),
        missed: missedRefillsFromChronic(profile),
      };
    })
    .filter((r) => r.due > 0 || r.missed > 0)
    .sort((a, b) => b.missed - a.missed || b.due - a.due)
    .slice(0, 15);

  const chronicMedicinePatients = customers
    .map((c) => {
      const profile = ensurePharmacyPatientProfile(c);
      const activeChronic = (profile.chronicMedications ?? []).filter(
        (m) => m.status === "active" || m.status === "missed",
      ).length;
      return { patientId: c.id, name: c.name, activeChronic };
    })
    .filter((r) => r.activeChronic > 0)
    .sort((a, b) => b.activeChronic - a.activeChronic)
    .slice(0, 15);

  const doctorRxCount = new Map<string, number>();
  for (const rx of prescriptions) {
    if (!rx.doctorName?.trim()) continue;
    const name = rx.doctorName.trim();
    doctorRxCount.set(name, (doctorRxCount.get(name) ?? 0) + 1);
  }
  for (const doc of doctors) {
    const linked = prescriptionsByDoctorName(prescriptions, doc.name).length;
    if (linked > 0) doctorRxCount.set(doc.name, Math.max(doctorRxCount.get(doc.name) ?? 0, linked));
  }
  const doctorReferrals = [...doctorRxCount.entries()]
    .map(([doctorName, rxCount]) => ({ doctorName, rxCount }))
    .sort((a, b) => b.rxCount - a.rxCount)
    .slice(0, 15);

  const growthByMonth = new Map<string, number>();
  for (const c of customers) {
    const month = c.createdAt.slice(0, 7);
    growthByMonth.set(month, (growthByMonth.get(month) ?? 0) + 1);
  }
  const patientGrowth = [...growthByMonth.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);

  const ageBuckets = new Map<string, number>([
    ["0-17", 0],
    ["18-39", 0],
    ["40-59", 0],
    ["60+", 0],
    ["Unknown", 0],
  ]);
  for (const c of customers) {
    const profile = ensurePharmacyPatientProfile(c);
    const age = computePatientAge(profile.dateOfBirth, today);
    if (age == null) ageBuckets.set("Unknown", (ageBuckets.get("Unknown") ?? 0) + 1);
    else if (age < 18) ageBuckets.set("0-17", (ageBuckets.get("0-17") ?? 0) + 1);
    else if (age < 40) ageBuckets.set("18-39", (ageBuckets.get("18-39") ?? 0) + 1);
    else if (age < 60) ageBuckets.set("40-59", (ageBuckets.get("40-59") ?? 0) + 1);
    else ageBuckets.set("60+", (ageBuckets.get("60+") ?? 0) + 1);
  }
  const ageDistribution = [...ageBuckets.entries()].map(([bucket, count]) => ({ bucket, count }));

  return {
    mostDispensedPatients,
    refillCompliance,
    chronicMedicinePatients,
    doctorReferrals,
    patientGrowth,
    ageDistribution,
  };
}

export function patientsCreatedSince(customers: Customer[], sinceKey: string): number {
  return customers.filter((c) => dateKeyKampala(c.createdAt) >= sinceKey).length;
}
