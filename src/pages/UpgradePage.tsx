import { Link } from "react-router-dom";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageBackBar } from "../components/layout/PageBackBar";
import { resolveEffectiveSubscription } from "../lib/effectiveSubscription";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSubscription } from "../context/SubscriptionContext";
import { usePublicPricing } from "../hooks/usePublicPricing";
import { AnnualIntervalNote } from "../components/pricing/AnnualIntervalNote";
import { PlanPriceDisplay } from "../components/pricing/PlanPriceDisplay";
import { pricingForPlan, type PaidPlanCode } from "../lib/subscriptionPricing";
import {
  getPaidPlanRenewalCountdown,
  resolveEffectivePlanTier,
  shouldShowFreeUpgradePitch,
  type SubscriptionPlanCode,
} from "../lib/subscriptionEntitlements";
import { fetchMyOrgBillingOffers, type OrgBillingOfferRow } from "../lib/orgBillingOffers";
import { CheckoutFlow } from "../components/subscription/CheckoutFlow";
import { publicAssetUrl } from "../lib/publicAssetUrl";
import { PrinterPromotionPanel } from "../components/subscription/PrinterPromotionPanel";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { HorizontalTabBar } from "../components/shared/HorizontalTabBar";
import { enterpriseTypeClass } from "../lib/enterpriseTypography";
import type { CheckoutCycle } from "../lib/paymentCheckout";

function planLabelKey(plan: SubscriptionPlanCode): string {
  if (plan === "free") return "planFreeName";
  if (plan === "starter") return "planStarterName";
  if (plan === "business") return "planBusinessName";
  return "planWakaPlusName";
}

function isPaidPlan(plan: SubscriptionPlanCode): plan is PaidPlanCode {
  return plan !== "free";
}

export function UpgradePage({ lang }: { lang: Language }) {
  const { snapshot, authMode, loading, refetch } = useSubscription();
  const { pricing, loading: pricingLoading } = usePublicPricing();
  const current = resolveEffectivePlanTier(snapshot);
  const showFreePitch = shouldShowFreeUpgradePitch(snapshot);
  const effective = useMemo(() => resolveEffectiveSubscription(snapshot), [snapshot]);
  const isBusinessTrial = effective.isTrial && effective.planCode === "business";
  const trialDaysRemaining = effective.daysRemaining;
  const renewalCountdown = getPaidPlanRenewalCountdown(snapshot);
  /**
   * Remaining access for a subscription that is cancelled or paused but still inside its
   * paid-through period.
   *
   * `getPaidPlanRenewalCountdown` returns null unless status is exactly "active", so a
   * cancelled subscription with time left showed nothing at all here — even though the
   * resolver deliberately preserves that period (`expiresAt` falls back to
   * `current_period_end` for cancelled/paused) and already computes `daysRemaining` from it.
   * Reusing the resolver rather than re-deriving keeps the day count consistent with the
   * account page.
   *
   * DELIBERATELY SEPARATE FROM `renewalCountdown`, which also feeds `hasFuturePeriodEnd`
   * below. That flag is handed to CheckoutFlow, so widening it would change checkout
   * eligibility — out of scope. This is display only and must never be folded into it.
   */
  const lapsedAccessDays =
    !renewalCountdown &&
    (effective.status === "cancelled" || effective.status === "paused") &&
    !effective.isExpired &&
    effective.daysRemaining != null
      ? effective.daysRemaining
      : null;
  const [billingOffers, setBillingOffers] = useState<OrgBillingOfferRow[]>([]);
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlanCode | null>(null);
  const [checkoutCycle, setCheckoutCycle] = useState<CheckoutCycle>("monthly");
  const checkoutTriggerRef = useRef<HTMLElement | null>(null);
  const [billingView, setBillingView] = useState<"monthly" | "yearly">("yearly");
  // Shop pinned at checkout start; the server keeps the payment bound to it.
  const shopId = snapshot.kind === "remote" && snapshot.row.shop_id ? snapshot.row.shop_id : null;

  const openCheckout = useCallback(
    (nextPlan: SubscriptionPlanCode, cycle: CheckoutCycle, trigger?: HTMLElement | null) => {
      if (!isPaidPlan(nextPlan)) return; // Free is never a payment option
      checkoutTriggerRef.current = trigger ?? null;
      setCheckoutCycle(cycle);
      setCheckoutPlan(nextPlan);
    },
    [setCheckoutCycle, setCheckoutPlan],
  );

  const closeCheckout = useCallback(() => {
    setCheckoutPlan(null);
    const trigger = checkoutTriggerRef.current;
    checkoutTriggerRef.current = null;
    if (trigger && typeof trigger.focus === "function") trigger.focus();
  }, [setCheckoutPlan]);

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

  return (
    <EnterprisePageContainer className="space-y-4 sm:space-y-6">
      <PageBackBar lang={lang} fallbackTo="/settings/account" label={t(lang, "officeCardAccount")} />

      {/*
        Page header — same gradient family as the rest of the signed-in app, but
        tighter than the marketing hero so this still reads as a POS screen.
      */}
      <header className="max-w-4xl px-1 py-1 sm:py-2">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-waka-700">{t(lang, "upgradePickTitle")}</p>
        <h1 className={enterpriseTypeClass("display", "mt-2")}>{t(lang, "upgradeBusinessHeading")}</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">One plan, one clear price, and a WP-58 receipt printer included when you choose Business yearly.</p>
      </header>

      {authMode === "local" ? (
        <p className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
          {t(lang, "upgradeLocalMode")}
        </p>
      ) : null}

      {/* --- current plan strip ------------------------------------------- */}
      {!loading && authMode === "supabase" ? (
        <section
          aria-labelledby="upgrade-current-plan-heading"
          className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4"
        >
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "upgradeCurrentLabel")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 id="upgrade-current-plan-heading" className={enterpriseTypeClass("pageTitle")}>
              {isBusinessTrial ? t(lang, "officePremiumBusinessTrialPlan") : t(lang, planLabelKey(current))}
            </h2>
            {effective.promotionalGrant ? (
              <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-bold text-violet-900">
                {t(lang, "upgradePromoGrantBadge")}
              </span>
            ) : null}
          </div>
          {isBusinessTrial ? (
            <>
              <p className="mt-2 text-sm font-semibold text-emerald-800">{t(lang, "upgradeTrialBusinessActive")}</p>
              {trialDaysRemaining != null && trialDaysRemaining > 0 ? (
                <p className="mt-1 text-sm font-semibold text-muted-foreground">
                  {tTemplate(lang, "upgradeTrialBusinessEnds", { d: trialDaysRemaining })}
                </p>
              ) : null}
            </>
          ) : current === "free" ? (
            <p className="mt-2 text-sm font-semibold text-muted-foreground">{t(lang, "upgradeNoTrial")}</p>
          ) : null}
          {/*
            Factual only: names a live promotional grant when one exists. It does
            not decide or explain printer eligibility — that verdict stays with
            the server. Shown so a grant-backed plan name cannot look identical
            to a purchased one when the two disagree.
          */}
          {effective.promotionalGrant ? (
            <p className="mt-2 rounded-xl bg-violet-50 px-3 py-2 text-xs font-semibold leading-5 text-violet-950">
              {t(lang, "upgradePromoGrantNote")}
              <br />
              {t(lang, "upgradePromoGrantPrinterNote")}
            </p>
          ) : null}
          {renewalCountdown ? (
            <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
              {renewalCountdown.plan === "waka_plus"
                ? t(lang, "officePremiumRenewalVip")
                    .replace("{{d}}", String(renewalCountdown.days))
                    .replace("{{h}}", String(renewalCountdown.hours))
                : renewalCountdown.plan === "starter"
                  ? t(lang, "officePremiumRenewalStarter").replace("{{d}}", String(renewalCountdown.days))
                  : t(lang, "officePremiumRenewalBusiness").replace("{{d}}", String(renewalCountdown.days))}
            </p>
          ) : null}
          {lapsedAccessDays != null ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
              {t(lang, "upgradeLapsedAccessRemaining").replace("{{d}}", String(lapsedAccessDays))}
            </p>
          ) : null}
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t(lang, "upgradeTrustLine")}</p>
        </section>
      ) : null}

      {authMode === "supabase" && billingOffers.length > 0 ? (
        <section className="rounded-2xl border-2 border-waka-300 bg-waka-50/90 p-4 shadow-sm sm:p-5">
          <p className="text-sm font-bold text-waka-950">{t(lang, "officeBillingOfferTitle")}</p>
          {billingOffers.map((o) => (
            <p key={o.id} className="mt-2 text-lg font-bold text-waka-900">
              UGX {Number(o.amount_ugx).toLocaleString("en-UG")}{" "}
              <span className="text-xs font-semibold uppercase text-waka-800">({o.status})</span>
            </p>
          ))}
          <p className="mt-2 text-sm font-semibold text-waka-950">{t(lang, "officeBillingOfferBody")}</p>
          <Link
            to="/office"
            className="mt-4 inline-flex min-h-[44px] items-center rounded-2xl bg-waka-600 px-4 py-2 text-sm font-bold text-white"
          >
            {t(lang, "officeHubNav")} →
          </Link>
        </section>
      ) : null}

      {!loading && showFreePitch ? (
        <p className="rounded-xl border border-border bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
          {t(lang, "upgradeWhyTitle")} — {t(lang, "upgradeWhyMoreProducts")} {t(lang, "upgradeWhyMoreProductsPlan")}; {t(lang, "upgradeWhyBackup")} {t(lang, "upgradeWhyBackupPlan")}.
        </p>
      ) : null}

      <section aria-labelledby="upgrade-plans-heading" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-waka-600">{t(lang, "upgradePickTitle")}</p>
            <h2 id="upgrade-plans-heading" className={enterpriseTypeClass("sectionTitle", "mt-1")}>{t(lang, "upgradeBusinessSectionTitle")}</h2>
          </div>
          <HorizontalTabBar
            ariaLabel={t(lang, "upgradeCycleTabsLabel")}
            activeId={billingView}
            onChange={(id) => setBillingView(id === "yearly" ? "yearly" : "monthly")}
            tabs={[{ id: "monthly", label: t(lang, "checkoutMonthly") }, { id: "yearly", label: t(lang, "checkoutAnnual") }]}
            className="w-full sm:w-auto"
          />
        </div>

        {billingView === "yearly" ? (
          <article className="overflow-hidden rounded-[1.5rem] border border-waka-500 bg-card shadow-lg shadow-waka-950/10">
            <div className="grid lg:grid-cols-[1.3fr_0.7fr]">
              <div className="p-5 sm:p-7">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-waka-600 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white">{t(lang, "upgradeBusinessYearlyBadge")}</span>
                  <a href="#printer-steps" className="rounded-full bg-waka-100 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-waka-900 underline-offset-2 hover:underline">{t(lang, "upgradePrinterBadge")}</a>
                </div>
                <h3 className="mt-5 max-w-xl text-3xl font-black tracking-tight text-foreground sm:text-4xl">{t(lang, "upgradeBusinessCardTitle")}</h3>
                <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">{t(lang, "business_blurb")}</p>
                <div className="mt-5 flex flex-wrap items-end gap-2">
                  {!pricingLoading ? <PlanPriceDisplay price={pricingForPlan(pricing, "business")} interval="year" size="lg" /> : <span className="text-3xl font-black">Business yearly</span>}
                  <span className="mb-1 rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">Save 20%</span>
                </div>
                <div className="mt-5 flex items-start gap-3 rounded-2xl bg-waka-950 px-4 py-4 text-waka-50">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-waka-600 text-lg font-black">P</span>
                  <div><p className="font-black">{t(lang, "upgradePrinterIncluded")}</p><p className="mt-1 text-sm text-waka-100">{t(lang, "upgradePrinterStepsNote")}</p></div>
                </div>
                <WakaButton type="button" id="plan-select-business-yearly" onClick={(event) => openCheckout("business", "yearly", event.currentTarget)} className="mt-5 min-h-[52px] w-full text-base">{t(lang, "upgradeChooseYearly")}</WakaButton>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{t(lang, "upgradeYearlyRequirement")}</p>
                  <AnnualIntervalNote lang={lang} className="mt-3 text-muted-foreground" />
              </div>
              <aside className="overflow-hidden border-t border-border bg-[#1d1a19] text-white lg:border-l lg:border-t-0">
                <img
                  src={publicAssetUrl("brand/waka-printer/wp58-hero.webp")}
                  alt={t(lang, "upgradePrinterImageAlt")} className="h-56 w-full object-cover sm:h-72 lg:h-64" />
                <div className="p-5 sm:p-7"><p className="font-black">{t(lang, "upgradeMeetPrinter")}</p><p className="mt-2 text-sm leading-6 text-white/75">{t(lang, "upgradePrinterSpecs")}</p></div>
              </aside>
            </div>
          </article>
        ) : (
          <article className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><span className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">{t(lang, "upgradeBusinessMonthlyBadge")}</span><h3 className="mt-2 text-2xl font-black">{t(lang, "upgradeMonthlyCardTitle")}</h3><p className="mt-2 text-sm text-muted-foreground">{t(lang, "upgradeMonthlyNoPrinter")}</p><div className="mt-4">{!pricingLoading ? <PlanPriceDisplay price={pricingForPlan(pricing, "business")} interval="month" size="lg" /> : null}</div></div><WakaButton type="button" id="plan-select-business-monthly" variant="secondary" onClick={(event) => openCheckout("business", "monthly", event.currentTarget)} className="min-h-[50px] shrink-0">{t(lang, "upgradeChooseMonthly")}</WakaButton></div>
          </article>
        )}
      </section>

      <section id="printer-steps" aria-labelledby="printer-steps-heading" className="scroll-mt-4 rounded-[1.5rem] border border-border bg-card p-5 pb-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+4rem)] sm:p-7 sm:pb-7">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><h2 id="printer-steps-heading" className={enterpriseTypeClass("sectionTitle")}>{t(lang, "upgradeJourneyTitle")}</h2><span className="text-sm text-muted-foreground">{t(lang, "upgradeJourneySub")}</span></div>
        <ol className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {["Choose Business yearly", "Activate your paid subscription", "Check eligibility and request collection", "Collect and confirm handover"].map((step, index) => (
            <li key={step} className="border-t border-waka-100 pt-4"><span className="grid size-8 place-items-center rounded-full bg-waka-100 text-xs font-black text-waka-800">0{index + 1}</span><p className="mt-3 font-black text-foreground">{step}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{index === 2 ? "Use the available collection method shown for your account." : index === 3 ? "The team records the printer handover against your account." : "The next step stays connected to your subscription."}</p></li>
          ))}
        </ol>
        {shopId && authMode === "supabase" ? <div className="mt-6"><PrinterPromotionPanel lang={lang} shopId={shopId} onUpgradePage /></div> : null}
      </section>

      {checkoutPlan && isPaidPlan(checkoutPlan) ? (
        <CheckoutFlow
          lang={lang}
          shopId={shopId}
          plan={checkoutPlan}
          setPlan={(nextPlan) => setCheckoutPlan(nextPlan)}
          initialCycle={checkoutCycle}
          currentPlanCode={current}
          effectiveStatus={effective.status}
          hasFuturePeriodEnd={Boolean(renewalCountdown)}
          onClose={closeCheckout}
        />
      ) : null}

      <details className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <summary className="cursor-pointer list-none font-black text-foreground">{t(lang, "upgradePlusDisclosure")}</summary>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t(lang, "upgradePlusBody")}</p>
        <WakaButton type="button" variant="secondary" onClick={(event) => openCheckout("waka_plus", billingView === "yearly" ? "yearly" : "monthly", event.currentTarget)} className="mt-4 min-h-[46px]">{t(lang, "upgradePlusCta")}</WakaButton>
      </details>


      <Link
        to="/pilot-support"
        className="inline-flex min-h-[48px] items-center rounded-2xl border-2 border-waka-200 bg-waka-50 px-4 py-3 text-base font-bold text-waka-950 shadow-sm"
      >
        {t(lang, "supportNav")} →
      </Link>

      <Link to="/" className="inline-flex min-h-[48px] items-center font-bold text-waka-800 underline">
        ← {t(lang, "upgradeBack")}
      </Link>
    </EnterprisePageContainer>
  );
}
