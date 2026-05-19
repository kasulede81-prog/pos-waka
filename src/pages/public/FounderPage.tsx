import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { MarketingLayout } from "../../components/marketing/MarketingLayout";
import { SeoHead } from "../../components/marketing/SeoHead";
import { FounderAvatar } from "../../components/marketing/FounderSection";
import { FounderJourney } from "../../components/marketing/FounderJourney";
import {
  FOUNDER_BASE,
  FOUNDER_BIO_LONG,
  FOUNDER_JOURNEY_SUMMARY,
  FOUNDER_NAME,
  FOUNDER_QUOTE,
  FOUNDER_QUOTE_SECOND,
  FOUNDER_ROLE,
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
        description={`${FOUNDER_NAME} is a Ugandan technology entrepreneur and African startup founder behind ${WAKA_MAIN_PRODUCT}. ${FOUNDER_JOURNEY_SUMMARY}`}
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
          <p className="mt-4 max-w-xl text-sm font-medium leading-relaxed text-stone-600">
            Founder of {WAKA_MAIN_PRODUCT} — building simple business technology for Uganda and Africa, from experience
            on the ground and a long-term commitment to local SMEs.
          </p>
        </header>

        <FounderJourney />

        <section className="rounded-3xl border border-stone-100 bg-white p-6 shadow-waka-sm sm:p-8">
          <h2 className="text-lg font-black text-stone-950">Full biography</h2>
          {FOUNDER_BIO_LONG.split("\n\n").map((para) => (
            <p key={para.slice(0, 48)} className="mt-4 text-sm font-medium leading-relaxed text-stone-700">
              {para}
            </p>
          ))}
        </section>

        <section className="rounded-3xl border border-orange-100 bg-orange-50 p-6 sm:p-8">
          <h2 className="text-lg font-black text-stone-950">Message from the founder</h2>
          <p className="mt-4 text-base font-semibold leading-relaxed text-stone-800">&ldquo;{FOUNDER_QUOTE}&rdquo;</p>
          <p className="mt-3 text-sm font-medium leading-relaxed text-stone-700">&ldquo;{FOUNDER_QUOTE_SECOND}&rdquo;</p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
            <h3 className="font-black text-stone-950">What we are building</h3>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm font-medium text-stone-700">
              <li>{WAKA_MAIN_PRODUCT} — sales, stock, receipts, reports</li>
              <li>Offline-friendly tools for busy trading days</li>
              <li>Affordable plans for growing Ugandan businesses</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
            <h3 className="font-black text-stone-950">Company</h3>
            <p className="mt-2 text-sm font-medium text-stone-700">
              {WAKA_LEGAL_COMPANY_NAME} is a Ugandan registered technology company. We support shops, pharmacies, salons,
              supermarkets, restaurants, and market vendors with software that feels local — not imported complexity.
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
