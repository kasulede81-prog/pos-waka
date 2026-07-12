import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import {
  fetchOwnerShopDevices,
  isDeviceHistoryRecord,
  isLicensedActiveDevice,
  isPendingApprovalDevice,
  partitionShopDevices,
  recordDevicesPageViewed,
  type ShopDeviceRow,
} from "./shopDevices";

function device(partial: Partial<ShopDeviceRow> & Pick<ShopDeviceRow, "id" | "status" | "approval_status">): ShopDeviceRow {
  return {
    device_fingerprint: partial.device_fingerprint ?? "fp-1",
    label: partial.label ?? null,
    platform: partial.platform ?? null,
    app_version: null,
    last_seen_at: null,
    last_sync_at: null,
    last_login_at: null,
    is_active: partial.status === "active",
    created_at: "",
    device_authority: partial.device_authority ?? "secondary",
    form_factor: "tablet",
    device_type: null,
    is_primary: partial.device_authority === "primary",
    current_staff_client_id: null,
    pending_uploads: 0,
    pending_downloads: 0,
    cloud_status: null,
    recovery_status: null,
    approval_requested_at: null,
    ...partial,
  };
}

describe("isLicensedActiveDevice", () => {
  it("counts only approved and active devices", () => {
    expect(isLicensedActiveDevice(device({ id: "1", status: "active", approval_status: "approved" }))).toBe(true);
    expect(isLicensedActiveDevice(device({ id: "2", status: "active", approval_status: "pending" }))).toBe(false);
    expect(isLicensedActiveDevice(device({ id: "3", status: "disconnected", approval_status: "approved" }))).toBe(false);
    expect(isLicensedActiveDevice(device({ id: "4", status: "revoked", approval_status: "revoked" }))).toBe(false);
  });
});

describe("partitionShopDevices", () => {
  it("separates active, pending, and history without overlap", () => {
    const active = device({ id: "a", status: "active", approval_status: "approved" });
    const pending = device({ id: "p", status: "disconnected", approval_status: "pending" });
    const history = device({ id: "h", status: "revoked", approval_status: "revoked" });
    const parts = partitionShopDevices([active, pending, history]);
    expect(parts.activeDevices).toEqual([active]);
    expect(parts.pendingDevices).toEqual([pending]);
    expect(parts.historyDevices).toEqual([history]);
  });

  it("never puts pending devices in history", () => {
    const pending = device({ id: "p", status: "disconnected", approval_status: "pending" });
    expect(isPendingApprovalDevice(pending)).toBe(true);
    expect(isDeviceHistoryRecord(pending)).toBe(false);
  });
});

describe("fetchOwnerShopDevices", () => {
  it("parses jsonb array returned as JSON string", async () => {
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data: JSON.stringify([
        {
          id: "dev-1",
          device_fingerprint: "fp-1",
          status: "active",
          approval_status: "approved",
          is_active: true,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
      error: null,
    } as never);
    const rows = await fetchOwnerShopDevices("shop-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("dev-1");
  });
});

describe("recordDevicesPageViewed", () => {
  it("does not throw when audit rpc fails", async () => {
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: "Forbidden" },
    } as never);
    await expect(recordDevicesPageViewed("shop-1")).resolves.toBeUndefined();
  });
});
