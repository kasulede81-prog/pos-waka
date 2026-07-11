import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Language } from "../../types";
import { usePosStore } from "../../store/usePosStore";
import {
  isBiometricAuthFeatureEnabled,
  sensitiveAuthSatisfiedByBackOfficeUnlock,
  type SensitiveActionKind,
} from "../../lib/sensitiveActionAuth";
import { isSecuritySessionActive } from "../../lib/enterpriseSecurity/securitySession";
import { useSensitiveActionAuth } from "../../context/SensitiveActionAuthContext";
import { useBackOfficeSession } from "../../context/BackOfficeSessionContext";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  kind: SensitiveActionKind;
  children: ReactNode;
  /** Legacy — no longer redirects; kept for call-site compatibility. */
  deniedTo?: string;
  onDenied?: () => void;
};

/** Blocks children until enterprise security auth succeeds (when biometric setting is on). */
export function SensitiveActionGate({ lang, kind, children, onDenied }: Props) {
  const biometricAuthEnabled = usePosStore((s) => s.preferences.biometricAuthEnabled);
  const backOfficePin = usePosStore((s) => s.preferences.backOfficePin);
  const staffAccounts = usePosStore((s) => s.preferences.staffAccounts);
  const { isUnlocked: backOfficeUnlocked } = useBackOfficeSession();
  const { ensureAuthorized } = useSensitiveActionAuth();
  const authStartedRef = useRef(false);

  const alreadyAuthorized = () => {
    if (!isBiometricAuthFeatureEnabled({ biometricAuthEnabled: biometricAuthEnabled ?? false })) {
      return true;
    }
    if (isSecuritySessionActive(kind)) return true;
    if (isSecuritySessionActive()) return true;
    return sensitiveAuthSatisfiedByBackOfficeUnlock(
      { backOfficePin, staffAccounts, biometricAuthEnabled: biometricAuthEnabled ?? false },
      backOfficeUnlocked,
    );
  };

  const [granted, setGranted] = useState(alreadyAuthorized);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (alreadyAuthorized()) {
      setGranted(true);
      setCancelled(false);
      authStartedRef.current = false;
      return;
    }
    if (authStartedRef.current) return;
    authStartedRef.current = true;
    let disposed = false;
    void ensureAuthorized(kind).then((ok) => {
      if (disposed) return;
      setGranted(ok);
      if (!ok) {
        setCancelled(true);
        onDenied?.();
      }
      authStartedRef.current = false;
    });
    return () => {
      disposed = true;
      authStartedRef.current = false;
    };
  }, [biometricAuthEnabled, backOfficePin, staffAccounts, backOfficeUnlocked, kind, ensureAuthorized, onDenied]);

  if (cancelled && !granted) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "enterpriseSecurityCancelled")}</p>
      </div>
    );
  }

  if (!granted) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "biometricGateLoading")}</p>
      </div>
    );
  }

  return <>{children}</>;
}
