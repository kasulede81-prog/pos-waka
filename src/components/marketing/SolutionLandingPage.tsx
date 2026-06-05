import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { MarketingLayout } from "./MarketingLayout";
import { SeoHead } from "./SeoHead";
import type { SolutionPageContent } from "../../config/solutionPages";
import { SOLUTION_NAV_LINKS } from "../../config/solutionPages";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
  content: SolutionPageContent;
};

export function SolutionLandingPage({ lang, setLang, isAuthenticated, content }: Props) {
  const related = SOLUTION_NAV_LINKS.filter((link) => link.slug !== content.slug);

  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead title={content.seoTitle} description={content.metaDescription} path={content.path} structuredData="page" />

      <article className="space-y-10">
        <header className="space-y-4">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-700">{content.eyebrow}</p>
          <h1 className="text-4xl font-black leading-tight text-stone-950 sm:text-5xl">{content.h1}</h1>
          <p className="max-w-3xl text-lg font-medium leading-relaxed text-stone-600">{content.intro}</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              to="/demo"
              className="inline-flex min-h-[48px] items-center rounded-2xl bg-orange-600 px-6 py-3 text-sm font-black text-white shadow-md hover:bg-orange-700"
            >
              {t(lang, "marketingCtaDemo")}
            </Link>
            <Link
              to="/register"
              className="inline-flex min-h-[48px] items-center rounded-2xl border-2 border-stone-200 bg-white px-6 py-3 text-sm font-black text-stone-900 hover:border-orange-200"
            >
              {t(lang, "marketingCtaSignup")}
            </Link>
          </div>
        </header>

        {content.sections.map((section) => (
          <section key={section.heading} className="rounded-3xl border border-stone-100 bg-white p-6 shadow-waka-sm sm:p-8">
            <h2 className="text-xl font-black text-stone-950">{section.heading}</h2>
            <div className="mt-4 space-y-3">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 48)} className="text-sm font-medium leading-relaxed text-stone-700">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}

        <section className="rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50/80 to-white p-6 sm:p-8">
          <h2 className="text-2xl font-black text-stone-950">Waka POS features for {content.eyebrow.toLowerCase()}</h2>
          <p className="mt-2 text-sm font-medium text-stone-600">
            Real tools from the Waka POS app — not a generic feature list.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {content.features.map((feature) => (
              <li key={feature.title} className="rounded-2xl border border-white bg-white/90 p-4 shadow-sm">
                <h3 className="font-black text-stone-950">{feature.title}</h3>
                <p className="mt-1 text-sm font-medium leading-relaxed text-stone-600">{feature.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-stone-100 bg-white p-6 shadow-waka-sm sm:p-8">
          <h2 className="text-2xl font-black text-stone-950">Frequently asked questions</h2>
          <dl className="mt-6 space-y-5">
            {content.faqs.map((faq) => (
              <div key={faq.question} className="border-b border-stone-100 pb-5 last:border-0 last:pb-0">
                <dt className="text-base font-black text-stone-950">{faq.question}</dt>
                <dd className="mt-2 text-sm font-medium leading-relaxed text-stone-600">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-3xl border border-stone-100 bg-stone-950 p-6 text-white sm:p-8">
          <h2 className="text-xl font-black">Try Waka POS on your business</h2>
          <p className="mt-2 text-sm font-medium text-stone-300">
            Open the interactive demo or create a free account — setup takes minutes on the phone you already use.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/demo"
              className="inline-flex min-h-[48px] items-center rounded-2xl bg-orange-600 px-6 py-3 text-sm font-black text-white hover:bg-orange-500"
            >
              {t(lang, "marketingCtaDemo")}
            </Link>
            <Link
              to="/register"
              className="inline-flex min-h-[48px] items-center rounded-2xl border-2 border-stone-600 px-6 py-3 text-sm font-black text-white hover:border-orange-400"
            >
              {t(lang, "marketingCtaSignup")}
            </Link>
            <Link
              to="/contact"
              className="inline-flex min-h-[48px] items-center rounded-2xl px-6 py-3 text-sm font-black text-orange-300 underline-offset-4 hover:underline"
            >
              Talk to support
            </Link>
          </div>
        </section>

        <section className="rounded-3xl border border-orange-100 bg-white p-6 shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">More Waka POS solutions in Uganda</h2>
          <p className="mt-2 text-sm font-medium text-stone-600">
            Explore how Waka POS fits other business types across Uganda.
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            {related.map((link) => (
              <li key={link.slug}>
                <Link to={link.path} className="text-sm font-black text-orange-800 underline-offset-4 hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/home" className="text-sm font-black text-stone-600 underline-offset-4 hover:underline">
                Waka POS home
              </Link>
            </li>
          </ul>
        </section>
      </article>
    </MarketingLayout>
  );
}
