import type { Customer, PharmacyPrescription, Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { missedRefillsFromChronic, refillsDueFromChronic } from "./pharmacyChronicMeds";
import { ensurePharmacyPatientProfile } from "./pharmacyPatientProfile";
import { activePrescriptionQueue } from "./pharmacyPrescriptions";

export type PharmacyPatientDashboardStats = {
  patientsToday: number;
  newPatientsToday: number;
  refillsDue: number;
  missedRefills: number;
  patientsWaiting: number;
  controlledPatientsToday: number;
  topChronicPatients: { patientId: string; name: string; chronicCount: number }[];
};

export function computePharmacyPatientDashboardStats(
  customers: Customer[],
  prescriptions: PharmacyPrescription[],
  sales: Sale[],
  today: Date = new Date(),
): PharmacyPatientDashboardStats {
  const dayKey = dateKeyKampala(today);
  const patientIdsToday = new Set<string>();
  for (const sale of sales) {
    if (sale.status === "cancelled" || !sale.customerId) continue;
    if (!sale.createdAt.startsWith(dayKey)) continue;
    patientIdsToday.add(sale.customerId);
  }
  for (const rx of prescriptions) {
    if (!rx.patientId) continue;
    if (rx.prescriptionDate === dayKey || rx.createdAt.startsWith(dayKey) || rx.dispensedAt?.startsWith(dayKey)) {
      patientIdsToday.add(rx.patientId);
    }
  }

  const newPatientsToday = customers.filter((c) => c.createdAt.startsWith(dayKey)).length;
  let refillsDue = 0;
  let missedRefills = 0;
  const chronicCounts: { patientId: string; name: string; chronicCount: number }[] = [];

  for (const c of customers) {
    const profile = ensurePharmacyPatientProfile(c);
    refillsDue += refillsDueFromChronic(profile, today);
    missedRefills += missedRefillsFromChronic(profile);
    const chronicCount = (profile.chronicMedications ?? []).filter(
      (m) => m.status === "active" || m.status === "missed",
    ).length;
    if (chronicCount > 0) chronicCounts.push({ patientId: c.id, name: c.name, chronicCount });
  }

  const queue = activePrescriptionQueue(prescriptions);
  const waitingPatientIds = new Set(
    queue.filter((rx) => rx.patientId).map((rx) => rx.patientId as string),
  );

  const controlledPatientsToday = new Set(
    prescriptions
      .filter((rx) => rx.controlledMedicinesApproved && rx.dispensedAt?.startsWith(dayKey) && rx.patientId)
      .map((rx) => rx.patientId as string),
  ).size;

  chronicCounts.sort((a, b) => b.chronicCount - a.chronicCount);

  return {
    patientsToday: patientIdsToday.size,
    newPatientsToday,
    refillsDue,
    missedRefills,
    patientsWaiting: waitingPatientIds.size,
    controlledPatientsToday,
    topChronicPatients: chronicCounts.slice(0, 5),
  };
}
