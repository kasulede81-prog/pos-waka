import { Link } from "react-router-dom";
import { Sun } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
};

/** Prominent call-to-action when formula v2 day drawer is not open yet. */
export function DayDrawerOpenAlert({ lang }: Props) {
  return (
    <Link
      to="/office/day-open"
      className="flex min-h-[72px] items-center gap-3 rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-white px-4 py-3 shadow-sm transition active:scale-[0.99] motion-reduce:active:scale-100"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
        <Sun className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-black leading-snug text-amber-950">{t(lang, "dayOpenHubAlertTitle")}</span>
        <span className="mt-0.5 block text-xs font-semibold text-amber-900/80">{t(lang, "dayOpenHubAlertSub")}</span>
      </span>
      <span className="shrink-0 rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white">
        {t(lang, "dayOpenGoBtn")}
      </span>
    </Link>
  );
}
