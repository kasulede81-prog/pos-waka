import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { WAKA_BRAND_NAME, WAKA_LEGAL_COMPANY_NAME, WAKA_SLOGAN } from "../../config/company";
import { SOLUTION_NAV_LINKS } from "../../config/solutionPages";
import { WakaBrandWordmark } from "../brand/WakaLogo";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
  children: ReactNode;
};

const FOOTER_LINKS = [
  { to: "/pricing", label: "Pricing" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/contact", label: "Contact" },
] as const;

const NAV_LINKS = [
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
  { to: "/support", label: "Support" },
] as const;

export function MarketingLayout({ lang, setLang, isAuthenticated, children }: Props) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-white via-orange-50/30 to-stone-50">
      <header className="sticky top-0 z-40 border-b border-orange-100/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/home" className="min-w-0 shrink">
            <WakaBrandWordmark />
          </Link>

          <nav className="hidden items-center gap-1 text-sm font-bold text-stone-700 sm:flex">
            {NAV_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="rounded-full px-3 py-2 hover:bg-orange-50 hover:text-orange-800">
                {link.label}
              </Link>
            ))}
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
              <button
                type="button"
                onClick={() => setLang("sw")}
                className={clsx("rounded-full px-3 py-1", lang === "sw" ? "bg-white text-orange-700 shadow-sm" : "text-stone-600")}
              >
                SW
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
        <div className="mx-auto max-w-5xl space-y-4 text-center sm:text-left">
          <div className="sm:flex sm:items-start sm:justify-between sm:text-left">
            <div>
              <p className="text-lg font-black text-white">{WAKA_BRAND_NAME}</p>
              <p className="mt-1 text-sm font-semibold text-orange-300">{WAKA_SLOGAN}</p>
              <p className="mt-3 text-xs text-stone-500">
                {t(lang, "appName")} · {t(lang, "marketingFooterLegalNote")}
              </p>
            </div>
            <div className="mt-4 space-y-3 sm:mt-0">
              <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-bold text-orange-300 sm:justify-end">
                {SOLUTION_NAV_LINKS.map((link) => (
                  <Link key={link.path} to={link.path} className="hover:text-white">
                    {link.label}
                  </Link>
                ))}
              </nav>
              <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-bold text-orange-300 sm:justify-end">
                {FOOTER_LINKS.map((link) => (
                  <Link key={link.to} to={link.to} className="hover:text-white">
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
          <p className="text-center text-xs text-stone-600 sm:text-left">
            © {new Date().getFullYear()} {WAKA_LEGAL_COMPANY_NAME}
          </p>
        </div>
      </footer>
    </div>
  );
}
