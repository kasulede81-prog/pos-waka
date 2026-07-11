import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSubscription } from "../../context/SubscriptionContext";
import { resolveEffectiveSubscription } from "../../lib/effectiveSubscription";
import { fetchShopAuditTimeline, type OpsAuditRow } from "../../lib/wakaInternalAdmin";
import {
  buildBillingTimelineEvents,
  parseSubscriptionHistoryRows,
} from "../../lib/subscriptionHistory";
import { BillingTimeline } from "./BillingTimeline";
import { SubscriptionHistoryPanel } from "./SubscriptionHistoryPanel";

type Props = {
  lang: Language;
  shopId?: string | null;
  showHistoryTable?: boolean;
};

function planLabelKey(tier: string): string {
  if (tier === "starter") return "planStarterName";
  if (tier === "business") return "planBusinessName";
  if (tier === "waka_plus") return "planWakaPlusName";
  return "planFreeName";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function AccountSubscriptionCenter({ lang, shopId: shopIdProp, showHistoryTable = true }: Props) {
  const { snapshot, authMode, loading } = useSubscription();
  const shopId = useMemo(() => {
    if (shopIdProp) return shopIdProp;
    if (snapshot.kind === "remote" && snapshot.row.shop_id) return snapshot.row.shop_id;
    return null;
  }, [shopIdProp, snapshot]);
  const [auditRows, setAuditRows] = useState<OpsAuditRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const effective = useMemo(() => {
    if (authMode === "local") return resolveEffectiveSubscription({ kind: "local_full" });
    if (snapshot.kind === "none" && !snapshot.promotionalGrant) return null;
    return resolveEffectiveSubscription(snapshot);
  }, [authMode, snapshot]);

  const loadHistory = useCallback(async () => {
    if (!shopId || authMode !== "supabase") return;
    setHistoryLoading(true);
    try {
      const rows = await fetchShopAuditTimeline(shopId, 40);
      setAuditRows(rows);
    } finally {
      setHistoryLoading(false);
    }
  }, [shopId, authMode]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const onUpdate = () => void loadHistory();
    window.addEventListener("waka:subscription-updated", onUpdate);
    return () => window.removeEventListener("waka:subscription-updated", onUpdate);
  }, [loadHistory]);

  const historyRows = useMemo(() => parseSubscriptionHistoryRows(auditRows), [auditRows]);
  const timelineEvents = useMemo(() => buildBillingTimelineEvents(historyRows), [historyRows]);

  if (loading) {
    return (
      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "billingLoading")}</p>
      </article>
    );
  }

  const planTier = effective?.effectivePlan ?? "free";
  const subscriptionType = effective?.subscriptionType ?? "free";
  const billingStatus = effective?.status ?? "none";

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "billingCenterTitle")}</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingCurrentPlan")}</p>
            <p className="text-base font-black text-foreground">{t(lang, planLabelKey(planTier) as "planFreeName")}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingSubscriptionType")}</p>
            <p className="text-base font-black capitalize text-foreground">{subscriptionType}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingStatus")}</p>
            <p className="text-base font-black capitalize text-foreground">{billingStatus.replace(/_/g, " ")}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingCycle")}</p>
            <p className="text-base font-black capitalize text-foreground">{effective?.billingCycle ?? "—"}</p>
          </div>
          {effective?.isTrial ? (
            <div>
              <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingTrialEnds")}</p>
              <p className="text-sm font-bold text-foreground">{fmtDate(effective.trialEndsAt)}</p>
            </div>
          ) : null}
          <div>
            <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingSubscriptionEnds")}</p>
            <p className="text-sm font-bold text-foreground">{fmtDate(effective?.expiresAt)}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingRenewalDate")}</p>
            <p className="text-sm font-bold text-foreground">{fmtDate(effective?.expiresAt)}</p>
          </div>
          {effective?.daysRemaining != null ? (
            <div>
              <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingDaysRemaining")}</p>
              <p className="text-sm font-bold text-foreground">{effective.daysRemaining}</p>
            </div>
          ) : null}
        </div>

        {effective?.promotionalGrant ? (
          <p className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-900">
            {t(lang, "billingPromotionalOverlay")}: {effective.promotionalGrant.plan_code}
          </p>
        ) : null}

        <div className="mt-4 rounded-xl bg-muted px-3 py-3">
          <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingCurrentLimits")}</p>
          <ul className="mt-1 space-y-1 text-sm font-semibold text-muted-foreground">
            <li>
              {t(lang, "billingDeviceLimit")}: {effective?.deviceLimit ?? "—"}
            </li>
          </ul>
        </div>
      </article>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "billingTimelineTitle")}</p>
        <div className="mt-3">
          {historyLoading ? (
            <p className="text-sm text-muted-foreground">{t(lang, "billingLoading")}</p>
          ) : (
            <BillingTimeline lang={lang} events={timelineEvents.slice(0, 8)} compact />
          )}
        </div>
      </article>

      {showHistoryTable && historyRows.length > 0 ? (
        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "billingHistoryTitle")}</p>
          <SubscriptionHistoryPanel lang={lang} rows={historyRows.slice(0, 15)} compact />
        </article>
      ) : null}
    </div>
  );
}
