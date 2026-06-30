import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSubscription } from "../../context/SubscriptionContext";
import {
  getPaidPlanRenewalCountdown,
  resolveEffectivePlanTier,
  type SubscriptionPlanCode,
  type SubscriptionSnapshot,
} from "../../lib/subscriptionEntitlements";

function formatRenewalLine(lang: Language, snapshot: SubscriptionSnapshot, nowMs: number): string | null {
  const r = getPaidPlanRenewalCountdown(snapshot, nowMs);
  if (!r) return null;
  if (r.totalMs <= 0) return t(lang, "officePremiumRenewalDue");
  if (r.plan === "waka_plus") {
    return t(lang, "officePremiumRenewalVip").replace("{{d}}", String(r.days)).replace("{{h}}", String(r.hours));
  }
  if (r.plan === "starter") {
    return t(lang, "officePremiumRenewalStarter").replace("{{d}}", String(r.days));
  }
  return t(lang, "officePremiumRenewalBusiness").replace("{{d}}", String(r.days));
}

function planName(lang: Language, plan: SubscriptionPlanCode): string {
  if (plan === "free") return t(lang, "planFreeName");
  if (plan === "starter") return t(lang, "planStarterName");
  if (plan === "business") return t(lang, "planBusinessName");
  if (plan === "waka_plus") return t(lang, "planWakaPlusName");
  return plan;
}

export function OfficePremiumSection({ lang }: { lang: Language }) {
  const { snapshot, authMode } = useSubscription();

  if (authMode !== "supabase") return null;

  const effectivePlan =
    snapshot.kind === "remote" ? resolveEffectivePlanTier(snapshot) : "free";
  const planLabel = planName(lang, effectivePlan);
  const renewalLine = formatRenewalLine(lang, snapshot, Date.now());
  const isFreeOnly = effectivePlan === "free";

  return (
    <section className="flex items-center justify-between gap-3 rounded-2xl border border-waka-200/80 bg-waka-50/90 px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-waka-500 text-white">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-waka-950">{planLabel}</p>
          <p className="truncate text-xs font-semibold text-waka-800/90">
            {renewalLine ?? (isFreeOnly ? t(lang, "officePremiumFreeModeHint") : t(lang, "officePremiumNoTrial"))}
          </p>
        </div>
      </div>
      <Link
        to="/upgrade"
        className="shrink-0 rounded-xl bg-waka-600 px-3 py-2 text-xs font-black text-white active:bg-waka-700"
      >
        {t(lang, "officePremiumUpgrade")}
      </Link>
    </section>
  );
}
