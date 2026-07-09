/**
 * Phase 13.2 — unified staff login service (offline PIN, session, audit).
 */

import type { Permission, UserRole } from "../../types";
import { resolveStaffPermissions } from "../enterpriseRoles";
import {
  authenticateOfflineStaff,
  type StaffAuthResult,
  type StaffLoginInput,
} from "../staffOfflineAuth";
import { resolveSessionActor } from "../sessionActor";
import { logStaffSessionAudit } from "./staffSessionAudit";
import { startStaffSessionClock } from "./staffSession";

export type AuthenticatedStaffSession = StaffAuthResult & {
  permissions?: Permission[];
  roleTemplateId?: string | null;
  customRoleId?: string | null;
};

export async function authenticateStaffLogin(input: StaffLoginInput): Promise<AuthenticatedStaffSession> {
  const result = await authenticateOfflineStaff(input);
  startStaffSessionClock();

  logStaffSessionAudit("staff_login", {
    staffId: result.staffId,
    staffName: result.staffName,
    role: result.role,
    source: "staff_login_screen",
    rememberDevice: input.rememberDevice,
  });

  return result;
}

export async function resolvePermissionsForStaffLogin(staffId: string, role: UserRole): Promise<{
  permissions: Permission[];
  roleTemplateId?: string | null;
  customRoleId?: string | null;
}> {
  const { usePosStore } = await import("../../store/usePosStore");
  const store = usePosStore.getState();
  const staffAccount = (store.preferences.staffAccounts ?? []).find((s) => s.id === staffId);
  const permissions = staffAccount
    ? resolveStaffPermissions(staffAccount, store.preferences.customStaffRoles)
    : resolveStaffPermissions({ role }, store.preferences.customStaffRoles);
  return {
    permissions,
    roleTemplateId: staffAccount?.roleTemplateId ?? null,
    customRoleId: staffAccount?.customRoleId ?? null,
  };
}

export async function buildStaffSessionActor(staff: {
  staffId: string;
  staffName: string;
  role: UserRole;
  permissions?: Permission[];
  roleTemplateId?: string | null;
  customRoleId?: string | null;
}) {
  const { usePosStore } = await import("../../store/usePosStore");
  return resolveSessionActor({
    mode: "local",
    user: null,
    email: null,
    preferences: usePosStore.getState().preferences,
    staffSession: staff,
  });
}
