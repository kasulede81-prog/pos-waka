import type { Language } from "../types";
import { isPharmacyMode } from "../lib/pharmacy";
import { usePosStore } from "../store/usePosStore";
import { PharmacyComplianceRegisterPanel } from "../components/pharmacy/compliance/PharmacyComplianceRegisterPanel";

export function PharmacyComplianceRegisterPage({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const register = usePosStore((s) => s.pharmacyControlledRegister);
  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);

  if (!pharmacy) return null;

  return (
    <div className="page-content-pad">
      <PharmacyComplianceRegisterPanel lang={lang} register={register} />
    </div>
  );
}
