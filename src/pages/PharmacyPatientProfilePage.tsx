import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import clsx from "clsx";
import type { Language, PharmacyPatientDocumentKind } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isPharmacyMode } from "../lib/pharmacy";
import {
  computePatientAge,
  ensurePharmacyPatientProfile,
  patientDisplayId,
  pinnedPatientNotes,
} from "../lib/pharmacyPatientProfile";
import { buildPatientTimeline, patientSummary } from "../lib/pharmacyPatientTimeline";
import { activeChronicMedications } from "../lib/pharmacyChronicMeds";
import { searchPharmacyDoctors } from "../lib/pharmacyPatientSearch";
import {
  printCounselingSummary,
  printPatientMedicationHistory,
  printPatientSummary,
  printRefillSchedule,
} from "../lib/pharmacyPatientPrint";
import { PHARMACY_PRESCRIPTIONS_ROUTE } from "../lib/pharmacyNav";
import { formatUgx } from "../lib/formatUgx";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PharmacyAllergyWarningBanner } from "../components/pharmacy/patient/PharmacyAllergyWarningBanner";

const DOC_KINDS: PharmacyPatientDocumentKind[] = [
  "prescription_scan",
  "lab_report",
  "insurance_card",
  "doctor_referral",
];

export function PharmacyPatientProfilePage({ lang }: { lang: Language }) {
  const { patientId } = useParams<{ patientId: string }>();
  const preferences = usePosStore((s) => s.preferences);
  const customers = usePosStore((s) => s.customers);
  const prescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const products = usePosStore((s) => s.products);
  const doctors = usePosStore((s) => s.pharmacyDoctors);
  const updateProfile = usePosStore((s) => s.updatePharmacyPatientProfile);
  const addNote = usePosStore((s) => s.addPharmacyPatientNote);
  const addDocument = usePosStore((s) => s.addPharmacyPatientDocumentPlaceholder);
  const addDoctor = usePosStore((s) => s.addPharmacyDoctor);
  const createRefill = usePosStore((s) => s.createPharmacyRefill);

  const [noteText, setNoteText] = useState("");
  const [docLabel, setDocLabel] = useState("");
  const [docKind, setDocKind] = useState<PharmacyPatientDocumentKind>("prescription_scan");
  const [doctorName, setDoctorName] = useState("");
  const [doctorClinic, setDoctorClinic] = useState("");

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const patient = customers.find((c) => c.id === patientId);

  const profile = useMemo(
    () => (patient ? ensurePharmacyPatientProfile(patient) : null),
    [patient],
  );

  const timeline = useMemo(() => {
    if (!patientId) return [];
    return buildPatientTimeline({
      patientId,
      prescriptions,
      sales,
      debtPayments,
      products,
    });
  }, [patientId, prescriptions, sales, debtPayments, products]);

  const stats = useMemo(() => {
    if (!patient) return null;
    return patientSummary({ patient, prescriptions, sales });
  }, [patient, prescriptions, sales]);

  const chronicMeds = useMemo(() => (profile ? activeChronicMedications(profile) : []), [profile]);
  const pinned = useMemo(() => (profile ? pinnedPatientNotes(profile) : []), [profile]);
  const patientRx = useMemo(
    () => prescriptions.filter((rx) => rx.patientId === patientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [prescriptions, patientId],
  );

  if (!pharmacy) return null;
  if (!patient || !profile) {
    return (
      <EnterprisePageContainer>
        <p className="font-bold text-muted-foreground">{t(lang, "pharmacyPatientNotFound")}</p>
        <Link to="/pharmacy/patients" className="mt-2 inline-block font-black text-teal-700">
          {t(lang, "pharmacyNavExit")}
        </Link>
      </EnterprisePageContainer>
    );
  }

  const age = computePatientAge(profile.dateOfBirth);
  const allergiesStr = (profile.allergies ?? []).join(", ");

  const patch = (field: string, value: string | boolean) => {
    if (field.startsWith("flag.")) {
      const key = field.slice(5);
      updateProfile(patient.id, {
        medicalFlags: { ...profile.medicalFlags, [key]: value },
      });
      return;
    }
    if (field === "allergies") {
      updateProfile(patient.id, {
        allergies: String(value)
          .split(/[,;]+/)
          .map((a) => a.trim())
          .filter(Boolean),
        allergiesText: String(value),
      });
      return;
    }
    updateProfile(patient.id, { [field]: value });
  };

  const eligibleRefill = patientRx.find(
    (rx) => rx.status === "dispensed" || rx.status === "archived",
  );

  return (
    <EnterprisePageContainer>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/pharmacy/patients" className="text-sm font-bold text-teal-700">
            ← {t(lang, "pharmacyTerm_patients")}
          </Link>
          <h1 className="mt-1 text-3xl font-black text-foreground">{patient.name}</h1>
          <p className="text-sm font-semibold text-muted-foreground">
            {patientDisplayId(patient)} · {patient.phone || "—"}
            {age != null ? ` · ${age} ${t(lang, "pharmacyPatientYears")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`${PHARMACY_PRESCRIPTIONS_ROUTE}?patient=${patient.id}`}
            className="min-h-[48px] rounded-2xl bg-teal-600 px-4 text-sm font-black text-white touch-manipulation"
          >
            {t(lang, "pharmacyRxNew")}
          </Link>
          {eligibleRefill ? (
            <button
              type="button"
              onClick={() => createRefill(eligibleRefill.id)}
              className="min-h-[48px] rounded-2xl border-2 border-teal-300 bg-teal-50 px-4 text-sm font-black text-teal-950"
            >
              {t(lang, "pharmacyRxRefill")}
            </button>
          ) : null}
        </div>
      </div>

      {pinned.length > 0 ? (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-black uppercase text-amber-900">{t(lang, "pharmacyPatientPinnedNotes")}</p>
          <ul className="mt-2 space-y-1">
            {pinned.map((n) => (
              <li key={n.id} className="text-base font-black text-amber-950">
                {n.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PharmacyAllergyWarningBanner lang={lang} patient={patient} productIds={[]} previewMode />

      {stats && stats.outstandingDebtUgx > 0 ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
          {t(lang, "debtBalanceLabel")}: {formatUgx(stats.outstandingDebtUgx)}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-foreground">{t(lang, "pharmacyPatientProfileSection")}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t(lang, "pharmacyPatientDob")} value={profile.dateOfBirth ?? ""} onChange={(v) => patch("dateOfBirth", v)} />
            <Field label={t(lang, "pharmacyPatientGender")} value={profile.gender ?? ""} onChange={(v) => patch("gender", v)} />
            <Field label={t(lang, "pharmacyPatientEmail")} value={profile.email ?? ""} onChange={(v) => patch("email", v)} />
            <Field label={t(lang, "pharmacyPatientAddress")} value={profile.address ?? ""} onChange={(v) => patch("address", v)} />
            <Field label={t(lang, "pharmacyPatientNationalId")} value={profile.nationalId ?? ""} onChange={(v) => patch("nationalId", v)} />
            <Field label={t(lang, "pharmacyPatientBloodGroup")} value={profile.bloodGroup ?? ""} onChange={(v) => patch("bloodGroup", v)} />
            <Field label={t(lang, "pharmacyPatientWeight")} value={profile.weightKg != null ? String(profile.weightKg) : ""} onChange={(v) => patch("weightKg", v)} />
            <Field label={t(lang, "pharmacyPatientHeight")} value={profile.heightCm != null ? String(profile.heightCm) : ""} onChange={(v) => patch("heightCm", v)} />
            <Field label={t(lang, "pharmacyPatientEmergency")} value={profile.emergencyContactName ?? ""} onChange={(v) => patch("emergencyContactName", v)} />
            <Field label={t(lang, "pharmacyPatientEmergencyPhone")} value={profile.emergencyContactPhone ?? ""} onChange={(v) => patch("emergencyContactPhone", v)} />
            <Field label={t(lang, "pharmacyPatientAllergies")} value={allergiesStr} onChange={(v) => patch("allergies", v)} className="sm:col-span-2" />
            <Field label={t(lang, "pharmacyPatientChronicConditions")} value={profile.chronicConditions ?? ""} onChange={(v) => patch("chronicConditions", v)} className="sm:col-span-2" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ["pregnancy", t(lang, "pharmacyMedPregnancy")],
              ["breastfeeding", t(lang, "pharmacyMedBreastfeeding")],
              ["diabetes", t(lang, "pharmacyMedDiabetes")],
              ["hypertension", t(lang, "pharmacyMedHypertension")],
              ["asthma", t(lang, "pharmacyMedAsthma")],
              ["kidneyDisease", t(lang, "pharmacyMedKidney")],
              ["liverDisease", t(lang, "pharmacyMedLiver")],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => patch(`flag.${key}`, !profile.medicalFlags?.[key as keyof typeof profile.medicalFlags])}
                className={clsx(
                  "min-h-[44px] rounded-xl px-3 text-sm font-black touch-manipulation",
                  profile.medicalFlags?.[key as keyof typeof profile.medicalFlags]
                    ? "bg-violet-600 text-white"
                    : "border border-border bg-muted text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-foreground">{t(lang, "pharmacyPatientStats")}</h2>
          {stats ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Stat label={t(lang, "pharmacyRxTimelineTitle")} value={String(stats.prescriptionCount)} />
              <Stat label={t(lang, "pharmacyRxStatusDispensed")} value={String(stats.dispensedCount)} />
              <Stat label="OTC" value={String(stats.otcCount)} />
              <Stat label={t(lang, "pharmacyDashRxRefillsDue")} value={String(stats.refillsDue)} />
            </dl>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <PrintBtn label={t(lang, "pharmacyPatientPrintSummary")} onClick={() => printPatientSummary(lang, patient, preferences)} />
            <PrintBtn label={t(lang, "pharmacyPatientPrintHistory")} onClick={() => printPatientMedicationHistory(lang, patient, timeline, preferences)} />
            <PrintBtn label={t(lang, "pharmacyPatientPrintRefillSchedule")} onClick={() => printRefillSchedule(lang, patient, profile, preferences)} />
            <PrintBtn label={t(lang, "pharmacyPatientPrintCounseling")} onClick={() => printCounselingSummary(lang, patient, profile, preferences)} />
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-border bg-card p-4 shadow-waka-sm">
        <h2 className="text-lg font-black text-foreground">{t(lang, "pharmacyPatientTimelineTitle")}</h2>
        <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
          {timeline.map((ev) => (
            <li key={ev.id} className="rounded-2xl border border-border bg-muted px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-black text-foreground">{ev.title}</p>
                <p className="text-xs font-bold text-muted-foreground">{ev.at.slice(0, 16).replace("T", " ")}</p>
              </div>
              {ev.productName ? <p className="text-sm font-semibold text-teal-900">{ev.productName}</p> : null}
              <p className="text-sm text-muted-foreground">
                {[ev.doctorName, ev.batchNumber ? `${t(lang, "pharmacyBatchNumber")}: ${ev.batchNumber}` : null, ev.quantity != null ? `×${ev.quantity}` : null, ev.detail]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
        {timeline.length === 0 ? (
          <p className="mt-3 text-sm font-medium text-muted-foreground">{t(lang, "pharmacyPatientNoHistory")}</p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card p-4">
          <h2 className="text-lg font-black">{t(lang, "pharmacyChronicTitle")}</h2>
          <ul className="mt-2 space-y-2">
            {chronicMeds.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm font-bold">
                <span>{m.productName}</span>
                <span className={m.status === "missed" ? "text-rose-700" : "text-teal-800"}>{m.status}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-border bg-card p-4">
          <h2 className="text-lg font-black">{t(lang, "pharmacyPatientNotes")}</h2>
          <div className="mt-2 flex gap-2">
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t(lang, "pharmacyPatientNotePh")}
              className="min-h-[44px] flex-1 rounded-xl border-2 px-3 font-semibold"
            />
            <button
              type="button"
              onClick={() => {
                addNote(patient.id, noteText, true);
                setNoteText("");
              }}
              className="min-h-[44px] rounded-xl bg-amber-500 px-3 font-black text-white"
            >
              {t(lang, "pharmacyPatientPinNote")}
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-sm font-semibold text-muted-foreground">
            {(profile.notes ?? []).map((n) => (
              <li key={n.id}>
                {n.pinned ? "📌 " : ""}
                {n.text}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-3xl border border-dashed border-border bg-muted p-4">
        <h2 className="text-lg font-black">{t(lang, "pharmacyPatientDocuments")}</h2>
        <p className="text-xs font-semibold text-muted-foreground">{t(lang, "pharmacyPatientDocumentsSub")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select value={docKind} onChange={(e) => setDocKind(e.target.value as PharmacyPatientDocumentKind)} className="min-h-[44px] rounded-xl border-2 px-2 font-bold">
            {DOC_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(lang, `pharmacyDoc_${k}`)}
              </option>
            ))}
          </select>
          <input value={docLabel} onChange={(e) => setDocLabel(e.target.value)} placeholder={t(lang, "pharmacyPatientDocLabelPh")} className="min-h-[44px] flex-1 rounded-xl border-2 px-3" />
          <button type="button" onClick={() => { addDocument(patient.id, docKind, docLabel); setDocLabel(""); }} className="min-h-[44px] rounded-xl bg-foreground px-4 font-black text-background">
            {t(lang, "pharmacyAdd")}
          </button>
        </div>
        <ul className="mt-2 text-sm font-semibold text-muted-foreground">
          {(profile.documents ?? []).map((d) => (
            <li key={d.id}>{t(lang, `pharmacyDoc_${d.kind}`)} — {d.label}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl border border-border bg-card p-4">
        <h2 className="text-lg font-black">{t(lang, "pharmacyDoctorDirectory")}</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder={t(lang, "pharmacyRxDoctor")} className="min-h-[44px] rounded-xl border-2 px-3 font-semibold" />
          <input value={doctorClinic} onChange={(e) => setDoctorClinic(e.target.value)} placeholder={t(lang, "pharmacyDoctorClinic")} className="min-h-[44px] rounded-xl border-2 px-3 font-semibold" />
          <button type="button" onClick={() => { addDoctor({ name: doctorName, clinic: doctorClinic }); setDoctorName(""); setDoctorClinic(""); }} className="min-h-[44px] rounded-xl bg-teal-600 font-black text-white">
            {t(lang, "pharmacyAdd")}
          </button>
        </div>
        <ul className="mt-3 space-y-1">
          {searchPharmacyDoctors(doctors, "").slice(0, 12).map((d) => (
            <li key={d.id} className="text-sm font-bold text-foreground">
              {d.name}
              {d.clinic ? ` · ${d.clinic}` : ""}
              {d.phone ? ` · ${d.phone}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </EnterprisePageContainer>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={clsx("block text-sm font-bold text-muted-foreground", className)}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(e.target.value)}
        className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border px-3 font-semibold"
      />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <p className="text-xs font-black uppercase text-muted-foreground">{label}</p>
      <p className="text-2xl font-black text-foreground">{value}</p>
    </div>
  );
}

function PrintBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-[40px] rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground">
      {label}
    </button>
  );
}
