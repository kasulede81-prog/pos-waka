import { Link } from "react-router-dom";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageBackBar } from "../components/layout/PageBackBar";
import { useEffect, useState } from "react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSubscription } from "../context/SubscriptionContext";
import { usePublicPricing } from "../hooks/usePublicPricing";
import { PlanPriceDisplay } from "../components/pricing/PlanPriceDisplay";
import { pricingForPlan, type PaidPlanCode } from "../lib/subscriptionPricing";
import {
  getPaidPlanRenewalCountdown,
  maxDevicesHintForTier,
  maxProductsForTier,
  maxStaffAccountsForTier,
  resolveEffectivePlanTier,
  shouldShowFreeUpgradePitch,
  type SubscriptionPlanCode,
} from "../lib/subscriptionEntitlements";
import { fetchMyOrgBillingOffers, type OrgBillingOfferRow } from "../lib/orgBillingOffers";

const PLAN_ORDER: SubscriptionPlanCode[] = ["free", "starter", "business", "waka_plus"];

const PAID_ANNUAL: { plan: SubscriptionPlanCode; annualKey: string; saveKey: string }[] = [
  { plan: "starter", annualKey: "planStarterAnnual", saveKey: "planStarterAnnualSave" },
  { plan: "business", annualKey: "planBusinessAnnual", saveKey: "planBusinessAnnualSave" },
  { plan: "waka_plus", annualKey: "planWakaPlusAnnual", saveKey: "planWakaPlusAnnualSave" },
];

function planLabelKey(plan: SubscriptionPlanCode): string {
  if (plan === "free") return "planFreeName";
  if (plan === "starter") return "planStarterName";
  if (plan === "business") return "planBusinessName";
  return "planWakaPlusName";
}

function planPriceKey(plan: SubscriptionPlanCode): string {
  if (plan === "free") return "planFreePrice";
  if (plan === "starter") return "planStarterPrice";
  if (plan === "business") return "planBusinessPrice";
  return "planWakaPlusPrice";
}

function isPaidPlan(plan: SubscriptionPlanCode): plan is PaidPlanCode {
  return plan !== "free";
}

function planTextKey(plan: SubscriptionPlanCode, suffix: "blurb" | "features" | "goodFor" | "note" | "cta"): string {
  const prefix = plan === "waka_plus" ? "wakaPlus" : plan;
  return `${prefix}_${suffix}`;
}

function usersHintForPlan(plan: SubscriptionPlanCode): number {
  if (plan === "free") return 1;
  if (plan === "starter") return 2;
  if (plan === "business") return 4;
  return 10;
}

export function UpgradePage({ lang }: { lang: Language }) {
  const { snapshot, authMode, loading, refetch } = useSubscription();
  const { pricing, loading: pricingLoading } = usePublicPricing();
  const current = resolveEffectivePlanTier(snapshot);
  const showFreePitch = shouldShowFreeUpgradePitch(snapshot);
  const renewalCountdown = getPaidPlanRenewalCountdown(snapshot);
  const [billingOffers, setBillingOffers] = useState<OrgBillingOfferRow[]>([]);

  useEffect(() => {
    if (authMode !== "supabase") return;
    const load = () => void fetchMyOrgBillingOffers().then(setBillingOffers);
    load();
    const on = () => {
      void refetch();
      load();
    };
    window.addEventListener("waka:subscription-updated", on);
    return () => window.removeEventListener("waka:subscription-updated", on);
  }, [authMode, refetch]);

  const whyRows: { q: string; plan: string }[] = [
    { q: t(lang, "upgradeWhyMoreProducts"), plan: t(lang, "upgradeWhyMoreProductsPlan") },
    { q: t(lang, "upgradeWhyBackup"), plan: t(lang, "upgradeWhyBackupPlan") },
    { q: t(lang, "upgradeWhyStaff"), plan: t(lang, "upgradeWhyStaffPlan") },
    { q: t(lang, "upgradeWhyDevices"), plan: t(lang, "upgradeWhyDevicesPlan") },
    { q: t(lang, "upgradeWhyPlus"), plan: t(lang, "upgradeWhyPlusPlan") },
  ];

  return (
    <EnterprisePageContainer className="space-y-6">
      <PageBackBar lang={lang} fallbackTo="/settings/account" label={t(lang, "accountSettingsTitle")} />
      <div className="rounded-[2rem] bg-gradient-to-br from-waka-600 to-waka-500 px-5 py-7 text-white shadow-sm sm:px-7">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-waka-100">{t(lang, "wakaSlogan")}</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">{t(lang, "upgradeTitle")}</h1>
        <p className="mt-2 max-w-2xl text-base font-medium leading-relaxed text-waka-50">{t(lang, "upgradeSub")}</p>
      </div>

      {authMode === "local" ? (
        <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-700">
          {t(lang, "upgradeLocalMode")}
        </p>
      ) : null}

      {!loading && authMode === "supabase" ? (
        <section className="rounded-3xl border border-waka-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wide text-waka-800">{t(lang, "upgradeCurrentLabel")}</p>
          <p className="mt-1 text-2xl font-black text-stone-900">{t(lang, planLabelKey(current))}</p>
          <p className="mt-2 text-sm font-semibold text-stone-600">{t(lang, "upgradeNoTrial")}</p>
          {renewalCountdown ? (
            <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-900">
              {renewalCountdown.plan === "waka_plus"
                ? t(lang, "officePremiumRenewalVip")
                    .replace("{{d}}", String(renewalCountdown.days))
                    .replace("{{h}}", String(renewalCountdown.hours))
                : renewalCountdown.plan === "starter"
                  ? t(lang, "officePremiumRenewalStarter").replace("{{d}}", String(renewalCountdown.days))
                  : t(lang, "officePremiumRenewalBusiness").replace("{{d}}", String(renewalCountdown.days))}
            </p>
          ) : null}
          <p className="mt-3 text-sm leading-relaxed text-stone-700">{t(lang, "upgradeTrustLine")}</p>
        </section>
      ) : null}

      {authMode === "supabase" && billingOffers.length > 0 ? (
        <section className="rounded-3xl border-2 border-waka-300 bg-waka-50/90 p-5 shadow-sm">
          <p className="text-sm font-black text-waka-950">{t(lang, "officeBillingOfferTitle")}</p>
          {billingOffers.map((o) => (
            <p key={o.id} className="mt-2 text-lg font-black text-waka-900">
              UGX {Number(o.amount_ugx).toLocaleString("en-UG")}{" "}
              <span className="text-xs font-semibold uppercase text-waka-800">({o.status})</span>
            </p>
          ))}
          <p className="mt-2 text-sm font-semibold text-waka-950">{t(lang, "officeBillingOfferBody")}</p>
          <Link to="/office" className="mt-4 inline-flex min-h-[44px] items-center rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white">
            {t(lang, "officeHubNav")} →
          </Link>
        </section>
      ) : null}

      {!loading && showFreePitch ? (
        <section className="rounded-3xl border border-stone-200 bg-stone-50 p-5 shadow-sm">
          <h2 className="text-lg font-black text-stone-900">{t(lang, "upgradeWhyTitle")}</h2>
          <ul className="mt-4 space-y-3">
            {whyRows.map((row) => (
              <li key={row.q} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold text-stone-700">{row.q}</span>
                <span className="font-black text-waka-800">→ {row.plan}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4">
        <p className="text-lg font-black text-stone-900">{t(lang, "upgradePickTitle")}</p>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLAN_ORDER.map((plan) => {
            const isCurrent = plan === current;
            const productLimit = maxProductsForTier(plan);
            const isPaid = plan !== "free";
            return (
              <li
                key={plan}
                className={`flex flex-col rounded-[1.75rem] border p-5 shadow-sm ${
                  isCurrent ? "border-waka-500 bg-waka-50/80" : "border-stone-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xl font-black text-stone-900">{t(lang, planLabelKey(plan))}</p>
                    {isPaid && !pricingLoading ? (
                      <div className="mt-1">
                        <PlanPriceDisplay price={pricingForPlan(pricing, plan)} interval="month" size="sm" />
                      </div>
                    ) : (
                      <p className="mt-1 text-2xl font-black text-waka-700">{t(lang, planPriceKey(plan))}</p>
                    )}
                    <p className="mt-2 text-sm font-semibold text-stone-600">{t(lang, planTextKey(plan, "blurb"))}</p>
                  </div>
                  {isCurrent ? (
                    <span className="rounded-full bg-waka-600 px-3 py-1 text-xs font-black text-white">
                      {t(lang, "upgradeCurrentBadge")}
                    </span>
                  ) : null}
                </div>
                <ul className="mt-4 space-y-2 text-sm font-semibold text-stone-700">
                  {t(lang, planTextKey(plan, "features"))
                    .split("|")
                    .map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="text-waka-600">✓</span>
                        <span>{line}</span>
                      </li>
                    ))}
                </ul>
                <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
                  <p className="font-black text-stone-900">{t(lang, "upgradeGoodForLabel")}</p>
                  <p className="mt-1 font-semibold">{t(lang, planTextKey(plan, "goodFor"))}</p>
                  <p className="mt-2 text-xs font-bold text-stone-500">{t(lang, planTextKey(plan, "note"))}</p>
                  {productLimit ? (
                    <p className="mt-1 text-xs font-bold text-stone-500">
                      {tTemplate(lang, "upgradeFreeProductLimit", { count: String(productLimit) })}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs font-bold text-stone-500">
                    {tTemplate(lang, "upgradePlanSimpleLimit", {
                      devices: String(maxDevicesHintForTier(plan)),
                      staff: String(maxStaffAccountsForTier(plan)),
                    })}
                  </p>
                  <p className="mt-1 text-xs font-bold text-stone-500">
                    {tTemplate(lang, "upgradePlanUsersLimit", { users: String(usersHintForPlan(plan)) })}
                  </p>
                </div>
                {isPaid && !isCurrent ? (
                  <Link
                    to="/pilot-support"
                    className="mt-4 flex min-h-[48px] items-center justify-center rounded-2xl bg-stone-950 px-4 py-3 text-sm font-black text-white"
                  >
                    {t(lang, planTextKey(plan, "cta"))}
                  </Link>
                ) : (
                  <div className="mt-4 min-h-[48px]" />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-3xl border-2 border-waka-200 bg-waka-50/90 p-5 shadow-sm">
        <h2 className="text-lg font-black text-waka-950">{t(lang, "upgradeYearlyTitle")}</h2>
        <p className="mt-2 text-sm font-semibold text-waka-900">{t(lang, "upgradeYearlySub")}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {PAID_ANNUAL.map(({ plan }) => {
            const price = isPaidPlan(plan) ? pricingForPlan(pricing, plan) : null;
            return (
            <li key={plan} className="rounded-2xl border border-waka-200 bg-white px-4 py-3">
              <p className="text-sm font-black text-stone-900">{t(lang, planLabelKey(plan))}</p>
              {price && !pricingLoading ? (
                <div className="mt-1">
                  <PlanPriceDisplay price={price} interval="year" size="sm" />
                </div>
              ) : (
                <>
                  <p className="mt-1 text-lg font-black text-waka-800">{t(lang, PAID_ANNUAL.find((p) => p.plan === plan)!.annualKey)}</p>
                  <p className="mt-1 text-xs font-bold text-emerald-800">{t(lang, PAID_ANNUAL.find((p) => p.plan === plan)!.saveKey)}</p>
                </>
              )}
            </li>
            );
          })}
        </ul>
        <Link
          to="/pilot-support"
          className="mt-4 inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-waka-600 px-5 py-3 text-sm font-black text-white"
        >
          {t(lang, "upgradePaySoon")} →
        </Link>
      </section>

      <p className="rounded-2xl bg-waka-50 px-4 py-3 text-sm font-semibold text-waka-950">{t(lang, "upgradePaymentPrep")}</p>

      <Link
        to="/pilot-support"
        className="inline-flex min-h-[48px] items-center rounded-2xl border-2 border-waka-200 bg-waka-50 px-4 py-3 text-base font-black text-waka-950 shadow-sm"
      >
        {t(lang, "supportNav")} →
      </Link>

      <Link to="/" className="inline-flex min-h-[48px] items-center font-bold text-waka-800 underline">
        ← {t(lang, "upgradeBack")}
      </Link>
    </EnterprisePageContainer>
  );
}
