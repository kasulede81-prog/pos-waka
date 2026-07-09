import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MonitorSmartphone } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useDeviceActivation } from "../context/DeviceActivationContext";
import { useDeviceAuthority } from "../context/DeviceAuthorityContext";
import { registerShopDeviceOnLogin } from "../lib/deviceActivation";

type Props = { lang: Language };

/** Read-only waiting screen until Primary Device approves this device. */
export function DevicePendingApprovalPage({ lang }: Props) {
  const navigate = useNavigate();
  const { retry, shopId, activated } = useDeviceActivation();
  const { refresh, loading: authorityLoading } = useDeviceAuthority();
  const [checking, setChecking] = useState(false);

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

  useEffect(() => {
    if (activated) {
      navigate("/", { replace: true });
    }
  }, [activated, navigate]);

  useEffect(() => {
    if (activated || authorityLoading) return;
    const timer = window.setInterval(() => {
      void recheck();
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [activated, authorityLoading, recheck]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-stone-50 to-stone-100 px-6 py-12">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
        <MonitorSmartphone className="h-8 w-8" aria-hidden />
      </div>
      <h1 className="mt-6 text-center text-2xl font-black text-stone-950">
        {t(lang, "devicePendingApprovalTitle")}
      </h1>
      <p className="mt-3 max-w-md text-center text-sm font-medium text-stone-600">
        {t(lang, "devicePendingApprovalBody")}
      </p>
      {shopId ? (
        <p className="mt-2 text-xs font-semibold text-stone-400">{t(lang, "devicePendingApprovalHint")}</p>
      ) : null}
      <button
        type="button"
        disabled={checking}
        onClick={() => void recheck()}
        className="mt-8 min-h-[48px] rounded-2xl bg-waka-600 px-6 text-sm font-black text-white disabled:opacity-60"
      >
        {checking ? t(lang, "devicePendingApprovalChecking") : t(lang, "devicePendingApprovalRecheck")}
      </button>
      {activated ? (
        <p className="mt-4 text-xs font-semibold text-emerald-700">{t(lang, "devicePendingApprovalApproved")}</p>
      ) : null}
    </div>
  );
}
