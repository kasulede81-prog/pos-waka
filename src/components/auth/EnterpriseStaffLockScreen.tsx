import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Capacitor } from "@capacitor/core";
import { Fingerprint, LogOut, RefreshCw, Wifi, WifiOff } from "lucide-react";
import type { Language, ShopPreferences, UserRole } from "../../types";
import { t } from "../../lib/i18n";
import { WakaSymbolIcon } from "../brand/WakaLogo";
import { EnterprisePinPad } from "./EnterprisePinPad";
import { formatUnlockLockoutMessage } from "./EnterpriseLockoutBanner";
import { AppShellSyncLabel } from "../layout/AppShellSyncLabel";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { getOrCreateDeviceId } from "../../lib/deviceId";
import { checkBiometricCapability, promptNativeBiometric } from "../../lib/biometricAuth";
import { isBiometricAuthFeatureEnabled } from "../../lib/sensitiveActionAuth";
import { getUnlockLockoutStatus, unlockLimiterScope } from "../../lib/auth/staffLoginLimiter";
import { staffAllowSwitchUser as resolveAllowSwitchUser } from "../../lib/auth/staffSession";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";

type Props = {
  lang: Language;
  preferences: ShopPreferences;
  actorName: string;
  actorRole: UserRole;
  businessName: string;
  canSwitchUser: boolean;
  isInternalAdmin?: boolean;
  onUnlock: (opts: {
    staffId: string | null;
    selectingOwner: boolean;
    secret: string;
  }) => Promise<{ ok: true } | { ok: false; errorKey: string }>;
  onBiometricUnlock?: () => Promise<{ ok: true } | { ok: false; errorKey: string }>;
  onSwitchUser: () => void;
  onEmergencyLogout: () => void;
  onSetupPin?: () => void;
  showSetupPin?: boolean;
};

function useLiveClock(lang: Language): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString(lang === "lg" ? "lg-UG" : "en-UG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function isUnlockingCurrentSession(staffId: string, activeStaffId: string | null | undefined): boolean {
  if (activeStaffId) {
    return staffId === activeStaffId;
  }
  return staffId === "" || staffId === "__owner__";
}

export function EnterpriseStaffLockScreen({
  lang,
  preferences,
  actorName,
  actorRole,
  businessName,
  canSwitchUser,
  isInternalAdmin = false,
  onUnlock,
  onBiometricUnlock,
  onSwitchUser,
  onEmergencyLogout,
  onSetupPin,
  showSetupPin = false,
}: Props) {
  const [staffId, setStaffId] = useState(preferences.activeStaffId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [pinResetSignal, setPinResetSignal] = useState(0);
  const clock = useLiveClock(lang);
  const { isOnline } = useOfflineStatus();
  const isDesktop = usePosDesktopLayout();
  const useCompactKeypad = Capacitor.isNativePlatform() || !isDesktop;
  const appVersion = import.meta.env.VITE_APP_VERSION?.trim() || "—";
  const allowSwitch = resolveAllowSwitchUser(preferences) && canSwitchUser;
  const biometricEnabled = isBiometricAuthFeatureEnabled(preferences);
  const activeStaffId = preferences.activeStaffId ?? null;
  const unlockingCurrent = isUnlockingCurrentSession(staffId, activeStaffId);
  const showBiometric =
    Boolean(onBiometricUnlock) && biometricEnabled && biometricAvailable && unlockingCurrent;

  const activeStaff = useMemo(
    () => (preferences.staffAccounts ?? []).filter((s) => s.active),
    [preferences.staffAccounts],
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => setFadeIn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    setError(null);
    setPinResetSignal((n) => n + 1);
  }, [staffId]);

  useEffect(() => {
    if (!biometricEnabled || !onBiometricUnlock) return;
    let cancelled = false;
    void checkBiometricCapability().then((cap) => {
      if (cancelled) return;
      setBiometricAvailable(Capacitor.isNativePlatform() && (cap.isAvailable || cap.deviceIsSecure));
    });
    return () => {
      cancelled = true;
    };
  }, [biometricEnabled, onBiometricUnlock]);

  const lockout = getUnlockLockoutStatus(unlockLimiterScope(staffId || preferences.activeStaffId));
  const lockoutMessage = lockout.locked ? formatUnlockLockoutMessage(lang, lockout.waitSeconds) : null;

  const tryUnlock = useCallback(
    async (secret: string) => {
      if (busy || lockout.locked) return false;
      setBusy(true);
      setError(null);
      try {
        const result = await onUnlock({
          staffId: staffId === "__owner__" ? null : staffId || null,
          selectingOwner: staffId === "__owner__",
          secret,
        });
        if (!result.ok) {
          setError(t(lang, result.errorKey));
          setPinResetSignal((n) => n + 1);
          return false;
        }
        return true;
      } catch {
        setError(t(lang, "saleError"));
        setPinResetSignal((n) => n + 1);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, lang, lockout.locked, onUnlock, staffId],
  );

  const runBiometric = async () => {
    if (!onBiometricUnlock || biometricBusy || lockout.locked) return;
    setBiometricBusy(true);
    setError(null);
    try {
      const prompt = await promptNativeBiometric(t(lang, "biometricReason_unlock_pos"));
      if (!prompt.ok) {
        if (!prompt.cancelled && prompt.errorKey) {
          setError(t(lang, prompt.errorKey));
        }
        return;
      }
      const result = await onBiometricUnlock();
      if (!result.ok) {
        setError(t(lang, result.errorKey));
      }
    } catch {
      setError(t(lang, "saleError"));
    } finally {
      setBiometricBusy(false);
    }
  };

  const statusPills = (
    <>
      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
        {isOnline ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-amber-400" />}
        {isOnline ? t(lang, "deviceMgmtOnline") : t(lang, "deviceMgmtOffline")}
      </span>
      <span className="rounded-full bg-white/10 px-2.5 py-1">
        <AppShellSyncLabel lang={lang} inverted />
      </span>
      <span className="rounded-full bg-white/10 px-2.5 py-1">
        {t(lang, "enterpriseLockDevice")}: {getOrCreateDeviceId().slice(0, 8)}
      </span>
      <span className="rounded-full bg-white/10 px-2.5 py-1">v{appVersion}</span>
    </>
  );

  return (
    <div
      className={clsx(
        "fixed inset-0 z-[120] flex h-dvh max-h-dvh flex-col overflow-hidden bg-foreground transition-opacity duration-300",
        fadeIn ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col lg:mx-auto lg:grid lg:w-full lg:max-w-5xl lg:grid-cols-[1fr,380px] lg:items-stretch lg:gap-6 lg:p-4">
        <section className="flex shrink-0 flex-col justify-between bg-gradient-to-br from-foreground via-foreground to-black px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))] text-white lg:rounded-3xl lg:p-8 lg:shadow-2xl">
          <div>
            <div className="flex items-center gap-3">
              <WakaSymbolIcon size="md" className="!h-9 !w-9 lg:!h-10 lg:!w-10" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-muted-foreground">{businessName || t(lang, "appName")}</p>
                <p className="text-xs text-muted-foreground">{t(lang, "enterpriseLockScreenTag")}</p>
              </div>
            </div>
            <p className="mt-4 font-mono text-5xl font-black tracking-tight sm:text-6xl lg:mt-10 lg:text-7xl">{clock}</p>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur lg:mt-8 lg:p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t(lang, "enterpriseLockSignedInAs")}</p>
            <p className="mt-1 text-xl font-black lg:text-2xl">{actorName}</p>
            <p className="mt-1 inline-flex rounded-full bg-waka-600/30 px-3 py-1 text-xs font-black text-waka-200">
              {t(lang, `role_${actorRole}`)}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground lg:mt-6">{statusPills}</div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-t-3xl bg-card p-4 shadow-2xl dark:bg-foreground sm:p-6 lg:max-h-full lg:flex-none lg:overflow-visible lg:rounded-3xl lg:p-7">
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col lg:max-w-none">
            <h2 className="text-xl font-black text-foreground dark:text-background sm:text-2xl">{t(lang, "lockPosTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">{t(lang, "lockPosSub")}</p>

            {allowSwitch && activeStaff.length > 0 ? (
              <label className="mt-3 block text-sm font-bold text-muted-foreground dark:text-muted-foreground sm:mt-4">
                {t(lang, "switchUser")}
                <select
                  value={staffId}
                  onChange={(e) => {
                    setStaffId(e.target.value);
                    setError(null);
                  }}
                  className="mt-1 w-full rounded-2xl border-2 border-border px-4 py-3 dark:bg-foreground"
                >
                  <option value="">{t(lang, "staffPickAccount")}</option>
                  <option value="__owner__">{t(lang, "role_owner")}</option>
                  {activeStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({t(lang, `role_${s.role}`)})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {showBiometric ? (
              <button
                type="button"
                disabled={biometricBusy || lockout.locked}
                onClick={() => void runBiometric()}
                className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-waka-600 py-3 text-base font-black text-white shadow-waka-sm disabled:opacity-50 sm:text-lg"
              >
                <Fingerprint className="h-5 w-5 shrink-0" aria-hidden />
                {biometricBusy ? t(lang, "biometricAuthenticating") : t(lang, "unlockBiometricButton")}
              </button>
            ) : null}

            <div className="mt-4 sm:mt-5">
              <EnterprisePinPad
                lang={lang}
                size={useCompactKeypad ? "mobile" : "tablet"}
                disabled={busy || lockout.locked || biometricBusy}
                verifying={busy}
                lockoutMessage={lockoutMessage}
                errorMessage={error}
                resetSignal={`${staffId}-${pinResetSignal}`}
                onComplete={(secret) => tryUnlock(secret)}
              />
            </div>

            {showSetupPin && onSetupPin ? (
              <button
                type="button"
                className="mt-3 min-h-[44px] w-full rounded-2xl border-2 border-waka-200 bg-waka-50 py-2.5 text-sm font-black text-waka-900 dark:border-waka-800 dark:bg-waka-950/40 dark:text-waka-200"
                onClick={onSetupPin}
              >
                {t(lang, "settingsHubPin")}
              </button>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {allowSwitch ? (
                <button
                  type="button"
                  onClick={onSwitchUser}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-border font-bold"
                >
                  <RefreshCw className="h-4 w-4" />
                  {t(lang, "switchUser")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onEmergencyLogout}
                className={clsx(
                  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-rose-200 font-bold text-rose-800 dark:border-rose-900 dark:text-rose-300",
                  !allowSwitch && "col-span-2",
                )}
              >
                <LogOut className="h-4 w-4" />
                {t(lang, "enterpriseLockEmergencyLogout")}
              </button>
            </div>

            {isInternalAdmin ? (
              <button
                type="button"
                className="mb-[max(0.75rem,env(safe-area-inset-bottom))] mt-2 min-h-[42px] w-full rounded-2xl border border-amber-300 bg-amber-50 py-2 text-sm font-black text-amber-900"
                onClick={onEmergencyLogout}
              >
                Admin unlock
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
