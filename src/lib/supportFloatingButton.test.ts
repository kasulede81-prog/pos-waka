import { describe, expect, it } from "vitest";
import {
  shouldShowSupportFloatingButton,
  supportFloatingBadgeLabel,
  type SupportFloatingButtonVisibility,
} from "./supportFloatingButton";

const base: SupportFloatingButtonVisibility = {
  pathname: "/office",
  authenticated: true,
  posLocked: false,
  internalAdminRoute: false,
};

describe("shouldShowSupportFloatingButton", () => {
  it("shows on ordinary back-office pages for a signed-in merchant", () => {
    expect(shouldShowSupportFloatingButton(base)).toBe(true);
  });

  it("shows on the launcher home", () => {
    expect(shouldShowSupportFloatingButton({ ...base, pathname: "/" })).toBe(true);
  });

  it("hides for unauthenticated users", () => {
    expect(shouldShowSupportFloatingButton({ ...base, authenticated: false })).toBe(false);
  });

  it("hides while the POS is locked", () => {
    expect(shouldShowSupportFloatingButton({ ...base, posLocked: true })).toBe(false);
  });

  it("hides on internal admin routes", () => {
    expect(shouldShowSupportFloatingButton({ ...base, internalAdminRoute: true })).toBe(false);
  });

  it("hides on every support-center route, including nested ticket pages", () => {
    for (const pathname of [
      "/support-center",
      "/support-center/notifications",
      "/support-center/tickets",
      "/support-center/tickets/72d1858d-a81d-4201-a3f1-61c6e4e60012",
      "/support-center/new",
    ]) {
      expect(shouldShowSupportFloatingButton({ ...base, pathname })).toBe(false);
    }
  });

  it("hides on login and sell workspace paths", () => {
    expect(shouldShowSupportFloatingButton({ ...base, pathname: "/login" })).toBe(false);
    expect(shouldShowSupportFloatingButton({ ...base, pathname: "/pos" })).toBe(false);
  });
});

describe("supportFloatingBadgeLabel", () => {
  it("is empty when there is no attention", () => {
    expect(supportFloatingBadgeLabel(0)).toBe("");
  });

  it("renders small counts verbatim", () => {
    expect(supportFloatingBadgeLabel(3)).toBe("3");
  });

  it("caps at 9+ so the badge stays balanced", () => {
    expect(supportFloatingBadgeLabel(10)).toBe("9+");
    expect(supportFloatingBadgeLabel(99)).toBe("9+");
  });
});
