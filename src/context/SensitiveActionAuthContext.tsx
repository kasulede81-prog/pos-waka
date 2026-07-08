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
import { promptNativeBiometric, checkBiometricCapability } from "../lib/biometricAuth";
import {
  isBiometricAuthFeatureEnabled,
  type SensitiveActionKind,
  sensitiveAuthSatisfiedByBackOfficeUnlock,
  grantSecuritySessionForScope,
} from "../lib/sensitiveActionAuth";
import { verifySecurityCredential } from "../lib/enterpriseSecurity/EnterpriseSecurityService";
import type { SecurityAuditPayload } from "../lib/enterpriseSecurity/types";
import {
  isSecuritySessionActive,
  refreshSecuritySession,
} from "../lib/enterpriseSecurity/securitySession";
import { getOrCreateDeviceId } from "../lib/deviceId";
import { useBackOfficeSession } from "./BackOfficeSessionContext";
import {
  EnterpriseSecurityDialog,
  type EnterpriseSecurityDialogMode,
} from "../components/security/EnterpriseSecurityDialog";
import { defaultSecurityAuditLogger } from "../lib/enterpriseSecurity/audit";

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

function dialogModeForKind(kind: SensitiveActionKind): EnterpriseSecurityDialogMode {
  if (kind === "change_settings" || kind === "manage_users" || kind === "access_reports") {
    return { pinCredential: "shop_security_pin", allowBiometric: true };
  }
  return { pinCredential: "staff_pin", allowBiometric: true };
}

export function SensitiveActionAuthProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const biometricAuthEnabled = usePosStore((s) => s.preferences.biometricAuthEnabled);
  const { isUnlocked: backOfficeUnlocked } = useBackOfficeSession();
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [forcePin, setForcePin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"success" | "error" | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  const biometricFailuresRef = useRef(0);

  const finish = useCallback((granted: boolean) => {
    const req = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setForcePin(false);
    setBusy(false);
    if (!granted) {
      setStatusMessage(null);
      setStatusKind(null);
    }
    req?.resolve(granted);
  }, []);

  const grantForKind = useCallback((kind: SensitiveActionKind) => {
    const deviceId = getOrCreateDeviceId();
    const actor = usePosStore.getState().sessionActor;
    grantSecuritySessionForScope(
      kind,
      deviceId,
      {
        role: actor?.role ?? "owner",
        actorUserId: actor?.userId ?? "unknown",
        actorLabel: actor?.displayName ?? actor?.role ?? "Owner",
      },
      "biometric",
      crypto.randomUUID(),
    );
    refreshSecuritySession();
  }, []);

  const ensureAuthorized = useCallback(
    (kind: SensitiveActionKind): Promise<boolean> => {
      if (!isBiometricAuthFeatureEnabled({ biometricAuthEnabled: biometricAuthEnabled ?? false })) {
        return Promise.resolve(true);
      }
      if (isSecuritySessionActive(kind)) {
        return Promise.resolve(true);
      }
      const preferences = usePosStore.getState().preferences;
      if (sensitiveAuthSatisfiedByBackOfficeUnlock(preferences, backOfficeUnlocked)) {
        grantForKind(kind);
        return Promise.resolve(true);
      }
      if (isSecuritySessionActive()) {
        grantForKind(kind);
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        pendingRef.current = { kind, resolve };
        setPending({ kind, resolve });
        setForcePin(false);
        setStatusMessage(null);
        setStatusKind(null);
        biometricFailuresRef.current = 0;
        void checkBiometricCapability().then((cap) => {
          if (!cap.isAvailable && !cap.deviceIsSecure) {
            setForcePin(true);
          }
        });
      });
    },
    [biometricAuthEnabled, backOfficeUnlocked, grantForKind],
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
      const deviceId = getOrCreateDeviceId();
      const actor = usePosStore.getState().sessionActor;
      const verified = await verifySecurityCredential({
        credentialType: "biometric",
        preferences: usePosStore.getState().preferences,
        sessionActor: actor,
        action: pending.kind,
        deviceId,
        audit: (p: SecurityAuditPayload) =>
          defaultSecurityAuditLogger(p.success, "Sensitive action biometric", {
            action: p.action,
            credential: p.credential,
            auditId: p.auditId,
          }),
      });
      if (verified.ok) {
        grantForKind(pending.kind);
        setStatusKind("success");
        setStatusMessage(t(lang, "biometricSuccess"));
        window.setTimeout(() => finish(true), 450);
        return;
      }
    }

    if (!result.ok && result.userFallback) {
      setForcePin(true);
      return;
    }

    biometricFailuresRef.current += 1;
    setStatusKind("error");
    setStatusMessage(
      biometricFailuresRef.current >= 3 ? t(lang, "biometricMaxFailures") : t(lang, "biometricFailed"),
    );
    if (biometricFailuresRef.current >= 3) {
      setForcePin(true);
    }
  }, [pending, lang, finish, grantForKind]);

  const submitPin = useCallback(
    async (pin: string) => {
      if (!pending) return;
      const preferences = usePosStore.getState().preferences;
      const deviceId = getOrCreateDeviceId();
      const actor = usePosStore.getState().sessionActor;
      const mode = dialogModeForKind(pending.kind);

      let verified = await verifySecurityCredential({
        credentialType: mode.pinCredential,
        secret: pin,
        preferences,
        sessionActor: actor,
        action: pending.kind,
        deviceId,
        audit: (p: SecurityAuditPayload) =>
          defaultSecurityAuditLogger(p.success, "Sensitive action PIN", {
            action: p.action,
            credential: p.credential,
            auditId: p.auditId,
          }),
      });

      if (!verified.ok && mode.pinCredential === "staff_pin") {
        verified = await verifySecurityCredential({
          credentialType: "shop_security_pin",
          secret: pin,
          preferences,
          sessionActor: actor,
          action: pending.kind,
          deviceId,
        });
      }

      if (!verified.ok) {
        setStatusKind("error");
        setStatusMessage(t(lang, "enterpriseSecurityWrongPin"));
        defaultSecurityAuditLogger(false, "Sensitive action PIN denied", {
          action: pending.kind,
          credential: mode.pinCredential,
        });
        return;
      }

      grantForKind(pending.kind);
      setStatusKind("success");
      setStatusMessage(t(lang, "biometricPinSuccess"));
      window.setTimeout(() => finish(true), 450);
    },
    [pending, lang, finish, grantForKind],
  );

  const cancel = useCallback(() => {
    finish(false);
  }, [finish]);

  const value = useMemo(
    (): Ctx => ({
      isSessionActive: () => isSecuritySessionActive(),
      ensureAuthorized,
    }),
    [ensureAuthorized],
  );

  const dialogMode = pending ? dialogModeForKind(pending.kind) : null;
  const showPinOnly = forcePin || !isBiometricAuthFeatureEnabled({ biometricAuthEnabled: biometricAuthEnabled ?? false });

  return (
    <SensitiveActionAuthContext.Provider value={value}>
      {children}
      {pending && dialogMode ? (
        <EnterpriseSecurityDialog
          lang={lang}
          open
          mode={{ ...dialogMode, allowBiometric: showPinOnly ? false : dialogMode.allowBiometric }}
          busy={busy}
          statusMessage={statusMessage}
          statusKind={statusKind}
          onAuthenticateBiometric={() => void runBiometric()}
          onSubmitPin={(pin) => void submitPin(pin)}
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
