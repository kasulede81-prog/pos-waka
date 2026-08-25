import { describe, expect, it } from "vitest";
import {
  isSharedTerminalLockOperator,
  shouldShowEnterpriseStaffLockScreen,
  shouldSuppressPosLockScreen,
} from "./lockPos";

describe("shouldSuppressPosLockScreen", () => {
  it("suppresses on staff setup for shop managers", () => {
    expect(shouldSuppressPosLockScreen("/staff-access", true)).toBe(true);
    expect(shouldSuppressPosLockScreen("/staff-center/team", true)).toBe(true);
    expect(shouldSuppressPosLockScreen("/settings/staff-security", true)).toBe(true);
  });

  it("does not suppress on sell screen or for cashiers", () => {
    expect(shouldSuppressPosLockScreen("/", false)).toBe(false);
    expect(shouldSuppressPosLockScreen("/staff-access", false)).toBe(false);
    expect(shouldSuppressPosLockScreen("/pos/sell", true)).toBe(false);
  });

  it("suppresses POS lock on close day and office routes", () => {
    expect(shouldSuppressPosLockScreen("/close-day", true)).toBe(true);
    expect(shouldSuppressPosLockScreen("/office/cash-drawer", true)).toBe(true);
  });
});

describe("Phase 11k shared terminal lock gate", () => {
  it("owner or Path S may lock; Path L cashier may not", () => {
    expect(isSharedTerminalLockOperator({ authOperatorRole: "owner", hasPathSStaffSession: false })).toBe(
      true,
    );
    expect(isSharedTerminalLockOperator({ authOperatorRole: "cashier", hasPathSStaffSession: true })).toBe(
      true,
    );
    expect(isSharedTerminalLockOperator({ authOperatorRole: "cashier", hasPathSStaffSession: false })).toBe(
      false,
    );
    expect(isSharedTerminalLockOperator({ authOperatorRole: "manager", hasPathSStaffSession: false })).toBe(
      false,
    );
  });

  it("posLocked alone does not show lock for personal staff", () => {
    expect(
      shouldShowEnterpriseStaffLockScreen({
        posLocked: true,
        authOperatorRole: "manager",
        hasPathSStaffSession: false,
        pathname: "/pos/sell",
        canManageShopSettings: true,
      }),
    ).toBe(false);
  });
});
