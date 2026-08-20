/**
 * AI-AUTH-1: who may use AI (platform role buckets).
 * Server-side source of truth is check_ai_feature_allowed + shop_members.role.
 */
import type { UserRole } from "../../types";

export type AiRoleBucket = "owner" | "manager" | "cashier";

export type AiRoleAccess = {
  owner: boolean;
  manager: boolean;
  cashier: boolean;
};

export const DEFAULT_AI_ROLE_ACCESS: AiRoleAccess = {
  owner: true,
  manager: true,
  cashier: false,
};

export function parseAiRoleAccess(raw: unknown): AiRoleAccess {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    owner: obj.owner !== false,
    manager: obj.manager !== false,
    cashier: obj.cashier === true,
  };
}

export function mapShopRoleToAiRoleBucket(role: UserRole | string | null | undefined): AiRoleBucket {
  const r = String(role ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (r === "owner") return "owner";
  if (r === "manager" || r === "supervisor") return "manager";
  return "cashier";
}

export function isAiRoleAuthorized(
  role: UserRole | string | null | undefined,
  access: AiRoleAccess = DEFAULT_AI_ROLE_ACCESS,
): boolean {
  return access[mapShopRoleToAiRoleBucket(role)] === true;
}
