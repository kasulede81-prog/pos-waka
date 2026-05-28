import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { MarketingLayout } from "../components/marketing/MarketingLayout";
import { SeoHead } from "../components/marketing/SeoHead";
import { FounderSection } from "../components/marketing/FounderSection";
import { FOUNDER_HOME_LINE, WAKA_PRODUCT_DESCRIPTION } from "../config/company";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

const FEATURES = [
  "Sales, receipts & fast checkout",
  "Stock tracking & shelves",
  "Customers & debts",
  "Reports & daily close",
  "Offline mode & cloud backup",
  "Staff accounts & branches",
];

export function MarketingHomePage({ lang, setLang, isAuthenticated }: Props) {
  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead
        title="Waka POS | Simple POS for Shops in Uganda"
        description={WAKA_PRODUCT_DESCRIPTION}
        path="/home"
        structuredData="home"
      />

      <div className="space-y-16">
        <section className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div className="space-y-6">
            <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-700">{t(lang, "brandTagline")}</p>
            <h1 className="text-4xl font-black leading-tight text-stone-950 sm:text-5xl">{t(lang, "marketingHomeTitle")}</h1>
            <p className="text-lg font-medium leading-relaxed text-stone-600">{t(lang, "marketingHomeSub")}</p>
            <p className="text-sm font-medium text-stone-500">{FOUNDER_HOME_LINE}</p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/demo"
                className="inline-flex min-h-[52px] items-center justify-center rounded-2xl bg-orange-600 px-8 py-3 text-lg font-black text-white shadow-lg hover:bg-orange-700"
              >
                {t(lang, "marketingCtaDemo")}
              </Link>
              {!isAuthenticated ? (
                <>
                  <Link
                    to="/login"
                    className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border-2 border-stone-200 bg-white px-8 py-3 text-lg font-black text-stone-900 hover:border-orange-200"
                  >
                    {t(lang, "marketingCtaLogin")}
                  </Link>
                  <Link
                    to="/register"
                    className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border-2 border-orange-200 bg-orange-50 px-8 py-3 text-lg font-black text-orange-900 hover:bg-orange-100"
                  >
                    {t(lang, "marketingCtaSignup")}
                  </Link>
                </>
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
                <p className="text-4xl font-black text-orange-700">Free to start</p>
                <p className="mt-2 text-sm font-semibold text-stone-600">Upgrade when your business needs more.</p>
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
            {FEATURES.map((item) => (
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

        <FounderSection compact />

        <section className="rounded-3xl border border-orange-100 bg-white p-6 text-center shadow-waka-sm">
          <h2 className="text-xl font-black text-stone-950">Built for real shops and businesses</h2>
          <p className="mt-2 text-sm font-medium text-stone-600">
            Waka Technologies brings simple tools, local support, and software that still works when the network is slow.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link to="/about" className="text-sm font-black text-orange-800 underline">
              About us
            </Link>
            <Link to="/contact" className="text-sm font-black text-orange-800 underline">
              Contact
            </Link>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
