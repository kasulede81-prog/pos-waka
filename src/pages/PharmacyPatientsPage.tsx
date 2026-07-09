import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus, Users } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isPharmacyMode } from "../lib/pharmacy";
import { searchPharmacyPatients } from "../lib/pharmacyPatientSearch";
import { generatePatientCode } from "../lib/pharmacyPatientProfile";
import { computePatientAge, patientDisplayId, ensurePharmacyPatientProfile } from "../lib/pharmacyPatientProfile";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterpriseListToolbar } from "../components/enterprise/EnterpriseListToolbar";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";

export function PharmacyPatientsPage({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const customers = usePosStore((s) => s.customers);
  const prescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const products = usePosStore((s) => s.products);
  const addCustomer = usePosStore((s) => s.addCustomer);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const rows = useMemo(
    () => searchPharmacyPatients(customers, search, prescriptions, products),
    [customers, search, prescriptions, products],
  );

  if (!pharmacy) return null;

  const addPatient = () => {
    const n = name.trim();
    if (!n) return;
    const row = addCustomer({
      name: n,
      phone: phone.trim(),
      location: "",
      pharmacyProfile: {
        patientCode: generatePatientCode(),
        allergies: [],
        notes: [],
        documents: [],
        chronicMedications: [],
      },
    });
    setName("");
    setPhone("");
    setShowAdd(false);
    if (row.id !== "denied") window.location.assign(`/pharmacy/patients/${row.id}`);
  };

  return (
    <EnterprisePageContainer className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-stone-950">{t(lang, "pharmacyTerm_patients")}</h1>
          <p className="mt-1 text-base font-medium text-stone-500">{t(lang, "pharmacyPatientListSub")}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex min-h-[52px] items-center gap-2 rounded-2xl bg-teal-600 px-5 text-sm font-black text-white touch-manipulation"
        >
          <UserPlus className="h-5 w-5" aria-hidden />
          {t(lang, "pharmacyPatientAdd")}
        </button>
      </div>

      <EnterpriseListToolbar
        lang={lang}
        sticky={false}
        searchQuery={search}
        searchPlaceholder={t(lang, "pharmacyPatientSearchPh")}
        onSearchChange={setSearch}
      />

      {showAdd ? (
        <div className="rounded-3xl border border-teal-200 bg-teal-50 p-4">
          <p className="text-sm font-black text-teal-950">{t(lang, "pharmacyPatientAdd")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(lang, "pharmacyPatientNamePh")}
              className="min-h-[48px] rounded-xl border-2 border-teal-200 px-3 font-semibold"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t(lang, "pharmacyPatientPhonePh")}
              className="min-h-[48px] rounded-xl border-2 border-teal-200 px-3 font-semibold"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="min-h-[48px] rounded-xl border-2 px-4 font-bold">
              {t(lang, "cancel")}
            </button>
            <button type="button" onClick={addPatient} className="min-h-[48px] rounded-xl bg-teal-600 px-4 font-black text-white">
              {t(lang, "confirm")}
            </button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EnterpriseEmptyState
          icon={Users}
          title={search.trim() ? t(lang, "enterpriseEmptySearchTitle") : t(lang, "pharmacyPatientEmpty")}
          description={search.trim() ? t(lang, "enterpriseEmptySearchDescription") : undefined}
          primaryAction={
            !search.trim() ? { label: t(lang, "pharmacyPatientAdd"), onClick: () => setShowAdd(true) } : undefined
          }
        />
      ) : (
        <ul className="grid min-h-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => {
            const profile = ensurePharmacyPatientProfile(c);
            const age = computePatientAge(profile.dateOfBirth);
            return (
              <li key={c.id}>
                <Link
                  to={`/pharmacy/patients/${c.id}`}
                  className="flex min-h-[120px] flex-col justify-between rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm transition-waka hover:border-teal-300 touch-manipulation"
                >
                  <div>
                    <p className="text-lg font-black text-stone-950">{c.name}</p>
                    <p className="text-xs font-bold text-stone-500">
                      {patientDisplayId(c)}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
                    {age != null ? (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">{age} yrs</span>
                    ) : null}
                    {(c.rxCount ?? 0) > 0 ? (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-900">{c.rxCount} Rx</span>
                    ) : null}
                    {(profile.allergies ?? []).length > 0 ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-900">
                        {t(lang, "pharmacyPatientAllergies")}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </EnterprisePageContainer>
  );
}
