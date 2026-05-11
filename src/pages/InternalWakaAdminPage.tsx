import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { isWakaInternalAdminEmail } from "../lib/internalAdminAllowlist";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

const CARD_KEYS = [
  { title: "internalAdminShopsCard", hint: "internalAdminShopsHint" },
  { title: "internalAdminSubsCard", hint: "internalAdminSubsHint" },
  { title: "internalAdminSupportCard", hint: "internalAdminSupportHint" },
  { title: "internalAdminMapCard", hint: "internalAdminMapHint" },
  { title: "internalAdminInsightsCard", hint: "internalAdminInsightsHint" },
] as const;

export function InternalWakaAdminPage({ lang, email }: Props) {
  if (!isWakaInternalAdminEmail(email)) {
    return (
      <div className="space-y-4 pb-10">
        <p className="rounded-3xl border-2 border-amber-200 bg-amber-50 px-5 py-6 text-center text-base font-bold text-amber-950">
          {t(lang, "internalAdminDenied")}
        </p>
        <Link to="/" className="inline-flex min-h-[48px] items-center font-bold text-waka-800 underline">
          ← {t(lang, "internalAdminBack")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-3xl font-black text-stone-900">{t(lang, "internalAdminTitle")}</h1>
        <p className="mt-2 text-base font-medium text-stone-600">{t(lang, "internalAdminSub")}</p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {CARD_KEYS.map((c) => (
          <li
            key={c.title}
            className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm"
          >
            <p className="text-lg font-black text-stone-900">{t(lang, c.title)}</p>
            <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, c.hint)}</p>
          </li>
        ))}
      </ul>

      <Link to="/" className="inline-flex min-h-[48px] items-center font-bold text-waka-800 underline">
        ← {t(lang, "internalAdminBack")}
      </Link>
    </div>
  );
}
