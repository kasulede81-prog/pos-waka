import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  adminExtendSubscriptionTrial,
  adminSetShopActive,
  fetchShopOpsDetail,
  fetchWakaInternalAdminMe,
  type ShopOpsDetail,
  type WakaInternalAdminRow,
} from "../lib/wakaInternalAdmin";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

export function InternalShopOpsPage({ lang, email }: Props) {
  const { shopId } = useParams<{ shopId: string }>();
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [detail, setDetail] = useState<ShopOpsDetail | null>(null);
  const [loadingShop, setLoadingShop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

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

  if (loadingAdmin) {
    return (
      <div className="pb-12 pt-2">
        <div className="h-32 animate-pulse rounded-3xl bg-stone-200/70" />
      </div>
    );
  }

  if (!adminRow) {
    return <Navigate to="/" replace />;
  }

  if (!shopId) {
    return <Navigate to="/internal/waka" replace />;
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 pb-14 pt-2">
      <Link to="/internal/waka" className="inline-flex min-h-[44px] items-center text-sm font-bold text-orange-800 underline">
        ← {t(lang, "internalShopProfileBack")}
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
            {detail.shop.phone_e164 ? (
              <p className="mt-1 font-mono text-sm text-stone-700">{detail.shop.phone_e164}</p>
            ) : null}
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-stone-500">{t(lang, "internalShopProfilePlan")}</dt>
                <dd className="font-mono font-black text-stone-900">{detail.subscription?.plan_code ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileSubStatus")}</dt>
                <dd className="font-mono font-black uppercase text-stone-900">{detail.subscription?.status ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileLastSeen")}</dt>
                <dd className="font-mono text-stone-800">
                  {detail.shop.last_seen_at ? new Date(detail.shop.last_seen_at).toLocaleString("en-GB") : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileDevices")}</dt>
                <dd className="font-mono font-black text-stone-900">{detail.deviceCount}</dd>
              </div>
            </dl>
          </div>

          {toast ? (
            <p
              className={`rounded-2xl px-4 py-3 text-center text-sm font-bold ${
                toast.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"
              }`}
            >
              {toast.text}
            </p>
          ) : null}

          <div className="grid gap-3">
            {detail.shop.is_active ? (
              <button
                type="button"
                disabled={busy}
                className="rounded-2xl border-2 border-stone-300 py-4 text-base font-black text-stone-900 disabled:opacity-50"
                onClick={() => void run(() => adminSetShopActive(detail.shop.id, false))}
              >
                {t(lang, "internalShopProfileSuspend")}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                className="rounded-2xl bg-emerald-600 py-4 text-base font-black text-white disabled:opacity-50"
                onClick={() => void run(() => adminSetShopActive(detail.shop.id, true))}
              >
                {t(lang, "internalShopProfileReactivate")}
              </button>
            )}
            {detail.subscription &&
            ["trial", "trialing"].includes((detail.subscription.status ?? "").toLowerCase()) ? (
              <button
                type="button"
                disabled={busy}
                className="rounded-2xl bg-orange-500 py-4 text-base font-black text-white disabled:opacity-50"
                onClick={() => void run(() => adminExtendSubscriptionTrial(detail.subscription!.id, 7))}
              >
                {t(lang, "internalShopProfileExtendTrial")}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
