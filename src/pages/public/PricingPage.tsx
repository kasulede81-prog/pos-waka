import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { MarketingLayout } from "../../components/marketing/MarketingLayout";
import { SeoHead } from "../../components/marketing/SeoHead";
import { usePublicPricing } from "../../hooks/usePublicPricing";
import { PlanPriceDisplay } from "../../components/pricing/PlanPriceDisplay";
import type { PaidPlanCode } from "../../lib/subscriptionPricing";
import { pricingForPlan } from "../../lib/subscriptionPricing";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

type PricingPlan = {
  code: PaidPlanCode | "free";
  name: string;
  blurb: string;
  features: string[];
  limits: string[];
  goodFor: string;
  popular?: boolean;
};

const PLANS: PricingPlan[] = [
  {
    code: "free",
    name: "Free",
    blurb: "Perfect for trying Waka POS and running a very small shop.",
    features: [
      "Sales & Checkout",
      "Inventory Management",
      "Customer Management",
      "Debt Tracking",
      "Receipts",
      "Offline Mode",
      "Basic Reports",
    ],
    limits: ["1 Device", "1 User", "Up to 7 Products"],
    goodFor: "Testing, kiosks, startups, very small shops",
  },
  {
    code: "starter",
    name: "Starter",
    blurb: "For owners who run the shop themselves.",
    features: [
      "Unlimited Products",
      "Supplier Management",
      "Purchase Tracking",
      "Expense Tracking",
      "Profit Reports",
      "Advanced Reports",
      "Customer Debt Management",
      "Supplier Payments",
      "Inventory Counts",
      "Backup & Restore",
      "Cloud Sync",
      "Stock Movement Tracking",
      "Daily Business Reports",
    ],
    limits: ["1 Device", "2 Users", "2 Staff Accounts"],
    goodFor: "Boutiques, salons, groceries, pharmacies, mini markets",
  },
  {
    code: "business",
    name: "Business",
    blurb: "For growing businesses with employees.",
    popular: true,
    features: [
      "Everything in Starter",
      "Staff Accounts",
      "Staff Switching",
      "Owner Dashboard",
      "Cash Drawer Management",
      "Day Open & Day Close",
      "Shift Management",
      "Opening Float Verification",
      "Cash Reconciliation",
      "Returns & Refunds",
      "Activity Logs",
      "Audit Center",
      "Role Permissions",
      "Multi-Device Sync",
      "Inventory Count Approval Workflow",
      "Staff Accountability Tracking",
      "Cash History",
      "Business Analytics",
    ],
    limits: ["Up to 4 Devices", "Up to 4 Staff Accounts"],
    goodFor: "Supermarkets, hardware stores, pharmacies, businesses with employees",
  },
  {
    code: "waka_plus",
    name: "Waka Plus",
    blurb: "For wholesalers and larger businesses.",
    features: [
      "Everything in Business",
      "Up to 10 Devices",
      "Up to 10 Staff Accounts",
      "Multi-Shop Support",
      "Advanced Backups",
      "Cloud Recovery",
      "Priority Support",
      "Advanced Audit Center",
      "Operational Analytics",
      "Cash Control Dashboard",
      "Inventory Intelligence",
      "Business Performance Insights",
      "Early Access Features",
    ],
    limits: ["Up to 10 Devices", "Up to 10 Staff Accounts"],
    goodFor: "Wholesalers, distributors, chain stores, multi-branch businesses",
  },
];

const WHY_CHOOSE = [
  "Offline First",
  "Cloud Sync",
  "Inventory Management",
  "Cash Drawer Control",
  "Shift Management",
  "Staff Accountability",
  "Debt Tracking",
  "Supplier Management",
  "Audit Logs",
  "Inventory Counts",
  "Business Reports",
  "Backup & Recovery",
  "Multi-Device Support",
  "Multi-Shop Support",
  "Built for African Businesses",
];

function formatUgx(amount: number): string {
  return `UGX ${amount.toLocaleString("en-UG")}`;
}

export function PricingPage({ lang, setLang, isAuthenticated }: Props) {
  const { pricing, loading } = usePublicPricing();

  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead
        title="Waka POS Pricing — Complete Business Control for Every Shop"
        description="Waka POS pricing for shops in Uganda. Free plan to start. Starter, Business, and Waka Plus plans with sales, inventory, cash control, staff accountability, and cloud sync."
        path="/pricing"
        structuredData="home"
      />

      <article className="space-y-10">
        <header className="space-y-4">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-waka-700">Pricing</p>
          <h1 className="text-4xl font-black leading-tight text-stone-950 sm:text-5xl">Waka POS Pricing</h1>
          <p className="text-2xl font-black text-waka-800">Complete Business Control for Every Shop</p>
          <p className="max-w-3xl text-base font-medium leading-relaxed text-stone-600">
            Sales · Inventory · Staff · Cash Control · Suppliers · Debt Tracking · Reports · Cloud Sync · Business
            Intelligence
          </p>
        </header>

        {pricing.campaignActive && pricing.campaignName ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-900">
            Limited offer: {pricing.campaignName}
          </p>
        ) : null}

        <div className="space-y-6">
          {PLANS.map((plan) => {
            const paidPrice =
              plan.code !== "free" ? pricingForPlan(pricing, plan.code) : null;
            return (
            <section
              key={plan.name}
              className={`rounded-3xl border p-6 shadow-waka-sm sm:p-8 ${
                plan.popular ? "border-waka-400 bg-gradient-to-br from-waka-50 to-white" : "border-stone-100 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black text-stone-950">
                    {plan.name}
                    {plan.popular ? <span className="ml-2 text-base text-waka-600">★ Most Popular</span> : null}
                  </h2>
                  {plan.code === "free" ? (
                    <p className="mt-2 text-3xl font-black text-waka-700">{formatUgx(0)}</p>
                  ) : paidPrice && !loading ? (
                    <div className="mt-2">
                      <PlanPriceDisplay price={paidPrice} interval="month" />
                      <div className="mt-2">
                        <PlanPriceDisplay price={paidPrice} interval="year" size="sm" />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-3xl font-black text-waka-700">—</p>
                  )}
                  <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-stone-700">{plan.blurb}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">Standout Features</h3>
                  <ul className="mt-3 space-y-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2 text-sm font-semibold text-stone-700">
                        <span className="text-waka-600">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">Limits</h3>
                  <ul className="mt-3 list-inside list-disc space-y-1 text-sm font-semibold text-stone-700">
                    {plan.limits.map((limit) => (
                      <li key={limit}>{limit}</li>
                    ))}
                  </ul>
                  <p className="mt-4 text-sm font-medium text-stone-600">
                    <span className="font-black text-stone-800">Good for:</span> {plan.goodFor}
                  </p>
                </div>
              </div>
            </section>
            );
          })}
        </div>

        <section className="rounded-3xl border border-stone-100 bg-white p-6 shadow-waka-sm sm:p-8">
          <h2 className="text-xl font-black text-stone-950">Why Businesses Choose Waka POS</h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_CHOOSE.map((item) => (
              <li key={item} className="flex gap-2 text-sm font-semibold text-stone-700">
                <span className="text-waka-600">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-waka-200 bg-gradient-to-br from-waka-600 to-waka-500 p-8 text-white shadow-waka-sm">
          <h2 className="text-3xl font-black leading-tight">Run your entire business from one app.</h2>
          <p className="mt-4 max-w-2xl text-base font-medium leading-relaxed text-waka-50">
            Manage sales, inventory, cash, staff, suppliers, debts, reports, audits, and cloud backups with Waka POS.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/register"
              className="inline-flex min-h-[48px] items-center rounded-2xl bg-white px-6 py-3 text-sm font-black text-waka-700"
            >
              Create free account
            </Link>
            <Link
              to="/support"
              className="inline-flex min-h-[48px] items-center rounded-2xl border-2 border-white/80 px-6 py-3 text-sm font-black text-white"
            >
              Contact support
            </Link>
          </div>
        </section>
      </article>
    </MarketingLayout>
  );
}
