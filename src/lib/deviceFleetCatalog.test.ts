import { describe, expect, it } from "vitest";
import {
  deviceMatchesFleetSearch,
  filterFleetDevices,
  groupFleetDevicesByBucket,
  resolveDeviceFleetBucket,
} from "./deviceFleetCatalog";
import type { ShopDeviceRow } from "./shopDevices";

function device(partial: Partial<ShopDeviceRow> & Pick<ShopDeviceRow, "id">): ShopDeviceRow {
  return {
    device_fingerprint: partial.device_fingerprint ?? `fp-${partial.id}`,
    label: partial.label ?? null,
    platform: partial.platform ?? null,
    app_version: partial.app_version ?? "1.0.19",
    last_seen_at: partial.last_seen_at ?? null,
    last_sync_at: partial.last_sync_at ?? null,
    last_login_at: partial.last_login_at ?? null,
    status: partial.status ?? "active",
    approval_status: partial.approval_status ?? "approved",
    is_active: partial.status === "active",
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    device_authority: "secondary",
    form_factor: "tablet",
    device_type: null,
    is_primary: false,
    current_staff_client_id: null,
    pending_uploads: 0,
    pending_downloads: 0,
    cloud_status: null,
    recovery_status: null,
    approval_requested_at: null,
    ...partial,
  };
}

describe("enterprise device fleet catalog", () => {
  const nowMs = Date.parse("2026-07-06T12:00:00.000Z");
  const currentFp = "fp-current";
  const recentSeen = new Date(nowMs - 5 * 60 * 1000).toISOString();

  it("scenario 1: Android, Windows, and Web devices all appear in fleet", () => {
    const fleet = [
      device({ id: "android", platform: "android", device_fingerprint: "fp-android", last_seen_at: recentSeen }),
      device({ id: "windows", platform: "electron", device_fingerprint: "fp-windows", last_seen_at: recentSeen }),
      device({ id: "web", platform: "web", device_fingerprint: "fp-web", last_seen_at: recentSeen }),
    ];
    const grouped = groupFleetDevicesByBucket(fleet, currentFp, nowMs);
    expect(grouped.approved).toHaveLength(3);
    expect(filterFleetDevices(fleet, { filter: "android", search: "", currentFingerprint: currentFp, nowMs })).toHaveLength(1);
    expect(filterFleetDevices(fleet, { filter: "windows", search: "", currentFingerprint: currentFp, nowMs })).toHaveLength(1);
    expect(filterFleetDevices(fleet, { filter: "web", search: "", currentFingerprint: currentFp, nowMs })).toHaveLength(1);
  });

  it("scenario 2: disconnected device appears under disconnected bucket", () => {
    const disconnected = device({
      id: "disc",
      status: "disconnected",
      approval_status: "approved",
      device_fingerprint: "fp-disc",
    });
    expect(resolveDeviceFleetBucket(disconnected, currentFp, nowMs)).toBe("disconnected");
    const grouped = groupFleetDevicesByBucket([disconnected], currentFp, nowMs);
    expect(grouped.disconnected).toEqual([disconnected]);
  });

  it("scenario 3: pending device moves to approved after approval", () => {
    const pending = device({
      id: "pending",
      approval_status: "pending",
      status: "disconnected",
      device_fingerprint: "fp-pending",
      approval_requested_at: new Date(nowMs - 30_000).toISOString(),
    });
    expect(resolveDeviceFleetBucket(pending, currentFp, nowMs)).toBe("pending");

    const approved = {
      ...pending,
      approval_status: "approved" as const,
      status: "active" as const,
      last_seen_at: recentSeen,
    };
    expect(resolveDeviceFleetBucket(approved, currentFp, nowMs)).toBe("approved");
  });

  it("scenario 5: current device badge bucket follows active session fingerprint", () => {
    const current = device({ id: "cur", device_fingerprint: currentFp, last_seen_at: recentSeen });
    const other = device({ id: "other", device_fingerprint: "fp-other", last_seen_at: recentSeen });
    expect(resolveDeviceFleetBucket(current, currentFp, nowMs)).toBe("current");
    expect(resolveDeviceFleetBucket(other, currentFp, nowMs)).toBe("approved");
    expect(filterFleetDevices([current, other], { filter: "current", search: "", currentFingerprint: currentFp, nowMs })).toEqual([
      current,
    ]);
  });

  it("scenario 6: search and filters return correct devices", () => {
    const fleet = [
      device({ id: "a", label: "Front counter", device_fingerprint: "fp-front", platform: "android" }),
      device({
        id: "b",
        label: "Kitchen",
        device_fingerprint: "fp-kitchen",
        platform: "web",
        status: "disconnected",
        approval_status: "approved",
      }),
      device({
        id: "c",
        label: "Old tablet",
        device_fingerprint: "fp-old",
        approval_status: "revoked",
        status: "revoked",
      }),
    ];

    expect(deviceMatchesFleetSearch(fleet[0]!, "front")).toBe(true);
    expect(deviceMatchesFleetSearch(fleet[1]!, "fp-kitchen")).toBe(true);
    expect(
      filterFleetDevices(fleet, { filter: "disconnected", search: "", currentFingerprint: currentFp, nowMs }),
    ).toEqual([fleet[1]]);
    expect(
      filterFleetDevices(fleet, { filter: "revoked", search: "", currentFingerprint: currentFp, nowMs }),
    ).toEqual([fleet[2]]);
    expect(
      filterFleetDevices(fleet, { filter: "all", search: "kitchen", currentFingerprint: currentFp, nowMs }),
    ).toEqual([fleet[1]]);
  });
});
