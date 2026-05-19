import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { WAKA_COMPANY_TAGLINE, WAKA_LEGAL_COMPANY_NAME, WAKA_MAIN_PRODUCT } from "../../config/company";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
  children: ReactNode;
};

const FOOTER_LINKS = [
  { to: "/about", label: "About" },
  { to: "/founder", label: "Founder" },
  { to: "/contact", label: "Contact" },
  { to: "/support", label: "Support" },
  { to: "/company", label: "Company" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/refund-policy", label: "Refunds" },
] as const;

export function MarketingLayout({ lang, setLang, isAuthenticated, children }: Props) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-white via-orange-50/30 to-stone-50">
      <header className="sticky top-0 z-40 border-b border-orange-100/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/home" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-700 text-lg font-black text-white shadow-md">
              W
            </div>
            <div>
              <p className="text-base font-black text-orange-700">{t(lang, "appName")}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{WAKA_MAIN_PRODUCT}</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 text-sm font-bold text-stone-700 sm:flex">
            <Link to="/about" className="rounded-full px-3 py-2 hover:bg-orange-50 hover:text-orange-800">
              About
            </Link>
            <Link to="/contact" className="rounded-full px-3 py-2 hover:bg-orange-50 hover:text-orange-800">
              Contact
            </Link>
            <Link to="/support" className="rounded-full px-3 py-2 hover:bg-orange-50 hover:text-orange-800">
              Support
            </Link>
          </nav>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-stone-200 bg-stone-50 p-1 text-xs font-black">
              <button
                type="button"
                onClick={() => setLang("en")}
                className={clsx("rounded-full px-3 py-1", lang === "en" ? "bg-white text-orange-700 shadow-sm" : "text-stone-600")}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang("lg")}
                className={clsx("rounded-full px-3 py-1", lang === "lg" ? "bg-white text-orange-700 shadow-sm" : "text-stone-600")}
              >
                LG
              </button>
            </div>
            {!isAuthenticated ? (
              <>
                <Link to="/login" className="rounded-full px-3 py-2 text-sm font-bold text-stone-700 hover:bg-stone-100">
                  {t(lang, "marketingCtaLogin")}
                </Link>
                <Link
                  to="/register"
                  className="rounded-full bg-orange-600 px-4 py-2 text-sm font-black text-white shadow-md hover:bg-orange-700"
                >
                  {t(lang, "marketingCtaSignup")}
                </Link>
              </>
            ) : (
              <Link to="/" className="rounded-full bg-stone-900 px-4 py-2 text-sm font-black text-white">
                {t(lang, "activationContinueApp")}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>

      <footer className="border-t border-stone-200 bg-stone-950 px-4 py-10 text-stone-300">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-lg font-black text-white">{WAKA_MAIN_PRODUCT}</p>
              <p className="mt-1 text-sm font-medium text-stone-400">{WAKA_COMPANY_TAGLINE}</p>
              <p className="mt-2 text-xs text-stone-500">Powered by {WAKA_LEGAL_COMPANY_NAME}</p>
            </div>
            <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-bold text-orange-300">
              {FOOTER_LINKS.map((link) => (
                <Link key={link.to} to={link.to} className="hover:text-white">
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <p className="text-center text-xs text-stone-500">
            © {new Date().getFullYear()} {WAKA_LEGAL_COMPANY_NAME}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

