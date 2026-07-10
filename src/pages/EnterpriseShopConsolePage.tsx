import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { AdminShell } from "../components/internal-admin/v2/AdminShell";
import { BottomSheet } from "../components/internal-admin/v2/primitives";
import type { AdminActionOption } from "../components/internal-admin/adminUi";
import {
  ShopConsoleQuickActions,
  ShopConsoleTabBar,
} from "../components/internal-admin/v2/shop-console/ShopConsoleLayout";
import { ShopConsoleOverviewTab } from "../components/internal-admin/v2/shop-console/tabs/ShopConsoleOverviewTab";
import { ShopConsoleBusinessTab } from "../components/internal-admin/v2/shop-console/tabs/ShopConsoleBusinessTab";
import { ShopConsoleDevicesTab } from "../components/internal-admin/v2/shop-console/tabs/ShopConsoleDevicesTab";
import { ShopConsoleSubscriptionsTab } from "../components/internal-admin/v2/shop-console/tabs/ShopConsoleSubscriptionsTab";
import { ShopConsoleSecurityTab } from "../components/internal-admin/v2/shop-console/tabs/ShopConsoleSecurityTab";
import { ShopConsoleSupportTab } from "../components/internal-admin/v2/shop-console/tabs/ShopConsoleSupportTab";
import { useShopConsoleState } from "../components/internal-admin/v2/shop-console/useShopConsoleState";
import { buildShopConsoleIntel } from "../components/internal-admin/v2/shop-console/shopConsoleIntel";
import { healthColor } from "../lib/internalOpsIntelligence";
import { isInternalAdminPreviewActive } from "../lib/internalAdminPreview";
import {
  persistShopConsoleTab,
  shopConsoleTabFromLocation,
  shopConsoleTabHref,
  type ShopConsoleTab,
} from "../lib/shopConsoleState";
import { t } from "../lib/i18n";
import { sendOwnerPasswordResetEmail } from "../lib/shopRecoverySignals";
import {
  ADMIN_PLAN_CODES,
  adminExtendSubscriptionTrial,
  adminSetShopActive,
  adminShopSetSubscriptionPlan,
  adminShopForceLogoutDevices,
  adminShopResetBackOfficePin,
  adminShopResetSync,
  adminShopSendOwnerPasswordReset,
  adminSubscriptionMarkPayment,
  adminSubscriptionSetStatus,
  formatDisplayEmail,
  formatLastActive,
  formatOwnerDisplayLabel,
  type AdminPlanCode,
} from "../lib/wakaInternalAdmin";
import type { Language } from "../types";
import clsx from "clsx";

const ShopConsoleActivityTab = lazy(() =>
  import("../components/internal-admin/v2/shop-console/tabs/ShopConsoleActivityTab").then((m) => ({
    default: m.ShopConsoleActivityTab,
  })),
);
const ShopConsoleAuditTab = lazy(() =>
  import("../components/internal-admin/v2/shop-console/tabs/ShopConsoleAuditTab").then((m) => ({
    default: m.ShopConsoleAuditTab,
  })),
);
const ShopConsoleDeveloperTab = lazy(() =>
  import("../components/internal-admin/v2/shop-console/tabs/ShopConsoleDeveloperTab").then((m) => ({
    default: m.ShopConsoleDeveloperTab,
  })),
);
const ShopConsoleAiTab = lazy(() =>
  import("../components/internal-admin/v2/shop-console/tabs/ShopConsoleAiTab").then((m) => ({
    default: m.ShopConsoleAiTab,
  })),
);

type Props = {
  lang: Language;
  email: string | null | undefined;
};

const PLAN_AMOUNTS: Record<string, number> = {
  starter: 25_000,
  business: 56_000,
  waka_plus: 110_000,
};

function TabFallback() {
  return (
    <p className="rounded-2xl border border-stone-200 bg-white px-4 py-8 text-center text-sm font-semibold text-stone-600">
      Loading…
    </p>
  );
}

export function EnterpriseShopConsolePage({ lang }: Props) {
  const { shopId } = useParams<{ shopId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const previewRequested = isInternalAdminPreviewActive(location.search);

  const ctx = useShopConsoleState(lang, shopId, previewRequested);
  const {
    detail,
    loadingAdmin,
    loadingShop,
    adminRow,
    toast,
    busy,
    canSupport,
    canSubs,
    subId,
    executeAction,
    previewMode,
  } = ctx;

  const [activeTab, setActiveTab] = useState<ShopConsoleTab>(() =>
    shopConsoleTabFromLocation(location.search, location.hash, shopId),
  );
  const [actionSheet, setActionSheet] = useState(false);
  const [planControlCode, setPlanControlCode] = useState<AdminPlanCode>("business");
  const [planControlDays, setPlanControlDays] = useState(30);

  useEffect(() => {
    const tab = shopConsoleTabFromLocation(location.search, location.hash, shopId);
    setActiveTab(tab);
  }, [location.search, location.hash, shopId]);

  const onTabChange = useCallback(
    (tab: ShopConsoleTab) => {
      if (!shopId) return;
      setActiveTab(tab);
      persistShopConsoleTab(shopId, tab);
      navigate(shopConsoleTabHref(shopId, tab, previewMode), { replace: true });
    },
    [navigate, previewMode, shopId],
  );

  useEffect(() => {
    const code = (detail?.plan_code ?? detail?.subscription?.plan_code ?? "free").toLowerCase();
    if (ADMIN_PLAN_CODES.includes(code as AdminPlanCode)) setPlanControlCode(code as AdminPlanCode);
  }, [detail?.plan_code, detail?.subscription?.plan_code]);

  const suggestedPaymentUgx = useMemo(() => {
    const code = (detail?.plan_code ?? detail?.subscription?.plan_code ?? "business").toLowerCase();
    return PLAN_AMOUNTS[code] ?? PLAN_AMOUNTS.business;
  }, [detail?.plan_code, detail?.subscription?.plan_code]);

  const shopIntel = useMemo(() => {
    if (!detail) return null;
    return buildShopConsoleIntel(detail, ctx.auditRowsLight);
  }, [detail, ctx.auditRowsLight]);

  const setAdminPlan = async (planCode: AdminPlanCode) => {
    if (!detail) return;
    const effectiveDays = planCode === "waka_plus" ? 30 : planControlDays;
    if (planCode === "waka_plus" && planControlDays !== 30) setPlanControlDays(30);
    await executeAction(
      "admin_shop_set_subscription_plan",
      () =>
        adminShopSetSubscriptionPlan({
          shopId: detail.shop.id,
          planCode,
          days: effectiveDays,
        }),
      { permitted: canSubs },
    );
  };

  const shopActions = useMemo((): AdminActionOption[] => {
    if (!detail) return [];
    const groupShop = t(lang, "internalShopActionGroupShop");
    const groupSub = t(lang, "internalShopActionGroupSub");
    const groupPlan = t(lang, "internalShopActionGroupPlan");
    const actions: AdminActionOption[] = [];

    if (canSupport) {
      actions.push({
        id: detail.shop.is_active ? "suspend" : "reactivate",
        label: detail.shop.is_active ? t(lang, "internalShopProfileSuspend") : t(lang, "internalShopProfileReactivate"),
        group: groupShop,
        confirm: detail.shop.is_active ? t(lang, "internalShopActionConfirmSuspend") : undefined,
      });
      actions.push({ id: "reset_sync", label: t(lang, "internalShopProfileResetSync"), group: groupShop });
      actions.push({
        id: "force_logout",
        label: t(lang, "internalShopProfileForceLogout"),
        group: groupShop,
        confirm: t(lang, "internalShopActionConfirmLogout"),
      });
      actions.push({ id: "password_reset", label: "Send owner password reset", group: "Account recovery" });
      actions.push({ id: "clear_bo_pin", label: "Clear back office PIN", group: "Account recovery" });
    }

    if (subId && canSubs) {
      if (detail.subscription && ["trial", "trialing"].includes((detail.subscription.status ?? "").toLowerCase())) {
        actions.push({ id: "extend_trial", label: t(lang, "internalShopProfileExtendTrial"), group: groupSub });
      }
      actions.push({ id: "pause_sub", label: t(lang, "internalShopProfilePauseSub"), group: groupSub });
      actions.push({ id: "active_sub", label: t(lang, "internalShopProfileReactivateSub"), group: groupSub });
      actions.push({
        id: "cancel_sub",
        label: t(lang, "internalShopProfileCancelSub"),
        group: groupSub,
        confirm: t(lang, "internalShopActionConfirmCancelSub"),
      });
      actions.push({
        id: "mark_paid",
        label: `${t(lang, "internalShopProfileMarkPaid")} · UGX ${suggestedPaymentUgx.toLocaleString("en-UG")}`,
        group: groupSub,
      });
    }

    if (canSubs) {
      for (const code of ADMIN_PLAN_CODES) {
        actions.push({
          id: `plan_${code}`,
          label: `${t(lang, "internalShopProfileApplyPlan")}: ${code.replace("_", " ")}`,
          group: groupPlan,
        });
      }
    }

    return actions;
  }, [canSubs, canSupport, detail, lang, subId, suggestedPaymentUgx]);

  const runPasswordReset = async () => {
    if (!detail) return;
    await executeAction(
      "admin_password_reset_email",
      async () => {
        const id = detail.shop.id;
        const audit = await adminShopSendOwnerPasswordReset(id);
        if (!audit.ok) return audit;
        const email = audit.ownerEmail ?? detail.owner_email?.trim().toLowerCase() ?? "";
        if (!email) return { ok: false, message: "No owner email on file." };
        const sent = await sendOwnerPasswordResetEmail(email);
        const { adminShopLogPasswordResetEmail } = await import("../lib/wakaInternalAdmin");
        await adminShopLogPasswordResetEmail(
          id,
          sent.ok,
          sent.ok ? `Email sent to ${email}` : sent.message ?? "send_failed",
        );
        if (!sent.ok) {
          return {
            ok: false,
            message:
              sent.message ??
              "Audit logged but email failed. Check Supabase Auth email settings and redirect URL.",
          };
        }
        return sent;
      },
      { permitted: canSupport, confirm: "Send owner password reset email?" },
    );
  };

  const runShopAction = (actionId: string) => {
    if (!detail) return;
    switch (actionId) {
      case "suspend":
        void executeAction(
          "admin_suspend_shop",
          () => adminSetShopActive(detail.shop.id, false),
          { permitted: canSupport, confirm: t(lang, "internalShopActionConfirmSuspend") },
        );
        break;
      case "reactivate":
        void executeAction("admin_reactivate_shop", () => adminSetShopActive(detail.shop.id, true), {
          permitted: canSupport,
        });
        break;
      case "reset_sync":
        void executeAction("admin_force_sync", () => adminShopResetSync(detail.shop.id), { permitted: canSupport });
        break;
      case "force_logout":
        void executeAction("admin_force_logout", () => adminShopForceLogoutDevices(detail.shop.id), {
          permitted: canSupport,
          confirm: t(lang, "internalShopActionConfirmLogout"),
        });
        break;
      case "password_reset":
        void runPasswordReset();
        break;
      case "clear_bo_pin":
        void executeAction("admin_reset_backoffice_pin", () => adminShopResetBackOfficePin(detail.shop.id), {
          permitted: canSupport,
          confirm: "Clear back office PIN for this shop?",
        });
        break;
      case "extend_trial":
        if (subId)
          void executeAction("admin_extend_trial", () => adminExtendSubscriptionTrial(subId, 7), { permitted: canSubs });
        break;
      case "pause_sub":
        if (subId)
          void executeAction("admin_pause_subscription", () => adminSubscriptionSetStatus(subId, "paused"), {
            permitted: canSubs,
          });
        break;
      case "active_sub":
        if (subId)
          void executeAction("admin_reactivate_subscription", () => adminSubscriptionSetStatus(subId, "active"), {
            permitted: canSubs,
          });
        break;
      case "cancel_sub":
        if (subId)
          void executeAction(
            "admin_cancel_subscription",
            () => adminSubscriptionSetStatus(subId, "cancelled"),
            { permitted: canSubs, confirm: t(lang, "internalShopActionConfirmCancelSub") },
          );
        break;
      case "mark_paid":
        if (subId) {
          void executeAction(
            "admin_mark_subscription_paid",
            () =>
              adminSubscriptionMarkPayment(subId, suggestedPaymentUgx, `Recorded ${suggestedPaymentUgx} UGX`),
            { permitted: canSubs },
          );
        }
        break;
      default:
        if (actionId.startsWith("plan_")) {
          const code = actionId.replace("plan_", "") as AdminPlanCode;
          if (ADMIN_PLAN_CODES.includes(code)) void setAdminPlan(code);
        }
        break;
    }
  };

  const actionGroups = useMemo(() => {
    const groups = new Map<string, typeof shopActions>();
    for (const a of shopActions) {
      const list = groups.get(a.group) ?? [];
      list.push(a);
      groups.set(a.group, list);
    }
    return [...groups.entries()];
  }, [shopActions]);

  if (!shopId && !loadingAdmin) {
    return <Navigate to="/internal/waka/shops" replace />;
  }

  const renderTab = () => {
    switch (activeTab) {
      case "overview":
        return <ShopConsoleOverviewTab ctx={ctx} />;
      case "business":
        return <ShopConsoleBusinessTab ctx={ctx} />;
      case "devices":
        return <ShopConsoleDevicesTab ctx={ctx} />;
      case "subscriptions":
        return (
          <ShopConsoleSubscriptionsTab
            ctx={ctx}
            planControlCode={planControlCode}
            setPlanControlCode={setPlanControlCode}
            planControlDays={planControlDays}
            setPlanControlDays={setPlanControlDays}
            onApplyPlan={() => void setAdminPlan(planControlCode)}
          />
        );
      case "activity":
        return (
          <Suspense fallback={<TabFallback />}>
            <ShopConsoleActivityTab ctx={ctx} />
          </Suspense>
        );
      case "audit":
        return (
          <Suspense fallback={<TabFallback />}>
            <ShopConsoleAuditTab ctx={ctx} />
          </Suspense>
        );
      case "security":
        return <ShopConsoleSecurityTab ctx={ctx} onDeleted={() => navigate("/internal/waka/shops")} />;
      case "support":
        return <ShopConsoleSupportTab ctx={ctx} />;
      case "developer":
        return (
          <Suspense fallback={<TabFallback />}>
            <ShopConsoleDeveloperTab ctx={ctx} />
          </Suspense>
        );
      case "ai":
        return (
          <Suspense fallback={<TabFallback />}>
            <ShopConsoleAiTab ctx={ctx} />
          </Suspense>
        );
      default:
        return <ShopConsoleOverviewTab ctx={ctx} />;
    }
  };

  return (
    <AdminShell lang={lang} adminRow={adminRow} loading={loadingAdmin} active="shop" previewMode={previewMode}>
      <div className="mx-auto max-w-3xl space-y-3">
        {previewMode ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-950">
            {t(lang, "internalAdminPreviewShopHint")}
          </p>
        ) : null}

        {loadingShop ? (
          <p className="rounded-2xl border border-stone-200 bg-white px-4 py-8 text-center text-sm font-semibold text-stone-600">
            {t(lang, "internalShopProfileLoading")}
          </p>
        ) : !detail ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-8 text-center text-sm font-bold text-rose-900">
            {t(lang, "internalShopProfileError")}
          </p>
        ) : (
          <>
            <header className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-waka-800">Shop Console</p>
                  <h1 className="mt-1 truncate text-xl font-black text-stone-900">{detail.shop.name}</h1>
                  <p className="mt-1 text-xs font-semibold text-stone-600">
                    {formatOwnerDisplayLabel({
                      ownerFullName: detail.owner_full_name,
                      ownerLabel: detail.owner_label,
                    }) ?? "—"}
                    {formatDisplayEmail(detail.owner_email) ? ` · ${formatDisplayEmail(detail.owner_email)}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-waka-50 px-2.5 py-0.5 text-[10px] font-black text-waka-900">
                      {detail.plan_code ?? detail.subscription?.plan_code ?? "free"}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                        formatLastActive(detail.shop.last_seen_at) === "Active now"
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-stone-100 text-stone-700"
                      }`}
                    >
                      {formatLastActive(detail.shop.last_seen_at)}
                    </span>
                  </div>
                </div>
                {shopIntel ? (
                  <div
                    className={clsx(
                      "flex min-h-[44px] items-center rounded-xl px-4 text-xs font-black",
                      healthColor(shopIntel.health.level),
                    )}
                  >
                    Health {shopIntel.health.score}%
                  </div>
                ) : null}
              </div>
            </header>

            <ShopConsoleTabBar activeTab={activeTab} onTabChange={onTabChange} />
            <ShopConsoleQuickActions
              activeTab={activeTab}
              onTabChange={onTabChange}
              ctx={ctx}
              onOpenActions={() => setActionSheet(true)}
              quickHandlers={{
                onResetPassword: () => void runPasswordReset(),
                onForceSync: () =>
                  void executeAction("admin_force_sync", () => adminShopResetSync(detail.shop.id), {
                    permitted: canSupport,
                  }),
                onSuspendOrReactivate: () => {
                  if (detail.shop.is_active) {
                    void executeAction(
                      "admin_suspend_shop",
                      () => adminSetShopActive(detail.shop.id, false),
                      { permitted: canSupport, confirm: t(lang, "internalShopActionConfirmSuspend") },
                    );
                  } else {
                    void executeAction("admin_reactivate_shop", () => adminSetShopActive(detail.shop.id, true), {
                      permitted: canSupport,
                    });
                  }
                },
              }}
            />

            {renderTab()}

            {shopActions.length > 0 ? (
              <BottomSheet
                open={actionSheet}
                onClose={() => setActionSheet(false)}
                title={t(lang, "internalShopActionsSelect")}
              >
                <div className="space-y-4">
                  {actionGroups.map(([group, actions]) => (
                    <div key={group}>
                      <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-stone-500">{group}</p>
                      <ul className="space-y-2">
                        {actions.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              disabled={busy}
                              className="min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-bold text-stone-900 disabled:opacity-40"
                              onClick={() => {
                                if (a.confirm && !window.confirm(a.confirm)) return;
                                runShopAction(a.id);
                                setActionSheet(false);
                              }}
                            >
                              {a.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </BottomSheet>
            ) : null}

            {toast ? (
              <p
                className={`rounded-xl px-3 py-2.5 text-center text-sm font-bold ${
                  toast.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"
                }`}
              >
                {toast.text}
              </p>
            ) : null}
          </>
        )}
      </div>
    </AdminShell>
  );
}
