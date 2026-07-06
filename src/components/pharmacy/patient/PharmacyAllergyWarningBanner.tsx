import type { Customer, Language, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import { checkAllergyWarnings, type PharmacyAllergyWarning } from "../../../lib/pharmacyAllergyWarnings";

type Props = {
  lang: Language;
  patient: Customer | null;
  productIds: string[];
  /** When true, show banner only if patient has allergies recorded (no products). */
  previewMode?: boolean;
};

export function PharmacyAllergyWarningBanner({ lang, patient, productIds, previewMode }: Props) {
  const products = usePosStore((s) => s.products);
  const selected: Product[] = productIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));

  if (!patient) return null;
  const warnings = checkAllergyWarnings(patient, selected);
  if (warnings.length === 0) {
    if (!previewMode) return null;
    const allergies = patient.pharmacyProfile?.allergies ?? [];
    if (allergies.length === 0 && !patient.pharmacyProfile?.allergiesText) return null;
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs font-black uppercase text-amber-900">{t(lang, "pharmacyPatientAllergies")}</p>
        <p className="text-sm font-bold text-amber-950">
          {(patient.pharmacyProfile?.allergies ?? []).join(", ") || patient.pharmacyProfile?.allergiesText}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-rose-400 bg-rose-50 px-4 py-3">
      <p className="text-sm font-black uppercase text-rose-900">{t(lang, "pharmacyAllergyWarningTitle")}</p>
      <ul className="mt-2 space-y-1">
        {warnings.map((w: PharmacyAllergyWarning) => (
          <li key={`${w.productId}-${w.allergyToken}`} className="text-base font-black text-rose-950">
            {w.productName} — {t(lang, "pharmacyAllergyMatch")}: {w.allergyToken}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs font-semibold text-rose-800">{t(lang, "pharmacyAllergyWarningSub")}</p>
    </div>
  );
}
