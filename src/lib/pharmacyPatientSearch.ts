import type { Customer, PharmacyDoctor, PharmacyPrescription, Product } from "../types";
import { patientDisplayId } from "./pharmacyPatientProfile";
import { prescriptionsForPatient } from "./pharmacyPrescriptions";

export type PharmacyPatientSearchRow = Customer & {
  matchHint?: string;
  rxCount?: number;
};

export function searchPharmacyPatients(
  customers: Customer[],
  query: string,
  prescriptions: PharmacyPrescription[],
  products: Product[],
): PharmacyPatientSearchRow[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return customers
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({
        ...c,
        rxCount: prescriptionsForPatient(prescriptions, c.id).length,
      }));
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  return customers
    .filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.phone.toLowerCase().includes(q)) return true;
      if (c.location.toLowerCase().includes(q)) return true;
      const profile = c.pharmacyProfile;
      if (profile?.patientCode?.toLowerCase().includes(q)) return true;
      if (profile?.nationalId?.toLowerCase().includes(q)) return true;
      if (profile?.idNumber?.toLowerCase().includes(q)) return true;
      if (profile?.email?.toLowerCase().includes(q)) return true;
      if (patientDisplayId(c).toLowerCase().includes(q)) return true;
      const rxList = prescriptionsForPatient(prescriptions, c.id);
      for (const rx of rxList) {
        if (rx.prescriptionNumber.toLowerCase().includes(q)) return true;
        if (rx.doctorName?.toLowerCase().includes(q)) return true;
        if (
          rx.lines.some((l) => {
            if (l.productName.toLowerCase().includes(q)) return true;
            const p = productById.get(l.productId);
            return (
              p?.name.toLowerCase().includes(q) ||
              p?.pharmacyMaster?.genericName?.toLowerCase().includes(q) ||
              p?.pharmacyMaster?.brandName?.toLowerCase().includes(q)
            );
          })
        ) {
          return true;
        }
      }
      return false;
    })
    .map((c) => ({
      ...c,
      rxCount: prescriptionsForPatient(prescriptions, c.id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function searchPharmacyDoctors(doctors: PharmacyDoctor[], query: string): PharmacyDoctor[] {
  const q = query.trim().toLowerCase();
  if (!q) return doctors.slice().sort((a, b) => a.name.localeCompare(b.name));
  return doctors
    .filter((d) => {
      if (d.name.toLowerCase().includes(q)) return true;
      if (d.clinic?.toLowerCase().includes(q)) return true;
      if (d.phone?.toLowerCase().includes(q)) return true;
      if (d.registrationNumber?.toLowerCase().includes(q)) return true;
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
