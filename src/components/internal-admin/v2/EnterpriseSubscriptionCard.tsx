import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { resolveEffectiveSubscription } from "../../../lib/effectiveSubscription";
import {
  fetchPlatformSubscriptionSettings,
  type PlatformSubscriptionSettings,
} from "../../../lib/platformSubscriptionSettings";
import {
  subscriptionEngine,
  type AdminPlanCode,
  resolveEffectiveSubscriptionForShop,
} from "../../../lib/subscriptionEngine";
import type { ShopOpsDetail } from "../../../lib/wakaInternalAdmin";
import { fetchShopAuditTimeline, type OpsAuditRow } from "../../../lib/wakaInternalAdmin";
import {
  buildBillingTimelineEvents,
  parseSubscriptionHistoryRows,
} from "../../../lib/subscriptionHistory";
import { BillingTimeline } from "../../subscription/BillingTimeline";
import { SubscriptionHistoryPanel } from "../../subscription/SubscriptionHistoryPanel";
import { PromotionalAccessPanel } from "./PromotionalAccessPanel";
import type { EffectiveSubscription } from "../../../lib/effectiveSubscription";

type Props = {
  lang: Language;
  detail: ShopOpsDetail;
  canManage: boolean;
  busy: boolean;
  previewMode?: boolean;
  onActionComplete?: () => void;
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

export function EnterpriseSubscriptionCard({
  lang,
  detail,
  canManage,
  busy,
  previewMode = false,
  onActionComplete,
}: Props) {
  const shopId = detail.shop.id;
  const subId = detail.subscription?.id ?? null;
  const [effective, setEffective] = useState<EffectiveSubscription | null>(null);
  const [settings, setSettings] = useState<PlatformSubscriptionSettings | null>(null);
  const [auditRows, setAuditRows] = useState<OpsAuditRow[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [promoOpen, setPromoOpen] = useState(false);

  const load = useCallback(async () => {
    if (previewMode) {
      const snap = {
        kind: "remote" as const,
        row: {
          id: subId ?? "preview-sub",
          organization_id: detail.shop.organization_id ?? "",
          shop_id: shopId,
          status: detail.subscription?.status ?? "active",
          trial_ends_at: detail.subscription?.trial_ends_at ?? null,
          current_period_start: null,
          current_period_end: detail.subscription?.current_period_end ?? null,
          plan_code: detail.plan_code ?? detail.subscription?.plan_code ?? "business",
          max_pos_users: null,
          max_shops: null,
          max_devices: null,
        },
        promotionalGrant: null,
      };
      setEffective(resolveEffectiveSubscription(snap));
      return;
    }
    const [eff, plat] = await Promise.all([
      resolveEffectiveSubscriptionForShop(shopId),
      fetchPlatformSubscriptionSettings(),
    ]);
    setEffective(eff);
    setSettings(plat.settings);
    const rows = await fetchShopAuditTimeline(shopId, 50);
    setAuditRows(rows);
  }, [shopId, subId, detail, previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const historyRows = useMemo(() => parseSubscriptionHistoryRows(auditRows), [auditRows]);
  const timelineEvents = useMemo(() => buildBillingTimelineEvents(historyRows), [historyRows]);

  const runEngine = async (_label: string, fn: () => Promise<{ ok: boolean; message?: string }>) => {
    if (!canManage || previewMode) return;
    setActionBusy(true);
    try {
      const result = await fn();
      if (!result.ok && result.message) window.alert(result.message);
      await load();
      onActionComplete?.();
    } finally {
      setActionBusy(false);
    }
  };

  const disabled = busy || actionBusy || !canManage || previewMode;
  const monthlyDays = settings?.monthlyDurationDays ?? 30;
  const yearlyDays = settings?.yearlyDurationDays ?? 365;
  const trialDays = settings?.defaultTrialDurationDays ?? 14;
  const trialPlan = settings?.defaultTrialPlan ?? "business";

  const btn =
    "min-h-[40px] rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground hover:bg-muted disabled:opacity-40";

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-waka-800">
          {t(lang, "enterpriseSubscriptionTitle")}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t(lang, "enterpriseSubscriptionSub")}</p>
      </div>

      <section className="rounded-xl bg-muted p-3">
        <p className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingOverview")}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-[10px] font-bold text-muted-foreground">{t(lang, "billingCurrentPlan")}</p>
            <p className="font-black text-foreground">
              {t(lang, planLabelKey(effective?.planCode ?? "free") as "planFreeName")}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground">{t(lang, "billingEffectivePlan")}</p>
            <p className="font-black text-foreground">
              {t(lang, planLabelKey(effective?.effectivePlan ?? "free") as "planFreeName")}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground">{t(lang, "billingSubscriptionType")}</p>
            <p className="font-black capitalize text-foreground">{effective?.subscriptionType ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground">{t(lang, "billingStatus")}</p>
            <p className="font-black capitalize text-foreground">{effective?.status ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground">{t(lang, "billingCycle")}</p>
            <p className="font-black capitalize text-foreground">{effective?.billingCycle ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground">{t(lang, "billingSubscriptionEnds")}</p>
            <p className="font-black text-foreground">{fmtDate(effective?.expiresAt)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground">{t(lang, "billingDeviceLimit")}</p>
            <p className="font-black text-foreground">{effective?.deviceLimit ?? "—"}</p>
          </div>
        </div>
        {effective?.promotionalGrant ? (
          <p className="mt-2 text-xs font-bold text-violet-800">
            {t(lang, "billingPromotionalOverlay")}: {effective.promotionalGrant.plan_code}
          </p>
        ) : null}
      </section>

      <section>
        <p className="mb-2 text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingActions")}</p>
        <label className="mb-2 block text-[10px] font-bold uppercase text-muted-foreground">
          {t(lang, "billingHistoryReason")}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled}
            placeholder={t(lang, "billingActionReasonPlaceholder")}
            className="mt-1 min-h-[40px] w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-waka-200 disabled:opacity-50"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            className={btn}
            onClick={() =>
              void runEngine("grant_trial", () =>
                subscriptionEngine.grantTrial({
                  shopId,
                  planCode: trialPlan,
                  reason: reason || "Admin trial grant",
                }),
              )
            }
          >
            {t(lang, "billingGrantTrial")} ({trialDays}d)
          </button>
          <button
            type="button"
            disabled={disabled}
            className={btn}
            onClick={() =>
              void runEngine("grant_monthly", () =>
                subscriptionEngine.grant({
                  shopId,
                  planCode: (effective?.planCode !== "free" ? effective?.planCode : "business") as AdminPlanCode,
                  days: monthlyDays,
                  billingCycle: "monthly",
                  reason: reason || "Admin monthly grant",
                }),
              )
            }
          >
            {t(lang, "billingGrantMonthly")}
          </button>
          <button
            type="button"
            disabled={disabled}
            className={btn}
            onClick={() =>
              void runEngine("grant_yearly", () =>
                subscriptionEngine.grant({
                  shopId,
                  planCode: (effective?.planCode !== "free" ? effective?.planCode : "business") as AdminPlanCode,
                  days: yearlyDays,
                  billingCycle: "yearly",
                  reason: reason || "Admin yearly grant",
                }),
              )
            }
          >
            {t(lang, "billingGrantYearly")}
          </button>
          {subId ? (
            <button
              type="button"
              disabled={disabled}
              className={btn}
              onClick={() =>
                void runEngine("extend", () =>
                  subscriptionEngine.extend({
                    subscriptionId: subId,
                    shopId,
                    extraDays: 7,
                    reason: reason || "Admin extend",
                  }),
                )
              }
            >
              {t(lang, "billingExtend")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            className={btn}
            onClick={() =>
              void runEngine("renew", () =>
                subscriptionEngine.renew({
                  shopId,
                  planCode: (effective?.planCode !== "free" ? effective?.planCode : "business") as AdminPlanCode,
                  days: monthlyDays,
                  billingCycle: "monthly",
                  reason: reason || "Admin renew",
                }),
              )
            }
          >
            {t(lang, "billingRenew")}
          </button>
          {subId ? (
            <>
              <button
                type="button"
                disabled={disabled}
                className={btn}
                onClick={() =>
                  void runEngine("pause", () =>
                    subscriptionEngine.pause({ subscriptionId: subId, shopId, reason: reason || "Admin pause" }),
                  )
                }
              >
                {t(lang, "billingPause")}
              </button>
              <button
                type="button"
                disabled={disabled}
                className={btn}
                onClick={() =>
                  void runEngine("resume", () =>
                    subscriptionEngine.resume({ subscriptionId: subId, shopId, reason: reason || "Admin resume" }),
                  )
                }
              >
                {t(lang, "billingResume")}
              </button>
              <button
                type="button"
                disabled={disabled}
                className={clsx(btn, "border-rose-200 text-rose-800")}
                onClick={() => {
                  if (!window.confirm(t(lang, "internalShopActionConfirmCancelSub"))) return;
                  void runEngine("cancel", () =>
                    subscriptionEngine.cancel({ subscriptionId: subId, shopId, reason: reason || "Admin cancel" }),
                  );
                }}
              >
                {t(lang, "billingCancel")}
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            className={btn}
            onClick={() =>
              void runEngine("reset", () =>
                subscriptionEngine.resetToFree({ shopId, reason: reason || "Admin reset to free" }),
              )
            }
          >
            {t(lang, "billingResetFree")}
          </button>
          <button type="button" disabled={disabled} className={btn} onClick={() => setPromoOpen((v) => !v)}>
            {t(lang, "billingPromotionalAccess")}
          </button>
        </div>
        {!canManage ? (
          <p className="mt-2 text-xs font-semibold text-muted-foreground">{t(lang, "internalShopProfilePlanNoPermission")}</p>
        ) : null}
      </section>

      {promoOpen ? (
        <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
          <PromotionalAccessPanel shopId={shopId} canManage={canManage && !previewMode} previewMode={previewMode} />
        </section>
      ) : null}

      <section>
        <p className="mb-2 text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingTimelineTitle")}</p>
        <BillingTimeline lang={lang} events={timelineEvents.slice(0, 10)} compact />
      </section>

      {historyRows.length > 0 ? (
        <section>
          <p className="mb-2 text-[10px] font-black uppercase text-muted-foreground">{t(lang, "billingHistoryTitle")}</p>
          <SubscriptionHistoryPanel lang={lang} rows={historyRows.slice(0, 12)} compact />
        </section>
      ) : null}
    </div>
  );
}
