import type { PharmacyChronicMedication, PharmacyPatientProfile, Product } from "../types";
import { dateKeyKampala } from "./datesUg";
import { formatMedicineFullLabel } from "./pharmacyMedicine";

export function computeNextChronicRefillDate(lastDispensedAt: string, intervalDays: number): string {
  const d = new Date(lastDispensedAt);
  d.setDate(d.getDate() + Math.max(1, intervalDays));
  return dateKeyKampala(d);
}

export function refreshChronicMedicationStatuses(
  meds: PharmacyChronicMedication[],
  today: Date = new Date(),
): PharmacyChronicMedication[] {
  const todayKey = dateKeyKampala(today);
  return meds.map((m) => {
    if (m.status === "completed") return m;
    if (!m.nextExpectedAt || m.status !== "active") return m;
    if (m.nextExpectedAt < todayKey) {
      return { ...m, status: "missed" as const, updatedAt: new Date().toISOString() };
    }
    return m;
  });
}

export function chronicMedicationFromProduct(
  product: Product,
  intervalDays = 30,
  directions?: string | null,
): PharmacyChronicMedication {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    productId: product.id,
    productName: formatMedicineFullLabel(product),
    directions: directions?.trim() || null,
    intervalDays: Math.max(1, intervalDays),
    lastDispensedAt: null,
    nextExpectedAt: null,
    status: "active",
    prescriptionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function markChronicDispensed(
  meds: PharmacyChronicMedication[],
  productId: string,
  dispensedAt: string,
): PharmacyChronicMedication[] {
  return meds.map((m) => {
    if (m.productId !== productId || m.status === "completed") return m;
    const nextExpectedAt = computeNextChronicRefillDate(dispensedAt, m.intervalDays);
    return {
      ...m,
      lastDispensedAt: dispensedAt,
      nextExpectedAt,
      status: "active",
      updatedAt: new Date().toISOString(),
    };
  });
}

export function activeChronicMedications(profile: PharmacyPatientProfile): PharmacyChronicMedication[] {
  return refreshChronicMedicationStatuses(profile.chronicMedications ?? []).filter(
    (m) => m.status === "active" || m.status === "missed",
  );
}

export function refillsDueFromChronic(profile: PharmacyPatientProfile, today: Date = new Date()): number {
  const todayKey = dateKeyKampala(today);
  return activeChronicMedications(profile).filter(
    (m) => m.nextExpectedAt && m.nextExpectedAt <= todayKey,
  ).length;
}

export function missedRefillsFromChronic(profile: PharmacyPatientProfile): number {
  return (profile.chronicMedications ?? []).filter((m) => m.status === "missed").length;
}
