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
import { PrinterPromotionPanel } from "../components/subscription/PrinterPromotionPanel";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { HorizontalTabBar } from "../components/shared/HorizontalTabBar";
import { enterpriseTypeClass } from "../lib/enterpriseTypography";
import type { CheckoutCycle } from "../lib/paymentCheckout";

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

/** Short highlight list — the scan-friendly subset of the full feature string. */
function planBulletsKey(plan: SubscriptionPlanCode): string {
  if (plan === "free") return "free_features";
  if (plan === "starter") return "starter_bullets";
  if (plan === "business") return "business_bullets";
  return "waka_plus_bullets";
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
  const [billingOffers, setBillingOffers] = useState<OrgBillingOfferRow[]>([]);
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlanCode | null>(null);
  const [checkoutCycle, setCheckoutCycle] = useState<CheckoutCycle>("monthly");
  const checkoutTriggerRef = useRef<HTMLElement | null>(null);
  // Monthly is the default scan path; yearly stays one tap away and is also
  // summarized in its own section below, where the free printer lives.
  const [billingView, setBillingView] = useState<"monthly" | "yearly">("monthly");
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>({});
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

  const whyRows: { q: string; plan: string }[] = [
    { q: t(lang, "upgradeWhyMoreProducts"), plan: t(lang, "upgradeWhyMoreProductsPlan") },
    { q: t(lang, "upgradeWhyBackup"), plan: t(lang, "upgradeWhyBackupPlan") },
    { q: t(lang, "upgradeWhyStaff"), plan: t(lang, "upgradeWhyStaffPlan") },
    { q: t(lang, "upgradeWhyDevices"), plan: t(lang, "upgradeWhyDevicesPlan") },
    { q: t(lang, "upgradeWhyPlus"), plan: t(lang, "upgradeWhyPlusPlan") },
  ];

  return (
    <EnterprisePageContainer className="space-y-4 sm:space-y-6">
      <PageBackBar lang={lang} fallbackTo="/settings/account" label={t(lang, "officeCardAccount")} />

      {/*
        Page header — same gradient family as the rest of the signed-in app, but
        tighter than the marketing hero so this still reads as a POS screen.
      */}
      <header className="rounded-[1.75rem] bg-gradient-to-br from-waka-600 to-waka-500 px-5 py-6 text-white shadow-sm sm:px-7">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-waka-100">{t(lang, "wakaSlogan")}</p>
        <h1 className={enterpriseTypeClass("display", "mt-2 text-white")}>{t(lang, "upgradeTitle")}</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-waka-50 sm:text-base">
          {t(lang, "upgradeSub")}
        </p>
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
          className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"
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
            <p className="mt-2 text-xs font-semibold text-muted-foreground">{t(lang, "upgradePromoGrantNote")}</p>
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
        <section className="rounded-2xl border border-border bg-muted p-4 shadow-sm sm:p-5">
          <h2 className={enterpriseTypeClass("sectionTitle")}>{t(lang, "upgradeWhyTitle")}</h2>
          <ul className="mt-3 space-y-2">
            {whyRows.map((row) => (
              <li key={row.q} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-muted-foreground">{row.q}</span>
                <span className="font-bold text-waka-800">→ {row.plan}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --- plans -------------------------------------------------------- */}
      <section aria-labelledby="upgrade-plans-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="upgrade-plans-heading" className={enterpriseTypeClass("sectionTitle")}>
              {t(lang, "upgradePickTitle")}
            </h2>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "upgradeCycleHint")}</p>
          </div>
          <HorizontalTabBar
            ariaLabel={t(lang, "upgradeCycleTabsLabel")}
            activeId={billingView}
            onChange={(id) => setBillingView(id === "yearly" ? "yearly" : "monthly")}
            tabs={[
              { id: "monthly", label: t(lang, "checkoutMonthly") },
              { id: "yearly", label: t(lang, "checkoutAnnual") },
            ]}
            className="max-w-full"
          />
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLAN_ORDER.map((plan) => {
            const isCurrent = plan === current;
            const isPaid = plan !== "free";
            const expanded = expandedPlans[plan] === true;
            const bulletSource = t(lang, planBulletsKey(plan));
            const fullFeatures = t(lang, planTextKey(plan, "features"));
            const bullets = bulletSource.split("|").filter(Boolean);
            const extraFeatures = fullFeatures
              .split("|")
              .filter((line) => line && !bullets.includes(line));
            const visibleBullets = expanded ? [...bullets, ...extraFeatures] : bullets.slice(0, 4);
            const hiddenCount = bullets.length + extraFeatures.length - visibleBullets.length;
            const showYearlyPrice = billingView === "yearly" && isPaid;
            return (
              <li
                key={plan}
                className={`flex flex-col rounded-2xl border p-4 shadow-sm sm:p-5 ${
                  isCurrent ? "border-waka-500 bg-waka-50/80" : "border-border bg-card"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-foreground">{t(lang, planLabelKey(plan))}</p>
                    {isPaid && !pricingLoading ? (
                      <div className="mt-1">
                        <PlanPriceDisplay
                          price={pricingForPlan(pricing, plan)}
                          interval={showYearlyPrice ? "year" : "month"}
                          size="sm"
                        />
                      </div>
                    ) : (
                      <p className="mt-1 text-xl font-bold text-waka-700">{t(lang, planPriceKey(plan))}</p>
                    )}
                    {isPaid && !pricingLoading && billingView === "monthly" ? (
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">
                        {tTemplate(lang, "upgradeOrYearly", {
                          price: pricingForPlan(pricing, plan).finalAnnualUgx.toLocaleString("en-UG"),
                        })}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, planTextKey(plan, "blurb"))}</p>
                  </div>
                  {isCurrent ? (
                    <span className="rounded-full bg-waka-600 px-3 py-1 text-xs font-bold text-white">
                      {t(lang, "upgradeCurrentBadge")}
                    </span>
                  ) : null}
                </div>

                {/*
                  Scan-first features: a short highlight list on the card, with the
                  full marketing list one disclosure away — never deleted, just
                  out of the first glance.
                */}
                <div className="mt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t(lang, "upgradeFeaturesLabel")}
                  </p>
                  <ul className="mt-1.5 space-y-1.5 text-sm font-medium text-muted-foreground">
                    {visibleBullets.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span aria-hidden className="text-waka-600">
                          ✓
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  {hiddenCount > 0 || expanded ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedPlans((prev) => ({ ...prev, [plan]: !expanded }))
                      }
                      className="mt-2 min-h-[44px] text-sm font-bold text-waka-700 underline underline-offset-2"
                    >
                      {expanded ? t(lang, "upgradeHideFeatures") : tTemplate(lang, "upgradeShowFeatures", { count: String(hiddenCount) })}
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">{t(lang, "upgradeGoodForLabel")}</p>
                  <p className="mt-0.5 font-medium">{t(lang, planTextKey(plan, "goodFor"))}</p>
                  {/* One limits line: `*_note` already carries devices, users and
                      the product cap. Repeating the same numbers here is the
                      wall-of-text this card is meant to avoid. */}
                  <p className="mt-1.5 font-semibold">{t(lang, planTextKey(plan, "note"))}</p>
                </div>

                {isPaid ? (
                  <WakaButton
                    type="button"
                    id={`plan-select-${plan}`}
                    onClick={(event) =>
                      openCheckout(plan, billingView === "yearly" ? "yearly" : "monthly", event.currentTarget)
                    }
                    className="mt-4 w-full min-h-[48px]"
                  >
                    {t(lang, isCurrent ? "checkoutRenew" : "checkoutSelect")}
                  </WakaButton>
                ) : (
                  <div className="mt-4 min-h-[48px]" />
                )}
              </li>
            );
          })}
        </ul>
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

      {/*
        YEARLY, WHERE THE FREE PRINTER LIVES. The yearly prices and the WP-58
        offer are one story: the printer is a benefit of Business billed yearly,
        so it sits on that option rather than in a detached promo card.
      */}
      <section
        aria-labelledby="upgrade-yearly-heading"
        className="overflow-hidden rounded-2xl border-2 border-waka-200 bg-waka-50/90 shadow-sm"
      >
        <div className="border-b border-waka-200/80 px-4 py-4 sm:px-5">
          <h2 id="upgrade-yearly-heading" className={enterpriseTypeClass("sectionTitle", "text-waka-950")}>
            {t(lang, "upgradeYearlyTitle")}
          </h2>
          <p className="mt-1 text-sm font-semibold text-waka-900">{t(lang, "upgradeYearlySub")}</p>
          {/* Plan-wide discount: the prices below already include it. An account's
              own discount is separate and private, so it is not described here. */}
          {pricing.globalDiscountActive ? (
            <p className="mt-2 text-sm font-bold text-waka-950">
              A discount is currently applied to these plan prices.
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-3">
          {PAID_ANNUAL.map(({ plan, annualKey, saveKey }) => {
            const price = isPaidPlan(plan) ? pricingForPlan(pricing, plan) : null;
            const isBusinessYearly = plan === "business";
            return (
              <div
                key={plan}
                className={`flex flex-col rounded-2xl border bg-card px-4 py-3 ${
                  isBusinessYearly ? "border-waka-400 shadow-sm" : "border-waka-200"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-foreground">{t(lang, planLabelKey(plan))}</p>
                  {isBusinessYearly ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-waka-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      {t(lang, "upgradePrinterBadge")}
                    </span>
                  ) : null}
                </div>
                {price && !pricingLoading ? (
                  <div className="mt-1">
                    <PlanPriceDisplay price={price} interval="year" size="sm" />
                  </div>
                ) : (
                  <>
                    <p className="mt-1 text-lg font-bold text-waka-800">{t(lang, annualKey)}</p>
                    <p className="mt-1 text-xs font-bold text-emerald-800">{t(lang, saveKey)}</p>
                  </>
                )}
                {isBusinessYearly ? (
                  <p className="mt-2 rounded-xl border border-waka-200 bg-waka-100/70 px-3 py-2 text-xs font-bold text-waka-950">
                    {t(lang, "upgradePrinterIncluded")}
                  </p>
                ) : null}
                <WakaButton
                  type="button"
                  onClick={(event) => openCheckout(plan, "yearly", event.currentTarget)}
                  className="mt-3 w-full min-h-[48px]"
                >
                  {t(lang, plan === current ? "checkoutRenew" : "checkoutSelect")}
                </WakaButton>
              </div>
            );
          })}
        </div>
        {/*
          Once for the card, not once per plan: the three yearly prices above are
          one offer described by one rule, and repeating the sentence under each
          figure would read as three separate caveats. It is not conditional on a
          discount being live — it states how the annual price is priced, so it
          has to be true and legible whether or not a promotion is running.
        */}
        <div className="px-4 pb-4 sm:px-5">
          <AnnualIntervalNote lang={lang} className="text-waka-900" />
        </div>
      </section>

      {/*
        THE FREE PRINTER OFFER BELONGS HERE, directly under the yearly prices —
        the reader has just seen the plan it comes with.

        THE SAME COMPONENT, NOT A SECOND ONE. It is the panel already mounted on
        the account page, so the two surfaces cannot drift apart, and all
        eligibility stays server-derived (`my_org_printer_status` →
        `_printer_promotion_eligible`). This page decides nothing.

        `shopId` and `authMode` come from the `useSubscription()` call above —
        the identical values, resolved the identical way, that
        `AccountSubscriptionCenter` uses. When there is no shop to ask about the
        line renders null, exactly as it does there.
      */}
      {shopId && authMode === "supabase" ? <PrinterPromotionPanel lang={lang} shopId={shopId} /> : null}

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
