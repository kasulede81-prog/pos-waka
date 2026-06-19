import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../../types";
import { usePosStore } from "../../store/usePosStore";
import {
  isBiometricAuthFeatureEnabled,
  isSensitiveActionSessionActive,
  sensitiveAuthSatisfiedByBackOfficeUnlock,
} from "../../lib/sensitiveActionAuth";
import { useSensitiveActionAuth } from "../../context/SensitiveActionAuthContext";
import { useBackOfficeSession } from "../../context/BackOfficeSessionContext";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  kind: import("../../lib/sensitiveActionAuth").SensitiveActionKind;
  children: ReactNode;
  /** Where to send the user if auth is denied (default: home). */
  deniedTo?: string;
};

function isAlreadyAuthorized(
  biometricAuthEnabled: boolean | undefined,
  backOfficeUnlocked: boolean,
  preferences: {
    backOfficePin?: string | null;
    staffAccounts?: import("../../types").StaffAccount[];
    biometricAuthEnabled?: boolean;
  },
): boolean {
  if (!isBiometricAuthFeatureEnabled({ biometricAuthEnabled: biometricAuthEnabled ?? false })) {
    return true;
  }
  if (isSensitiveActionSessionActive()) return true;
  return sensitiveAuthSatisfiedByBackOfficeUnlock(preferences, backOfficeUnlocked);
}

/** Blocks children until sensitive-action auth succeeds (when biometric setting is on). */
export function SensitiveActionGate({ lang, kind, children, deniedTo = "/" }: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const biometricAuthEnabled = preferences.biometricAuthEnabled;
  const { isUnlocked: backOfficeUnlocked } = useBackOfficeSession();
  const { ensureAuthorized } = useSensitiveActionAuth();
  const authStartedRef = useRef(false);
  const [granted, setGranted] = useState(() =>
    isAlreadyAuthorized(biometricAuthEnabled, backOfficeUnlocked, preferences),
  );
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (isAlreadyAuthorized(biometricAuthEnabled, backOfficeUnlocked, preferences)) {
      setGranted(true);
      setDenied(false);
      authStartedRef.current = false;
      return;
    }
    if (authStartedRef.current) return;
    authStartedRef.current = true;
    let cancelled = false;
    void ensureAuthorized(kind).then((ok) => {
      if (cancelled) return;
      setGranted(ok);
      if (!ok) setDenied(true);
      authStartedRef.current = false;
    });
    return () => {
      cancelled = true;
      authStartedRef.current = false;
    };
  }, [biometricAuthEnabled, backOfficeUnlocked, kind, ensureAuthorized, preferences]);

  if (denied) return <Navigate to={deniedTo} replace />;
  if (!granted) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <p className="text-sm font-semibold text-stone-500">{t(lang, "biometricGateLoading")}</p>
      </div>
    );
  }
  return <>{children}</>;
}
