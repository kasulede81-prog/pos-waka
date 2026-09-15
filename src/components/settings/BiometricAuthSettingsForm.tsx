import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { checkBiometricCapability } from "../../lib/biometricAuth";
import {
  canEnableBiometricAuth,
  isBiometricAuthFeatureEnabled,
} from "../../lib/sensitiveActionAuth";
import { isBackOfficePinConfigured } from "../../lib/lockPos";

export function BiometricAuthSettingsForm({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const isOwner = actor.role === "owner";
  const enabled = isBiometricAuthFeatureEnabled(preferences);
  const pinConfigured = isBackOfficePinConfigured(preferences.backOfficePin);

  const [capability, setCapability] = useState<Awaited<ReturnType<typeof checkBiometricCapability>> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkBiometricCapability().then((cap) => {
      if (!cancelled) {
        setCapability(cap);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = (next: boolean) => {
    setMsg(null);
    if (!isOwner) {
      setMsg(t(lang, "biometricOwnerOnly"));
      return;
    }
    if (next && !canEnableBiometricAuth(preferences)) {
      setMsg(t(lang, "biometricRequiresOwnerPin"));
      return;
    }
    setPreferences({ biometricAuthEnabled: next });
    setMsg(next ? t(lang, "biometricEnabledOk") : t(lang, "biometricDisabledOk"));
    window.setTimeout(() => setMsg(null), 3500);
  };

  return (
    <article className="rounded-2xl border border-border/90 bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">{t(lang, "biometricSettingsTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t(lang, "biometricSettingsSub")}</p>

      {loading ? (
        <p className="mt-3 text-sm font-semibold text-muted-foreground">{t(lang, "biometricCheckingDevice")}</p>
      ) : capability ? (
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between rounded-xl bg-muted px-3 py-2">
            <dt className="font-semibold text-muted-foreground">{t(lang, "biometricDeviceStatus")}</dt>
            <dd className="font-black text-foreground">
              {capability.isAvailable || capability.deviceIsSecure
                ? t(lang, "biometricDeviceReady")
                : t(lang, "biometricDeviceUnavailable")}
            </dd>
          </div>
        </dl>
      ) : null}

      {!pinConfigured ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
          {t(lang, "biometricRequiresOwnerPin")}
        </p>
      ) : null}

      {!isOwner ? (
        <p className="mt-3 rounded-xl border border-border bg-muted px-3 py-2 text-sm font-semibold text-muted-foreground">
          {t(lang, "biometricOwnerOnly")}
        </p>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={!isOwner || !pinConfigured || enabled}
          onClick={() => setEnabled(true)}
          className="min-h-[48px] rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white disabled:opacity-40"
        >
          {t(lang, "biometricEnableButton")}
        </button>
        <button
          type="button"
          disabled={!isOwner || !enabled}
          onClick={() => setEnabled(false)}
          className="min-h-[48px] rounded-2xl border-2 border-border bg-card px-4 py-3 text-sm font-black text-foreground disabled:opacity-40"
        >
          {t(lang, "biometricDisableButton")}
        </button>
      </div>

      <p className="mt-3 text-xs font-medium text-muted-foreground">{t(lang, "biometricPrivacyNote")}</p>

      {msg ? <p className="mt-3 text-sm font-bold text-foreground">{msg}</p> : null}
    </article>
  );
}
