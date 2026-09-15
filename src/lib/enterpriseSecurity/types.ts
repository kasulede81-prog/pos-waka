import type { SessionActor } from "../sessionActor";
import type { ShopPreferences, UserRole } from "../../types";
import type { SensitiveActionKind } from "../sensitiveActionAuth";

/** Explicit credential types — one engine, four kinds. */
export type SecurityCredentialType =
  | "shop_security_pin"
  | "staff_pin"
  | "owner_override"
  | "biometric";

export type SecurityActionScope =
  | "back_office_shell"
  | SensitiveActionKind
  | "manager_override"
  | "float_verify"
  | "controlled_pharmacy"
  | string;

export type VerifiedSecurityUser = {
  role: UserRole;
  actorUserId: string;
  actorLabel: string;
  staffId?: string;
};

export type EnterpriseSecuritySuccess = {
  ok: true;
  credential: SecurityCredentialType;
  via: "staff_pin" | "shop_pin" | "biometric" | "owner_override" | "open_no_pin" | "role_session";
  user: VerifiedSecurityUser;
  auditId: string;
};

export type EnterpriseSecurityFailure = {
  ok: false;
  reason: "invalid_credential" | "no_credential_configured" | "role_not_allowed" | "cancelled";
  credentialAttempted?: SecurityCredentialType;
  auditId: string;
};

export type EnterpriseSecurityResult = EnterpriseSecuritySuccess | EnterpriseSecurityFailure;

export type SecuritySession = {
  authorizedScopes: Set<string>;
  expiresAt: number;
  verifiedCredential: SecurityCredentialType;
  verifiedUser: VerifiedSecurityUser;
  deviceId: string;
  lastActivity: number;
  auditId: string;
};

export type VerifySecurityCredentialInput = {
  credentialType: SecurityCredentialType;
  secret?: string;
  preferences: ShopPreferences;
  sessionActor: SessionActor | null;
  action: SecurityActionScope;
  /** Staff PIN: restrict matching accounts to these roles. */
  allowedStaffRoles?: Set<UserRole>;
  deviceId: string;
};

export type SecurityRequirement = {
  action: SecurityActionScope;
  /** Credential types the UI may collect for this action. */
  accept: SecurityCredentialType[];
};

export type SecurityAuditPayload = {
  action: SecurityActionScope;
  credential: SecurityCredentialType;
  success: boolean;
  reason?: string;
  userId?: string;
  role?: UserRole;
  deviceId: string;
  auditId: string;
};

export type SecurityAuditLogger = (payload: SecurityAuditPayload) => void;
