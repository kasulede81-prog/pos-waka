import { useCallback, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useDeviceActivation } from "../context/DeviceActivationContext";
import { fetchShopDeviceLimitContext, resolveLoginDeviceActivation } from "../lib/deviceActivation";
import { schedulePostLoginBackgroundTasks } from "../lib/postLoginBackgroundTasks";

type Props = { lang: Language };

/**
 * Recovery / diagnostics only — owners should not normally reach this page (Phase 20.6).
 * Staff pending approval uses /device-pending instead.
 */
export function DeviceActivatingPage({ lang }: Props) {
  const navigate = useNavigate();
  const { retry, shopId, activated, block } = useDeviceActivation();
  const sid = block?.shopId ?? shopId ?? null;
  const ranRef = useRef(false);

  const runRecovery = useCallback(async () => {
    if (!sid) return;
    const ctx = await fetchShopDeviceLimitContext(sid).catch(() => null);
    if (ctx?.is_owner === false) {
      navigate("/device-pending", { replace: true });
      return;
    }
    const outcome = await resolveLoginDeviceActivation(sid);
    if (outcome.activated) {
      schedulePostLoginBackgroundTasks(sid);
      await retry();
      navigate("/", { replace: true });
    }
  }, [navigate, retry, sid]);

  useEffect(() => {
    if (activated) {
      navigate("/", { replace: true });
    }
  }, [activated, navigate]);

  useEffect(() => {
    if (!sid || ranRef.current) return;
    ranRef.current = true;
    void runRecovery();
  }, [runRecovery, sid]);

  return (
    <div className="auth-scroll-root flex h-dvh max-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-waka-50 to-muted px-6 dark:from-foreground dark:to-foreground">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-waka-100 text-waka-700 dark:bg-waka-500/20 dark:text-waka-300">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
      </div>
      <h1 className="mt-6 text-center text-2xl font-black text-foreground dark:text-background">
        {t(lang, "deviceActivatingTitle")}
      </h1>
      <p className="mt-3 max-w-md text-center text-sm font-medium text-muted-foreground dark:text-muted-foreground">
        {t(lang, "deviceActivatingAlmostReady")}
      </p>
      <p className="mt-4 max-w-md text-center text-xs font-medium text-muted-foreground">
        {t(lang, "deviceActivatingRecoveryHint")}
      </p>
      <button
        type="button"
        onClick={() => void runRecovery()}
        className="mt-6 min-h-[48px] rounded-2xl bg-waka-600 px-6 text-sm font-black text-white"
      >
        {t(lang, "deviceActivatingRetry")}
      </button>
      <Link
        to="/login"
        className="mt-4 text-sm font-semibold text-waka-700 underline dark:text-waka-300"
      >
        {t(lang, "signIn")}
      </Link>
    </div>
  );
}
