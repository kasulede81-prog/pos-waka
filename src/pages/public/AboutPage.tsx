import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { MarketingLayout } from "../../components/marketing/MarketingLayout";
import { SeoHead } from "../../components/marketing/SeoHead";
import { FounderSection } from "../../components/marketing/FounderSection";
import { FounderJourney } from "../../components/marketing/FounderJourney";
import { FOUNDER_JOURNEY_SUMMARY, FOUNDER_NAME } from "../../config/company";
import {
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_MAIN_PRODUCT,
  WAKA_PRODUCT_DESCRIPTION,
} from "../../config/company";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

export function AboutPage({ lang, setLang, isAuthenticated }: Props) {
  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead
        title="About Waka POS — Uganda business software"
        description={`Founded by ${FOUNDER_NAME}, Ugandan software founder behind Waka POS. ${FOUNDER_JOURNEY_SUMMARY} ${WAKA_PRODUCT_DESCRIPTION}`}
        path="/about"
        structuredData="home"
      />

      <article className="space-y-10">
        <header className="space-y-4">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-700">About us</p>
          <h1 className="text-4xl font-black leading-tight text-stone-950 sm:text-5xl">
            Built in Uganda for everyday businesses
          </h1>
          <p className="max-w-2xl text-lg font-medium leading-relaxed text-stone-600">{WAKA_PRODUCT_DESCRIPTION}</p>
        </header>

        <section className="rounded-3xl border border-stone-100 bg-white p-6 shadow-waka-sm sm:p-8">
          <h2 className="text-xl font-black text-stone-950">Our story</h2>
          <p className="mt-4 text-sm font-medium leading-relaxed text-stone-700">
            Founded by {FOUNDER_NAME}, {WAKA_MAIN_PRODUCT} was built to help Ugandan businesses access affordable and
            easy-to-use business technology. Many shops still rely on notebooks, memory, and manual stock counts. Waka
            POS brings sales, receipts, stock, debts, reports, and staff tools into one simple system that works on the
            phones and devices businesses already use.
          </p>
          <p className="mt-3 text-sm font-medium leading-relaxed text-stone-700">
            {WAKA_LEGAL_COMPANY_NAME} focuses on local support, practical features, and software that keeps working
            when the network is slow — including offline mode and cloud backup when you are ready.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Simple by design",
              body: "Clear screens, fast checkout, and everyday language — not enterprise jargon.",
            },
            {
              title: "Offline-friendly",
              body: "Keep selling and recording when internet is weak. Sync and backup when connection returns.",
            },
            {
              title: "Affordable for SMEs",
              body: "Start in Free Mode. Upgrade when your shop needs more products, staff, or backup.",
            },
          ].map((card) => (
            <div key={card.title} className="rounded-2xl border border-orange-100 bg-orange-50/50 p-5">
              <h3 className="font-black text-stone-950">{card.title}</h3>
              <p className="mt-2 text-sm font-medium text-stone-700">{card.body}</p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-stone-100 bg-white p-6 shadow-waka-sm">
          <h2 className="text-xl font-black text-stone-950">Mission</h2>
          <p className="mt-3 text-sm font-medium leading-relaxed text-stone-700">
            To build affordable, easy-to-use business technology for African businesses — starting in Uganda. We want
            every shop, pharmacy, salon, restaurant, and market vendor to manage sales and stock with confidence, not
            complexity.
          </p>
        </section>

        <section className="rounded-3xl border border-orange-50 bg-gradient-to-br from-white to-orange-50/60 p-6 shadow-waka-sm sm:p-8">
          <FounderJourney condensed />
        </section>

        <FounderSection />

        <section className="rounded-3xl border border-stone-100 bg-white p-6 text-center shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">Ready to try Waka POS?</h2>
          <p className="mt-2 text-sm font-medium text-stone-600">Create a free account or speak with our support team.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              to="/register"
              className="inline-flex min-h-[48px] items-center rounded-2xl bg-orange-600 px-6 py-3 text-sm font-black text-white"
            >
              Create account
            </Link>
            <Link
              to="/contact"
              className="inline-flex min-h-[48px] items-center rounded-2xl border-2 border-stone-200 px-6 py-3 text-sm font-black text-stone-900"
            >
              Contact us
            </Link>
          </div>
        </section>
      </article>
    </MarketingLayout>
  );
}
