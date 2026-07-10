import { describe, expect, it } from "vitest";
import { resolveActivationBlockKind } from "./deviceActivation";
import type { ShopDeviceRow } from "./shopDevices";

const baseDevice: ShopDeviceRow = {
  id: "d1",
  device_fingerprint: "fp1",
  label: "Web POS",
  platform: "web",
  app_version: "1.0.0",
  last_seen_at: null,
  last_sync_at: null,
  last_login_at: null,
  status: "disconnected",
  is_active: false,
  created_at: "",
  device_authority: "secondary",
  approval_status: "pending",
  approval_requested_at: new Date().toISOString(),
  form_factor: "phone",
  device_type: null,
  is_primary: false,
  current_staff_client_id: null,
  pending_uploads: 0,
  pending_downloads: 0,
  cloud_status: null,
  recovery_status: null,
};

describe("resolveActivationBlockKind", () => {
  it("returns limit when server blocked or context is full", () => {
    expect(
      resolveActivationBlockKind({
        result: { ok: false, activated: false, limit_blocked: true },
        context: null,
        currentDevice: null,
      }),
    ).toBe("limit");
    expect(
      resolveActivationBlockKind({
        result: { ok: false, activated: false },
        context: {
          shop_id: "s1",
          plan_code: "business",
          plan_name: "Business",
          device_limit: 4,
          active_count: 4,
          is_owner: true,
          at_limit: true,
          devices: [],
        },
        currentDevice: null,
      }),
    ).toBe("limit");
  });

  it("returns pending for pending device rows", () => {
    expect(
      resolveActivationBlockKind({
        result: { ok: false, activated: false },
        context: {
          shop_id: "s1",
          plan_code: "business",
          plan_name: "Business",
          device_limit: 4,
          active_count: 2,
          is_owner: true,
          at_limit: false,
          devices: [],
        },
        currentDevice: baseDevice,
      }),
    ).toBe("pending");
  });

  it("returns retry when pending approval expired", () => {
    const expiredAt = new Date(Date.now() - 120_000).toISOString();
    expect(
      resolveActivationBlockKind({
        result: { ok: true, activated: false, pending_approval: true, approval_status: "pending" },
        context: null,
        currentDevice: { ...baseDevice, approval_requested_at: expiredAt },
      }),
    ).toBe("retry");
  });

  it("returns retry when slots remain and device is not pending", () => {
    expect(
      resolveActivationBlockKind({
        result: { ok: false, activated: false },
        context: {
          shop_id: "s1",
          plan_code: "business",
          plan_name: "Business",
          device_limit: 4,
          active_count: 2,
          is_owner: true,
          at_limit: false,
          devices: [],
        },
        currentDevice: null,
      }),
    ).toBe("retry");
  });
});
