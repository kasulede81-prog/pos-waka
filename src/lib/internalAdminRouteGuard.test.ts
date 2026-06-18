import { describe, expect, it } from "vitest";
import {
  resolveInternalAdminGateState,
  shouldMountInternalAdminOutlet,
} from "./internalAdminRouteGuard";

describe("internalAdminRouteGuard", () => {
  it("preview mode allows immediately without admin row", () => {
    expect(resolveInternalAdminGateState({ previewRequested: true, adminRow: undefined })).toBe("allowed");
    expect(resolveInternalAdminGateState({ previewRequested: true, adminRow: null })).toBe("allowed");
  });

  it("loading while admin check is in flight", () => {
    expect(resolveInternalAdminGateState({ previewRequested: false, adminRow: undefined })).toBe("loading");
  });

  it("denies non-admin after check resolves", () => {
    expect(resolveInternalAdminGateState({ previewRequested: false, adminRow: null })).toBe("denied");
  });

  it("allows verified waka admin", () => {
    expect(
      resolveInternalAdminGateState({
        previewRequested: false,
        adminRow: { id: "admin-1", email: "ops@waka.ug", role: "super_admin" },
      }),
    ).toBe("allowed");
  });

  it("child routes mount only when allowed", () => {
    expect(shouldMountInternalAdminOutlet("allowed")).toBe(true);
    expect(shouldMountInternalAdminOutlet("loading")).toBe(false);
    expect(shouldMountInternalAdminOutlet("denied")).toBe(false);
  });
});
