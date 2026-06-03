import { describe, expect, it } from "vitest";
import { buildDeviceUsageSummary, parsePlanDeviceLimit } from "./shopDevices";
import type { ShopDeviceRow } from "./shopDevices";

const devices: ShopDeviceRow[] = [
  {
    id: "1",
    device_fingerprint: "a",
    label: "A",
    platform: "android",
    app_version: null,
    last_seen_at: null,
    status: "active",
    is_active: true,
    created_at: "",
  },
  {
    id: "2",
    device_fingerprint: "b",
    label: "B",
    platform: "web",
    app_version: null,
    last_seen_at: null,
    status: "active",
    is_active: true,
    created_at: "",
  },
  {
    id: "3",
    device_fingerprint: "c",
    label: "C",
    platform: "web",
    app_version: null,
    last_seen_at: null,
    status: "disconnected",
    is_active: false,
    created_at: "",
  },
];

describe("buildDeviceUsageSummary", () => {
  it("counts only active devices", () => {
    const u = buildDeviceUsageSummary(devices, 3);
    expect(u.activeCount).toBe(2);
    expect(u.totalCount).toBe(3);
    expect(u.atPlanLimit).toBe(false);
  });

  it("flags at plan limit", () => {
    const u = buildDeviceUsageSummary(devices, 2);
    expect(u.atPlanLimit).toBe(true);
    expect(u.overPlanLimit).toBe(false);
  });

  it("flags over plan limit when extra active devices exist", () => {
    const u = buildDeviceUsageSummary(devices, 1);
    expect(u.activeCount).toBe(2);
    expect(u.atPlanLimit).toBe(true);
    expect(u.overPlanLimit).toBe(true);
  });
});

describe("parsePlanDeviceLimit", () => {
  it("returns null for local auth", () => {
    expect(parsePlanDeviceLimit({ kind: "local_full" }, "local")).toBeNull();
  });

  it("uses plan max_devices when present", () => {
    expect(
      parsePlanDeviceLimit(
        {
          kind: "remote",
          row: {
            id: "s",
            organization_id: "o",
            shop_id: null,
            status: "active",
            trial_ends_at: null,
            current_period_start: null,
            current_period_end: null,
            plan_code: "business",
            max_pos_users: null,
            max_shops: null,
            max_devices: 5,
          },
        },
        "supabase",
      ),
    ).toBe(5);
  });

  it("returns null when features.devices missing (unlimited)", () => {
    expect(
      parsePlanDeviceLimit(
        {
          kind: "remote",
          row: {
            id: "s",
            organization_id: "o",
            shop_id: null,
            status: "active",
            trial_ends_at: null,
            current_period_start: null,
            current_period_end: null,
            plan_code: "business",
            max_pos_users: null,
            max_shops: null,
            max_devices: null,
          },
        },
        "supabase",
      ),
    ).toBeNull();
  });
});
