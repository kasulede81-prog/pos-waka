import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { AdminShell } from "../components/internal-admin/v2/AdminShell";
import { BottomSheet } from "../components/internal-admin/v2/primitives";
import { adminPermissions } from "../components/internal-admin/v2/adminRoles";
import { AccountRecoveryPanel } from "../components/internal-admin/AccountRecoveryPanel";
import { AdminShopProfileOverridePanel } from "../components/internal-admin/AdminShopProfileOverridePanel";
import { AdminPermanentDeletePanel } from "../components/internal-admin/AdminPermanentDeletePanel";
import { AdminCollapsible, type AdminActionOption } from "../components/internal-admin/adminUi";
import { InternalNotesPanel, ShopTimelinePanel } from "../components/internal-admin/v2/ops/OpsWidgets";
import {
  buildShopTimelineFromDetail,
  computeShopHealth,
  detectFraudSignals,
} from "../lib/internalOpsIntelligence";
import { fetchShopAuditTimeline, type OpsAuditRow } from "../lib/wakaInternalAdmin";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { sendOwnerPasswordResetEmail } from "../lib/shopRecoverySignals";
import {
  ADMIN_PLAN_CODES,
  adminExtendSubscriptionTrial,
  adminSetShopActive,
  adminShopSetSubscriptionPlan,
  adminShopDeviceSetActive,
  adminShopDeviceSetTrusted,
  adminShopForceLogoutDevices,
  adminShopOpenSupportMessage,
  adminShopResetBackOfficePin,
  adminShopSendOwnerPasswordReset,
  adminShopResetSync,
  adminSubscriptionMarkPayment,
  adminSubscriptionSetStatus,
  fetchShopOpsDetail,
  fetchWakaInternalAdminMe,
  formatDisplayEmail,
  formatLastActive,
  googleMapsDirectionsUrl,
  type AdminPlanCode,
  type ShopOpsDetail,
  type WakaInternalAdminRow,
} from "../lib/wakaInternalAdmin";
import {
  INTERNAL_ADMIN_PREVIEW_ROW,
  PREVIEW_SHOP_ID,
  PREVIEW_SHOP_OPS_DETAIL,
  isInternalAdminPreviewActive,
} from "../lib/internalAdminPreview";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

const PLAN_AMOUNTS: Record<string, number> = {
  starter: 25_000,
  business: 56_000,
  waka_plus: 110_000,
};

function deviceOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 15 * 60 * 1000;
}

function vipCountdownLabel(currentPeriodEnd: string | null | undefined): string | null {
  if (!currentPeriodEnd) return null;
  const end = new Date(currentPeriodEnd).getTime();
  if (!Number.isFinite(end)) return null;
  const left = end - Date.now();
  if (left <= 0) return "VIP expired";
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const days = Math.floor(left / dayMs);
  const hours = Math.floor((left % dayMs) / hourMs);
  return `VIP ${days}d ${hours}h left`;
}

export function InternalShopOpsPage({ lang }: Props) {
  const { shopId } = useParams<{ shopId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const previewMode = isInternalAdminPreviewActive(location.search);
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [detail, setDetail] = useState<ShopOpsDetail | null>(null);
  const [loadingShop, setLoadingShop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportBody, setSupportBody] = useState("");
  const [planControlCode, setPlanControlCode] = useState<AdminPlanCode>("business");
  const [planControlDays, setPlanControlDays] = useState(30);
  const [auditRows, setAuditRows] = useState<OpsAuditRow[]>([]);

  const loadShop = useCallback(async () => {
    if (!shopId) return;
    setLoadingShop(true);
    if (previewMode) {
      setDetail(
        shopId === PREVIEW_SHOP_ID || shopId.startsWith("preview-")
          ? PREVIEW_SHOP_OPS_DETAIL
          : { ...PREVIEW_SHOP_OPS_DETAIL, shop: { ...PREVIEW_SHOP_OPS_DETAIL.shop, id: shopId, name: `${PREVIEW_SHOP_OPS_DETAIL.shop.name} (${shopId})` } },
      );
      setLoadingShop(false);
      return;
    }
    const d = await fetchShopOpsDetail(shopId);
    setDetail(d);
    setLoadingShop(false);
  }, [shopId, previewMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const row = await fetchWakaInternalAdminMe();
      if (cancelled) return;
      setAdminRow(row);
      setLoadingAdmin(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadShop();
  }, [loadShop]);

  useEffect(() => {
    if (!shopId || previewMode) {
      setAuditRows([]);
      return;
    }
    void fetchShopAuditTimeline(shopId, 20).then(setAuditRows);
  }, [shopId, previewMode]);

  useEffect(() => {
    const code = (detail?.plan_code ?? detail?.subscription?.plan_code ?? "free").toLowerCase();
    if (ADMIN_PLAN_CODES.includes(code as AdminPlanCode)) setPlanControlCode(code as AdminPlanCode);
  }, [detail?.plan_code, detail?.subscription?.plan_code]);

  const perms = adminPermissions(adminRow);
  const canSupport = perms.canShopSupport;
  const canSubs = perms.canShopSubs;
  const [actionSheet, setActionSheet] = useState(false);

  const suggestedPaymentUgx = useMemo(() => {
    const code = (detail?.plan_code ?? detail?.subscription?.plan_code ?? "business").toLowerCase();
    return PLAN_AMOUNTS[code] ?? PLAN_AMOUNTS.business;
  }, [detail?.plan_code, detail?.subscription?.plan_code]);
  const vipCountdown = useMemo(() => {
    const code = (detail?.plan_code ?? detail?.subscription?.plan_code ?? "").toLowerCase();
    if (code !== "waka_plus") return null;
    return vipCountdownLabel(detail?.subscription?.current_period_end ?? null);
  }, [detail?.plan_code, detail?.subscription?.plan_code, detail?.subscription?.current_period_end]);

  const shellAdmin = previewMode ? INTERNAL_ADMIN_PREVIEW_ROW : adminRow;
  const subId = detail?.subscription?.id;

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    if (previewMode) {
      setToast({ kind: "err", text: t(lang, "internalAdminPreviewActionBlocked") });
      return;
    }
    setBusy(true);
    setToast(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      setToast({ kind: "ok", text: t(lang, "internalShopProfileDone") });
      await loadShop();
    } else {
      setToast({ kind: "err", text: r.message ?? t(lang, "internalShopProfileError") });
    }
  };

  const setAdminPlan = async (planCode: AdminPlanCode) => {
    if (!detail) return;
    const effectiveDays = planCode === "waka_plus" ? 30 : planControlDays;
    if (planCode === "waka_plus" && planControlDays !== 30) setPlanControlDays(30);
    await run(() =>
      adminShopSetSubscriptionPlan({
        shopId: detail.shop.id,
        planCode,
        days: effectiveDays,
      }),
    );
    window.dispatchEvent(new Event("waka:subscription-updated"));
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
      actions.push({
        id: "reset_sync",
        label: t(lang, "internalShopProfileResetSync"),
        group: groupShop,
      });
      actions.push({
        id: "force_logout",
        label: t(lang, "internalShopProfileForceLogout"),
        group: groupShop,
        confirm: t(lang, "internalShopActionConfirmLogout"),
      });
      actions.push({
        id: "password_reset",
        label: "Send owner password reset",
        group: "Account recovery",
      });
      actions.push({
        id: "clear_bo_pin",
        label: "Clear back office PIN",
        group: "Account recovery",
      });
    }

    if (subId && canSubs) {
      if (detail.subscription && ["trial", "trialing"].includes((detail.subscription.status ?? "").toLowerCase())) {
        actions.push({
          id: "extend_trial",
          label: t(lang, "internalShopProfileExtendTrial"),
          group: groupSub,
        });
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

  const runShopAction = (actionId: string) => {
    if (!detail) return;
    switch (actionId) {
      case "suspend":
        void run(() => adminSetShopActive(detail.shop.id, false));
        break;
      case "reactivate":
        void run(() => adminSetShopActive(detail.shop.id, true));
        break;
      case "reset_sync":
        void run(() => adminShopResetSync(detail.shop.id));
        break;
      case "force_logout":
        void run(() => adminShopForceLogoutDevices(detail.shop.id));
        break;
      case "password_reset":
        void run(async () => {
          const audit = await adminShopSendOwnerPasswordReset(detail.shop.id);
          if (!audit.ok) return audit;
          const email =
            audit.ownerEmail ??
            detail.owner_email?.trim().toLowerCase() ??
            "";
          if (!email) return { ok: false, message: "No owner email on file." };
          return sendOwnerPasswordResetEmail(email);
        });
        break;
      case "clear_bo_pin":
        void run(() => adminShopResetBackOfficePin(detail.shop.id));
        break;
      case "extend_trial":
        if (subId) void run(() => adminExtendSubscriptionTrial(subId, 7));
        break;
      case "pause_sub":
        if (subId) void run(() => adminSubscriptionSetStatus(subId, "paused"));
        break;
      case "active_sub":
        if (subId) void run(() => adminSubscriptionSetStatus(subId, "active"));
        break;
      case "cancel_sub":
        if (subId) void run(() => adminSubscriptionSetStatus(subId, "cancelled"));
        break;
      case "mark_paid":
        if (subId) {
          void run(() =>
            adminSubscriptionMarkPayment(subId, suggestedPaymentUgx, `Recorded ${suggestedPaymentUgx} UGX`),
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

  const shopIntel = useMemo(() => {
    if (!detail) return null;
    const health = computeShopHealth({
      id: detail.shop.id,
      name: detail.shop.name,
      district: detail.shop.district,
      city: detail.shop.city,
      is_active: detail.shop.is_active,
      created_at: detail.shop.created_at ?? "",
      plan_code: detail.plan_code,
      trial_days_left: null,
      last_seen_at: detail.shop.last_seen_at,
      sale_count_30d: detail.sale_count_30d,
      gps_missing: false,
    });
    const fraud = detectFraudSignals(detail);
    const timeline = [
      ...buildShopTimelineFromDetail(detail),
      ...auditRows.map((a) => ({
        id: a.id,
        at: a.created_at,
        timeLabel: new Date(a.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        message: `Admin: ${a.action.replace(/_/g, " ")}`,
        priority: "low" as const,
        kind: "system" as const,
      })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { health, fraud, timeline };
  }, [detail, auditRows]);

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

  return (
    <AdminShell
      lang={lang}
      adminRow={shellAdmin}
      loading={loadingAdmin}
      active="shop"
      previewMode={previewMode}
    >
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
          {shopIntel ? (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-900">
                Health {shopIntel.health.score}%
              </span>
              {shopIntel.fraud.map((f) => (
                <span key={f} className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-800">
                  {f}
                </span>
              ))}
            </div>
          ) : null}

          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            {formatDisplayEmail(detail.owner_email) ? (
              <p className="text-xs font-semibold text-stone-600">{formatDisplayEmail(detail.owner_email)}</p>
            ) : detail.owner_label ? (
              <p className="text-xs font-semibold text-stone-600">{detail.owner_label}</p>
            ) : null}
            <h1 className="mt-0.5 text-xl font-black text-stone-900">{detail.shop.name}</h1>
            <p className="mt-1 text-xs font-semibold text-stone-600">
              {[detail.shop.district, detail.shop.city].filter(Boolean).join(" · ") || "—"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                  formatLastActive(detail.shop.last_seen_at) === "Active now"
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-stone-100 text-stone-700"
                }`}
              >
                {formatLastActive(detail.shop.last_seen_at)}
              </span>
              <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-[10px] font-black text-orange-900">
                {detail.plan_code ?? detail.subscription?.plan_code ?? "free"}
              </span>
              <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[10px] font-black text-violet-900">
                {detail.product_count} {t(lang, "internalShopProfileProducts")}
              </span>
              <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[10px] font-black text-stone-700">
                {detail.sale_count_30d} {t(lang, "internalShopProfileSales30d")}
              </span>
              {vipCountdown ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-900">
                  {vipCountdown}
                </span>
              ) : null}
            </div>
            {detail.shop.phone_e164 ? (
              <p className="mt-1.5 font-mono text-xs text-stone-700">{detail.shop.phone_e164}</p>
            ) : null}
            {detail.shop.latitude != null &&
            detail.shop.longitude != null &&
            !Number.isNaN(detail.shop.latitude) &&
            !Number.isNaN(detail.shop.longitude) ? (
              <a
                href={googleMapsDirectionsUrl(detail.shop.latitude!, detail.shop.longitude!)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex min-h-[40px] items-center rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white hover:bg-orange-700"
              >
                {t(lang, "internalVisitDirections")}
              </a>
            ) : null}
          </div>

          {canSupport ? (
            <AccountRecoveryPanel
              shopId={detail.shop.id}
              detail={detail}
              busy={busy}
              previewMode={previewMode}
              onBusy={setBusy}
              onToast={setToast}
            />
          ) : null}

          {perms.canEditShopProfile ? (
            <AdminShopProfileOverridePanel
              detail={detail}
              busy={busy}
              previewMode={previewMode}
              onBusy={setBusy}
              onToast={setToast}
              onSaved={() => void loadShop()}
            />
          ) : null}

          {perms.canPermanentlyDeleteShopAccount ? (
            <AdminPermanentDeletePanel
              detail={detail}
              busy={busy}
              previewMode={previewMode}
              onBusy={setBusy}
              onToast={setToast}
              onDeleted={() => navigate("/internal/waka/shops")}
            />
          ) : null}

          {shopActions.length > 0 ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setActionSheet(true)}
                className="min-h-[48px] w-full rounded-2xl bg-orange-600 text-sm font-black text-white shadow-md disabled:opacity-40"
              >
                {t(lang, "internalShopActionsSelect")}
              </button>
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
            </>
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

          <AdminCollapsible
            title={t(lang, "internalShopProfilePlanControlTitle")}
            summary={`${detail.plan_code ?? detail.subscription?.plan_code ?? "free"} · ${planControlDays}d`}
          >
            <p className="mb-3 text-xs text-stone-600">{t(lang, "internalShopProfilePlanControlSub")}</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
                {t(lang, "internalShopProfilePlanSelect")}
                <select
                  value={planControlCode}
                  onChange={(e) => setPlanControlCode(e.target.value as AdminPlanCode)}
                  disabled={!canSubs || busy}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-900 outline-none focus:ring-2 focus:ring-orange-200 disabled:opacity-50"
                >
                  <option value="free">{t(lang, "planFreeName")}</option>
                  <option value="starter">{t(lang, "planStarterName")}</option>
                  <option value="business">{t(lang, "planBusinessName")}</option>
                  <option value="waka_plus">{t(lang, "planWakaPlusName")}</option>
                </select>
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
                {t(lang, "internalShopProfilePlanDays")}
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={planControlDays}
                  onChange={(e) => setPlanControlDays(Math.max(1, Number(e.target.value) || 30))}
                  disabled={!canSubs || busy || planControlCode === "free" || planControlCode === "waka_plus"}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-900 outline-none focus:ring-2 focus:ring-orange-200 disabled:opacity-50"
                />
              </label>
            </div>
            {planControlCode === "waka_plus" ? (
              <p className="mt-2 text-xs font-semibold text-emerald-800">VIP is always granted for 30 days.</p>
            ) : null}
            <button
              type="button"
              disabled={busy || !canSubs}
              className="mt-3 min-h-[44px] w-full rounded-xl bg-orange-600 text-sm font-black text-white disabled:opacity-40"
              onClick={() => void setAdminPlan(planControlCode)}
            >
              {t(lang, "internalShopProfileApplyPlan")}
            </button>
            {!canSubs ? (
              <p className="mt-2 text-xs font-semibold text-stone-500">{t(lang, "internalShopProfilePlanNoPermission")}</p>
            ) : null}
          </AdminCollapsible>

          {detail.sync_health ? (
            <AdminCollapsible
              title={t(lang, "internalShopProfileSyncTitle")}
              summary={`${detail.sync_health.pending_outbound} pending`}
            >
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileSyncPending")}</dt>
                  <dd className="font-mono font-black">{detail.sync_health.pending_outbound}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileSyncLastPull")}</dt>
                  <dd className="font-mono text-xs text-stone-700">
                    {detail.sync_health.last_pull_at ? new Date(detail.sync_health.last_pull_at).toLocaleString("en-GB") : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileSyncLastPush")}</dt>
                  <dd className="font-mono text-xs text-stone-700">
                    {detail.sync_health.last_push_ok_at ? new Date(detail.sync_health.last_push_ok_at).toLocaleString("en-GB") : "—"}
                  </dd>
                </div>
                {detail.sync_health.last_error ? (
                  <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">{detail.sync_health.last_error}</p>
                ) : null}
              </dl>
            </AdminCollapsible>
          ) : null}

          {canSupport ? (
            <AdminCollapsible title="Remote support" summary="Sync & session tools">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-[44px] rounded-xl bg-stone-900 px-4 text-xs font-black text-white disabled:opacity-40"
                  onClick={() => void run(() => adminShopResetSync(detail.shop.id))}
                >
                  Force sync reset
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-[44px] rounded-xl border border-stone-300 px-4 text-xs font-black disabled:opacity-40"
                  onClick={() => void run(() => adminShopForceLogoutDevices(detail.shop.id))}
                >
                  Force logout devices
                </button>
              </div>
              {detail.sync_health ? (
                <p className="mt-2 text-xs text-stone-600">
                  Queue: {detail.sync_health.pending_outbound} pending · last error{" "}
                  {detail.sync_health.last_error ? "yes" : "none"}
                </p>
              ) : null}
            </AdminCollapsible>
          ) : null}

          {shopIntel && shopIntel.timeline.length > 0 ? (
            <AdminCollapsible title="Activity timeline" summary={`${shopIntel.timeline.length} events`}>
              <ShopTimelinePanel events={shopIntel.timeline} />
            </AdminCollapsible>
          ) : null}

          <AdminCollapsible title="Internal notes" summary="Staff only">
            <InternalNotesPanel shopId={detail.shop.id} author={shellAdmin?.full_name ?? shellAdmin?.email ?? "Staff"} />
          </AdminCollapsible>

          <AdminCollapsible
            title={t(lang, "internalShopProfileDevicesTitle")}
            summary={`${detail.devices.length} ${t(lang, "internalShopProfileDevicesTitle").toLowerCase()}`}
          >
            {detail.devices.length === 0 ? (
              <p className="text-sm font-semibold text-stone-500">{t(lang, "internalShopProfileDevicesEmpty")}</p>
            ) : (
              <ul className="space-y-2">
                {detail.devices.map((d) => {
                  const online = deviceOnline(d.last_seen_at);
                  return (
                    <li key={d.id} className="rounded-xl border border-stone-100 bg-stone-50/60 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-stone-900">{d.label || d.device_fingerprint.slice(0, 18)}</p>
                          <p className="text-[10px] font-semibold text-stone-500">
                            {[d.platform, d.app_version].filter(Boolean).join(" · ") || "—"}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-black uppercase">
                            <span className={online ? "rounded-md bg-emerald-100 px-1.5 py-0.5 text-emerald-900" : "rounded-md bg-stone-200 px-1.5 py-0.5 text-stone-700"}>
                              {online ? t(lang, "internalShopProfileDeviceOnline") : t(lang, "internalShopProfileDeviceOffline")}
                            </span>
                            {d.trusted ? (
                              <span className="rounded-md bg-orange-100 px-1.5 py-0.5 text-orange-900">{t(lang, "internalShopProfileDeviceTrusted")}</span>
                            ) : null}
                          </div>
                        </div>
                        {canSupport ? (
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-lg border border-stone-300 px-2 py-1 text-[10px] font-black text-stone-900 disabled:opacity-40"
                              onClick={() => void run(() => adminShopDeviceSetActive(d.id, !d.is_active))}
                            >
                              {d.is_active ? t(lang, "internalShopProfileDeviceDeactivate") : t(lang, "internalShopProfileDeviceActivate")}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-lg bg-orange-100 px-2 py-1 text-[10px] font-black text-orange-950 disabled:opacity-40"
                              onClick={() => void run(() => adminShopDeviceSetTrusted(d.id, !d.trusted))}
                            >
                              {d.trusted ? t(lang, "internalShopProfileDeviceUntrust") : t(lang, "internalShopProfileDeviceTrust")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </AdminCollapsible>

          {detail.subscriptionPaymentsRecent.length > 0 ? (
            <AdminCollapsible
              title={t(lang, "internalShopProfilePaymentsTitle")}
              summary={`${detail.subscriptionPaymentsRecent.length} recent`}
            >
              <ul className="space-y-2 text-sm">
                {detail.subscriptionPaymentsRecent.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
                    <span className="font-mono text-[10px] text-stone-600">{new Date(p.created_at).toLocaleString("en-GB")}</span>
                    <span className="text-xs font-black text-stone-900">
                      UGX {p.amount_ugx.toLocaleString("en-UG")} · {p.status}
                    </span>
                  </li>
                ))}
              </ul>
            </AdminCollapsible>
          ) : null}

          {canSupport ? (
            <AdminCollapsible title={t(lang, "internalShopProfileSupportTitle")} summary={t(lang, "internalShopProfileSupportSub")}>
              <label className="block text-xs font-bold text-stone-600">
                {t(lang, "internalShopProfileSupportSubject")}
                <input
                  value={supportSubject}
                  onChange={(e) => setSupportSubject(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 px-3 text-sm font-semibold text-stone-900"
                  placeholder="…"
                />
              </label>
              <label className="mt-3 block text-xs font-bold text-stone-600">
                {t(lang, "internalShopProfileSupportBody")}
                <textarea
                  value={supportBody}
                  onChange={(e) => setSupportBody(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold text-stone-900"
                  placeholder="…"
                />
              </label>
              <button
                type="button"
                disabled={busy || !supportBody.trim()}
                className="mt-3 min-h-[44px] w-full rounded-xl bg-violet-600 text-sm font-black text-white disabled:opacity-40"
                onClick={() =>
                  void run(async () => {
                    const r = await adminShopOpenSupportMessage(detail.shop.id, supportSubject.trim() || "Staff note", supportBody.trim());
                    if (r.ok) {
                      setSupportSubject("");
                      setSupportBody("");
                    }
                    return r;
                  })
                }
              >
                {t(lang, "internalShopProfileSupportSend")}
              </button>
            </AdminCollapsible>
          ) : null}
        </>
      )}
      </div>
    </AdminShell>
  );
}
