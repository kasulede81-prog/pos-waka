import type { ReactNode } from "react";
import type { Language } from "../../types";
import { MarketingLayout } from "../../components/marketing/MarketingLayout";
import { SeoHead } from "../../components/marketing/SeoHead";
import {
  FOUNDER_NAME,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_MAIN_PRODUCT,
  WAKA_OFFICE_CITY,
  WAKA_OFFICE_COUNTRY,
  WAKA_OFFICE_STREET,
  WAKA_POS_URL,
  WAKA_SUPPORT_EMAILS,
} from "../../config/company";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

type FeatureBlock = {
  title: string;
  intro?: string[];
  bulletsLabel?: string;
  bullets?: string[];
  outro?: string[];
};

const DIFFERENTIATORS: FeatureBlock[] = [
  {
    title: "Built For Real Businesses",
    intro: [
      "Every feature in Waka comes from real operational challenges faced by shop owners, pharmacists, restaurant operators, wholesalers, and service businesses.",
    ],
  },
  {
    title: "Works Online And Offline",
    intro: [
      "Business should not stop because internet is unavailable.",
      "Waka continues recording sales, stock movements, debts, expenses, and operations while offline, then syncs automatically when connectivity returns.",
    ],
  },
  {
    title: "Complete Cash Control",
    bulletsLabel: "Monitor:",
    bullets: [
      "Shift openings",
      "Float verification",
      "Cash shortages",
      "Cash overages",
      "Drawer reconciliation",
      "Cash adjustments",
      "Daily cash accountability",
    ],
    outro: ["Owners always know where money moved."],
  },
  {
    title: "Owner Command Center",
    bulletsLabel: "Waka provides a centralized command center where owners can monitor:",
    bullets: [
      "Revenue",
      "Profit",
      "Staff performance",
      "Inventory risks",
      "Cash control",
      "Debt collection",
      "Supplier balances",
      "System integrity",
      "Business alerts",
    ],
    outro: ["All from one dashboard."],
  },
  {
    title: "Inventory Intelligence",
    bulletsLabel: "Track:",
    bullets: [
      "Stock levels",
      "Low stock alerts",
      "Out-of-stock products",
      "Inventory counts",
      "Product movements",
      "Expiry monitoring",
      "Shrinkage risks",
    ],
  },
  {
    title: "Staff Accountability",
    bulletsLabel: "Know:",
    bullets: [
      "Who opened a shift",
      "Who verified cash",
      "Who edited products",
      "Who issued refunds",
      "Who applied discounts",
      "Who performed stock adjustments",
    ],
    outro: ["Every important action is recorded."],
  },
  {
    title: "Built For Growth",
    intro: ["Start with a small shop and grow without changing systems."],
    bulletsLabel: "Waka supports:",
    bullets: [
      "Multiple staff accounts",
      "Multiple devices",
      "Cloud backup",
      "Branch expansion",
      "Advanced reporting",
      "Business analytics",
    ],
  },
];

export function AboutPage({ lang, setLang, isAuthenticated }: Props) {
  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead
        title="About Waka POS — Built in Uganda for African Business"
        description="Waka POS is an all-in-one business management platform for shops, supermarkets, pharmacies, restaurants, and growing businesses across Africa. Founded by Kasule Denis in Uganda."
        path="/about"
        structuredData="home"
      />

      <article className="space-y-8">
        <header className="space-y-4">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-waka-700">About us</p>
          <h1 className="text-4xl font-black leading-tight text-stone-950 sm:text-5xl">
            Built in Uganda. Built for African Business.
          </h1>
          <div className="max-w-3xl space-y-3 text-base font-medium leading-relaxed text-stone-600">
            <p>
              {WAKA_MAIN_PRODUCT} is an all-in-one business management platform designed for shops, supermarkets,
              pharmacies, restaurants, salons, wholesalers, and growing businesses across Africa.
            </p>
            <p>
              We help business owners sell faster, manage stock, control cash, monitor staff performance, track debts,
              manage suppliers, and make better decisions from a single platform.
            </p>
            <p>
              Whether you operate one shop or multiple branches, Waka gives you the tools to run your business with
              confidence.
            </p>
          </div>
        </header>

        <ContentSection title="Our Story">
          <p>
            Waka was founded by {FOUNDER_NAME} after years of operating and managing real businesses in Uganda.
          </p>
          <p>
            Like many business owners, he experienced the daily challenges of tracking stock, managing cash, monitoring
            staff, collecting debts, and understanding business performance using notebooks, spreadsheets, and
            disconnected systems.
          </p>
          <p>Waka was created to solve those problems with simple technology that works for everyday businesses.</p>
          <p>
            Today Waka serves businesses across multiple industries while remaining focused on one goal: helping African
            businesses operate more efficiently and grow sustainably.
          </p>
        </ContentSection>

        <section className="space-y-4">
          <h2 className="text-2xl font-black text-stone-950">What Makes Waka Different</h2>
          <div className="space-y-4">
            {DIFFERENTIATORS.map((block) => (
              <FeatureCard key={block.title} block={block} />
            ))}
          </div>
        </section>

        <ContentSection title="Our Vision">
          <p>To build Africa&apos;s most trusted business operating platform.</p>
          <p>
            We believe business owners deserve affordable technology that provides visibility, accountability, and
            control without requiring expensive infrastructure or technical knowledge.
          </p>
          <p>
            Our mission is to help millions of African businesses move from manual operations to modern business
            management.
          </p>
        </ContentSection>

        <section className="rounded-3xl border border-stone-100 bg-white p-6 shadow-waka-sm sm:p-8">
          <h2 className="text-xl font-black text-stone-950">{WAKA_LEGAL_COMPANY_NAME}</h2>
          <p className="mt-3 text-sm font-medium leading-relaxed text-stone-700">
            Waka POS is operated by {WAKA_LEGAL_COMPANY_NAME}, a Ugandan technology company building business software
            for Africa.
          </p>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-[11px] font-black uppercase tracking-wide text-stone-500">Email</h3>
              <ul className="mt-2 space-y-1 text-sm font-semibold text-waka-800">
                {WAKA_SUPPORT_EMAILS.map((email) => (
                  <li key={email}>
                    <a href={`mailto:${email}`} className="hover:underline">
                      {email}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-[11px] font-black uppercase tracking-wide text-stone-500">Website</h3>
              <p className="mt-2 text-sm font-semibold text-waka-800">
                <a href={WAKA_POS_URL} className="hover:underline">
                  pos.waka.ug
                </a>
              </p>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-[11px] font-black uppercase tracking-wide text-stone-500">Location</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-stone-700">
              {WAKA_OFFICE_STREET},
              <br />
              {WAKA_OFFICE_CITY}, {WAKA_OFFICE_COUNTRY}
            </p>
          </div>
        </section>
      </article>
    </MarketingLayout>
  );
}

function ContentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-stone-100 bg-white p-6 shadow-waka-sm sm:p-8">
      <h2 className="text-xl font-black text-stone-950">{title}</h2>
      <div className="mt-4 space-y-3 text-sm font-medium leading-relaxed text-stone-700">{children}</div>
    </section>
  );
}

function FeatureCard({ block }: { block: FeatureBlock }) {
  return (
    <article className="rounded-2xl border border-waka-100 bg-waka-50/40 p-5 sm:p-6">
      <h3 className="text-lg font-black text-stone-950">{block.title}</h3>
      {block.intro?.map((paragraph) => (
        <p key={paragraph} className="mt-2 text-sm font-medium leading-relaxed text-stone-700">
          {paragraph}
        </p>
      ))}
      {block.bulletsLabel ? (
        <p className="mt-2 text-sm font-medium text-stone-700">{block.bulletsLabel}</p>
      ) : null}
      {block.bullets && block.bullets.length > 0 ? (
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm font-medium text-stone-700">
          {block.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {block.outro?.map((paragraph) => (
        <p key={paragraph} className="mt-2 text-sm font-medium leading-relaxed text-stone-700">
          {paragraph}
        </p>
      ))}
    </article>
  );
}
