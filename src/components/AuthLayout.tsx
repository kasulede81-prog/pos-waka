import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { WakaMarkIcon } from "./brand/WakaLogo";
import { WAKA_COMPANY_TAGLINE, WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  children: ReactNode;
  /** Logo link target (default sign-in). */
  brandHref?: string;
};

export function AuthLayout({ lang, setLang, children, brandHref = "/login" }: Props) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-waka-50 via-stone-50 to-stone-100">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
        <header className="flex items-center justify-between gap-3">
          <Link to={brandHref} className="flex min-w-0 items-center gap-2.5 rounded-2xl py-1">
            <WakaMarkIcon className="h-10 w-10 shrink-0 text-waka-600 shadow-waka-sm" />
            <span className="min-w-0">
              <span className="block truncate text-lg font-black text-stone-900">{t(lang, "appName")}</span>
              <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                {t(lang, "brandTagline")}
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setLang(lang === "en" ? "lg" : "en")}
            className="shrink-0 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-800 shadow-sm active:bg-stone-50"
          >
            {lang === "en" ? "Luganda" : "English"}
          </button>
        </header>
        {children}
        <footer className="pb-4 text-center text-[11px] font-semibold text-stone-500">
          <p>© 2026 {WAKA_LEGAL_COMPANY_NAME}</p>
          <p>{WAKA_COMPANY_TAGLINE}</p>
          <nav className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-orange-800">
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/refund-policy">Refund Policy</Link>
            <Link to="/support">Contact Support</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
