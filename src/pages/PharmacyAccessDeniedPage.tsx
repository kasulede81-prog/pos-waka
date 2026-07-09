import { Link, useLocation } from "react-router-dom";
import type { Language } from "../types";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { t } from "../lib/i18n";

export function PharmacyAccessDeniedPage({ lang }: { lang: Language }) {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  return (
    <EnterprisePageContainer className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <h1 className="text-3xl font-black text-stone-950">{t(lang, "pharmacyAccessDeniedTitle")}</h1>
      <p className="mt-2 max-w-md text-base font-semibold text-stone-600">{t(lang, "pharmacyAccessDeniedSub")}</p>
      {from ? (
        <p className="mt-1 text-sm font-medium text-stone-400">
          {from}
        </p>
      ) : null}
      <Link
        to="/"
        className="mt-6 min-h-[52px] rounded-2xl bg-waka-600 px-6 py-3 text-base font-black text-white touch-manipulation"
      >
        {t(lang, "posNavMainMenu")}
      </Link>
    </EnterprisePageContainer>
  );
}
