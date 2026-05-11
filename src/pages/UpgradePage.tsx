import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSubscription } from "../context/SubscriptionContext";
import {
  maxDevicesHintForTier,
  maxStaffAccountsForTier,
  resolveEffectivePlanTier,
  type SubscriptionPlanCode,
} from "../lib/subscriptionEntitlements";

const PLAN_ORDER: SubscriptionPlanCode[] = ["starter", "business", "waka_plus"];

function planLabelKey(plan: SubscriptionPlanCode): string {
  if (plan === "starter") return "planStarterName";
  if (plan === "business") return "planBusinessName";
  return "planWakaPlusName";
}

function planPriceKey(plan: SubscriptionPlanCode): string {
  if (plan === "starter") return "planStarterPrice";
  if (plan === "business") return "planBusinessPrice";
  return "planWakaPlusPrice";
}

export function UpgradePage({ lang }: { lang: Language }) {
  const { snapshot, authMode, daysLeftInTrial, loading } = useSubscription();
  const current = resolveEffectivePlanTier(snapshot);
  const inTrial = daysLeftInTrial !== null && daysLeftInTrial > 0;

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-3xl font-black text-slate-900">{t(lang, "upgradeTitle")}</h1>
        <p className="mt-2 text-lg text-slate-600">{t(lang, "upgradeSub")}</p>
      </div>

      {authMode === "local" ? (
        <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-700">
          {t(lang, "upgradeLocalMode")}
        </p>
      ) : null}

      {!loading && authMode === "supabase" ? (
        <section className="rounded-3xl border-2 border-waka-200 bg-gradient-to-br from-waka-50 to-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wide text-waka-800">{t(lang, "upgradeCurrentLabel")}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{t(lang, planLabelKey(current))}</p>
          {inTrial ? (
            <p className="mt-2 text-base font-bold text-waka-900">
              {tTemplate(lang, "upgradeTrialDays", { days: String(daysLeftInTrial) })}
            </p>
          ) : (
            <p className="mt-2 text-sm font-semibold text-slate-600">{t(lang, "upgradeNoTrial")}</p>
          )}
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{t(lang, "upgradeTrustLine")}</p>
        </section>
      ) : null}

      <section className="space-y-4">
        <p className="text-lg font-black text-slate-900">{t(lang, "upgradePickTitle")}</p>
        <ul className="space-y-4">
          {PLAN_ORDER.map((plan) => {
            const isCurrent = plan === current;
            return (
              <li
                key={plan}
                className={`rounded-3xl border-2 p-5 shadow-sm ${
                  isCurrent ? "border-waka-500 bg-waka-50/80" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xl font-black text-slate-900">{t(lang, planLabelKey(plan))}</p>
                    <p className="mt-1 text-2xl font-black text-waka-700">{t(lang, planPriceKey(plan))}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-600">
                      {plan === "starter"
                        ? t(lang, "starter_blurb")
                        : plan === "business"
                          ? t(lang, "business_blurb")
                          : t(lang, "waka_plus_blurb")}
                    </p>
                  </div>
                  {isCurrent ? (
                    <span className="rounded-full bg-waka-600 px-3 py-1 text-xs font-black text-white">
                      {t(lang, "upgradeCurrentBadge")}
                    </span>
                  ) : null}
                </div>
                <ul className="mt-3 space-y-1 text-sm font-medium text-slate-700">
                  {(plan === "starter"
                    ? t(lang, "starter_bullets")
                    : plan === "business"
                      ? t(lang, "business_bullets")
                      : t(lang, "waka_plus_bullets")
                  )
                    .split("|")
                    .map((line) => (
                      <li key={line}>· {line}</li>
                    ))}
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  {tTemplate(lang, "upgradeLimitsHint", {
                    staff: String(maxStaffAccountsForTier(plan)),
                    devices: String(maxDevicesHintForTier(plan)),
                  })}
                </p>
                {!isCurrent ? (
                  <button
                    type="button"
                    disabled
                    className="mt-4 w-full min-h-[48px] rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 py-3 text-sm font-bold text-slate-500"
                  >
                    {t(lang, "upgradePaySoon")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">{t(lang, "upgradePaymentPrep")}</p>

      <Link to="/" className="inline-flex min-h-[48px] items-center font-bold text-waka-800 underline">
        ← {t(lang, "upgradeBack")}
      </Link>
    </div>
  );
}
