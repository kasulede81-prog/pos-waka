import { Link } from "react-router-dom";
import { Clock, Headphones, Sparkles } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSubscription } from "../../context/SubscriptionContext";
import {
  getPaidPlanRenewalCountdown,
  resolveEffectivePlanTier,
  type SubscriptionSnapshot,
} from "../../lib/subscriptionEntitlements";

function formatRenewalLine(lang: Language, snapshot: SubscriptionSnapshot, nowMs: number): string | null {
  const r = getPaidPlanRenewalCountdown(snapshot, nowMs);
  if (!r) return null;
  if (r.totalMs <= 0) return t(lang, "officePremiumRenewalDue");
  if (r.plan === "waka_plus") {
    return t(lang, "officePremiumRenewalVip").replace("{{d}}", String(r.days)).replace("{{h}}", String(r.hours));
  }
  return t(lang, "officePremiumRenewalBusiness").replace("{{d}}", String(r.days)).replace("{{h}}", String(r.hours));
}

function planName(lang: Language, plan: string): string {
  if (plan === "free") return t(lang, "planFreeName");
  if (plan === "starter") return t(lang, "planStarterName");
  if (plan === "business") return t(lang, "planBusinessName");
  if (plan === "waka_plus") return t(lang, "planWakaPlusName");
  return plan;
}

export function OfficePremiumSection({ lang }: { lang: Language }) {
  const { snapshot, authMode } = useSubscription();

  const plan = authMode === "supabase" && snapshot.kind === "remote" ? resolveEffectivePlanTier(snapshot) : "starter";
  const planLabel = planName(lang, plan);
  const renewalLine = authMode === "supabase" ? formatRenewalLine(lang, snapshot, Date.now()) : null;

  if (authMode !== "supabase") return null;

  return (
    <section className="rounded-3xl border border-orange-200 bg-gradient-to-br from-orange-500 to-waka-700 p-5 text-white shadow-waka-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-100">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            {t(lang, "officePremiumPlanLabel")}
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">{planLabel}</h2>
          {renewalLine ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-orange-50">
              <Clock className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
              {renewalLine}
            </p>
          ) : (
            <p className="mt-2 text-sm font-bold text-orange-50">{t(lang, "officePremiumFreeModeHint")}</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          to="/upgrade"
          className="inline-flex min-h-[46px] items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-black text-orange-700 shadow-sm active:scale-[0.99]"
        >
          {t(lang, "officePremiumUpgrade")}
        </Link>
        <Link
          to="/support"
          className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-2xl border border-white/50 bg-black/15 px-4 py-3 text-sm font-black text-white"
        >
          <Headphones className="h-4 w-4" />
          {t(lang, "officePremiumSupportChat")}
        </Link>
      </div>
    </section>
  );
}
