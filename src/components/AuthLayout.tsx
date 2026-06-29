import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { languageToggleLabel, nextLanguage } from "../lib/language";
import { WakaPosLogo } from "./brand/WakaLogo";
import { WAKA_BRAND_NAME, WAKA_LEGAL_COMPANY_NAME, WAKA_SLOGAN } from "../config/wakaSupport";
import { AppThemeToggle } from "./ui/AppThemeToggle";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  children: ReactNode;
  /** Logo link target (default sign-in). */
  brandHref?: string;
};

export function AuthLayout({ lang, setLang, children, brandHref = "/login" }: Props) {
  return (
    <div className="auth-scroll-root flex h-dvh max-h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-waka-50 via-stone-50 to-stone-100 transition-colors duration-300">
      <div className="auth-scroll-pane min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="mx-auto w-full max-w-md px-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] pt-[max(1rem,env(safe-area-inset-top,0px))] sm:py-8">
          <header className="flex items-center justify-between gap-3">
            <Link to={brandHref} className="block min-w-0 rounded-2xl py-1">
              <WakaPosLogo size="md" className="max-w-[min(100%,280px)]" />
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <AppThemeToggle lang={lang} />
              <button
                type="button"
                onClick={() => setLang(nextLanguage(lang))}
                className="min-h-[44px] shrink-0 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-800 shadow-sm active:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:active:bg-stone-800"
              >
                {languageToggleLabel(lang)}
              </button>
            </div>
          </header>
          <main className="py-4">{children}</main>
          <footer className="pb-2 text-center text-xs font-semibold text-stone-500 dark:text-stone-400">
            <p className="font-black text-stone-700 dark:text-stone-200">{WAKA_BRAND_NAME}</p>
            <p>{WAKA_SLOGAN}</p>
            <p className="mt-1 text-[10px] text-stone-400 dark:text-stone-500">© {new Date().getFullYear()} {WAKA_LEGAL_COMPANY_NAME}</p>
            <nav className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-orange-800 dark:text-orange-400">
              <Link to="/terms">Terms</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/acceptable-use">Acceptable use</Link>
              <Link to="/support">Support</Link>
            </nav>
          </footer>
        </div>
      </div>
    </div>
  );
}
