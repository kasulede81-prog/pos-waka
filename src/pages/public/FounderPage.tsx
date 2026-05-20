import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { MarketingLayout } from "../../components/marketing/MarketingLayout";
import { SeoHead } from "../../components/marketing/SeoHead";
import { FounderAvatar } from "../../components/marketing/FounderSection";
import {
  FOUNDER_BASE,
  FOUNDER_BIO_PARAGRAPHS,
  FOUNDER_JOURNEY_SUMMARY,
  FOUNDER_NAME,
  FOUNDER_QUOTE_SECOND,
  FOUNDER_ROLE,
  FOUNDER_VISION,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_MAIN_PRODUCT,
  WAKA_PRODUCT_DESCRIPTION,
} from "../../config/company";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

export function FounderPage({ lang, setLang, isAuthenticated }: Props) {
  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead
        title={`${FOUNDER_NAME} — Ugandan software founder of Waka POS`}
        description={`${FOUNDER_NAME} is a Ugandan technology entrepreneur and founder of Waka Marketplace Limited. ${FOUNDER_JOURNEY_SUMMARY}`}
        path="/founder"
        type="profile"
        structuredData="founder"
      />

      <article className="space-y-10">
        <header className="flex flex-col items-center text-center">
          <FounderAvatar large className="mx-auto" />
          <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-orange-700">Founder profile</p>
          <h1 className="mt-2 text-4xl font-black text-stone-950">{FOUNDER_NAME}</h1>
          <p className="mt-2 text-lg font-bold text-orange-800">
            {FOUNDER_ROLE}, {WAKA_LEGAL_COMPANY_NAME}
          </p>
          <p className="mt-1 text-sm font-semibold text-stone-500">{FOUNDER_BASE}</p>
        </header>

        <section className="rounded-3xl border border-stone-100 bg-white p-6 shadow-waka-sm sm:p-8">
          <h2 className="text-lg font-black text-stone-950">Biography</h2>
          <div className="mt-4 space-y-4">
            {FOUNDER_BIO_PARAGRAPHS.map((para) => (
              <p key={para.slice(0, 56)} className="text-sm font-medium leading-relaxed text-stone-700">
                {para}
              </p>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-orange-100 bg-orange-50 p-6 sm:p-8">
          <h2 className="text-lg font-black text-stone-950">Vision</h2>
          <p className="mt-4 text-base font-medium leading-relaxed text-stone-800">{FOUNDER_VISION}</p>
          <p className="mt-4 text-sm font-medium leading-relaxed text-stone-700">{FOUNDER_QUOTE_SECOND}</p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
            <h3 className="font-black text-stone-950">What we are building</h3>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm font-medium text-stone-700">
              <li>{WAKA_MAIN_PRODUCT} for sales, stock, receipts, and reports</li>
              <li>Offline-friendly tools for busy trading days</li>
              <li>Affordable plans for growing Ugandan businesses</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
            <h3 className="font-black text-stone-950">Company</h3>
            <p className="mt-2 text-sm font-medium text-stone-700">
              {WAKA_LEGAL_COMPANY_NAME} is a Ugandan registered technology company serving shops, pharmacies, salons,
              supermarkets, restaurants, and market vendors with software built for local business life.
            </p>
          </div>
        </section>

        <p className="text-center text-xs font-medium text-stone-500">
          {WAKA_PRODUCT_DESCRIPTION}{" "}
          <Link to="/about" className="font-bold text-orange-800 underline">
            About Waka POS
          </Link>
        </p>
      </article>
    </MarketingLayout>
  );
}
