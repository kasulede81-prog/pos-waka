import { Link, useLocation } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PHARMACY_HOME_ROUTE } from "../lib/pharmacyNav";

export function PharmacyAccessDeniedPage({ lang }: { lang: Language }) {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  return (
    <div className="page-content-pad flex min-h-[50vh] flex-col items-center justify-center text-center">
      <h1 className="text-3xl font-black text-stone-950">{t(lang, "pharmacyAccessDeniedTitle")}</h1>
      <p className="mt-2 max-w-md text-base font-semibold text-stone-600">{t(lang, "pharmacyAccessDeniedSub")}</p>
      {from ? (
        <p className="mt-1 text-sm font-medium text-stone-400">
          {from}
        </p>
      ) : null}
      <Link
        to={PHARMACY_HOME_ROUTE}
        className="mt-6 min-h-[52px] rounded-2xl bg-waka-600 px-6 py-3 text-base font-black text-white touch-manipulation"
      >
        {t(lang, "pharmacyNav_dashboard")}
      </Link>
    </div>
  );
}
