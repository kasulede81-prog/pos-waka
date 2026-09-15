import type { SecurityActionScope, SecurityCredentialType, SecuritySession, VerifiedSecurityUser } from "./types";

export const ENTERPRISE_SECURITY_SESSION_MS = 5 * 60 * 1000;
export const ENTERPRISE_SECURITY_TOUCH_MIN_MS = 25_000;
export const ENTERPRISE_SECURITY_TOUCH_IF_MS_LEFT = 45_000;

let session: SecuritySession | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) {
    fn();
  }
}

export function subscribeSecuritySession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSecuritySession(): SecuritySession | null {
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    session = null;
    notify();
    return null;
  }
  return session;
}

export function isSecuritySessionActive(scope?: SecurityActionScope): boolean {
  const cur = getSecuritySession();
  if (!cur) return false;
  if (!scope) return true;
  if (cur.authorizedScopes.has("*") || cur.authorizedScopes.has(scope)) return true;
  if (scope !== "back_office_shell" && cur.authorizedScopes.has("back_office_shell")) return true;
  return false;
}

export function securitySessionMsRemaining(): number {
  const cur = getSecuritySession();
  if (!cur) return 0;
  return Math.max(0, cur.expiresAt - Date.now());
}

export function createSecuritySession(input: {
  scopes: SecurityActionScope[] | "all";
  credential: SecurityCredentialType;
  user: VerifiedSecurityUser;
  deviceId: string;
  auditId: string;
}): SecuritySession {
  const authorizedScopes =
    input.scopes === "all"
      ? new Set<string>(["*"])
      : new Set(input.scopes.map(String));
  const now = Date.now();
  session = {
    authorizedScopes,
    expiresAt: now + ENTERPRISE_SECURITY_SESSION_MS,
    verifiedCredential: input.credential,
    verifiedUser: input.user,
    deviceId: input.deviceId,
    lastActivity: now,
    auditId: input.auditId,
  };
  notify();
  return session;
}

export function refreshSecuritySession(): void {
  const cur = getSecuritySession();
  if (!cur) return;
  cur.lastActivity = Date.now();
  cur.expiresAt = Date.now() + ENTERPRISE_SECURITY_SESSION_MS;
  notify();
}

export function touchSecuritySession(): void {
  const cur = getSecuritySession();
  if (!cur) return;
  const now = Date.now();
  const msLeft = cur.expiresAt - now;
  if (msLeft < ENTERPRISE_SECURITY_TOUCH_IF_MS_LEFT) {
    cur.expiresAt = now + ENTERPRISE_SECURITY_SESSION_MS;
    cur.lastActivity = now;
    notify();
    return;
  }
  if (now - cur.lastActivity < ENTERPRISE_SECURITY_TOUCH_MIN_MS) return;
  cur.expiresAt = now + ENTERPRISE_SECURITY_SESSION_MS;
  cur.lastActivity = now;
  notify();
}

export function clearSecuritySession(): void {
  if (!session) return;
  session = null;
  notify();
}

/** @deprecated Use createSecuritySession — bridge for legacy sensitiveActionAuth. */
export function grantLegacySensitiveSession(): void {
  if (getSecuritySession()) {
    refreshSecuritySession();
    return;
  }
  createSecuritySession({
    scopes: "all",
    credential: "biometric",
    user: { role: "owner", actorUserId: "legacy", actorLabel: "legacy" },
    deviceId: "legacy",
    auditId: crypto.randomUUID(),
  });
}

/** @deprecated */
export function isLegacySensitiveSessionActive(): boolean {
  return isSecuritySessionActive();
}

/** @deprecated */
export function clearLegacySensitiveSession(): void {
  clearSecuritySession();
}
