import { describe, expect, it } from "vitest";
import { filterActiveRescueDevices, isRescueDeviceLoggedIn } from "./rescueDeviceList";
import type { ShopDeviceRow } from "./wakaInternalAdmin";

function device(partial: Partial<ShopDeviceRow>): ShopDeviceRow {
  return {
    id: partial.id ?? "d1",
    shop_id: partial.shop_id ?? "s1",
    device_fingerprint: partial.device_fingerprint ?? "fp1",
    label: partial.label ?? null,
    platform: partial.platform ?? "web",
    app_version: partial.app_version ?? "1.0.11",
    last_seen_at: partial.last_seen_at ?? null,
    last_login_at: partial.last_login_at ?? null,
    device_authority: partial.device_authority ?? "secondary",
    is_active: partial.is_active ?? true,
    trusted: partial.trusted ?? false,
    suspicious_flag: partial.suspicious_flag ?? false,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("rescueDeviceList", () => {
  const now = Date.parse("2026-07-08T18:00:00.000Z");

  it("treats recently seen devices as logged in", () => {
    expect(
      isRescueDeviceLoggedIn(device({ last_seen_at: "2026-07-08T17:50:00.000Z" }), now),
    ).toBe(true);
  });

  it("filters to active online devices up to limit", () => {
    const rows = [
      device({ id: "1", last_seen_at: "2026-07-08T17:55:00.000Z" }),
      device({ id: "2", last_seen_at: "2026-07-08T17:52:00.000Z" }),
      device({ id: "3", last_seen_at: "2026-07-08T17:50:00.000Z" }),
      device({ id: "4", last_seen_at: "2026-07-08T17:48:00.000Z" }),
      device({ id: "5", last_seen_at: "2026-07-08T17:46:00.000Z" }),
      device({ id: "old", last_seen_at: "2026-06-01T00:00:00.000Z" }),
    ];
    const active = filterActiveRescueDevices(rows, { nowMs: now, limit: 4 });
    expect(active).toHaveLength(4);
    expect(active.map((d) => d.id)).toEqual(["1", "2", "3", "4"]);
  });
});
