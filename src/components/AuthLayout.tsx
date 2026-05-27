import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { languageToggleLabel, nextLanguage } from "../lib/language";
import { WakaPosLogo } from "./brand/WakaLogo";
import { WAKA_BRAND_NAME, WAKA_LEGAL_COMPANY_NAME, WAKA_SLOGAN } from "../config/wakaSupport";

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
          <Link to={brandHref} className="block min-w-0 rounded-2xl py-1">
            <WakaPosLogo size="md" className="max-w-[min(100%,280px)]" />
          </Link>
          <button
            type="button"
            onClick={() => setLang(nextLanguage(lang))}
            className="shrink-0 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-800 shadow-sm active:bg-stone-50"
          >
            {languageToggleLabel(lang)}
          </button>
        </header>
        {children}
        <footer className="pb-4 text-center text-[11px] font-semibold text-stone-500">
          <p className="font-black text-stone-700">{WAKA_BRAND_NAME}</p>
          <p>{WAKA_SLOGAN}</p>
          <p className="mt-1 text-[10px] text-stone-400">© {new Date().getFullYear()} {WAKA_LEGAL_COMPANY_NAME}</p>
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
