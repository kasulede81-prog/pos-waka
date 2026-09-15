import { describe, expect, it } from "vitest";
import { shouldSuppressPosLockScreen } from "./lockPos";

describe("shouldSuppressPosLockScreen", () => {
  it("suppresses on staff setup for shop managers", () => {
    expect(shouldSuppressPosLockScreen("/staff-access", true)).toBe(true);
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
