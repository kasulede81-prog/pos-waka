import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  FAIL_CLOSED_ROLE,
  logRoleResolutionFailure,
  normalizeUserRole,
  resolveAuthRole,
} from "./permissions";

vi.mock("./pilotEventLog", () => ({
  appendPilotEvent: vi.fn(),
}));

import { appendPilotEvent } from "./pilotEventLog";

describe("resolveAuthRole — fail closed", () => {
  beforeEach(() => {
    vi.mocked(appendPilotEvent).mockClear();
  });

  it("local mode remains owner (single-device offline shop)", () => {
    expect(
      resolveAuthRole({
        mode: "local",
        userMetadata: undefined,
        shopMemberRole: null,
      }),
    ).toBe("owner");
    expect(appendPilotEvent).not.toHaveBeenCalled();
  });

  it("uses shop_members role when present", () => {
    expect(
      resolveAuthRole({
        mode: "supabase",
        userMetadata: { pos_role: "owner" },
        shopMemberRole: "cashier",
      }),
    ).toBe("cashier");
    expect(appendPilotEvent).not.toHaveBeenCalled();
  });

  it("missing membership never resolves to owner", () => {
    const role = resolveAuthRole({
      mode: "supabase",
      userMetadata: { pos_role: "owner" },
      shopMemberRole: null,
    });
    expect(role).toBe(FAIL_CLOSED_ROLE);
    expect(role).not.toBe("owner");
    expect(appendPilotEvent).toHaveBeenCalled();
  });

  it("invalid metadata alone never resolves to owner", () => {
    const role = resolveAuthRole({
      mode: "supabase",
      userMetadata: { pos_role: "superuser" },
      shopMemberRole: null,
    });
    expect(role).toBe(FAIL_CLOSED_ROLE);
    expect(role).not.toBe("owner");
  });

  it("corrupted membership string normalizes to null and fail-closed role", () => {
    expect(normalizeUserRole("not_a_real_role")).toBeNull();
    const role = resolveAuthRole({
      mode: "supabase",
      userMetadata: undefined,
      shopMemberRole: normalizeUserRole("not_a_real_role"),
    });
    expect(role).toBe(FAIL_CLOSED_ROLE);
    expect(role).not.toBe("owner");
  });

  it("logRoleResolutionFailure records pilot event", () => {
    logRoleResolutionFailure({ hadMetadataRole: true });
    expect(appendPilotEvent).toHaveBeenCalledWith(
      "other",
      "Auth role fail-closed (no valid shop_members)",
      { hadMetadataRole: true },
    );
  });
});
