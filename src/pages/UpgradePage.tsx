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
  type SubscriptionPlanCode,
} from "../lib/subscriptionEntitlements";
import { fetchMyOrgBillingOffers, type OrgBillingOfferRow } from "../lib/orgBillingOffers";
import { CheckoutFlow } from "../components/subscription/CheckoutFlow";
import { PrinterPromotionPanel } from "../components/subscription/PrinterPromotionPanel";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { HorizontalTabBar } from "../components/shared/HorizontalTabBar";
import { enterpriseTypeClass } from "../lib/enterpriseTypography";
import type { CheckoutCycle } from "../lib/paymentCheckout";
import { publicAssetUrl } from "../lib/publicAssetUrl";
import { formatUgx } from "../lib/subscriptionPricing";

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
  const effective = useMemo(() => resolveEffectiveSubscription(snapshot), [snapshot]);
  const isBusinessTrial = effective.isTrial && effective.planCode === "business";
  const trialDaysRemaining = effective.daysRemaining;
  const renewalCountdown = getPaidPlanRenewalCountdown(snapshot);
  const [billingOffers, setBillingOffers] = useState<OrgBillingOfferRow[]>([]);
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlanCode | null>(null);
  const [checkoutCycle, setCheckoutCycle] = useState<CheckoutCycle>("monthly");
  const checkoutTriggerRef = useRef<HTMLElement | null>(null);
  // YEARLY IS THE OFFER. It carries the printer, so it is what the page opens
  // on; monthly stays a tap away as the quieter alternative.
  const [billingView, setBillingView] = useState<"monthly" | "yearly">("yearly");
  // Shop pinned at checkout start; the server keeps the payment bound to it.
  const shopId = snapshot.kind === "remote" && snapshot.row.shop_id ? snapshot.row.shop_id : null;
  // Live prices from the same book checkout charges from. Never hardcoded.
  const businessPrice = pricingForPlan(pricing, "business");
  const businessMonthly = pricingLoading ? null : businessPrice;

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
      {/*
        ONE OFFER, STATED ONCE. The page used to open with a full-width gradient
        hero and then ask the reader to compare four plans — so the one thing
        this page exists to sell (Business yearly, with the printer) was the
        fourth thing they read. The heading now names the offer, and the card
        below it is the offer.
      */}
      <header>
        <h1 className={enterpriseTypeClass("display")}>{t(lang, "upgradeBusinessHeading")}</h1>
        <p className="mt-2 max-w-2xl text-base font-medium leading-relaxed text-muted-foreground">
          {t(lang, "upgradeBusinessSubtitle")}
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
          className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <p className="text-sm font-semibold text-muted-foreground">{t(lang, "upgradeCurrentLabel")}</p>
            <h2 id="upgrade-current-plan-heading" className="text-sm font-black text-foreground">
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

      {/* --- plans -------------------------------------------------------- */}
      {/*
        THE OFFER. Business billed yearly, priced from the live book, with the
        printer as PART of it rather than a detached promotion. Monthly is a
        real option and stays one tap away, but it is the quieter one because
        the printer offer is yearly-only - and that is stated plainly rather
        than left to be inferred from two competing cards.
      */}
      <section
        aria-labelledby="upgrade-business-heading"
        className="rounded-[1.75rem] border-2 border-waka-300 bg-card p-4 shadow-sm sm:p-6"
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-waka-100 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-waka-900">
                {t(lang, "upgradeBusinessYearlyBadge")}
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-amber-900">
                {t(lang, "upgradePrinterBadge")}
              </span>
            </div>

            <h2 id="upgrade-business-heading" className={enterpriseTypeClass("pageTitle", "mt-3")}>
              {t(lang, "upgradeBusinessCardTitle")}
            </h2>
            <p className="mt-2 text-sm font-medium leading-relaxed text-muted-foreground">
              {t(lang, "upgradeBusinessCardBody")}
            </p>

            <div className="mt-5 min-h-[72px]">
              {businessPrice && !pricingLoading ? (
                <PlanPriceDisplay
                  price={businessPrice}
                  interval={billingView === "yearly" ? "year" : "month"}
                  lang={lang}
                />
              ) : (
                <p className="text-2xl font-black text-muted-foreground">
                  {pricingLoading ? t(lang, "billingLoading") : t(lang, "upgradePriceUnavailable")}
                </p>
              )}
            </div>

            <HorizontalTabBar
              ariaLabel={t(lang, "upgradeCycleTabsLabel")}
              activeId={billingView}
              onChange={(id) => setBillingView(id === "yearly" ? "yearly" : "monthly")}
              tabs={[
                { id: "yearly", label: t(lang, "checkoutAnnual") },
                { id: "monthly", label: t(lang, "checkoutMonthly") },
              ]}
              className="mt-3 max-w-full"
            />
            {billingView === "monthly" ? (
              <p className="mt-2 text-xs font-semibold text-amber-900">{t(lang, "upgradeMonthlyNoPrinter")}</p>
            ) : null}

            <WakaButton
              type="button"
              onClick={(event) =>
                openCheckout("business", billingView === "yearly" ? "yearly" : "monthly", event.currentTarget)
              }
              className="mt-4 w-full min-h-[52px]"
            >
              {billingView === "yearly" ? t(lang, "upgradeChooseYearly") : t(lang, "upgradeChooseMonthly")}
            </WakaButton>
            <p className="mt-2 text-xs font-semibold leading-relaxed text-muted-foreground">
              {t(lang, "upgradeYearlyRequirement")}
            </p>
            <AnnualIntervalNote lang={lang} className="mt-3 text-muted-foreground" />
          </div>

          <div>
            <img
              src={publicAssetUrl("brand/waka-printer/wp58-hero.webp")}
              alt={t(lang, "upgradePrinterImageAlt")}
              loading="lazy"
              className="w-full rounded-2xl border border-border bg-black object-cover"
            />
            <p className="mt-3 text-base font-black text-foreground">{t(lang, "upgradeMeetPrinter")}</p>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">{t(lang, "upgradePrinterSpecs")}</p>
          </div>
        </div>
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
      {/*
        THE JOURNEY, ON THE PAGE. "How do I actually get it?" used to leave
        /upgrade entirely. These four steps are the real sequence the server
        enforces, and the link at the end scrolls to the live panel below rather
        than to another page. Nothing here promises a printer: step 3 says the
        options APPEAR when eligible and step 4 says the team RECORDS the
        handover - statements of process, not of outcome.
      */}
      <section
        aria-labelledby="upgrade-printer-journey-heading"
        className="rounded-[1.75rem] border border-border bg-card p-4 shadow-sm sm:p-6"
      >
        <h2 id="upgrade-printer-journey-heading" className={enterpriseTypeClass("sectionTitle")}>
          {t(lang, "upgradeJourneyTitle")}
        </h2>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "upgradeJourneySub")}</p>

        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(["1", "2", "3", "4"] as const).map((n) => (
            <li key={n}>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-waka-100 text-xs font-black text-waka-900">
                {`0${n}`}
              </span>
              <p className="mt-2 text-sm font-black text-foreground">
                {t(lang, `upgradeStep${n}Title` as "upgradeStep1Title")}
              </p>
              <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">
                {t(lang, `upgradeStep${n}Body` as "upgradeStep1Body")}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-4 py-3">
          <div>
            <p className="text-sm font-black text-emerald-900">{t(lang, "upgradePrinterStatusTitle")}</p>
            <p className="mt-0.5 text-xs font-medium text-emerald-800">{t(lang, "upgradePrinterStatusBody")}</p>
          </div>
          <a
            href="#printer-status"
            className="inline-flex min-h-[44px] items-center text-sm font-black text-emerald-900 underline underline-offset-2"
          >
            {t(lang, "upgradeCheckStatus")}
          </a>
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
      {/*
        THE LIVE PANEL, ANCHORED. Same component as the account page, not a
        copy, so the two cannot drift; all eligibility stays server-derived
        (`my_org_printer_status` -> `_printer_promotion_eligible`). This page
        decides nothing.

        `onUpgradePage` drops the panel's outbound links — the offer, the
        in-app upgrade and the setup/pickup steps are all carried by this page
        already, so leaving them would be a detour back to where the reader
        started.
      */}
      <div id="printer-status" className="scroll-mt-24">
        {shopId && authMode === "supabase" ? (
          <PrinterPromotionPanel lang={lang} shopId={shopId} onUpgradePage />
        ) : null}
      </div>

      {/*
        MONTHLY IS STATED, NOT SOLD. A real option, with the single thing that
        changes named outright, and no second card competing with the offer.
      */}
      <section className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        <p className="text-sm font-black text-foreground">{t(lang, "upgradePreferMonthlyTitle")}</p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          {businessMonthly && !pricingLoading
            ? tTemplate(lang, "upgradePreferMonthlyBody", { price: formatUgx(businessMonthly.finalMonthlyUgx) })
            : t(lang, "upgradePrinterYearlyOnly")}
        </p>
      </section>

      {/*
        PLUS IS DEFERRED, NOT HIDDEN. A shop weighing branches is not shopping
        for a receipt printer, so a collapsed disclosure keeps the plan findable
        without putting a second comparison in front of everyone else. Its
        availability and price are untouched; the link goes to the pricing page
        that already lists every plan.
      */}
      <details className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-black text-foreground">
          {t(lang, "upgradePlusDisclosure")}
        </summary>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "upgradePlusBody")}</p>
        <p className="mt-2 text-sm font-semibold">
          <Link to="/pricing" className="text-waka-700 underline underline-offset-2">
            {t(lang, "upgradePlusCta")}
          </Link>
        </p>
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
