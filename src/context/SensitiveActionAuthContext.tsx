import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { promptNativeBiometric } from "../lib/biometricAuth";
import {
  grantSensitiveActionSession,
  isBiometricAuthFeatureEnabled,
  isSensitiveActionSessionActive,
  MAX_BIOMETRIC_FAILURES_BEFORE_PIN,
  shouldPromptForSensitiveAction,
  verifyOwnerPin,
  type SensitiveActionKind,
} from "../lib/sensitiveActionAuth";
import { BiometricAuthModal } from "../components/security/BiometricAuthModal";

type PendingRequest = {
  kind: SensitiveActionKind;
  resolve: (granted: boolean) => void;
};

type Ctx = {
  isSessionActive: () => boolean;
  ensureAuthorized: (kind: SensitiveActionKind) => Promise<boolean>;
};

const SensitiveActionAuthContext = createContext<Ctx | null>(null);

function actionPromptReason(lang: Language, kind: SensitiveActionKind): string {
  const key = `biometricReason_${kind}` as Parameters<typeof t>[1];
  return t(lang, key);
}

export function SensitiveActionAuthProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const preferences = usePosStore((s) => s.preferences);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [, setBiometricFailures] = useState(0);
  const [forcePin, setForcePin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"success" | "error" | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);

  const finish = useCallback((granted: boolean) => {
    const req = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setBiometricFailures(0);
    setForcePin(false);
    setBusy(false);
    setStatusMessage(null);
    setStatusKind(null);
    req?.resolve(granted);
  }, []);

  const ensureAuthorized = useCallback(
    (kind: SensitiveActionKind): Promise<boolean> => {
      if (!isBiometricAuthFeatureEnabled(preferences)) {
        return Promise.resolve(true);
      }
      if (isSensitiveActionSessionActive()) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        pendingRef.current = { kind, resolve };
        setPending({ kind, resolve });
        setBiometricFailures(0);
        setForcePin(false);
        setStatusMessage(null);
        setStatusKind(null);
      });
    },
    [preferences],
  );

  const runBiometric = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setStatusMessage(null);
    setStatusKind(null);
    const reason = actionPromptReason(lang, pending.kind);
    const result = await promptNativeBiometric(reason);
    setBusy(false);

    if (result.ok) {
      grantSensitiveActionSession();
      setStatusKind("success");
      setStatusMessage(t(lang, "biometricSuccess"));
      window.setTimeout(() => finish(true), 450);
      return;
    }

    if (result.userFallback) {
      setForcePin(true);
      return;
    }

    setBiometricFailures((prev) => {
      const nextFailures = prev + 1;
      setStatusKind("error");
      setStatusMessage(
        nextFailures >= MAX_BIOMETRIC_FAILURES_BEFORE_PIN
          ? t(lang, "biometricMaxFailures")
          : t(lang, "biometricFailed"),
      );
      if (nextFailures >= MAX_BIOMETRIC_FAILURES_BEFORE_PIN) {
        setForcePin(true);
      }
      return nextFailures;
    });
  }, [pending, lang, finish]);

  const submitOwnerPin = useCallback(
    (pin: string) => {
      if (!pending) return;
      if (!verifyOwnerPin(pin, preferences)) {
        setStatusKind("error");
        setStatusMessage(t(lang, "biometricOwnerPinWrong"));
        usePosStore.getState().logAuditAction("sensitive_action_auth_denied", "Owner PIN denied for sensitive action", {
          action: pending.kind,
        });
        finish(false);
        return;
      }
      grantSensitiveActionSession();
      usePosStore.getState().logAuditAction("sensitive_action_auth_granted", "Owner PIN granted for sensitive action", {
        action: pending.kind,
      });
      setStatusKind("success");
      setStatusMessage(t(lang, "biometricPinSuccess"));
      window.setTimeout(() => finish(true), 450);
    },
    [pending, preferences, lang, finish],
  );

  const cancel = useCallback(() => {
    finish(false);
  }, [finish]);

  const value = useMemo(
    (): Ctx => ({
      isSessionActive: isSensitiveActionSessionActive,
      ensureAuthorized,
    }),
    [ensureAuthorized],
  );

  const showPinOnly = forcePin || !shouldPromptForSensitiveAction(preferences);

  return (
    <SensitiveActionAuthContext.Provider value={value}>
      {children}
      {pending ? (
        <BiometricAuthModal
          lang={lang}
          busy={busy}
          showPinOnly={showPinOnly}
          statusMessage={statusMessage}
          statusKind={statusKind}
          onAuthenticateBiometric={() => void runBiometric()}
          onUseOwnerPin={() => setForcePin(true)}
          onSubmitOwnerPin={submitOwnerPin}
          onCancel={cancel}
        />
      ) : null}
    </SensitiveActionAuthContext.Provider>
  );
}

export function useSensitiveActionAuth(): Ctx {
  const ctx = useContext(SensitiveActionAuthContext);
  if (!ctx) {
    throw new Error("useSensitiveActionAuth requires SensitiveActionAuthProvider");
  }
  return ctx;
}
