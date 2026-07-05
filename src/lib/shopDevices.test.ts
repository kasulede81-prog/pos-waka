import { describe, expect, it } from "vitest";
import { buildDeviceUsageSummary, parsePlanDeviceLimit } from "./shopDevices";
import type { ShopDeviceRow } from "./shopDevices";

function testDevice(
  partial: Partial<ShopDeviceRow> & Pick<ShopDeviceRow, "id" | "device_fingerprint">,
): ShopDeviceRow {
  return {
    label: null,
    platform: "android",
    app_version: null,
    last_seen_at: null,
    last_sync_at: null,
    last_login_at: null,
    status: "active",
    is_active: true,
    created_at: "",
    device_authority: "secondary",
    approval_status: "approved",
    form_factor: "tablet",
    device_type: null,
    is_primary: false,
    current_staff_client_id: null,
    pending_uploads: 0,
    pending_downloads: 0,
    cloud_status: null,
    recovery_status: null,
    ...partial,
  };
}

const devices: ShopDeviceRow[] = [
  testDevice({ id: "1", device_fingerprint: "a", label: "A" }),
  testDevice({ id: "2", device_fingerprint: "b", label: "B", platform: "web" }),
  testDevice({
    id: "3",
    device_fingerprint: "c",
    label: "C",
    platform: "web",
    status: "disconnected",
    is_active: false,
  }),
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

  it("falls back to tier default when features.devices missing", () => {
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
    ).toBe(4);
  });

  it("uses effective tier for shops without subscription row", () => {
    expect(parsePlanDeviceLimit({ kind: "none" }, "supabase")).toBe(1);
  });
});
