import { actorHasEffectivePermission } from "../lib/actorAuthorization";
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { PageBackBar } from "../components/layout/PageBackBar";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";

import { Copy, MapPin, Users } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { subscriptionEngine } from "../lib/subscriptionEngine";
import {
  buildAgentReferralRegisterUrl,
  fetchMarketingAgentMe,
  formatOwnerContactLabel,
  listAgentReferrals,
  referralRowToMapPin,
  type AgentReferralRow,
  type MarketingAgentMe,
} from "../lib/referralAgents";
const LovableFieldMap = lazy(async () => {
  const m = await import("../components/internal-admin/LovableFieldMap");
  return { default: m.LovableFieldMap };
});

export function MarketingAgentPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const agentBackTo = actorHasEffectivePermission(actor, "back_office.access", snapshot, authMode) ? "/office" : "/";
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<MarketingAgentMe | null>(null);
  const [referrals, setReferrals] = useState<AgentReferralRow[]>([]);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upgradeBusyId, setUpgradeBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setLoadError(null);
    const me = await fetchMarketingAgentMe();
    setAgent(me);
    if (me) {
      const { rows, error } = await listAgentReferrals();
      setReferrals(rows);
      if (error) setLoadError(error);
    } else {
      setReferrals([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load({ silent: true });
    };
    const onFocus = () => void load({ silent: true });
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const shareLink = agent ? buildAgentReferralRegisterUrl(agent.referralCode) : "";

  const copyCode = async () => {
    if (!agent?.referralCode) return;
    try {
      await navigator.clipboard.writeText(agent.referralCode);
      setCopyHint(t(lang, "agentCodeCopied"));
    } catch {
      setCopyHint(agent.referralCode);
    }
    window.setTimeout(() => setCopyHint(null), 2500);
  };

  const copyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopyHint(t(lang, "agentLinkCopied"));
    } catch {
      setCopyHint(shareLink);
    }
    window.setTimeout(() => setCopyHint(null), 2500);
  };

  const mapPins = referrals.map(referralRowToMapPin).filter((x): x is NonNullable<typeof x> => x !== null);
  const activeReferrals = referrals.filter((r) => (r.subscriptionStatus ?? "").toLowerCase() === "active").length;

  const upgradeReferral = async (referralId: string, planCode: "starter" | "business" | "waka_plus") => {
    setUpgradeBusyId(referralId);
    setActionMsg(null);
    const res = await subscriptionEngine.agentGrantPlan({ referralId, planCode, days: 30 });
    setUpgradeBusyId(null);
    if (!res.ok) {
      const err = res.message ?? "unknown";
      const key =
        err === "vip_role_required"
          ? t(lang, "agentUpgradeVipRequired")
          : err === "role_forbidden"
            ? t(lang, "agentUpgradeNotAllowed")
            : err ?? t(lang, "agentUpgradeFailed");
      setActionMsg(key);
      return;
    }
    setActionMsg(t(lang, "agentUpgradeOk").replace("{{plan}}", planCode));
    const { rows } = await listAgentReferrals();
    setReferrals(rows);
    window.setTimeout(() => setActionMsg(null), 3000);
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm font-semibold text-muted-foreground">…</div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 pb-16 pt-2">
        <PageBackBar lang={lang} fallbackTo={agentBackTo} label={t(lang, "officeBackToHub")} />
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">{t(lang, "agentPortalTitle")}</h1>
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-950">
          {t(lang, "agentPortalNotAgent")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 pb-16 pt-2">
      <PageBackBar lang={lang} fallbackTo={agentBackTo} label={t(lang, "officeBackToHub")} />
      <div>
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">{t(lang, "agentPortalTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "agentPortalSub")}</p>
      </div>

      <article className="rounded-3xl border-2 border-waka-100 bg-gradient-to-br from-waka-50 to-card p-5 shadow-waka-sm">
        <p className="text-xs font-black uppercase tracking-widest text-waka-700">{t(lang, "agentYourCode")}</p>
        <p className="mt-2 font-mono text-3xl font-black uppercase tracking-widest text-foreground">{agent.referralCode}</p>
        {agent.fullName ? <p className="mt-1 text-sm font-semibold text-muted-foreground">{agent.fullName}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyCode()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white"
          >
            <Copy className="h-4 w-4" aria-hidden />
            {t(lang, "agentCopyCode")}
          </button>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border-2 border-waka-200 bg-card px-4 py-2 text-sm font-black text-waka-800"
          >
            {t(lang, "agentCopyLink")}
          </button>
        </div>
        {copyHint ? <p className="mt-2 text-xs font-bold text-emerald-700">{copyHint}</p> : null}
        {loadError ? (
          <p className="mt-2 text-xs font-bold text-rose-700">
            {t(lang, "agentReferralsLoadError")}
            {import.meta.env.DEV ? ` (${loadError})` : null}
          </p>
        ) : null}
        {agent.roles.length > 0 ? (
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            {t(lang, "agentRolesLabel")}: {agent.roles.join(" · ")}
          </p>
        ) : null}
        <p className="mt-3 break-all text-xs font-medium text-muted-foreground">{shareLink}</p>
      </article>

      <article className="rounded-3xl border border-border bg-card p-5 shadow-waka-sm">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-border bg-muted px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Tracked shops</p>
            <p className="text-xl font-black text-foreground">{referrals.length}</p>
          </div>
          <div className="rounded-2xl border border-border bg-muted px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Active plans</p>
            <p className="text-xl font-black text-waka-800">{activeReferrals}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-waka-700" aria-hidden />
          <h2 className="text-lg font-black text-foreground">{t(lang, "agentReferralsTitle")}</h2>
          <span className="ml-auto rounded-full bg-waka-100 px-3 py-0.5 text-sm font-black text-waka-800">
            {agent.referralCount}
          </span>
        </div>
        {referrals.length === 0 ? (
          <p className="mt-4 text-sm font-semibold text-muted-foreground">{t(lang, "agentReferralsEmpty")}</p>
        ) : (
          <>
          {actionMsg ? <p className="mt-3 text-sm font-bold text-waka-800">{actionMsg}</p> : null}
          <ul className="mt-4 space-y-2">
            {referrals.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-muted px-4 py-3">
                <p className="font-bold text-foreground">{r.shopName ?? t(lang, "agentReferralShopPending")}</p>
                <p className="text-xs font-medium text-muted-foreground">
                  {formatOwnerContactLabel(r.ownerEmail, r.ownerPhone)}
                </p>
                {r.planCode ? (
                  <p className="text-xs font-bold text-waka-800">
                    {t(lang, "agentPlanLabel")}: {r.planCode}
                    {r.subscriptionStatus ? ` (${r.subscriptionStatus})` : ""}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                </p>
                {r.shopId && (agent.canActivateTrial || agent.canActivateVip) ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {agent.canActivateTrial ? (
                      <button
                        type="button"
                        disabled={upgradeBusyId === r.id}
                        onClick={() => void upgradeReferral(r.id, "starter")}
                        className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-black text-white disabled:opacity-50"
                      >
                        {t(lang, "agentUpgradeStarter")}
                      </button>
                    ) : null}
                    {agent.canActivateVip ? (
                      <>
                        <button
                          type="button"
                          disabled={upgradeBusyId === r.id}
                          onClick={() => void upgradeReferral(r.id, "business")}
                          className="rounded-lg bg-waka-600 px-2.5 py-1 text-[11px] font-black text-white disabled:opacity-50"
                        >
                          {t(lang, "agentUpgradeBusiness")}
                        </button>
                        <button
                          type="button"
                          disabled={upgradeBusyId === r.id}
                          onClick={() => void upgradeReferral(r.id, "waka_plus")}
                          className="rounded-lg border border-waka-400 bg-card px-2.5 py-1 text-[11px] font-black text-waka-800 disabled:opacity-50"
                        >
                          {t(lang, "agentUpgradeVip")}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          </>
        )}
      </article>

      <article className="rounded-3xl border border-border bg-card p-5 shadow-waka-sm">
        <div className="mb-3 flex items-center gap-2">
          <MapPin className="h-5 w-5 text-waka-600" aria-hidden />
          <h2 className="text-lg font-black text-foreground">Shop map view</h2>
        </div>
        {mapPins.length > 0 ? (
          <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" />}>
            <LovableFieldMap pins={mapPins} />
          </Suspense>
        ) : (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            GPS map will appear when referred shops have location data.
          </p>
        )}
      </article>
    </div>
  );
}
