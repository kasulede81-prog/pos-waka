import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { PageBackBar } from "../components/layout/PageBackBar";
import { Copy, MapPin, Users } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  buildAgentReferralRegisterUrl,
  buildAgentVerificationUrl,
  fetchMarketingAgentMe,
  formatOwnerContactLabel,
  listAgentReferrals,
  marketingAgentUpgradeReferralPlan,
  referralRowToMapPin,
  type AgentReferralRow,
  type MarketingAgentMe,
} from "../lib/referralAgents";
import { AgentVerificationQr } from "../components/agents/AgentVerificationQr";
const LovableFieldMap = lazy(async () => {
  const m = await import("../components/internal-admin/LovableFieldMap");
  return { default: m.LovableFieldMap };
});

export function MarketingAgentPage({ lang }: { lang: Language }) {
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
  const verifyLink = agent ? buildAgentVerificationUrl(agent.referralCode) : "";

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

  const copyVerifyLink = async () => {
    if (!verifyLink) return;
    try {
      await navigator.clipboard.writeText(verifyLink);
      setCopyHint(t(lang, "agentVerifyLinkCopied"));
    } catch {
      setCopyHint(verifyLink);
    }
    window.setTimeout(() => setCopyHint(null), 2500);
  };

  const mapPins = referrals.map(referralRowToMapPin).filter((x): x is NonNullable<typeof x> => x !== null);
  const activeReferrals = referrals.filter((r) => (r.subscriptionStatus ?? "").toLowerCase() === "active").length;

  const upgradeReferral = async (referralId: string, planCode: "starter" | "business" | "waka_plus") => {
    setUpgradeBusyId(referralId);
    setActionMsg(null);
    const res = await marketingAgentUpgradeReferralPlan({ referralId, planCode, days: 30 });
    setUpgradeBusyId(null);
    if (!res.ok) {
      const key =
        res.error === "vip_role_required"
          ? t(lang, "agentUpgradeVipRequired")
          : res.error === "role_forbidden"
            ? t(lang, "agentUpgradeNotAllowed")
            : res.error ?? t(lang, "agentUpgradeFailed");
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
      <div className="flex min-h-[40vh] items-center justify-center text-sm font-semibold text-stone-600">…</div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 pb-16 pt-2">
        <PageBackBar lang={lang} fallbackTo="/office" label={t(lang, "officeBackToHub")} />
        <h1 className="text-2xl font-black text-stone-900 sm:text-3xl">{t(lang, "agentPortalTitle")}</h1>
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-950">
          {t(lang, "agentPortalNotAgent")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 pb-16 pt-2">
      <PageBackBar lang={lang} fallbackTo="/office" label={t(lang, "officeBackToHub")} />
      <div>
        <h1 className="text-2xl font-black text-stone-900 sm:text-3xl">{t(lang, "agentPortalTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "agentPortalSub")}</p>
      </div>

      <article className="rounded-3xl border-2 border-waka-100 bg-gradient-to-br from-waka-50 to-white p-5 shadow-waka-sm">
        <p className="text-xs font-black uppercase tracking-widest text-waka-700">{t(lang, "agentYourCode")}</p>
        <p className="mt-2 font-mono text-3xl font-black uppercase tracking-widest text-stone-950">{agent.referralCode}</p>
        {agent.fullName ? <p className="mt-1 text-sm font-semibold text-stone-600">{agent.fullName}</p> : null}
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
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border-2 border-waka-200 bg-white px-4 py-2 text-sm font-black text-waka-800"
          >
            {t(lang, "agentCopyLink")}
          </button>
          <button
            type="button"
            onClick={() => void copyVerifyLink()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border-2 border-stone-200 bg-white px-4 py-2 text-sm font-black text-stone-800"
          >
            {t(lang, "agentCopyVerifyLink")}
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
          <p className="mt-2 text-xs font-semibold text-stone-600">
            {t(lang, "agentRolesLabel")}: {agent.roles.join(" · ")}
          </p>
        ) : null}
        <p className="mt-3 break-all text-xs font-medium text-stone-500">{shareLink}</p>
      </article>

      <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <p className="text-xs font-black uppercase tracking-widest text-stone-500">{t(lang, "agentVerifyQrTitle")}</p>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "agentVerifyQrSub")}</p>
        <div className="mt-4 flex justify-center">
          <AgentVerificationQr referralCode={agent.referralCode} size={180} />
        </div>
      </article>

      <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">Tracked shops</p>
            <p className="text-xl font-black text-stone-900">{referrals.length}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">Active plans</p>
            <p className="text-xl font-black text-waka-800">{activeReferrals}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-waka-700" aria-hidden />
          <h2 className="text-lg font-black text-stone-900">{t(lang, "agentReferralsTitle")}</h2>
          <span className="ml-auto rounded-full bg-waka-100 px-3 py-0.5 text-sm font-black text-waka-800">
            {agent.referralCount}
          </span>
        </div>
        {referrals.length === 0 ? (
          <p className="mt-4 text-sm font-semibold text-stone-500">{t(lang, "agentReferralsEmpty")}</p>
        ) : (
          <>
          {actionMsg ? <p className="mt-3 text-sm font-bold text-waka-800">{actionMsg}</p> : null}
          <ul className="mt-4 space-y-2">
            {referrals.map((r) => (
              <li key={r.id} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
                <p className="font-bold text-stone-900">{r.shopName ?? t(lang, "agentReferralShopPending")}</p>
                <p className="text-xs font-medium text-stone-600">
                  {formatOwnerContactLabel(r.ownerEmail, r.ownerPhone)}
                </p>
                {r.planCode ? (
                  <p className="text-xs font-bold text-waka-800">
                    {t(lang, "agentPlanLabel")}: {r.planCode}
                    {r.subscriptionStatus ? ` (${r.subscriptionStatus})` : ""}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-stone-400">
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
                          className="rounded-lg border border-waka-400 bg-white px-2.5 py-1 text-[11px] font-black text-waka-800 disabled:opacity-50"
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

      <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <div className="mb-3 flex items-center gap-2">
          <MapPin className="h-5 w-5 text-orange-600" aria-hidden />
          <h2 className="text-lg font-black text-stone-900">Shop map view</h2>
        </div>
        {mapPins.length > 0 ? (
          <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-stone-100" />}>
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
