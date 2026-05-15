import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Clock, Headphones, Sparkles } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSubscription } from "../../context/SubscriptionContext";
import { useAuth } from "../../hooks/useAuth";
import {
  getPaidPlanRenewalCountdown,
  normalizePlanCode,
  resolveEffectivePlanTier,
  shouldHideStarterTrialRequestCta,
  trialDaysRemaining,
  type SubscriptionSnapshot,
} from "../../lib/subscriptionEntitlements";
import { fetchStarterTrialRequestGateForUser, requestAnnualPlanSupport, requestSubscriptionPlanChange } from "../../lib/shopRequests";
import { fetchMyOrgBillingOffers, ownerClaimOrgBillingOfferPaid, type OrgBillingOfferRow } from "../../lib/orgBillingOffers";

const MS_HOUR = 3600000;
const MS_MIN = 60000;
const PENDING_SLA_MS = 14 * 86400000;

function formatTrialStatusLine(lang: Language, snapshot: SubscriptionSnapshot, nowMs: number): string {
  const days = trialDaysRemaining(snapshot, nowMs);
  if (days == null) return t(lang, "officePremiumNoTrial");
  if (snapshot.kind !== "remote" || !snapshot.row.trial_ends_at) return t(lang, "officePremiumNoTrial");
  const end = new Date(snapshot.row.trial_ends_at).getTime();
  const ms = end - nowMs;
  if (ms <= 0) return t(lang, "officePremiumTrialEnded");
  if (ms < 48 * MS_HOUR) {
    const h = Math.floor(ms / MS_HOUR);
    const m = Math.floor((ms % MS_HOUR) / MS_MIN);
    return t(lang, "officePremiumTrialHmLeft").replace("{{h}}", String(h)).replace("{{m}}", String(m));
  }
  return t(lang, "officePremiumTrialDays").replace("{{n}}", String(days));
}

function formatRenewalLine(lang: Language, snapshot: SubscriptionSnapshot, nowMs: number): string | null {
  const r = getPaidPlanRenewalCountdown(snapshot, nowMs);
  if (!r) return null;
  if (r.totalMs <= 0) return t(lang, "officePremiumRenewalDue");
  if (r.plan === "waka_plus") {
    return t(lang, "officePremiumRenewalVip").replace("{{d}}", String(r.days)).replace("{{h}}", String(r.hours));
  }
  return t(lang, "officePremiumRenewalBusiness").replace("{{d}}", String(r.days)).replace("{{h}}", String(r.hours));
}

export function OfficePremiumSection({ lang }: { lang: Language }) {
  const { user } = useAuth();
  const { snapshot, authMode, refetch } = useSubscription();
  const [billingOffers, setBillingOffers] = useState<OrgBillingOfferRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [starterGate, setStarterGate] = useState<{
    starterRequestConsumed: boolean;
    pendingStarterRequestCreatedAt: string | null;
  }>({ starterRequestConsumed: false, pendingStarterRequestCreatedAt: null });

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (authMode !== "supabase" || !user?.id) return;
    void fetchStarterTrialRequestGateForUser(user.id).then(setStarterGate);
  }, [authMode, user?.id, snapshot]);

  useEffect(() => {
    if (authMode !== "supabase") return;
    const refresh = () => {
      void refetch();
      void fetchMyOrgBillingOffers().then(setBillingOffers);
      if (user?.id) void fetchStarterTrialRequestGateForUser(user.id).then(setStarterGate);
    };
    const id = window.setInterval(refresh, 20_000);
    const onSub = () => {
      void refetch();
      void fetchMyOrgBillingOffers().then(setBillingOffers);
      if (user?.id) void fetchStarterTrialRequestGateForUser(user.id).then(setStarterGate);
    };
    window.addEventListener("waka:subscription-updated", onSub);
    void fetchMyOrgBillingOffers().then(setBillingOffers);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("waka:subscription-updated", onSub);
    };
  }, [authMode, refetch, user?.id]);

  const plan = authMode === "supabase" && snapshot.kind === "remote" ? resolveEffectivePlanTier(snapshot) : "starter";
  const cloudSubLabel =
    authMode === "supabase" && snapshot.kind === "remote" ? `${snapshot.row.status} · ${snapshot.row.plan_code}` : null;

  const hideStarterTrialCta =
    authMode !== "supabase" ||
    shouldHideStarterTrialRequestCta({
      snapshot,
      nowMs,
      starterRequestConsumed: starterGate.starterRequestConsumed,
      pendingStarterRequestCreatedAt: starterGate.pendingStarterRequestCreatedAt,
    });

  const renewalLine = authMode === "supabase" ? formatRenewalLine(lang, snapshot, nowMs) : null;
  const trialLine = authMode === "supabase" ? formatTrialStatusLine(lang, snapshot, nowMs) : t(lang, "officePremiumNoTrial");

  const pendingCreated = starterGate.pendingStarterRequestCreatedAt;
  const pendingSlaDaysLeft =
    pendingCreated != null ? Math.max(0, Math.ceil((new Date(pendingCreated).getTime() + PENDING_SLA_MS - nowMs) / 86400000)) : null;

  const run = async (key: string, fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setMsg(null);
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setMsg(r.message ?? t(lang, "officePremiumRequestFail"));
    else setMsg(t(lang, "officePremiumRequestOk"));
    void refetch();
    setBillingOffers(await fetchMyOrgBillingOffers());
    if (user?.id) setStarterGate(await fetchStarterTrialRequestGateForUser(user.id));
    window.dispatchEvent(new Event("waka:subscription-updated"));
  };

  if (authMode !== "supabase") return null;

  return (
    <section className="rounded-3xl border-2 border-orange-300 bg-gradient-to-br from-orange-500 via-orange-500 to-amber-600 text-white shadow-[0_16px_50px_rgba(234,88,12,0.35)]">
      <details className="group/premium px-5 pb-5 pt-5 sm:px-7 sm:pb-7 sm:pt-7">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 marker:content-none [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-100">
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
              {t(lang, "officePremiumBadge")}
            </p>
            <h2 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">{t(lang, "officePremiumTitle")}</h2>
            <p className="mt-1.5 text-sm font-semibold leading-snug text-orange-50/95">{t(lang, "officePremiumPanelHint")}</p>
          </div>
          <ChevronDown
            className="mt-1 h-6 w-6 shrink-0 text-orange-100 transition-transform duration-200 group-open/premium:rotate-180"
            strokeWidth={2.5}
            aria-hidden
          />
        </summary>

        <div className="mt-5 space-y-4 border-t border-white/25 pt-5">
          <p className="text-sm font-semibold leading-relaxed text-orange-50">{t(lang, "officePremiumSub")}</p>
          <div className="flex flex-wrap justify-end">
            <Link
              to="/upgrade"
              className="min-h-[48px] rounded-2xl bg-white px-5 py-3 text-sm font-black text-orange-700 shadow-lg active:scale-[0.99]"
            >
              {t(lang, "officePremiumUpgrade")}
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/15 px-4 py-3 ring-1 ring-white/25">
              <p className="text-xs font-black uppercase tracking-wide text-orange-100">{t(lang, "officePremiumPlanLabel")}</p>
              <p className="mt-1 font-mono text-xl font-black capitalize">{plan}</p>
              <p className="mt-1 text-xs font-semibold text-orange-50">{trialLine}</p>
              {renewalLine ? (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-white">
                  <Clock className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                  {renewalLine}
                </p>
              ) : null}
              {pendingCreated ? (
                <p className="mt-2 text-[11px] font-bold leading-snug text-orange-50">
                  {t(lang, "officePremiumStarterTrialPending")}
                  {" · "}
                  {new Date(pendingCreated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  {pendingSlaDaysLeft !== null ? (
                    <span className="mt-1 block text-white/90">
                      {t(lang, "officePremiumStarterTrialResponseWindow").replace("{{n}}", String(pendingSlaDaysLeft))}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {cloudSubLabel ? (
                <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-white/90">
                  {t(lang, "officeCloudSubscriptionLive")}: {cloudSubLabel}
                </p>
              ) : null}
            </div>
            <div className="rounded-2xl bg-white/15 px-4 py-3 ring-1 ring-white/25">
              <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide text-orange-100">
                <Clock className="h-4 w-4" aria-hidden />
                {t(lang, "officePremiumRenewalCardTitle")}
              </p>
              <p className="mt-1 text-sm font-bold text-white">
                {renewalLine ??
                  (snapshot.kind === "remote" && normalizePlanCode(snapshot.row.plan_code) === "waka_plus"
                    ? t(lang, "officePremiumRenewalVipWaiting")
                    : t(lang, "officePremiumRenewalIdle"))}
              </p>
            </div>
          </div>

          {billingOffers.length > 0 ? (
            <div className="space-y-3 rounded-2xl border border-white/30 bg-black/25 p-4 ring-1 ring-white/15">
              {billingOffers.map((o) => (
                <div key={o.id} className="rounded-xl bg-white/10 px-3 py-3 text-sm ring-1 ring-white/10">
                  <p className="font-black text-white">{t(lang, "officeBillingOfferTitle")}</p>
                  <p className="mt-1 text-lg font-black text-white">UGX {Number(o.amount_ugx).toLocaleString("en-UG")}</p>
                  <p className="mt-1 text-xs font-medium text-orange-50">{o.message ?? t(lang, "officeBillingOfferBody")}</p>
                  <p className="mt-2 text-xs font-bold uppercase text-orange-100">
                    {o.status === "claimed_paid" ? t(lang, "officeBillingOfferClaimed") : t(lang, "officeBillingOfferPending")}
                  </p>
                  {o.status === "pending" ? (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        void (async () => {
                          setMsg(null);
                          setBusy(`claim-${o.id}`);
                          const r = await ownerClaimOrgBillingOfferPaid(o.id);
                          setBusy(null);
                          if (!r.ok) setMsg(r.message ?? t(lang, "officePremiumRequestFail"));
                          else {
                            setMsg(t(lang, "officePremiumRequestOk"));
                            window.dispatchEvent(new Event("waka:subscription-updated"));
                            void refetch();
                            setBillingOffers(await fetchMyOrgBillingOffers());
                          }
                        })();
                      }}
                      className="mt-3 w-full rounded-xl bg-white py-2.5 text-sm font-black text-orange-900 disabled:opacity-50"
                    >
                      {busy === `claim-${o.id}` ? "…" : t(lang, "officeBillingClaimPaidCta")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {msg ? <p className="rounded-xl bg-black/20 px-3 py-2 text-sm font-semibold text-white">{msg}</p> : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {!hideStarterTrialCta ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void run("trial", () => requestSubscriptionPlanChange("starter"))}
                className="min-h-[48px] flex-1 rounded-2xl border-2 border-white/40 bg-white/10 px-4 py-3 text-sm font-black text-white backdrop-blur-sm hover:bg-white/20 disabled:opacity-50"
              >
                {busy === "trial" ? "…" : t(lang, "officePremiumRequestTrial")}
              </button>
            ) : null}
            <Link
              to="/support"
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-white/50 bg-black/20 px-4 py-3 text-sm font-black text-white hover:bg-black/30"
            >
              <Headphones className="h-4 w-4" />
              {t(lang, "officePremiumSupportChat")}
            </Link>
          </div>

          <div className="rounded-2xl border border-white/25 bg-black/15 p-4">
            <p className="text-sm font-black text-white">{t(lang, "officeAnnualTitle")}</p>
            <p className="mt-1 text-xs font-medium text-orange-50">{t(lang, "officeAnnualBody")}</p>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run("annual", requestAnnualPlanSupport)}
              className="mt-3 w-full rounded-xl bg-white py-2.5 text-sm font-black text-orange-800 disabled:opacity-50"
            >
              {busy === "annual" ? "…" : t(lang, "officeAnnualRequest")}
            </button>
          </div>

          <p className="text-center text-xs font-semibold text-orange-100">{t(lang, "officeEnterpriseHint")}</p>
        </div>
      </details>
    </section>
  );
}
