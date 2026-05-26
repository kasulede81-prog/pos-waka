import { useCallback, useEffect, useState } from "react";
import { PageBackBar } from "../components/layout/PageBackBar";
import { Copy, Users } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  fetchMarketingAgentMe,
  listAgentReferrals,
  type AgentReferralRow,
  type MarketingAgentMe,
} from "../lib/referralAgents";

export function MarketingAgentPage({ lang }: { lang: Language }) {
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<MarketingAgentMe | null>(null);
  const [referrals, setReferrals] = useState<AgentReferralRow[]>([]);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const me = await fetchMarketingAgentMe();
    setAgent(me);
    if (me) {
      const rows = await listAgentReferrals();
      setReferrals(rows);
    } else {
      setReferrals([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shareLink =
    typeof window !== "undefined" && agent
      ? `${window.location.origin}/register?ref=${encodeURIComponent(agent.referralCode)}`
      : "";

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
        <p className="mt-2 font-mono text-3xl font-black tracking-wide text-stone-950">{agent.referralCode}</p>
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
        </div>
        {copyHint ? <p className="mt-2 text-xs font-bold text-emerald-700">{copyHint}</p> : null}
        <p className="mt-3 break-all text-xs font-medium text-stone-500">{shareLink}</p>
      </article>

      <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
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
          <ul className="mt-4 space-y-2">
            {referrals.map((r) => (
              <li key={r.id} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
                <p className="font-bold text-stone-900">{r.shopName ?? t(lang, "agentReferralShopPending")}</p>
                <p className="text-xs font-medium text-stone-500">{r.ownerEmail ?? "—"}</p>
                <p className="mt-1 text-xs text-stone-400">
                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
