import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Cpu, Headphones, Sparkles } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSubscription } from "../../context/SubscriptionContext";
import { resolveEffectivePlanTier } from "../../lib/subscriptionEntitlements";
import {
  canUseAiStockTools,
  fetchMyFeatureEntitlements,
  requestAiStockAssistant,
  requestAnnualPlanSupport,
  requestFreeAiTrial,
  requestSubscriptionPlanChange,
  type MyFeatureEntitlements,
} from "../../lib/shopRequests";
import { fetchMyOrgBillingOffers, ownerClaimOrgBillingOfferPaid, type OrgBillingOfferRow } from "../../lib/orgBillingOffers";

export function OfficePremiumSection({ lang }: { lang: Language }) {
  const { snapshot, authMode, daysLeftInTrial, refetch } = useSubscription();
  const [ent, setEnt] = useState<MyFeatureEntitlements | null>(null);
  const [billingOffers, setBillingOffers] = useState<OrgBillingOfferRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void fetchMyFeatureEntitlements().then(setEnt);
  }, []);

  useEffect(() => {
    if (authMode !== "supabase") return;
    const refresh = () => {
      void refetch();
      void fetchMyOrgBillingOffers().then(setBillingOffers);
      void fetchMyFeatureEntitlements().then(setEnt);
    };
    const id = window.setInterval(refresh, 20_000);
    const onSub = () => {
      void refetch();
      void fetchMyOrgBillingOffers().then(setBillingOffers);
    };
    const onEnt = () => void fetchMyFeatureEntitlements().then(setEnt);
    window.addEventListener("waka:subscription-updated", onSub);
    window.addEventListener("waka:feature-entitlements-changed", onEnt);
    void fetchMyOrgBillingOffers().then(setBillingOffers);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("waka:subscription-updated", onSub);
      window.removeEventListener("waka:feature-entitlements-changed", onEnt);
    };
  }, [authMode, refetch]);

  const plan = authMode === "supabase" && snapshot.kind === "remote" ? resolveEffectivePlanTier(snapshot) : "starter";
  const trialLeft = daysLeftInTrial;
  const aiActive = canUseAiStockTools(ent);
  const cloudSubLabel =
    authMode === "supabase" && snapshot.kind === "remote" ? `${snapshot.row.status} · ${snapshot.row.plan_code}` : null;

  const run = async (key: string, fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setMsg(null);
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setMsg(r.message ?? t(lang, "officePremiumRequestFail"));
    else setMsg(t(lang, "officePremiumRequestOk"));
    void refetch();
    const e = await fetchMyFeatureEntitlements();
    setEnt(e);
    setBillingOffers(await fetchMyOrgBillingOffers());
    window.dispatchEvent(new Event("waka:feature-entitlements-changed"));
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
          <p className="mt-1 text-xs font-semibold text-orange-50">
            {trialLeft != null ? t(lang, "officePremiumTrialDays").replace("{{n}}", String(trialLeft)) : t(lang, "officePremiumNoTrial")}
          </p>
          {cloudSubLabel ? (
            <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-white/90">
              {t(lang, "officeCloudSubscriptionLive")}: {cloudSubLabel}
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl bg-white/15 px-4 py-3 ring-1 ring-white/25">
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide text-orange-100">
            <Cpu className="h-4 w-4" />
            {t(lang, "officePremiumAiStatus")}
          </p>
          <p className="mt-1 text-sm font-bold text-white">
            {aiActive ? t(lang, "officePremiumAiOn") : ent?.ai_stock_assistant === "pending" ? t(lang, "officePremiumAiPending") : t(lang, "officePremiumAiOff")}
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
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void run("trial", () => requestSubscriptionPlanChange("starter"))}
          className="min-h-[48px] flex-1 rounded-2xl border-2 border-white/40 bg-white/10 px-4 py-3 text-sm font-black text-white backdrop-blur-sm hover:bg-white/20 disabled:opacity-50"
        >
          {busy === "trial" ? "…" : t(lang, "officePremiumRequestTrial")}
        </button>
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

      <div className="rounded-2xl border border-white/25 bg-black/10 p-4">
        <p className="text-sm font-black text-white">{t(lang, "officeAiSectionTitle")}</p>
        <p className="mt-1 text-xs font-medium text-orange-50">{t(lang, "officeAiSectionBody")}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void run("ai", requestAiStockAssistant)}
            className="min-h-[44px] flex-1 rounded-xl bg-white py-2.5 text-sm font-black text-orange-900 disabled:opacity-50"
          >
            {busy === "ai" ? "…" : t(lang, "officeAiRequestCta")}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void run("aitrial", requestFreeAiTrial)}
            className="min-h-[44px] flex-1 rounded-xl border-2 border-white/50 py-2.5 text-sm font-black text-white disabled:opacity-50"
          >
            {busy === "aitrial" ? "…" : t(lang, "officeAiTrialCta")}
          </button>
        </div>
        {aiActive ? (
          <Link
            to="/stock/import-ocr"
            className="mt-3 block text-center text-sm font-black text-white underline decoration-white/60"
          >
            {t(lang, "officeAiOpenTools")} →
          </Link>
        ) : null}
      </div>

      <p className="text-center text-xs font-semibold text-orange-100">{t(lang, "officeEnterpriseHint")}</p>
        </div>
      </details>
    </section>
  );
}
