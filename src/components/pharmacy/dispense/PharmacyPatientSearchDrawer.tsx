import { useMemo, useState } from "react";
import type { Customer, Language, PharmacyPrescription, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { searchPharmacyPatients } from "../../../lib/pharmacyPatientSearch";

type Props = {
  lang: Language;
  open: boolean;
  customers: Customer[];
  prescriptions: PharmacyPrescription[];
  products: Product[];
  onClose: () => void;
  onSelect: (patientId: string) => void;
};

export function PharmacyPatientSearchDrawer({
  lang,
  open,
  customers,
  prescriptions,
  products,
  onClose,
  onSelect,
}: Props) {
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () => searchPharmacyPatients(customers, search, prescriptions, products),
    [customers, search, prescriptions, products],
  );

  if (!open) return null;

  return (
    <AppModalOverlay className="z-[75] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
        <div className="shrink-0 border-b border-border px-4 py-4">
          <h2 className="text-lg font-black text-foreground">{t(lang, "pharmacyDispenseSelectPatient")}</h2>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(lang, "pharmacyPatientSearchPh")}
            className="mt-3 min-h-[48px] w-full rounded-2xl border-2 border-border px-4 text-base font-semibold"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm font-semibold text-muted-foreground">
              {t(lang, "pharmacyPatientEmpty")}
            </p>
          ) : (
            rows.map((patient) => (
              <li key={patient.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(patient.id);
                    onClose();
                  }}
                  className="w-full rounded-2xl border border-border px-4 py-3 text-left touch-manipulation hover:bg-teal-50"
                >
                  <p className="text-sm font-black text-foreground">{patient.name}</p>
                  {patient.phone ? (
                    <p className="text-xs font-semibold text-muted-foreground">{patient.phone}</p>
                  ) : null}
                  {(patient.pharmacyProfile?.allergies?.length ?? 0) > 0 ? (
                    <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900">
                      {t(lang, "pharmacyPatientAllergies")}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] w-full rounded-2xl border-2 border-border font-black text-foreground"
          >
            {t(lang, "cancel")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
