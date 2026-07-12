import { describe, expect, it } from "vitest";
import { resolveIsShopOwner } from "../context/DeviceActivationContext";
import type { DeviceLimitContext } from "../lib/deviceActivation";

const ownerContext: DeviceLimitContext = {
  shop_id: "s1",
  plan_code: "business",
  plan_name: "Business",
  device_limit: 4,
  active_count: 1,
  is_owner: true,
  at_limit: false,
  devices: [],
};

const staffContext: DeviceLimitContext = { ...ownerContext, is_owner: false };

describe("resolveIsShopOwner", () => {
  it("returns true when server context marks owner", () => {
    expect(resolveIsShopOwner(ownerContext, { isOwner: false })).toBe(true);
  });

  it("returns true when login activation marks owner even if context missing", () => {
    expect(resolveIsShopOwner(null, { isOwner: true })).toBe(true);
  });

  it("returns false for staff when both sources agree", () => {
    expect(resolveIsShopOwner(staffContext, { isOwner: false })).toBe(false);
  });

  it("returns false when both sources are absent", () => {
    expect(resolveIsShopOwner(null, undefined)).toBe(false);
  });
});
