import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import clsx from "clsx";
import { WAKA_COMPANY_TAGLINE, WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

export function MarketingHomePage({ lang, setLang, isAuthenticated }: Props) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-white via-orange-50/40 to-stone-50 pb-16">
      <header className="border-b border-orange-100/80 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-700 text-xl font-black text-white shadow-md">
              W
            </div>
            <div>
              <p className="text-lg font-black text-orange-700">{t(lang, "appName")}</p>
              <p className="text-xs font-bold uppercase tracking-wider text-stone-500">{t(lang, "brandShortTag")}</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            <div className="mr-2 flex rounded-full border border-stone-200 bg-stone-50 p-1 text-xs font-black">
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
                <Link to="/login" className="rounded-full px-4 py-2 text-sm font-bold text-stone-700 hover:bg-stone-100">
                  {t(lang, "marketingCtaLogin")}
                </Link>
                <Link
                  to="/register"
                  className="rounded-full bg-orange-600 px-5 py-2 text-sm font-black text-white shadow-md hover:bg-orange-700"
                >
                  {t(lang, "marketingCtaSignup")}
                </Link>
              </>
            ) : (
              <Link to="/" className="rounded-full bg-stone-900 px-5 py-2 text-sm font-black text-white">
                {t(lang, "activationContinueApp")}
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-16 px-4 py-14">
        <section className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div className="space-y-6">
            <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-700">{t(lang, "brandTagline")}</p>
            <h1 className="text-4xl font-black leading-tight text-stone-950 sm:text-5xl">{t(lang, "marketingHomeTitle")}</h1>
            <p className="text-lg font-medium leading-relaxed text-stone-600">{t(lang, "marketingHomeSub")}</p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/demo"
                className="inline-flex min-h-[52px] items-center justify-center rounded-2xl bg-orange-600 px-8 py-3 text-lg font-black text-white shadow-lg hover:bg-orange-700"
              >
                {t(lang, "marketingCtaDemo")}
              </Link>
              {!isAuthenticated ? (
                <Link
                  to="/register"
                  className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border-2 border-stone-200 bg-white px-8 py-3 text-lg font-black text-stone-900 hover:border-orange-200"
                >
                  {t(lang, "marketingCtaSignup")}
                </Link>
              ) : null}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="aspect-[4/5] rounded-3xl border-2 border-orange-100 bg-gradient-to-br from-orange-100 to-white p-6 shadow-inner">
              <p className="text-sm font-black text-orange-950">{t(lang, "marketingScreensHeading")}</p>
              <div className="mt-6 space-y-3 rounded-2xl bg-white p-4 shadow-md">
                <div className="h-24 rounded-xl bg-stone-200/70" />
                <div className="h-4 w-2/3 rounded bg-stone-200" />
                <div className="h-4 w-full rounded bg-stone-100" />
              </div>
            </div>
            <div className="flex aspect-[4/5] flex-col justify-between rounded-3xl border-2 border-stone-100 bg-white p-6 shadow-waka-sm sm:translate-y-6">
              <p className="text-sm font-bold text-stone-500">{t(lang, "marketingPricingHeading")}</p>
              <div>
                <p className="text-4xl font-black text-orange-700">Custom</p>
                <p className="mt-2 text-sm font-semibold text-stone-600">Speak with sales after you submit activation.</p>
              </div>
              <Link to="/support" className="text-center text-sm font-black text-orange-700 underline-offset-4 hover:underline">
                {t(lang, "activationContactSupport")}
              </Link>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-black text-stone-950">{t(lang, "marketingFeaturesHeading")}</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              "Inventory & stock-taking",
              "Fast checkout & receipts",
              "Customers & debts",
              "Reports & daily close",
              "Staff roles & PIN",
              "Branches (activated)",
            ].map((item) => (
              <li
                key={item}
                className="rounded-2xl border border-stone-100 bg-white p-5 text-sm font-bold text-stone-800 shadow-sm"
              >
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-orange-500 align-middle" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <footer className="space-y-3 border-t border-stone-200 pt-8 text-center text-xs font-semibold text-stone-500">
          <p>© 2026 {WAKA_LEGAL_COMPANY_NAME}</p>
          <p>{WAKA_COMPANY_TAGLINE}</p>
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-orange-800">
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/refund-policy">Refund Policy</Link>
            <Link to="/support">Contact Support</Link>
          </nav>
          <p>{t(lang, "marketingFooterNote")}</p>
        </footer>
      </main>
    </div>
  );
}
