import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MonitorSmartphone } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useDeviceActivation } from "../context/DeviceActivationContext";
import { useDeviceAuthority } from "../context/DeviceAuthorityContext";
import {
  fetchShopDeviceLimitContext,
  registerShopDeviceOnLogin,
  resolveLoginDeviceActivation,
  tryOwnerApproveCurrentDevice,
} from "../lib/deviceActivation";
import { OWNER_BYPASS_DEVICE_PENDING_ON_LOGIN } from "../lib/deviceAuthorityPolicy";
import { fetchShopDevicesForManagement } from "../lib/shopDevices";
import { getOrCreateDeviceId } from "../lib/deviceId";
import {
  formatPendingApprovalCountdown,
  isPendingApprovalExpired,
  pendingApprovalRemainingMs,
} from "../lib/devicePendingApproval";

type Props = { lang: Language };

/** Read-only waiting screen until Primary Device approves this device. */
export function DevicePendingApprovalPage({ lang }: Props) {
  const navigate = useNavigate();
  const { retry, shopId, activated, block } = useDeviceActivation();
  const { refresh, loading: authorityLoading } = useDeviceAuthority();
  const [checking, setChecking] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [requestedAt, setRequestedAt] = useState<string | null>(block?.result.approval_requested_at ?? null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);

  const remainingMs = useMemo(
    () => pendingApprovalRemainingMs(requestedAt ?? block?.result.approval_requested_at, nowMs),
    [block?.result.approval_requested_at, nowMs, requestedAt],
  );

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!shopId) return;
    void fetchShopDeviceLimitContext(shopId).then((ctx) => {
      setIsOwner(Boolean(ctx?.is_owner));
      if (ctx?.is_owner && OWNER_BYPASS_DEVICE_PENDING_ON_LOGIN && !ctx.at_limit) {
        void tryOwnerApproveCurrentDevice(shopId).then((ok) => {
          if (ok) void retry().then(() => navigate("/", { replace: true }));
        });
      }
    });
    const fp = getOrCreateDeviceId();
    void fetchShopDevicesForManagement(shopId).then(({ devices }) => {
      const mine = devices.find((d) => d.device_fingerprint === fp);
      if (mine?.approval_requested_at) setRequestedAt(mine.approval_requested_at);
    });
  }, [shopId]);

  useEffect(() => {
    if (block?.result.approval_requested_at) {
      setRequestedAt(block.result.approval_requested_at);
    }
  }, [block?.result.approval_requested_at]);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      await refresh();
      if (shopId) {
        await registerShopDeviceOnLogin(shopId);
      }
      await retry();
    } finally {
      setChecking(false);
    }
  }, [refresh, retry, shopId]);

  const handleExpired = useCallback(async () => {
    setExpired(true);
    await recheck();
    navigate("/device-limit?autoActivate=1", { replace: true });
  }, [navigate, recheck]);

  useEffect(() => {
    if (activated || authorityLoading || expired) return;
    const at = requestedAt ?? block?.result.approval_requested_at ?? null;
    if (!isPendingApprovalExpired(at, nowMs)) return;
    void handleExpired();
  }, [
    activated,
    authorityLoading,
    block?.result.approval_requested_at,
    expired,
    handleExpired,
    nowMs,
    requestedAt,
  ]);

  const ownerApproveAndContinue = useCallback(async () => {
    if (!shopId || ownerBusy) return;
    setOwnerBusy(true);
    try {
      const outcome = await resolveLoginDeviceActivation(shopId);
      if (outcome.activated) {
        await retry();
        navigate("/", { replace: true });
        return;
      }
      await recheck();
    } finally {
      setOwnerBusy(false);
    }
  }, [navigate, ownerBusy, recheck, retry, shopId]);

  useEffect(() => {
    if (activated) {
      navigate("/", { replace: true });
    }
  }, [activated, navigate]);

  useEffect(() => {
    if (activated || authorityLoading || expired) return;
    const timer = window.setInterval(() => {
      void recheck();
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [activated, authorityLoading, expired, recheck]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-stone-50 to-stone-100 px-6 py-12">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
        <MonitorSmartphone className="h-8 w-8" aria-hidden />
      </div>
      <h1 className="mt-6 text-center text-2xl font-black text-stone-950">
        {expired ? t(lang, "devicePendingApprovalExpiredTitle") : t(lang, "devicePendingApprovalTitle")}
      </h1>
      <p className="mt-3 max-w-md text-center text-sm font-medium text-stone-600">
        {expired
          ? t(lang, "devicePendingApprovalExpiredBody")
          : isOwner
            ? t(lang, "devicePendingApprovalOwnerBody")
            : t(lang, "devicePendingApprovalBody")}
      </p>
      {!expired ? (
        <p className="mt-4 rounded-full bg-amber-100 px-4 py-2 text-sm font-black text-amber-950">
          {tTemplate(lang, "devicePendingApprovalCountdown", {
            time: formatPendingApprovalCountdown(remainingMs),
          })}
        </p>
      ) : null}
      {shopId ? (
        <p className="mt-2 text-xs font-semibold text-stone-400">{t(lang, "devicePendingApprovalHint")}</p>
      ) : null}
      {isOwner && !expired ? (
        <button
          type="button"
          disabled={ownerBusy || checking}
          onClick={() => void ownerApproveAndContinue()}
          className="mt-8 min-h-[48px] rounded-2xl bg-emerald-600 px-6 text-sm font-black text-white disabled:opacity-60"
        >
          {ownerBusy ? t(lang, "deviceLimitActivating") : t(lang, "devicePendingApprovalOwnerContinue")}
        </button>
      ) : null}
      <button
        type="button"
        disabled={checking || ownerBusy}
        onClick={() => (expired ? void handleExpired() : void recheck())}
        className="mt-3 min-h-[48px] rounded-2xl bg-waka-600 px-6 text-sm font-black text-white disabled:opacity-60"
      >
        {checking
          ? t(lang, "devicePendingApprovalChecking")
          : expired
            ? t(lang, "devicePendingApprovalTryAgain")
            : t(lang, "devicePendingApprovalRecheck")}
      </button>
      {activated ? (
        <p className="mt-4 text-xs font-semibold text-emerald-700">{t(lang, "devicePendingApprovalApproved")}</p>
      ) : null}
    </div>
  );
}
