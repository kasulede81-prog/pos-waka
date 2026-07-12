import { describe, expect, it } from "vitest";
import {
  DEVICE_PRESENCE_ONLINE_MS,
  DEVICE_PRESENCE_RECENT_MS,
  resolveDevicePresence,
  shortDeviceFingerprint,
} from "./deviceFleetPresence";
import type { ShopDeviceRow } from "./shopDevices";

function device(partial: Partial<ShopDeviceRow> & Pick<ShopDeviceRow, "id">): ShopDeviceRow {
  return {
    device_fingerprint: partial.device_fingerprint ?? "fp-default",
    label: partial.label ?? null,
    platform: partial.platform ?? null,
    app_version: partial.app_version ?? null,
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

describe("resolveDevicePresence", () => {
  const nowMs = Date.parse("2026-07-06T12:00:00.000Z");

  it("returns online when heartbeat is within 15 minutes", () => {
    const seen = new Date(nowMs - 5 * 60 * 1000).toISOString();
    expect(resolveDevicePresence(device({ id: "1", last_seen_at: seen }), nowMs)).toBe("online");
  });

  it("transitions online → recently_active → offline as heartbeat ages", () => {
    const onlineSeen = new Date(nowMs - DEVICE_PRESENCE_ONLINE_MS + 60_000).toISOString();
    const recentSeen = new Date(nowMs - DEVICE_PRESENCE_ONLINE_MS - 60_000).toISOString();
    const offlineSeen = new Date(nowMs - DEVICE_PRESENCE_RECENT_MS - 60_000).toISOString();

    expect(resolveDevicePresence(device({ id: "1", last_seen_at: onlineSeen }), nowMs)).toBe("online");
    expect(resolveDevicePresence(device({ id: "2", last_seen_at: recentSeen }), nowMs)).toBe("recently_active");
    expect(resolveDevicePresence(device({ id: "3", last_seen_at: offlineSeen }), nowMs)).toBe("offline");
  });

  it("falls back to last_sync then last_login when heartbeat is missing", () => {
    const syncAt = new Date(nowMs - 10 * 60 * 1000).toISOString();
    expect(
      resolveDevicePresence(device({ id: "1", last_sync_at: syncAt, last_login_at: null }), nowMs),
    ).toBe("online");

    const loginAt = new Date(nowMs - 20 * 60 * 1000).toISOString();
    expect(
      resolveDevicePresence(device({ id: "2", last_sync_at: null, last_login_at: loginAt }), nowMs),
    ).toBe("recently_active");
  });

  it("returns unknown for active devices with no activity timestamps", () => {
    expect(resolveDevicePresence(device({ id: "1", status: "active" }), nowMs)).toBe("unknown");
  });

  it("returns offline for disconnected devices with no activity", () => {
    expect(
      resolveDevicePresence(
        device({ id: "1", status: "disconnected", approval_status: "approved" }),
        nowMs,
      ),
    ).toBe("offline");
  });
});

describe("shortDeviceFingerprint", () => {
  it("shortens long fingerprints", () => {
    expect(shortDeviceFingerprint("abcdef1234567890")).toBe("abcd…7890");
  });

  it("returns em dash for empty input", () => {
    expect(shortDeviceFingerprint(null)).toBe("—");
  });
});
