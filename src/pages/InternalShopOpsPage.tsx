import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { WakaAdminShell } from "../components/internal-admin/WakaAdminShell";
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
  googleMapsDirectionsUrl,
  type AdminPlanCode,
  type ShopOpsDetail,
  type WakaInternalAdminRow,
} from "../lib/wakaInternalAdmin";

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

export function InternalShopOpsPage({ lang, email }: Props) {
  const { shopId } = useParams<{ shopId: string }>();
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
    const d = await fetchShopOpsDetail(shopId);
    setDetail(d);
    setLoadingShop(false);
  }, [shopId]);

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

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
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

  if (!shopId && !loadingAdmin) {
    return <Navigate to="/internal/waka" replace />;
  }

  const subId = detail?.subscription?.id;

  return (
    <WakaAdminShell lang={lang} adminRow={adminRow} loading={loadingAdmin} active="shop">
      <div className="mx-auto max-w-3xl space-y-4 pb-8">
        <Link
          to="/internal/waka#ops-recent-shops"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-orange-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t(lang, "internalShopProfileBack")}
        </Link>

      {loadingShop ? (
        <p className="rounded-3xl border border-stone-200 bg-white px-5 py-8 text-center font-semibold text-stone-600">
          {t(lang, "internalShopProfileLoading")}
        </p>
      ) : !detail ? (
        <p className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-8 text-center font-bold text-rose-900">
          {t(lang, "internalShopProfileError")}
        </p>
      ) : (
        <>
          <div className="rounded-3xl border border-stone-200/80 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wider text-orange-700">{email ?? "—"}</p>
            <h1 className="mt-1 text-2xl font-black text-stone-900">{detail.shop.name}</h1>
            <p className="mt-2 text-sm font-semibold text-stone-600">
              {[detail.shop.district, detail.shop.city].filter(Boolean).join(" · ") || "—"}
            </p>
            {detail.owner_label ? (
              <p className="mt-2 text-sm font-bold text-stone-800">
                {t(lang, "internalRecentColOwner")}: {detail.owner_label}
              </p>
            ) : null}
            {detail.shop.phone_e164 ? (
              <p className="mt-1 font-mono text-sm text-stone-700">{detail.shop.phone_e164}</p>
            ) : null}
            {detail.shop.created_at ? (
              <p className="mt-1 text-xs font-semibold text-stone-500">
                {t(lang, "internalShopProfileJoined")}: {new Date(detail.shop.created_at).toLocaleDateString("en-GB")}
              </p>
            ) : null}
            {detail.shop.latitude != null &&
            detail.shop.longitude != null &&
            !Number.isNaN(detail.shop.latitude) &&
            !Number.isNaN(detail.shop.longitude) ? (
              <a
                href={googleMapsDirectionsUrl(detail.shop.latitude!, detail.shop.longitude!)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-[44px] items-center rounded-2xl bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-700"
              >
                {t(lang, "internalVisitDirections")}
              </a>
            ) : null}
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-2xl bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
                <dt className="font-bold text-stone-500">{t(lang, "internalShopProfilePlan")}</dt>
                <dd className="font-mono font-black text-stone-900">{detail.plan_code ?? detail.subscription?.plan_code ?? "—"}</dd>
              </div>
              <div className="rounded-2xl bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
                <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileSubStatus")}</dt>
                <dd className="font-mono font-black uppercase text-stone-900">{detail.subscription?.status ?? "—"}</dd>
              </div>
              <div className="rounded-2xl bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
                <dt className="font-bold text-stone-500">{t(lang, "internalShopProfilePayment")}</dt>
                <dd className="font-mono font-black text-stone-900">{detail.subscription?.payment_status ?? "—"}</dd>
              </div>
              <div className="rounded-2xl bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
                <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileLastSeen")}</dt>
                <dd className="font-mono text-stone-800">
                  {detail.shop.last_seen_at ? new Date(detail.shop.last_seen_at).toLocaleString("en-GB") : "—"}
                </dd>
              </div>
            </dl>
          </div>

          {detail.sync_health ? (
            <div className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-stone-900">{t(lang, "internalShopProfileSyncTitle")}</h2>
              <dl className="mt-3 space-y-2 text-sm">
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
            </div>
          ) : null}

          <div className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-stone-900">{t(lang, "internalShopProfileDevicesTitle")}</h2>
            <p className="mt-1 text-xs font-semibold text-stone-500">{t(lang, "internalShopProfileDevicesSub")}</p>
            {detail.devices.length === 0 ? (
              <p className="mt-4 text-sm font-semibold text-stone-500">{t(lang, "internalShopProfileDevicesEmpty")}</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {detail.devices.map((d) => {
                  const online = deviceOnline(d.last_seen_at);
                  return (
                    <li key={d.id} className="rounded-2xl border border-stone-100 bg-stone-50/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-black text-stone-900">{d.label || d.device_fingerprint.slice(0, 18)}</p>
                          <p className="text-xs font-semibold text-stone-500">
                            {[d.platform, d.app_version].filter(Boolean).join(" · ") || "—"} ·{" "}
                            {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString("en-GB") : "—"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase">
                            <span className={online ? "rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-900" : "rounded-md bg-stone-200 px-2 py-0.5 text-stone-700"}>
                              {online ? t(lang, "internalShopProfileDeviceOnline") : t(lang, "internalShopProfileDeviceOffline")}
                            </span>
                            {d.trusted ? (
                              <span className="rounded-md bg-orange-100 px-2 py-0.5 text-orange-900">{t(lang, "internalShopProfileDeviceTrusted")}</span>
                            ) : null}
                            {d.suspicious_flag ? (
                              <span className="rounded-md bg-rose-100 px-2 py-0.5 text-rose-900">{t(lang, "internalShopProfileDeviceSuspicious")}</span>
                            ) : null}
                          </div>
                        </div>
                        {canSupport ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-xl border-2 border-stone-300 px-3 py-2 text-xs font-black text-stone-900 disabled:opacity-40"
                              onClick={() => void run(() => adminShopDeviceSetActive(d.id, !d.is_active))}
                            >
                              {d.is_active ? t(lang, "internalShopProfileDeviceDeactivate") : t(lang, "internalShopProfileDeviceActivate")}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-xl bg-orange-100 px-3 py-2 text-xs font-black text-orange-950 disabled:opacity-40"
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
          </div>

          {detail.subscriptionPaymentsRecent.length > 0 ? (
            <div className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-stone-900">{t(lang, "internalShopProfilePaymentsTitle")}</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {detail.subscriptionPaymentsRecent.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
                    <span className="font-mono text-xs text-stone-600">{new Date(p.created_at).toLocaleString("en-GB")}</span>
                    <span className="font-black text-stone-900">
                      UGX {p.amount_ugx.toLocaleString("en-UG")} · {p.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {toast ? (
            <p
              className={`rounded-2xl px-4 py-3 text-center text-sm font-bold ${
                toast.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"
              }`}
            >
              {toast.text}
            </p>
          ) : null}

          <div className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-orange-700">
                  {t(lang, "internalShopProfilePlanControlTitle")}
                </p>
                <h2 className="mt-1 text-lg font-black text-stone-900">{t(lang, "internalShopProfilePlanControlSub")}</h2>
              </div>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-[10px] font-black uppercase text-stone-700">
                {detail.plan_code ?? detail.subscription?.plan_code ?? "free"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_9rem]">
              <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
                {t(lang, "internalShopProfilePlanSelect")}
                <select
                  value={planControlCode}
                  onChange={(e) => setPlanControlCode(e.target.value as AdminPlanCode)}
                  disabled={!canSubs || busy}
                  className="mt-1 min-h-[44px] w-full rounded-2xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-900 outline-none focus:ring-2 focus:ring-orange-200 disabled:opacity-50"
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
                  className="mt-1 min-h-[44px] w-full rounded-2xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-900 outline-none focus:ring-2 focus:ring-orange-200 disabled:opacity-50"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !canSubs}
                className="rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40"
                onClick={() => void setAdminPlan(planControlCode)}
              >
                {t(lang, "internalShopProfileApplyPlan")}
              </button>
              {ADMIN_PLAN_CODES.map((code) => (
                <button
                  key={code}
                  type="button"
                  disabled={busy || !canSubs}
                  className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-black uppercase text-stone-800 disabled:opacity-40"
                  onClick={() => void setAdminPlan(code)}
                >
                  {code.replace("_", " ")}
                </button>
              ))}
            </div>

            {!canSubs ? (
              <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-500">
                {t(lang, "internalShopProfilePlanNoPermission")}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {detail.shop.is_active ? (
              <button
                type="button"
                disabled={busy || !canSupport}
                className="rounded-2xl border-2 border-stone-300 py-4 text-base font-black text-stone-900 disabled:opacity-40"
                onClick={() => void run(() => adminSetShopActive(detail.shop.id, false))}
              >
                {t(lang, "internalShopProfileSuspend")}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !canSupport}
                className="rounded-2xl bg-emerald-600 py-4 text-base font-black text-white disabled:opacity-40"
                onClick={() => void run(() => adminSetShopActive(detail.shop.id, true))}
              >
                {t(lang, "internalShopProfileReactivate")}
              </button>
            )}
            <button
              type="button"
              disabled={busy || !canSupport}
              className="rounded-2xl border-2 border-orange-200 bg-orange-50 py-4 text-base font-black text-orange-950 disabled:opacity-40"
              onClick={() => void run(() => adminShopResetSync(detail.shop.id))}
            >
              {t(lang, "internalShopProfileResetSync")}
            </button>
            <button
              type="button"
              disabled={busy || !canSupport}
              className="rounded-2xl border-2 border-rose-200 bg-rose-50 py-4 text-base font-black text-rose-950 disabled:opacity-40"
              onClick={() => void run(() => adminShopForceLogoutDevices(detail.shop.id))}
            >
              {t(lang, "internalShopProfileForceLogout")}
            </button>
            {detail.subscription && ["trial", "trialing"].includes((detail.subscription.status ?? "").toLowerCase()) && subId ? (
              <button
                type="button"
                disabled={busy || !canSubs}
                className="rounded-2xl bg-orange-500 py-4 text-base font-black text-white disabled:opacity-40 sm:col-span-2"
                onClick={() => void run(() => adminExtendSubscriptionTrial(subId, 7))}
              >
                {t(lang, "internalShopProfileExtendTrial")}
              </button>
            ) : null}
            {subId && canSubs ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-2xl border-2 border-stone-300 py-4 text-base font-black text-stone-800"
                  onClick={() => void run(() => adminSubscriptionSetStatus(subId, "paused"))}
                >
                  {t(lang, "internalShopProfilePauseSub")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 py-4 text-base font-black text-emerald-950"
                  onClick={() => void run(() => adminSubscriptionSetStatus(subId, "active"))}
                >
                  {t(lang, "internalShopProfileReactivateSub")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-2xl border-2 border-rose-200 py-4 text-base font-black text-rose-900"
                  onClick={() => void run(() => adminSubscriptionSetStatus(subId, "cancelled"))}
                >
                  {t(lang, "internalShopProfileCancelSub")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-2xl bg-waka-600 py-4 text-base font-black text-white sm:col-span-2"
                  onClick={() =>
                    void run(() => adminSubscriptionMarkPayment(subId, suggestedPaymentUgx, `Recorded ${suggestedPaymentUgx} UGX`))
                  }
                >
                  {t(lang, "internalShopProfileMarkPaid")} (UGX {suggestedPaymentUgx.toLocaleString("en-UG")})
                </button>
              </>
            ) : null}
          </div>

          {canSupport ? (
            <div className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-stone-900">{t(lang, "internalShopProfileSupportTitle")}</h2>
              <p className="mt-1 text-xs font-semibold text-stone-500">{t(lang, "internalShopProfileSupportSub")}</p>
              <label className="mt-3 block text-xs font-bold text-stone-600">
                {t(lang, "internalShopProfileSupportSubject")}
                <input
                  value={supportSubject}
                  onChange={(e) => setSupportSubject(e.target.value)}
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-base font-semibold text-stone-900"
                  placeholder="…"
                />
              </label>
              <label className="mt-3 block text-xs font-bold text-stone-600">
                {t(lang, "internalShopProfileSupportBody")}
                <textarea
                  value={supportBody}
                  onChange={(e) => setSupportBody(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-base font-semibold text-stone-900"
                  placeholder="…"
                />
              </label>
              <button
                type="button"
                disabled={busy || !supportBody.trim()}
                className="mt-4 w-full rounded-2xl bg-violet-600 py-4 text-base font-black text-white disabled:opacity-40"
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
            </div>
          ) : null}
        </>
      )}
      </div>
    </WakaAdminShell>
  );
}
