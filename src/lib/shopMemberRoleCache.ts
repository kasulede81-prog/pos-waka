import { normalizeUserRole } from "./permissions";
import type { UserRole } from "../types";

const PREFIX = "waka:shop-member-role:";

export function readCachedShopMemberRole(userId: string): UserRole | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}${userId}`);
    return raw ? normalizeUserRole(raw) : null;
  } catch {
    return null;
  }
}

export function writeCachedShopMemberRole(userId: string, role: UserRole): void {
  if (!userId) return;
  try {
    localStorage.setItem(`${PREFIX}${userId}`, role);
  } catch {
    /* quota / private mode */
  }
}

export function clearCachedShopMemberRole(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(`${PREFIX}${userId}`);
  } catch {
    /* ignore */
  }
}
