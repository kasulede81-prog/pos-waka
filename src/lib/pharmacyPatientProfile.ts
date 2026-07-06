import type {
  Customer,
  PharmacyBloodGroup,
  PharmacyChronicMedication,
  PharmacyPatientDocument,
  PharmacyPatientGender,
  PharmacyPatientMedicalFlags,
  PharmacyPatientNote,
  PharmacyPatientProfile,
} from "../types";
import { dateKeyKampala } from "./datesUg";

const GENDERS: PharmacyPatientGender[] = ["male", "female", "other", "unspecified"];
const BLOOD_GROUPS: PharmacyBloodGroup[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"];

let patientSeq = 0;

export function generatePatientCode(at: Date = new Date()): string {
  const day = dateKeyKampala(at).replace(/-/g, "");
  patientSeq = (patientSeq + 1) % 10000;
  return `PT-${day}-${String(patientSeq).padStart(4, "0")}`;
}

function normalizeNote(raw: unknown): PharmacyPatientNote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const text = String(r.text ?? "").trim();
  if (!id || !text) return null;
  return {
    id,
    text,
    pinned: Boolean(r.pinned),
    createdAt: String(r.createdAt ?? new Date().toISOString()),
  };
}

function normalizeDocument(raw: unknown): PharmacyPatientDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const label = String(r.label ?? "").trim();
  if (!id || !label) return null;
  const kind = r.kind as PharmacyPatientDocument["kind"];
  const validKinds: PharmacyPatientDocument["kind"][] = [
    "prescription_scan",
    "lab_report",
    "insurance_card",
    "doctor_referral",
  ];
  return {
    id,
    kind: validKinds.includes(kind) ? kind : "prescription_scan",
    label,
    placeholder: true,
    createdAt: String(r.createdAt ?? new Date().toISOString()),
  };
}

function normalizeChronicMed(raw: unknown): PharmacyChronicMedication | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const productId = String(r.productId ?? "").trim();
  if (!id || !productId) return null;
  const status =
    r.status === "completed" || r.status === "missed" ? r.status : r.status === "active" ? "active" : "active";
  return {
    id,
    productId,
    productName: String(r.productName ?? "—"),
    directions: r.directions != null ? String(r.directions) : null,
    intervalDays: Math.max(1, Math.floor(Number(r.intervalDays ?? 30))),
    lastDispensedAt: r.lastDispensedAt != null ? String(r.lastDispensedAt) : null,
    nextExpectedAt: r.nextExpectedAt != null ? String(r.nextExpectedAt) : null,
    status,
    prescriptionId: r.prescriptionId != null ? String(r.prescriptionId) : null,
    createdAt: String(r.createdAt ?? new Date().toISOString()),
    updatedAt: String(r.updatedAt ?? r.createdAt ?? new Date().toISOString()),
  };
}

function normalizeMedicalFlags(raw: unknown): PharmacyPatientMedicalFlags | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    pregnancy: Boolean(r.pregnancy),
    breastfeeding: Boolean(r.breastfeeding),
    diabetes: Boolean(r.diabetes),
    hypertension: Boolean(r.hypertension),
    asthma: Boolean(r.asthma),
    kidneyDisease: Boolean(r.kidneyDisease),
    liverDisease: Boolean(r.liverDisease),
  };
}

export function normalizePharmacyPatientProfile(
  raw: unknown,
  customerId?: string,
): PharmacyPatientProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const legacyId = r.idNumber != null ? String(r.idNumber).trim() : "";
  const nationalId = r.nationalId != null ? String(r.nationalId).trim() : legacyId || null;
  const allergiesRaw = r.allergies;
  let allergies: string[] = [];
  if (Array.isArray(allergiesRaw)) {
    allergies = allergiesRaw.map((a) => String(a).trim()).filter(Boolean);
  } else if (typeof r.allergiesText === "string" && r.allergiesText.trim()) {
    allergies = r.allergiesText
      .split(/[,;]+/)
      .map((a) => a.trim())
      .filter(Boolean);
  } else if (typeof allergiesRaw === "string" && allergiesRaw.trim()) {
    allergies = allergiesRaw
      .split(/[,;]+/)
      .map((a) => a.trim())
      .filter(Boolean);
  }
  const gender = GENDERS.includes(r.gender as PharmacyPatientGender)
    ? (r.gender as PharmacyPatientGender)
    : null;
  const bloodGroup = BLOOD_GROUPS.includes(r.bloodGroup as PharmacyBloodGroup)
    ? (r.bloodGroup as PharmacyBloodGroup)
    : null;
  const patientCode =
    String(r.patientCode ?? "").trim() ||
    (customerId ? `PT-${customerId.slice(0, 8).toUpperCase()}` : generatePatientCode());
  return {
    patientCode,
    dateOfBirth: r.dateOfBirth != null ? String(r.dateOfBirth) : null,
    gender,
    email: r.email != null ? String(r.email) : null,
    address: r.address != null ? String(r.address) : null,
    nationalId,
    emergencyContactName: r.emergencyContactName != null ? String(r.emergencyContactName) : null,
    emergencyContactPhone: r.emergencyContactPhone != null ? String(r.emergencyContactPhone) : null,
    preferredLanguage: r.preferredLanguage != null ? String(r.preferredLanguage) : null,
    bloodGroup,
    weightKg: r.weightKg != null ? Math.max(0, Number(r.weightKg)) : null,
    heightCm: r.heightCm != null ? Math.max(0, Number(r.heightCm)) : null,
    allergies,
    allergiesText: r.allergiesText != null ? String(r.allergiesText) : allergies.join(", ") || null,
    chronicConditions: r.chronicConditions != null ? String(r.chronicConditions) : null,
    medicalFlags: normalizeMedicalFlags(r.medicalFlags),
    notes: Array.isArray(r.notes)
      ? (r.notes.map(normalizeNote).filter(Boolean) as PharmacyPatientNote[])
      : [],
    documents: Array.isArray(r.documents)
      ? (r.documents.map(normalizeDocument).filter(Boolean) as PharmacyPatientDocument[])
      : [],
    chronicMedications: Array.isArray(r.chronicMedications)
      ? (r.chronicMedications.map(normalizeChronicMed).filter(Boolean) as PharmacyChronicMedication[])
      : [],
    idNumber: nationalId,
  };
}

export function ensurePharmacyPatientProfile(customer: Customer): PharmacyPatientProfile {
  if (customer.pharmacyProfile) {
    const normalized = normalizePharmacyPatientProfile(customer.pharmacyProfile, customer.id);
    if (normalized) return normalized;
  }
  return {
    patientCode: generatePatientCode(),
    allergies: [],
    notes: [],
    documents: [],
    chronicMedications: [],
    medicalFlags: {},
  };
}

export function computePatientAge(dateOfBirth: string | null | undefined, today: Date = new Date()): number | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const dob = new Date(`${dateOfBirth}T12:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function pinnedPatientNotes(profile: PharmacyPatientProfile): PharmacyPatientNote[] {
  return (profile.notes ?? []).filter((n) => n.pinned).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isPharmacyPatient(customer: Customer): boolean {
  return Boolean(customer.pharmacyProfile);
}

export function patientDisplayId(customer: Customer): string {
  const profile = customer.pharmacyProfile
    ? normalizePharmacyPatientProfile(customer.pharmacyProfile, customer.id)
    : null;
  return profile?.patientCode ?? customer.id.slice(0, 8).toUpperCase();
}
