import type { PharmacyDoctor, PharmacyPrescription } from "../types";

export function normalizePharmacyDoctor(raw: unknown): PharmacyDoctor | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const name = String(r.name ?? "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    clinic: r.clinic != null ? String(r.clinic) : null,
    phone: r.phone != null ? String(r.phone) : null,
    registrationNumber: r.registrationNumber != null ? String(r.registrationNumber) : null,
    notes: r.notes != null ? String(r.notes) : null,
    createdAt: String(r.createdAt ?? new Date().toISOString()),
    updatedAt: String(r.updatedAt ?? r.createdAt ?? new Date().toISOString()),
    version: Math.max(1, Math.floor(Number(r.version ?? 1))),
    pendingSync: r.pendingSync !== false,
  };
}

export function prescriptionsForDoctor(
  prescriptions: PharmacyPrescription[],
  doctorId: string,
): PharmacyPrescription[] {
  return prescriptions
    .filter((rx) => rx.doctorId === doctorId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function prescriptionsByDoctorName(
  prescriptions: PharmacyPrescription[],
  doctorName: string,
): PharmacyPrescription[] {
  const q = doctorName.trim().toLowerCase();
  return prescriptions
    .filter((rx) => rx.doctorName?.trim().toLowerCase() === q)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function mergePharmacyDoctorLww(local: PharmacyDoctor, remote: PharmacyDoctor): PharmacyDoctor {
  if (remote.version > local.version) return remote;
  if (remote.version < local.version) return local;
  return remote.updatedAt >= local.updatedAt ? remote : local;
}
