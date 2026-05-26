import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { WakaAdminShell } from "../components/internal-admin/WakaAdminShell";
import { AdminActionPicker, AdminCollapsible, type AdminActionOption } from "../components/internal-admin/adminUi";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  ADMIN_PLAN_CODES,
  adminExtendSubscriptionTrial,
  adminSetShopActive,
  adminShopSetSubscriptionPlan,
  adminShopDeviceSetActive,
  adminShopDeviceSetTrusted,
  adminShopForceLogoutDevices,
  adminShopOpenSupportMessage,
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

export function InternalShopOpsPage({ lang }: Props) {
  const { shopId } = useParams<{ shopId: string }>();
  const location = useLocation();
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
    const code = (detail?.plan_code ?? detail?.subscription?.plan_code ?? "free").toLowerCase();
    if (ADMIN_PLAN_CODES.includes(code as AdminPlanCode)) setPlanControlCode(code as AdminPlanCode);
  }, [detail?.plan_code, detail?.subscription?.plan_code]);

  const roleNorm = (adminRow?.role ?? "").toLowerCase();
  const canSupport = ["super_admin", "support_admin", "finance_admin"].includes(roleNorm);
  const canSubs = ["super_admin", "subscriptions_admin", "finance_admin", "operations_admin"].includes(roleNorm);

  const suggestedPaymentUgx = useMemo(() => {
    const code = (detail?.plan_code ?? detail?.subscription?.plan_code ?? "business").toLowerCase();
    return PLAN_AMOUNTS[code] ?? PLAN_AMOUNTS.business;
  }, [detail?.plan_code, detail?.subscription?.plan_code]);

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
    await run(() =>
      adminShopSetSubscriptionPlan({
        shopId: detail.shop.id,
        planCode,
        days: planControlDays,
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

  if (!shopId && !loadingAdmin) {
    return <Navigate to="/internal/waka" replace />;
  }

  return (
    <WakaAdminShell
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

          {shopActions.length > 0 ? (
            <AdminActionPicker
              label={t(lang, "internalShopActionsSelect")}
              runLabel={t(lang, "internalShopActionsRun")}
              placeholder={t(lang, "internalShopActionsChoose")}
              actions={shopActions}
              busy={busy}
              onRun={runShopAction}
            />
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
                  disabled={!canSubs || busy || planControlCode === "free"}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-900 outline-none focus:ring-2 focus:ring-orange-200 disabled:opacity-50"
                />
              </label>
            </div>
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
    </WakaAdminShell>
  );
}
