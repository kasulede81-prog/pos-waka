import type { Language } from "../types";
import { t } from "../lib/i18n";
import { BUSINESS_TYPE_IDS } from "../config/businessTypes";
import { usePosStore } from "../store/usePosStore";

export function BusinessTypeOnboarding({ lang }: { lang: Language }) {
  const complete = usePosStore((s) => s.completeBusinessOnboarding);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
        <p className="text-center text-2xl font-black leading-tight text-slate-900">{t(lang, "onboardTitle")}</p>
        <p className="mt-2 text-center text-base text-slate-600">{t(lang, "onboardSubtitle")}</p>
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BUSINESS_TYPE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => complete(id)}
              className="rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 py-4 text-left text-base font-bold text-slate-900 active:border-waka-500 active:bg-waka-50"
            >
              {t(lang, `businessType_${id}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
