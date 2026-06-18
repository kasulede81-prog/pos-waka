import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../../types";
import { usePosStore } from "../../store/usePosStore";
import { isBiometricAuthFeatureEnabled } from "../../lib/sensitiveActionAuth";
import { useSensitiveActionAuth } from "../../context/SensitiveActionAuthContext";

type Props = {
  lang: Language;
  kind: import("../../lib/sensitiveActionAuth").SensitiveActionKind;
  children: ReactNode;
  /** Where to send the user if auth is denied (default: home). */
  deniedTo?: string;
};

/** Blocks children until sensitive-action auth succeeds (when biometric setting is on). */
export function SensitiveActionGate({ lang: _lang, kind, children, deniedTo = "/" }: Props) {
  const biometricAuthEnabled = usePosStore((s) => s.preferences.biometricAuthEnabled);
  const { ensureAuthorized, isSessionActive } = useSensitiveActionAuth();
  const [granted, setGranted] = useState(() => !biometricAuthEnabled || isSessionActive());
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!isBiometricAuthFeatureEnabled({ biometricAuthEnabled: biometricAuthEnabled ?? false })) {
      setGranted(true);
      setDenied(false);
      return;
    }
    if (isSessionActive()) {
      setGranted(true);
      setDenied(false);
      return;
    }
    let cancelled = false;
    void ensureAuthorized(kind).then((ok) => {
      if (cancelled) return;
      setGranted(ok);
      if (!ok) setDenied(true);
    });
    return () => {
      cancelled = true;
    };
  }, [biometricAuthEnabled, kind, ensureAuthorized, isSessionActive]);

  if (denied) return <Navigate to={deniedTo} replace />;
  if (!granted) return null;
  return <>{children}</>;
}
