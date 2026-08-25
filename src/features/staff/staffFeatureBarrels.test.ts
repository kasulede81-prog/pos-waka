import { describe, expect, it } from "vitest";
import * as staff from "./index";
import * as identity from "./identity";
import * as roles from "./roles";
import * as sessions from "./sessions";
import * as activity from "./activity";
import * as management from "./management";

describe("Staff feature Phase 2 barrel surface", () => {
  it("identity re-exports invite + hydrate helpers", () => {
    expect(typeof identity.sendStaffInvite).toBe("function");
    expect(typeof identity.hydrateStaffAuthWorkspace).toBe("function");
    expect(typeof identity.fetchShopMemberRoleForUser).toBe("function");
  });

  it("roles re-exports permission helpers", () => {
    expect(typeof roles.hasActorPermission).toBe("function");
    expect(typeof roles.actorHasPermission).toBe("function");
    expect(typeof roles.resolveStaffPermissions).toBe("function");
  });

  it("sessions re-exports SessionActor + lock + offline auth", () => {
    expect(typeof sessions.resolveSessionActor).toBe("function");
    expect(typeof sessions.lockPos).toBe("function");
    expect(typeof sessions.authenticateOfflineStaff).toBe("function");
    expect(typeof sessions.shouldShowEnterpriseStaffLockScreen).toBe("function");
  });

  it("activity re-exports audit loggers", () => {
    expect(typeof activity.logStaffSecurityAudit).toBe("function");
    expect(typeof activity.logStaffSessionAudit).toBe("function");
  });

  it("management re-exports Staff Center UI entry points", () => {
    expect(typeof management.StaffAccessPage).toBe("function");
    expect(typeof management.StaffTeamList).toBe("function");
    expect(typeof management.StaffRolesCenter).toBe("function");
  });

  it("root features/staff re-exports subdomain surfaces", () => {
    expect(typeof staff.resolveSessionActor).toBe("function");
    expect(typeof staff.sendStaffInvite).toBe("function");
    expect(typeof staff.logStaffSecurityAudit).toBe("function");
    expect(typeof staff.StaffAccessPage).toBe("function");
  });
});
