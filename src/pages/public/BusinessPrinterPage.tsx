import { Link } from "react-router-dom";
import { ArrowRight, Check, MessageCircle } from "lucide-react";
import type { Language } from "../../types";
import { MarketingLayout } from "../../components/marketing/MarketingLayout";
import { SeoHead } from "../../components/marketing/SeoHead";
import { MarketingMotionProvider, Reveal } from "../../components/marketing/website2026/MarketingMotion";
import { mktCardLg, mktEyebrow, mktHeroGlow, mktPopularPlan, mktSubtext } from "../../components/marketing/marketingThemeClasses";
import { PlanPriceDisplay } from "../../components/pricing/PlanPriceDisplay";
import { PrinterShowcase } from "../../components/marketing/businessPrinter/PrinterShowcase";
import { PrinterFulfilment } from "../../components/marketing/businessPrinter/PrinterFulfilment";
import { PrinterSetupVideo } from "../../components/marketing/businessPrinter/PrinterSetupVideo";
import { usePublicPricing } from "../../hooks/usePublicPricing";
import { pricingForPlan, type PaidPlanCode } from "../../lib/subscriptionPricing";
import { MARKETING_PLANS } from "../../config/marketingSiteData";
import { wakaSupportWhatsAppUrl } from "../../config/company";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

/** The three paid plans, in the order they are presented. Business is the offer. */
const SHOWN_PLANS: Array<{ code: PaidPlanCode; name: string; role: string; promoted?: boolean }> = [
  { code: "starter", name: "Starter", role: "One person, one device" },
  { code: "business", name: "Business", role: "Shops with employees", promoted: true },
  { code: "waka_plus", name: "Waka Plus", role: "Chains and multi-branch" },
];

/**
 * The features Business actually unlocks.
 *
 * Read from the shared marketing plan data rather than retyped, so this page can
 * never advertise a Business feature the pricing page does not also list.
 */
function businessFeatures(): string[] {
  return MARKETING_PLANS.find((plan) => plan.code === "business")?.features ?? [];
}

export function BusinessPrinterPage({ lang, setLang, isAuthenticated }: Props) {
  const { pricing, loading } = usePublicPricing();
  const freePrinterWhatsApp = wakaSupportWhatsAppUrl(
    "Hello DKASU, I would like to know more about the free WP-58 printer with the Business annual plan.",
  );

  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead
        title="Free Waka POS WP-58 Printer with Business Annual — DKASU POS"
        description="Subscribe to DKASU POS Business billed yearly and receive a free Waka POS WP-58 58mm Bluetooth thermal printer. Business features for shops with employees, staff accountability, cloud sync and reports."
        path="/business-printer"
        structuredData="home"
      />

      {/*
        `Reveal` renders a framer-motion `m` element, and `m` only works inside a
        `LazyMotion` provider. MarketingLayout does NOT supply one — only the
        marketing home page does — so the provider has to wrap this page's
        sections explicitly.
      */}
      <MarketingMotionProvider>
        <article className="space-y-16 sm:space-y-20">
          {/* ------------------------------------------------------------- hero */}
          <section className="relative pt-6 sm:pt-10">
            <div className={mktHeroGlow} aria-hidden="true" />
            <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
              <Reveal>
                <p className={`text-xs font-black uppercase tracking-[0.22em] ${mktEyebrow}`}>Limited promotion</p>
                <h1 className="mt-3 text-4xl font-black leading-[1.08] text-mkt-text sm:text-5xl">
                  A free WP-58 printer with Business, billed yearly.
                </h1>
                <p className={`mt-5 max-w-xl text-lg font-medium leading-relaxed ${mktSubtext}`}>
                  The 58mm Bluetooth thermal printer that prints the receipt at the counter — included when you take
                  Business on an annual subscription. No separate hardware order, no extra payment for the printer.
                </p>

                <div className="mt-7 flex flex-wrap gap-3">
                  <Link
                    to="/register"
                    className="inline-flex items-center gap-2 rounded-2xl bg-waka-600 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-600/20 transition hover:bg-waka-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2"
                  >
                    Start free, upgrade later
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <a
                    href="#printer"
                    className="inline-flex items-center gap-2 rounded-2xl border-2 border-mkt-border bg-mkt-card px-6 py-3.5 text-base font-bold text-mkt-text transition hover:border-waka-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2"
                  >
                    See the printer
                  </a>
                </div>

                <p className={`mt-4 text-sm font-medium ${mktSubtext}`}>
                  Business features unlock when the subscription is active. The printer is collected after that.
                </p>
              </Reveal>

              <Reveal delay={0.1}>
                <PrinterShowcase />
              </Reveal>
            </div>
          </section>

          {/* --------------------------------------------------- receipt detail */}
          <section className="border-t border-mkt-border pt-14">
            <Reveal>
              <p className={`text-xs font-black uppercase tracking-[0.22em] ${mktEyebrow}`} id="printer">
                The printer
              </p>
              <h2 className="mt-3 max-w-3xl text-3xl font-black leading-tight text-mkt-text sm:text-4xl">
                Built for a counter with no spare socket and no reliable power.
              </h2>
              <p className={`mt-4 max-w-2xl text-base font-medium leading-relaxed ${mktSubtext}`}>
                A handheld 58mm thermal printer that talks to the phone or tablet already running DKASU POS over
                Bluetooth. It charges over USB-C, carries its own battery, and prints the customer's receipt without a
                laptop, a router, or a mains connection.
              </p>
            </Reveal>
          </section>

          {/* --------------------------------------------------- Business features */}
          <section className="border-t border-mkt-border pt-14">
            <Reveal>
              <p className={`text-xs font-black uppercase tracking-[0.22em] ${mktEyebrow}`}>What Business adds</p>
              <h2 className="mt-3 max-w-3xl text-3xl font-black leading-tight text-mkt-text sm:text-4xl">
                Business is the plan for a shop with employees.
              </h2>
              <p className={`mt-4 max-w-2xl text-base font-medium leading-relaxed ${mktSubtext}`}>
                Every item below is part of the Business plan today. They unlock as soon as the subscription is active —
                nothing here needs configuring, and nothing is gated behind the printer arriving.
              </p>
            </Reveal>

            <Reveal delay={0.05}>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {businessFeatures().map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 rounded-2xl border border-mkt-border bg-mkt-card px-4 py-3.5 shadow-mkt"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <span className="text-sm font-bold text-mkt-text">{feature}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </section>

          {/* -------------------------------------------------- setup video */}
          <section className="border-t border-mkt-border pt-14">
            <PrinterSetupVideo />
          </section>

          {/* --------------------------------------------------------- the plans */}
          <section className="border-t border-mkt-border pt-14">
            <Reveal>
              <p className={`text-xs font-black uppercase tracking-[0.22em] ${mktEyebrow}`}>Plans</p>
              <h2 className="mt-3 max-w-3xl text-3xl font-black leading-tight text-mkt-text sm:text-4xl">
                Business yearly, with the printer included.
              </h2>
              <p className={`mt-4 max-w-2xl text-base font-medium leading-relaxed ${mktSubtext}`}>
                Prices below are live and come from the same price book the app charges from. A plan the team has taken
                off sale shows as unavailable rather than disappearing.
              </p>
            </Reveal>

            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              {SHOWN_PLANS.map((plan, index) => {
                /**
                 * A plan is only offered here when the live price book carries it.
                 * The book already excludes anything taken off sale, so this page
                 * follows the same switch the app does — no separate list to keep
                 * in step, and no change to how plans are enabled.
                 */
                const price = loading ? null : pricingForPlan(pricing, plan.code);
                return (
                  <Reveal key={plan.code} delay={index * 0.06}>
                    <div
                      className={`${mktCardLg} flex h-full flex-col p-6 ${plan.promoted ? mktPopularPlan : ""}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-xl font-bold text-mkt-text">{plan.name}</h3>
                        {plan.promoted ? (
                          <span className="rounded-full bg-waka-600 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">
                            Free printer
                          </span>
                        ) : null}
                      </div>
                      <p className={`mt-1 text-sm font-semibold ${mktSubtext}`}>{plan.role}</p>

                      <div className="mt-5 min-h-[86px]">
                        {price ? (
                          <PlanPriceDisplay price={price} interval="year" size="sm" showIntervalNote />
                        ) : (
                          <p className="text-2xl font-black text-mkt-text-secondary">
                            {loading ? "Loading…" : "Currently unavailable"}
                          </p>
                        )}
                      </div>

                      <Link
                        to={plan.promoted ? "/register" : "/pricing"}
                        className={`mt-6 inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 ${
                          plan.promoted
                            ? "bg-waka-600 text-white shadow-lg shadow-orange-600/20 hover:bg-waka-700"
                            : "border-2 border-mkt-border bg-mkt-card text-mkt-text hover:border-waka-500"
                        }`}
                      >
                        {plan.promoted ? "Choose Business yearly" : `See ${plan.name}`}
                      </Link>

                      {plan.promoted ? (
                        <p className={`mt-3 text-xs font-semibold leading-relaxed ${mktSubtext}`}>
                          Subscribing happens in the app after you create an account. This page does not activate
                          anything.
                        </p>
                      ) : null}
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </section>

          {/* ---------------------------------------------------- getting the printer */}
          <section className="border-t border-mkt-border pt-14">
            <Reveal>
              <p className={`text-xs font-black uppercase tracking-[0.22em] ${mktEyebrow}`}>Getting your printer</p>
              <h2 className="mt-3 max-w-3xl text-3xl font-black leading-tight text-mkt-text sm:text-4xl">
                Two ways to collect it.
              </h2>
            </Reveal>
            <Reveal delay={0.05}>
              <div className="mt-8">
                <PrinterFulfilment />
              </div>
            </Reveal>
          </section>

          {/* ---------------------------------------------------------- close */}
          <section className="border-t border-mkt-border pt-14">
            <Reveal>
              <div className="rounded-3xl bg-gradient-to-br from-waka-600 to-waka-700 p-8 text-white shadow-waka-sm sm:p-10">
                <h2 className="max-w-2xl text-3xl font-black leading-tight sm:text-4xl">
                  Start free today. Take Business yearly when you are ready for the printer.
                </h2>
                <p className="mt-4 max-w-2xl text-base font-medium leading-relaxed text-waka-50">
                  Create an account and run your shop on the free plan first. Upgrade inside the app when the counter
                  gets busy enough to need staff accounts and a printed receipt on every sale.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link
                    to="/register"
                    className="inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-base font-bold text-waka-700 transition hover:bg-waka-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-waka-600"
                  >
                    Create a free account
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <a
                    href={freePrinterWhatsApp}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-2xl border-2 border-white/80 px-6 py-3.5 text-base font-bold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-waka-600"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    Ask a question first
                  </a>
                </div>
              </div>
            </Reveal>
            </section>
        </article>
      </MarketingMotionProvider>
    </MarketingLayout>
  );
}
