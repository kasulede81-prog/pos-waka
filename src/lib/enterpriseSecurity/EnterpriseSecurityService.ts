/**
 * Enterprise Security Service — single verification engine for all protected actions.
 */

import type { SessionActor } from "../sessionActor";
import type { ShopPreferences, StaffAccount, UserRole } from "../../types";
import {
  staffHasBackOfficeUnlockSecret,
  staffSecretMatches,
  staffSecretMatchesAsync,
} from "../staffSecret";
import { isBackOfficePinRequired } from "../backOfficeUnlock";
import {
  isShopSecurityPinConfigured,
  verifyShopSecurityPinAsync,
  verifyShopSecurityPinSync,
} from "./shopPinSecret";
import {
  auditSecurityFailure,
  auditSecuritySuccess,
  createAuditId,
} from "./audit";
import { createSecuritySession } from "./securitySession";
import type {
  EnterpriseSecurityResult,
  EnterpriseSecuritySuccess,
  SecurityActionScope,
  SecurityAuditLogger,
  SecurityCredentialType,
  VerifiedSecurityUser,
  VerifySecurityCredentialInput,
} from "./types";

const DEFAULT_UNLOCK_STAFF_ROLES = new Set<UserRole>(["owner", "manager"]);
const FLOAT_OVERRIDE_STAFF_ROLES = new Set<UserRole>(["owner", "manager", "supervisor"]);

export type VerifyContext = VerifySecurityCredentialInput & {
  audit?: SecurityAuditLogger;
};

function matchingStaffSync(
  staff: StaffAccount[],
  pin: string,
  roles: Set<UserRole>,
): StaffAccount | null {
  return (
    staff.find(
      (s) =>
        s.active &&
        roles.has(s.role) &&
        staffHasBackOfficeUnlockSecret(s) &&
        staffSecretMatches(s, pin),
    ) ?? null
  );
}

async function matchingStaffAsync(
  staff: StaffAccount[],
  pin: string,
  roles: Set<UserRole>,
): Promise<StaffAccount | null> {
  for (const s of staff) {
    if (!s.active || !roles.has(s.role) || !staffHasBackOfficeUnlockSecret(s)) continue;
    if (await staffSecretMatchesAsync(s, pin)) return s;
  }
  return null;
}

function staffToUser(staff: StaffAccount): VerifiedSecurityUser {
  return {
    role: staff.role,
    actorUserId: `staff:${staff.id}`,
    actorLabel: staff.name,
    staffId: staff.id,
  };
}

function sessionActorToUser(actor: SessionActor | null, role: UserRole): VerifiedSecurityUser {
  return {
    role,
    actorUserId: actor?.userId ?? "unknown",
    actorLabel: actor?.displayName?.trim() || role,
  };
}

function successResult(
  input: VerifyContext,
  credential: SecurityCredentialType,
  via: EnterpriseSecuritySuccess["via"],
  user: VerifiedSecurityUser,
  auditId: string,
): EnterpriseSecurityResult {
  auditSecuritySuccess(input.audit, {
    action: input.action,
    credential,
    userId: user.actorUserId,
    role: user.role,
    deviceId: input.deviceId,
    auditId,
  });
  return {
    ok: true,
    credential,
    via,
    user,
    auditId,
  };
}

function failureResult(
  input: VerifyContext,
  credential: SecurityCredentialType,
  reason: string,
  auditId: string,
): EnterpriseSecurityResult {
  auditSecurityFailure(input.audit, {
    action: input.action,
    credential,
    reason,
    deviceId: input.deviceId,
    auditId,
  });
  return {
    ok: false,
    reason: "invalid_credential",
    credentialAttempted: credential,
    auditId,
  };
}

/** Verify shop security PIN (async — supports Argon2 hash at rest). */
export async function verifyShopSecurityPin(
  pin: string,
  preferences: Pick<ShopPreferences, "backOfficePin">,
): Promise<boolean> {
  return verifyShopSecurityPinAsync(pin, preferences.backOfficePin);
}

/** Verify staff PIN (async — Argon2 + legacy). */
export async function verifyStaffPin(
  pin: string,
  preferences: ShopPreferences,
  allowedRoles: Set<UserRole> = DEFAULT_UNLOCK_STAFF_ROLES,
): Promise<VerifiedSecurityUser | null> {
  const matched = await matchingStaffAsync(preferences.staffAccounts ?? [], pin.trim(), allowedRoles);
  return matched ? staffToUser(matched) : null;
}

/** Sync staff PIN — legacy/plain + fnv1a hashes only. */
export function verifyStaffPinSync(
  pin: string,
  preferences: ShopPreferences,
  allowedRoles: Set<UserRole> = DEFAULT_UNLOCK_STAFF_ROLES,
): VerifiedSecurityUser | null {
  const matched = matchingStaffSync(preferences.staffAccounts ?? [], pin.trim(), allowedRoles);
  return matched ? staffToUser(matched) : null;
}

/**
 * Unified credential verification — routes all PIN/biometric checks through one engine.
 */
export async function verifySecurityCredential(input: VerifyContext): Promise<EnterpriseSecurityResult> {
  const auditId = createAuditId();
  const secret = input.secret?.trim() ?? "";

  if (input.credentialType === "biometric") {
    const user = sessionActorToUser(
      input.sessionActor,
      input.sessionActor?.role === "manager" ? "manager" : "owner",
    );
    return successResult(input, "biometric", "biometric", user, auditId);
  }

  if (input.credentialType === "owner_override") {
    if (!secret) {
      return failureResult(input, "owner_override", "missing_secret", auditId);
    }
    const ownerStaff = await matchingStaffAsync(
      input.preferences.staffAccounts ?? [],
      secret,
      new Set<UserRole>(["owner"]),
    );
    if (ownerStaff) {
      return successResult(input, "owner_override", "staff_pin", staffToUser(ownerStaff), auditId);
    }
    const shopOk = await verifyShopSecurityPinAsync(secret, input.preferences.backOfficePin);
    if (shopOk && input.sessionActor?.role === "owner") {
      return successResult(
        input,
        "owner_override",
        "shop_pin",
        sessionActorToUser(input.sessionActor, "owner"),
        auditId,
      );
    }
    return failureResult(input, "owner_override", "invalid", auditId);
  }

  if (input.credentialType === "staff_pin") {
    if (!secret) return failureResult(input, "staff_pin", "missing_secret", auditId);
    const roles = input.allowedStaffRoles ?? DEFAULT_UNLOCK_STAFF_ROLES;
    const user = await verifyStaffPin(secret, input.preferences, roles);
    if (user) {
      return successResult(input, "staff_pin", "staff_pin", user, auditId);
    }
    return failureResult(input, "staff_pin", "invalid", auditId);
  }

  if (input.credentialType === "shop_security_pin") {
    if (!secret) return failureResult(input, "shop_security_pin", "missing_secret", auditId);
    const ok = await verifyShopSecurityPinAsync(secret, input.preferences.backOfficePin);
    if (!ok) return failureResult(input, "shop_security_pin", "invalid", auditId);
    const role =
      input.sessionActor?.role === "manager"
        ? "manager"
        : input.sessionActor?.role === "owner"
          ? "owner"
          : "owner";
    return successResult(
      input,
      "shop_security_pin",
      "shop_pin",
      sessionActorToUser(input.sessionActor, role),
      auditId,
    );
  }

  return failureResult(input, input.credentialType, "unsupported", auditId);
}

/** Back-office shell unlock — staff PIN (async) then shop PIN. */
export async function verifyBackOfficeShellCredential(
  pin: string,
  preferences: ShopPreferences,
  sessionActor: SessionActor | null,
  deviceId: string,
): Promise<EnterpriseSecurityResult> {
  const auditId = createAuditId();
  const input: VerifyContext = {
    credentialType: "staff_pin",
    secret: pin,
    preferences,
    sessionActor,
    action: "back_office_shell",
    deviceId,
    allowedStaffRoles: DEFAULT_UNLOCK_STAFF_ROLES,
  };

  const staffUser = await verifyStaffPin(pin, preferences, DEFAULT_UNLOCK_STAFF_ROLES);
  if (staffUser) {
    return successResult(input, "staff_pin", "staff_pin", staffUser, auditId);
  }

  const stored = preferences.backOfficePin?.trim() ?? "";
  const staff = preferences.staffAccounts ?? [];

  if (!stored) {
    if (staff.length === 0) {
      const role = sessionActor?.role ?? "owner";
      return successResult(
        input,
        "shop_security_pin",
        "open_no_pin",
        sessionActorToUser(sessionActor, role),
        auditId,
      );
    }
    return failureResult(input, "staff_pin", "invalid", auditId);
  }

  const shopOk = await verifyShopSecurityPinAsync(pin, stored);
  if (shopOk) {
    const role =
      sessionActor?.role === "manager" ? "manager" : sessionActor?.role === "owner" ? "owner" : "owner";
    return successResult(
      input,
      "shop_security_pin",
      "shop_pin",
      sessionActorToUser(sessionActor, role),
      auditId,
    );
  }

  return failureResult(input, "shop_security_pin", "invalid", auditId);
}

/** Sync back-office shell unlock — legacy staff hashes + plaintext shop PIN. */
export function verifyBackOfficeShellCredentialSync(
  pin: string,
  preferences: ShopPreferences,
  sessionActor: SessionActor | null,
): EnterpriseSecurityResult {
  const auditId = createAuditId();
  const input: VerifyContext = {
    credentialType: "staff_pin",
    secret: pin,
    preferences,
    sessionActor,
    action: "back_office_shell",
    deviceId: "sync",
    allowedStaffRoles: DEFAULT_UNLOCK_STAFF_ROLES,
  };

  const staffUser = verifyStaffPinSync(pin, preferences, DEFAULT_UNLOCK_STAFF_ROLES);
  if (staffUser) {
    return successResult(input, "staff_pin", "staff_pin", staffUser, auditId);
  }

  const stored = preferences.backOfficePin?.trim() ?? "";
  const staff = preferences.staffAccounts ?? [];

  if (!stored) {
    if (staff.length === 0) {
      const role = sessionActor?.role ?? "owner";
      return successResult(
        input,
        "shop_security_pin",
        "open_no_pin",
        sessionActorToUser(sessionActor, role),
        auditId,
      );
    }
    return { ok: false, reason: "invalid_credential", credentialAttempted: "staff_pin", auditId };
  }

  if (verifyShopSecurityPinSync(pin, stored)) {
    const role =
      sessionActor?.role === "manager" ? "manager" : sessionActor?.role === "owner" ? "owner" : "owner";
    return successResult(
      input,
      "shop_security_pin",
      "shop_pin",
      sessionActorToUser(sessionActor, role),
      auditId,
    );
  }

  return { ok: false, reason: "invalid_credential", credentialAttempted: "shop_security_pin", auditId };
}

/** Manager float / day-close override — staff PIN (async) or shop PIN. */
export async function verifyFloatVerifyOverride(
  pin: string,
  preferences: ShopPreferences,
  sessionRole: UserRole,
  sessionUserId: string,
  sessionLabel: string,
): Promise<EnterpriseSecurityResult> {
  const staffUser = await verifyStaffPin(pin, preferences, FLOAT_OVERRIDE_STAFF_ROLES);
  if (staffUser) {
    return {
      ok: true,
      credential: "staff_pin",
      via: "staff_pin",
      user: staffUser,
      auditId: createAuditId(),
    };
  }

  const shopOk = await verifyShopSecurityPinAsync(pin, preferences.backOfficePin);
  if (shopOk) {
    const role =
      sessionRole === "owner" || sessionRole === "manager" || sessionRole === "supervisor"
        ? sessionRole
        : "owner";
    return {
      ok: true,
      credential: "shop_security_pin",
      via: "shop_pin",
      user: { role, actorUserId: sessionUserId, actorLabel: sessionLabel },
      auditId: createAuditId(),
    };
  }

  const stored = preferences.backOfficePin?.trim() ?? "";
  const staff = preferences.staffAccounts ?? [];
  if (!stored && staff.length === 0 && FLOAT_OVERRIDE_STAFF_ROLES.has(sessionRole)) {
    return {
      ok: true,
      credential: "staff_pin",
      via: "role_session",
      user: { role: sessionRole, actorUserId: sessionUserId, actorLabel: sessionLabel },
      auditId: createAuditId(),
    };
  }

  return {
    ok: false,
    reason: "invalid_credential",
    credentialAttempted: "staff_pin",
    auditId: createAuditId(),
  };
}

/** Sync float override — legacy paths only; prefer async in new code. */
export function verifyFloatVerifyOverrideSync(
  pin: string,
  preferences: ShopPreferences,
  sessionRole: UserRole,
  sessionUserId: string,
  sessionLabel: string,
): EnterpriseSecurityResult {
  const staffUser = verifyStaffPinSync(pin, preferences, FLOAT_OVERRIDE_STAFF_ROLES);
  if (staffUser) {
    return {
      ok: true,
      credential: "staff_pin",
      via: "staff_pin",
      user: staffUser,
      auditId: createAuditId(),
    };
  }

  if (verifyShopSecurityPinSync(pin, preferences.backOfficePin)) {
    const role =
      sessionRole === "owner" || sessionRole === "manager" || sessionRole === "supervisor"
        ? sessionRole
        : "owner";
    return {
      ok: true,
      credential: "shop_security_pin",
      via: "shop_pin",
      user: { role, actorUserId: sessionUserId, actorLabel: sessionLabel },
      auditId: createAuditId(),
    };
  }

  const stored = preferences.backOfficePin?.trim() ?? "";
  const staff = preferences.staffAccounts ?? [];
  if (!stored && staff.length === 0 && FLOAT_OVERRIDE_STAFF_ROLES.has(sessionRole)) {
    return {
      ok: true,
      credential: "staff_pin",
      via: "role_session",
      user: { role: sessionRole, actorUserId: sessionUserId, actorLabel: sessionLabel },
      auditId: createAuditId(),
    };
  }

  return {
    ok: false,
    reason: "invalid_credential",
    credentialAttempted: "staff_pin",
    auditId: createAuditId(),
  };
}

/** Manager approval — accepts staff PIN or shop security PIN (async). */
export async function verifyManagerApprovalPin(
  pin: string,
  preferences: ShopPreferences,
  deviceId: string,
  action: SecurityActionScope = "manager_override",
): Promise<EnterpriseSecurityResult> {
  const ctx: VerifyContext = {
    credentialType: "staff_pin",
    secret: pin,
    preferences,
    sessionActor: null,
    action,
    deviceId,
    allowedStaffRoles: FLOAT_OVERRIDE_STAFF_ROLES,
  };
  const auditId = createAuditId();
  const staffUser = await verifyStaffPin(pin, preferences, FLOAT_OVERRIDE_STAFF_ROLES);
  if (staffUser) {
    return successResult(ctx, "staff_pin", "staff_pin", staffUser, auditId);
  }
  const shopOk = await verifyShopSecurityPinAsync(pin, preferences.backOfficePin);
  if (shopOk) {
    return successResult(
      ctx,
      "shop_security_pin",
      "shop_pin",
      { role: "owner", actorUserId: "shop_pin", actorLabel: "Shop Security PIN" },
      auditId,
    );
  }
  return failureResult(ctx, "staff_pin", "invalid", auditId);
}

/** Sync manager approval — shop legacy plaintext + legacy staff. */
export function verifyManagerApprovalPinSync(
  pin: string,
  preferences: ShopPreferences,
): boolean {
  if (verifyStaffPinSync(pin, preferences, FLOAT_OVERRIDE_STAFF_ROLES)) return true;
  return verifyShopSecurityPinSync(pin, preferences.backOfficePin);
}

export function grantSecuritySessionForResult(
  result: EnterpriseSecurityResult,
  scopes: SecurityActionScope[] | "all",
  deviceId: string,
): void {
  if (!result.ok) return;
  createSecuritySession({
    scopes,
    credential: result.credential,
    user: result.user,
    deviceId,
    auditId: result.auditId,
  });
}

export function securityRequiredForPreferences(
  preferences: Pick<ShopPreferences, "backOfficePin" | "staffAccounts" | "biometricAuthEnabled">,
): boolean {
  return isBackOfficePinRequired(preferences) || preferences.biometricAuthEnabled === true;
}

export function isShopPinConfigured(preferences: Pick<ShopPreferences, "backOfficePin">): boolean {
  return isShopSecurityPinConfigured(preferences.backOfficePin);
}
