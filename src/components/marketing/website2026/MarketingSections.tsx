import { Link } from "react-router-dom";
import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, Star } from "lucide-react";
import {
  MARKETING_BUSINESS_TYPES,
  MARKETING_COMPARISON_ROWS,
  MARKETING_FAQ,
  MARKETING_FEATURES,
  MARKETING_HARDWARE_PACKAGES,
  MARKETING_PLANS,
  MARKETING_TESTIMONIALS,
  MARKETING_TRUST_PILLARS,
  formatMarketingUgx,
} from "../../../config/marketingSiteData";
import { wakaSupportWhatsAppUrl } from "../../../config/company";
import { HoverLift, Reveal } from "./MarketingMotion";
import {
  mktBtnPrimary,
  mktBtnSecondary,
  mktCard,
  mktCardLg,
  mktEyebrow,
  mktHeading,
  mktPopularPlan,
  mktSectionMuted,
  mktSubtext,
} from "../marketingThemeClasses";

export function MarketingTrustedSection() {
  return (
    <section className={clsx("border-y py-14 sm:py-16", mktSectionMuted)}>
      <Reveal className="text-center">
        <p className={mktEyebrow}>Trusted across Uganda</p>
        <h2 className={clsx("mt-2 text-2xl font-black sm:text-3xl", mktHeading)}>Growing with businesses across Uganda</h2>
      </Reveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MARKETING_TRUST_PILLARS.map((item, i) => (
          <Reveal key={item.title} delay={i * 0.05}>
            <HoverLift>
              <article className={clsx(mktCard, "h-full p-5")}>
                <p className="text-sm font-black text-waka- dark:text-waka-">{item.title}</p>
                <p className={clsx("mt-2 text-sm font-medium leading-relaxed", mktSubtext)}>{item.body}</p>
              </article>
            </HoverLift>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function MarketingBusinessTypesSection() {
  return (
    <section id="solutions" className="py-16 sm:py-20">
      <Reveal className="max-w-2xl">
        <p className={mktEyebrow}>Solutions</p>
        <h2 className={clsx("mt-2 text-3xl font-black sm:text-4xl", mktHeading)}>Built for every business type</h2>
        <p className={clsx("mt-3 text-base font-medium", mktSubtext)}>
          One POS for retail, food service, pharmacies, salons, and wholesale — tuned for how Ugandan businesses actually work.
        </p>
      </Reveal>
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {MARKETING_BUSINESS_TYPES.map((biz, i) => (
          <Reveal key={`${biz.label}-${i}`} delay={i * 0.03}>
            <Link
              to={`/solutions/${biz.slug}`}
              className={clsx(
                mktCard,
                "group flex min-h-[108px] flex-col justify-between p-4 transition hover:border-waka- hover:shadow-md dark:hover:border-waka-/40",
              )}
            >
              <span className="text-2xl" aria-hidden>
                {biz.icon}
              </span>
              <span className="text-sm font-black text-mkt-text group-hover:text-waka- dark:group-hover:text-waka-">
                {biz.label}
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function MarketingFeaturesSection() {
  return (
    <section id="features" className={clsx(mktCardLg, "px-4 py-16 sm:px-8 sm:py-20")}>
      <Reveal className="max-w-2xl">
        <p className={mktEyebrow}>Features</p>
        <h2 className={clsx("mt-2 text-3xl font-black sm:text-4xl", mktHeading)}>Everything you need to run your shop</h2>
        <p className={clsx("mt-3 text-base font-medium", mktSubtext)}>
          Sales, stock, cash, staff, suppliers, debts, and reports — without juggling five different tools.
        </p>
      </Reveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {MARKETING_FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 4) * 0.04}>
            <article className="h-full rounded-2xl border border-mkt-border bg-mkt-bg-secondary p-5 transition-[background-color,border-color] duration-500">
              <span className="text-xl" aria-hidden>
                {f.icon}
              </span>
              <h3 className={clsx("mt-3 text-sm font-black", mktHeading)}>{f.title}</h3>
              <p className={clsx("mt-1.5 text-sm font-medium leading-relaxed", mktSubtext)}>{f.body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function MarketingShowcaseSection() {
  const panels = [
    { title: "Owner Dashboard", tone: "from-stone-900 to-stone-800", chips: ["Sales", "Profit", "Low stock", "Debts"] },
    { title: "Sell Screen", tone: "from-waka- to-waka-", chips: ["Fast checkout", "Barcode", "Categories", "Offline"] },
    { title: "Reports", tone: "from-emerald-700 to-teal-700", chips: ["Daily close", "Trends", "Top products", "Export"] },
    { title: "Inventory", tone: "from-sky-700 to-indigo-700", chips: ["Stock list", "Purchases", "Suppliers", "Counts"] },
  ];

  return (
    <section className="py-16 sm:py-20">
      <Reveal className="text-center">
        <p className={mktEyebrow}>Product</p>
        <h2 className={clsx("mt-2 text-3xl font-black sm:text-4xl", mktHeading)}>See Waka POS in action</h2>
        <p className={clsx("mx-auto mt-3 max-w-2xl text-base font-medium", mktSubtext)}>
          Desktop command center, fast sell screen, rich reports, and inventory — on the devices you already use.
        </p>
      </Reveal>
      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {panels.map((panel, i) => (
          <Reveal key={panel.title} delay={i * 0.06}>
            <HoverLift>
              <article className={`overflow-hidden rounded-3xl bg-gradient-to-br ${panel.tone} p-6 text-white shadow-xl ring-1 ring-white/10`}>
                <p className="text-lg font-black">{panel.title}</p>
                <div className="mt-6 rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
                  <div className="grid grid-cols-2 gap-2">
                    {panel.chips.map((c) => (
                      <div key={c} className="rounded-xl bg-white/15 px-3 py-4 text-center text-xs font-black">
                        {c}
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            </HoverLift>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function MarketingHardwareSection() {
  return (
    <section id="hardware" className="py-16 sm:py-20">
      <Reveal className="max-w-2xl">
        <p className={mktEyebrow}>Hardware</p>
        <h2 className={clsx("mt-2 text-3xl font-black sm:text-4xl", mktHeading)}>Complete POS solutions</h2>
        <p className={clsx("mt-3 text-base font-medium", mktSubtext)}>
          Choose a full terminal package, a tablet setup, or software-only on devices you already own.
        </p>
      </Reveal>
      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {MARKETING_HARDWARE_PACKAGES.map((pkg, i) => (
          <Reveal key={pkg.id} delay={i * 0.06}>
            <HoverLift>
              <article className={clsx(mktCardLg, "flex h-full flex-col p-6")}>
                <p className={mktEyebrow}>{pkg.badge}</p>
                <h3 className={clsx("mt-2 text-xl font-black", mktHeading)}>{pkg.name}</h3>
                <p className="mt-3 text-3xl font-black text-waka- dark:text-waka-">{pkg.priceLabel}</p>
                <ul className="mt-6 flex-1 space-y-2">
                  {pkg.includes.map((item) => (
                    <li key={item} className="flex gap-2 text-sm font-semibold text-mkt-text">
                      <span className="text-waka- dark:text-waka-">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/contact"
                  className={clsx(
                    mktBtnSecondary,
                    "mt-6 min-h-[48px] border-waka- bg-waka- text-sm text-waka- hover:bg-waka- dark:border-waka-/30 dark:bg-waka-/30 dark:text-waka- dark:hover:bg-waka-/50",
                  )}
                >
                  Contact sales
                </Link>
              </article>
            </HoverLift>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function MarketingPricingSection() {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="py-16 sm:py-20">
      <Reveal className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className={mktEyebrow}>Pricing</p>
          <h2 className={clsx("mt-2 text-3xl font-black sm:text-4xl", mktHeading)}>Simple plans that grow with you</h2>
          <p className={clsx("mt-3 text-base font-medium", mktSubtext)}>
            Start free. Upgrade when your shop needs more products, staff, or devices.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-mkt-border bg-mkt-bg-secondary p-1 text-sm font-black">
          <button
            type="button"
            onClick={() => setYearly(false)}
            className={clsx(
              "rounded-full px-4 py-2 transition duration-300",
              !yearly ? "bg-mkt-card text-waka- shadow-sm dark:text-waka-" : mktSubtext,
            )}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setYearly(true)}
            className={clsx(
              "rounded-full px-4 py-2 transition duration-300",
              yearly ? "bg-mkt-card text-waka- shadow-sm dark:text-waka-" : mktSubtext,
            )}
          >
            Yearly · Save 20%
          </button>
        </div>
      </Reveal>

      <div className="mt-10 grid gap-5 lg:grid-cols-4">
        {MARKETING_PLANS.map((plan, i) => (
          <Reveal key={plan.code} delay={i * 0.05}>
            <article
              className={clsx(
                "flex h-full flex-col rounded-3xl border p-6 shadow-mkt transition-[background-color,border-color,box-shadow] duration-500",
                plan.popular ? mktPopularPlan : clsx(mktCard, "border-mkt-border"),
              )}
            >
              {plan.popular ? (
                <span className="mb-2 inline-flex w-fit rounded-full bg-waka- px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                  Most Popular
                </span>
              ) : null}
              <h3 className={clsx("text-xl font-black", mktHeading)}>{plan.name}</h3>
              <p className="mt-2 text-3xl font-black text-waka- dark:text-waka-">
                {plan.code === "free"
                  ? formatMarketingUgx(0)
                  : yearly
                    ? formatMarketingUgx(plan.annualUgx)
                    : `${formatMarketingUgx(plan.monthlyUgx)}/mo`}
              </p>
              {plan.code !== "free" && yearly ? (
                <p className={clsx("mt-1 text-xs font-bold", mktSubtext)}>Billed yearly · 20% savings</p>
              ) : null}
              <p className={clsx("mt-3 text-sm font-medium", mktSubtext)}>{plan.blurb}</p>
              <ul className="mt-5 flex-1 space-y-1.5">
                {plan.features.slice(0, 8).map((f) => (
                  <li key={f} className="text-xs font-semibold text-mkt-text">
                    ✓ {f}
                  </li>
                ))}
                {plan.features.length > 8 ? (
                  <li className={clsx("text-xs font-bold", mktSubtext)}>+ {plan.features.length - 8} more</li>
                ) : null}
              </ul>
              <Link
                to={plan.code === "free" ? "/register" : "/contact"}
                className={clsx(
                  "mt-6 inline-flex min-h-[44px] items-center justify-center rounded-2xl text-sm font-black transition duration-300",
                  plan.popular ? clsx(mktBtnPrimary, "hover:bg-waka-") : mktBtnSecondary,
                )}
              >
                {plan.code === "free" ? "Start free" : "Get started"}
              </Link>
            </article>
          </Reveal>
        ))}
      </div>
      <p className={clsx("mt-6 text-center text-sm font-medium", mktSubtext)}>
        <Link to="/pricing" className="font-black text-waka- underline-offset-2 hover:underline dark:text-waka-">
          View full plan comparison →
        </Link>
      </p>
    </section>
  );
}

export function MarketingComparisonSection() {
  return (
    <section className={clsx("rounded-[2rem] border px-4 py-16 sm:px-8", mktSectionMuted, "border-mkt-border")}>
      <Reveal className="text-center">
        <p className={mktEyebrow}>Why Waka</p>
        <h2 className={clsx("mt-2 text-3xl font-black", mktHeading)}>Why businesses choose Waka POS</h2>
      </Reveal>
      <div className={clsx(mktCard, "mt-10 overflow-hidden rounded-2xl")}>
        <div className="grid grid-cols-3 bg-mkt-bg-secondary text-xs font-black uppercase tracking-wide text-mkt-text-secondary sm:text-sm">
          <div className="p-4">Topic</div>
          <div className="border-l border-mkt-border p-4">Traditional</div>
          <div className="border-l border-mkt-border p-4 text-waka- dark:text-waka-">With Waka POS</div>
        </div>
        {MARKETING_COMPARISON_ROWS.map((row) => (
          <div key={row.topic} className="grid grid-cols-3 border-t border-mkt-border text-sm">
            <div className={clsx("p-4 font-black", mktHeading)}>{row.topic}</div>
            <div className={clsx("border-l border-mkt-border p-4 font-medium", mktSubtext)}>{row.traditional}</div>
            <div className="border-l border-mkt-border p-4 font-semibold text-mkt-text">{row.waka}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MarketingTestimonialsSection() {
  return (
    <section className="py-16 sm:py-20">
      <Reveal className="text-center">
        <p className={mktEyebrow}>Customers</p>
        <h2 className={clsx("mt-2 text-3xl font-black", mktHeading)}>Trusted by shop owners across Uganda</h2>
      </Reveal>
      <div className="mt-10 flex gap-4 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]">
        {MARKETING_TESTIMONIALS.map((t, i) => (
          <Reveal key={t.name} delay={i * 0.05} className="min-w-[280px] max-w-[320px] shrink-0">
            <article className={clsx(mktCardLg, "h-full p-6")}>
              <div className="flex gap-0.5 text-amber-500 dark:text-amber-400">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-current" aria-hidden />
                ))}
              </div>
              <p className={clsx("mt-4 text-sm font-medium leading-relaxed", mktSubtext)}>&ldquo;{t.quote}&rdquo;</p>
              <p className={clsx("mt-4 text-sm font-black", mktHeading)}>{t.name}</p>
              <p className={clsx("text-xs font-semibold", mktSubtext)}>{t.business}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function MarketingFaqSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="py-16 sm:py-20">
      <Reveal className="max-w-2xl">
        <p className={mktEyebrow}>FAQ</p>
        <h2 className={clsx("mt-2 text-3xl font-black", mktHeading)}>Questions shop owners ask</h2>
      </Reveal>
      <div className="mt-8 space-y-2">
        {MARKETING_FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={item.q} delay={i * 0.03}>
              <div className={clsx(mktCard, "overflow-hidden")}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span className={clsx("text-sm font-black sm:text-base", mktHeading)}>{item.q}</span>
                  <ChevronDown
                    className={clsx("h-5 w-5 shrink-0 text-mkt-text-secondary transition duration-300", isOpen && "rotate-180")}
                  />
                </button>
                {isOpen ? (
                  <p className={clsx("border-t border-mkt-border px-5 pb-4 text-sm font-medium leading-relaxed", mktSubtext)}>
                    {item.a}
                  </p>
                ) : null}
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

export function MarketingFinalCtaSection() {
  return (
    <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-waka- to-waka- px-6 py-12 text-white shadow-xl ring-1 ring-waka-/30 sm:px-10 sm:py-14">
      <Reveal>
        <h2 className="text-3xl font-black leading-tight sm:text-4xl">Ready to grow your business?</h2>
        <p className="mt-3 max-w-xl text-base font-medium text-waka-">
          Join Ugandan shops using Waka POS for sales, stock, debts, and daily reports — online or offline.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/register" className="inline-flex min-h-[48px] items-center rounded-2xl bg-white px-6 py-3 text-sm font-black text-waka- transition hover:bg-waka-">
            Start Free
          </Link>
          <Link to="/contact" className="inline-flex min-h-[48px] items-center rounded-2xl border-2 border-white/80 px-6 py-3 text-sm font-black text-white transition hover:bg-white/10">
            Contact Sales
          </Link>
          <a
            href={wakaSupportWhatsAppUrl("Hello Waka, I want to learn about Waka POS.")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[48px] items-center rounded-2xl border-2 border-white/40 px-6 py-3 text-sm font-black text-white transition hover:bg-white/10"
          >
            WhatsApp
          </a>
        </div>
      </Reveal>
    </section>
  );
}
