import { Link } from "react-router-dom";
import type { Customer, Language, PharmacyPrescription } from "../../../types";
import { t } from "../../../lib/i18n";
import { PharmacyAllergyWarningBanner } from "../patient/PharmacyAllergyWarningBanner";
import { ensurePharmacyPatientProfile, pinnedPatientNotes } from "../../../lib/pharmacyPatientProfile";
import { buildPatientTimeline, patientSummary } from "../../../lib/pharmacyPatientTimeline";
import { formatUgx } from "../../../lib/formatUgx";
import type { Product, Sale } from "../../../types";

type Props = {
  lang: Language;
  patient: Customer;
  selectedRx: PharmacyPrescription | null;
  prescriptions: PharmacyPrescription[];
  sales: Sale[];
  products: Product[];
  basketProductIds: string[];
};

export function PharmacyPatientContextPanel({
  lang,
  patient,
  selectedRx,
  prescriptions,
  sales,
  products,
  basketProductIds,
}: Props) {
  const profile = ensurePharmacyPatientProfile(patient);
  const pinned = pinnedPatientNotes(profile);
  const stats = patientSummary({ patient, prescriptions, sales });
  const timeline = buildPatientTimeline({
    patientId: patient.id,
    prescriptions,
    sales,
    debtPayments: [],
    products,
  }).slice(0, 4);
  const chronic = profile.chronicMedications?.slice(0, 4) ?? [];

  return (
    <div className="shrink-0 space-y-2 border-b border-stone-200 bg-teal-50/50 px-2 py-2 sm:px-3">
      <PharmacyAllergyWarningBanner lang={lang} patient={patient} productIds={basketProductIds} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-black text-stone-950">{patient.name}</p>
          {patient.phone ? <p className="text-xs font-semibold text-stone-600">{patient.phone}</p> : null}
        </div>
        <Link
          to={`/pharmacy/patients/${patient.id}`}
          className="shrink-0 rounded-lg bg-white px-2 py-1 text-[10px] font-black text-teal-800 ring-1 ring-teal-200"
        >
          {t(lang, "pharmacyPatientOpenProfile")}
        </Link>
      </div>
      {pinned.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
          {pinned.map((n) => (
            <p key={n.id}>{n.text}</p>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 text-[10px] font-bold text-stone-700">
        <span className="rounded-full bg-white px-2 py-1 ring-1 ring-stone-200">
          {stats.prescriptionCount} Rx · {stats.otcCount} OTC
        </span>
        {stats.outstandingDebtUgx > 0 ? (
          <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-900">
            {t(lang, "debtBalanceLabel")}: {formatUgx(stats.outstandingDebtUgx)}
          </span>
        ) : null}
        {selectedRx ? (
          <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-900">
            {selectedRx.prescriptionNumber} · {t(lang, "pharmacyRxEditor")}
          </span>
        ) : null}
      </div>
      {chronic.length > 0 ? (
        <div>
          <p className="text-[10px] font-black uppercase text-stone-500">{t(lang, "pharmacyChronicTitle")}</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {chronic.map((m) => (
              <li key={m.id} className="rounded-lg bg-white px-2 py-0.5 text-[10px] font-bold text-stone-800 ring-1 ring-stone-200">
                {m.productName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {timeline.length > 0 ? (
        <ul className="max-h-16 space-y-0.5 overflow-y-auto text-[10px] font-semibold text-stone-600">
          {timeline.map((ev) => (
            <li key={ev.id} className="truncate">
              {ev.title} · {ev.at.slice(0, 10)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
