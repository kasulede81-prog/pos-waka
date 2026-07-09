import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Language, PharmacyControlledRegisterEntry } from "../../../types";
import { t } from "../../../lib/i18n";
import { searchControlledRegister } from "../../../lib/pharmacyControlledRegister";
import { PharmacyControlledReturnSheet } from "../../../components/pharmacy/compliance/PharmacyControlledReturnSheet";

type Props = {
  lang: Language;
  register: PharmacyControlledRegisterEntry[];
  embedded?: boolean;
};

function kindLabel(lang: Language, kind: PharmacyControlledRegisterEntry["kind"]): string {
  const key = `pharmacyComplianceKind_${kind}` as const;
  const translated = t(lang, key);
  return translated === key ? kind : translated;
}

/** Controlled register table — reused by Compliance page and Investigation Center tab. */
export function PharmacyComplianceRegisterPanel({ lang, register, embedded = false }: Props) {
  const [query, setQuery] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const rows = useMemo(() => searchControlledRegister(register, query), [register, query]);

  return (
    <div className={embedded ? "space-y-3" : "space-y-4"}>
      {!embedded ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-stone-950">{t(lang, "pharmacyComplianceRegisterTitle")}</h1>
            <p className="mt-1 text-base font-medium text-stone-500">{t(lang, "pharmacyComplianceRegisterSub")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/pharmacy/compliance/reports"
              className="min-h-[48px] rounded-2xl border-2 px-4 text-sm font-black touch-manipulation"
            >
              {t(lang, "pharmacyComplianceReportsLink")}
            </Link>
            <button
              type="button"
              onClick={() => setReturnOpen(true)}
              className="min-h-[48px] rounded-2xl bg-violet-700 px-4 text-sm font-black text-white touch-manipulation"
            >
              {t(lang, "pharmacyComplianceReturnTitle")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-stone-600">{t(lang, "icPharmacyComplianceTabHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/pharmacy/compliance/reports"
              className="min-h-[40px] rounded-xl border border-stone-200 px-3 text-xs font-black touch-manipulation"
            >
              {t(lang, "pharmacyComplianceReportsLink")}
            </Link>
            <button
              type="button"
              onClick={() => setReturnOpen(true)}
              className="min-h-[40px] rounded-xl bg-violet-700 px-3 text-xs font-black text-white touch-manipulation"
            >
              {t(lang, "pharmacyComplianceReturnTitle")}
            </button>
          </div>
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t(lang, "pharmacyComplianceRegisterSearchPh")}
        className="min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 text-base font-semibold"
      />

      <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-waka-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-stone-100 bg-stone-50 text-xs font-black uppercase text-stone-500">
              <tr>
                <th className="px-4 py-3">{t(lang, "pharmacyComplianceColWhen")}</th>
                <th className="px-4 py-3">{t(lang, "pharmacyComplianceColKind")}</th>
                <th className="px-4 py-3">{t(lang, "pharmacyTerm_medicines")}</th>
                <th className="px-4 py-3">{t(lang, "pharmacyComplianceQty")}</th>
                <th className="px-4 py-3">{t(lang, "pharmacyComplianceColPatient")}</th>
                <th className="px-4 py-3">{t(lang, "pharmacyComplianceColPharmacist")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center font-semibold text-stone-500">
                    {t(lang, "pharmacyComplianceRegisterEmpty")}
                  </td>
                </tr>
              ) : (
                rows.slice(0, 200).map((row) => (
                  <tr key={row.id} className="border-b border-stone-50">
                    <td className="px-4 py-3 font-semibold text-stone-700">
                      <span className="block">{row.businessDate}</span>
                      <span className="text-xs text-stone-400">{new Date(row.at).toLocaleTimeString()}</span>
                    </td>
                    <td className="px-4 py-3 font-black text-violet-800">{kindLabel(lang, row.kind)}</td>
                    <td className="px-4 py-3 font-bold text-stone-900">{row.productName}</td>
                    <td className="px-4 py-3 font-black">{row.quantity}</td>
                    <td className="px-4 py-3 font-semibold">{row.patientName ?? "—"}</td>
                    <td className="px-4 py-3 font-semibold">{row.pharmacistName ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PharmacyControlledReturnSheet lang={lang} open={returnOpen} onClose={() => setReturnOpen(false)} />
    </div>
  );
}
