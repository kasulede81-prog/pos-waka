import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { createCheckoutBackend, paymentStatusKey, toDisplayPayments, type DisplayPayment } from "../../lib/paymentCheckout";
import { SubscriptionHistoryPanel } from "./SubscriptionHistoryPanel";
import { resolveSubscriptionCancelledAt } from "../../lib/subscriptionCancellationDate";
import { PrinterPromotionPanel } from "./PrinterPromotionPanel";

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

  /**
   * Only ever a date the records actually carry. Null for a row that is not cancelled, and
   * null for the cancellations that were written without a stamp (the plan-RPC sibling
   * sweep, a reset to free) — in both cases the card shows the status with no date rather
   * than inventing one. See src/lib/subscriptionCancellationDate.ts.
   */
  const cancelledAt = useMemo(
    () => (snapshot.kind === "remote" ? resolveSubscriptionCancelledAt(snapshot.row) : null),
    [snapshot],
  );

  /**
   * Tagged with the shop the rows were fetched for, and gated on still being the
   * newest request — the same rule the payment list below already follows. A shop
   * switch re-runs this, and without the ticket a slow response for the previous
   * shop could land last and show one shop's subscription history under another's
   * name.
   */
  const historySeqRef = useRef(0);
  const loadHistory = useCallback(async () => {
    const seq = ++historySeqRef.current;
    if (!shopId || authMode !== "supabase") {
      setAuditRows([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const rows = await fetchShopAuditTimeline(shopId, 40);
      if (seq !== historySeqRef.current) return; // superseded — drop it
      setAuditRows(rows);
    } finally {
      if (seq === historySeqRef.current) setHistoryLoading(false);
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

  // M3-D payment history — safe projection only (server + local whitelist).
  // Rows are tagged with the shop they were fetched for, so a shop switch
  // never shows another shop's payments (and no setState runs synchronously
  // in the effect body).
  const [paymentsFor, setPaymentsFor] = useState<{
    shopId: string;
    rows: DisplayPayment[];
    errorKey: string | null;
  } | null>(null);

  useEffect(() => {
    if (!shopId || authMode !== "supabase") return;
    let live = true;
    void (async () => {
      const list = await createCheckoutBackend().listPayments(shopId);
      if (!live) return;
      if (list.ok !== true) {
        setPaymentsFor({
          shopId,
          rows: [],
          errorKey: typeof list.error === "string" ? list.error : "unavailable",
        });
        return;
      }
      setPaymentsFor({ shopId, rows: toDisplayPayments(list), errorKey: null });
    })();
    return () => {
      live = false;
    };
  }, [shopId, authMode]);

  const currentPayments =
    paymentsFor && shopId && authMode === "supabase" && paymentsFor.shopId === shopId
      ? paymentsFor
      : null;
  const paymentRows = currentPayments?.rows ?? [];
  const paymentsErrorKey = currentPayments?.errorKey ?? null;

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
          {/*
            A "Renewal date" tile used to sit here, rendering the SAME
            `effective.expiresAt` as "Subscription ends" directly above it. There is
            no next-renewal date to show: nothing in the schema records one
            (`current_period_end` is the only date that exists), and nothing renews
            automatically — a period advances only when a NEW payment settles through
            `subscription_payment_confirm`, and the hourly lifecycle tick only ever
            expires rows. So the second tile did not report a fact the first one
            omitted; it restated the access-expiry date under a more promising name.
          */}
          {cancelledAt ? (
            <div>
              <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingCancelledOn")}</p>
              <p className="text-sm font-bold text-foreground">{fmtDate(cancelledAt)}</p>
            </div>
          ) : null}
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

      {/*
        The printer promotion, tied to THIS account's real eligibility and
        fulfilment state. It reads its own server state and renders nothing at
        all when there is no shop to ask about, so it cannot show a merchant a
        status that is not theirs.
      */}
      {shopId && authMode === "supabase" ? <PrinterPromotionPanel lang={lang} shopId={shopId} /> : null}

      {showHistoryTable && historyRows.length > 0 ? (
        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "billingHistoryTitle")}</p>
          <SubscriptionHistoryPanel lang={lang} rows={historyRows.slice(0, 15)} compact />
        </article>
      ) : null}

      {shopId && authMode === "supabase" ? (
        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "checkoutHistoryTitle")}</p>
          {paymentsErrorKey ? (
            <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
              {t(lang, paymentsErrorKey.startsWith("checkout") ? paymentsErrorKey : "checkoutUnavailable")}
            </p>
          ) : paymentRows.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t(lang, "checkoutHistoryEmpty")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {paymentRows.map((p) => (
                <li
                  key={`${p.reference ?? "no-ref"}-${p.createdAt}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2"
                >
                  <span className="font-mono text-[10px] text-muted-foreground">{fmtDate(p.createdAt)}</span>
                  <span className="text-sm font-bold">
                    UGX {p.amountUgx.toLocaleString("en-UG")}
                    {p.planCode ? ` · ${p.planCode.replace("_", " ")}` : ""}
                    {p.billingInterval
                      ? ` · ${p.billingInterval === "year" ? t(lang, "checkoutAnnual") : t(lang, "checkoutMonthly")}`
                      : ""}
                  </span>
                  <span className="text-sm font-black">{t(lang, paymentStatusKey(p.status))}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ) : null}
    </div>
  );
}
