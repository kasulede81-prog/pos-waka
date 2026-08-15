import { describe, expect, it } from "vitest";
import {
  assertTicketDeviceResolution,
  mapTicketIssueToReason,
  ticketDeviceFingerprint,
  ticketRemoteSupportPayload,
} from "./resolveTicketDevice";

const now = Date.parse("2026-08-15T16:00:00.000Z");

function device(partial: Record<string, unknown> = {}) {
  return {
    id: "dev-a",
    shop_id: "shop-a",
    device_fingerprint: "pos-aaaa-1111",
    platform: "windows",
    last_seen_at: new Date(now - 60_000).toISOString(),
    is_active: true,
    status: "active",
    approval_status: "approved",
    ...partial,
  };
}

describe("ticket device resolution", () => {
  it("uses ticket fingerprint or diagnostics.deviceId", () => {
    expect(ticketDeviceFingerprint({ deviceFingerprint: "pos-aaaa-1111" })).toBe("pos-aaaa-1111");
    expect(ticketDeviceFingerprint({ diagnostics: { deviceId: "pos-bbbb-2222" } })).toBe("pos-bbbb-2222");
    expect(ticketDeviceFingerprint({})).toBe("");
  });

  it("resolves an eligible same-shop Windows POS", () => {
    const result = assertTicketDeviceResolution({
      shopId: "shop-a",
      fingerprint: "pos-aaaa-1111",
      device: device(),
      nowMs: now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.device.id).toBe("dev-a");
  });

  it("fails closed without shop, fingerprint, or device", () => {
    const noShop = assertTicketDeviceResolution({ shopId: null, fingerprint: "pos-aaaa-1111", device: device() });
    const noFp = assertTicketDeviceResolution({ shopId: "shop-a", fingerprint: "", device: device() });
    const noDevice = assertTicketDeviceResolution({ shopId: "shop-a", fingerprint: "pos-aaaa-1111", device: null });
    expect(noShop.ok).toBe(false);
    expect(noFp.ok).toBe(false);
    expect(noDevice.ok).toBe(false);
    if (!noShop.ok) expect(noShop.error).toBe("shop_unavailable");
    if (!noFp.ok) expect(noFp.error).toBe("device_fingerprint_missing");
    if (!noDevice.ok) expect(noDevice.error).toBe("device_not_found");
  });

  it("fails closed on shop or fingerprint mismatch", () => {
    const shopMismatch = assertTicketDeviceResolution({
      shopId: "shop-a",
      fingerprint: "pos-aaaa-1111",
      device: device({ shop_id: "shop-b" }),
    });
    const fpMismatch = assertTicketDeviceResolution({
      shopId: "shop-a",
      fingerprint: "pos-aaaa-1111",
      device: device({ device_fingerprint: "pos-bbbb-2222" }),
    });
    expect(shopMismatch.ok).toBe(false);
    expect(fpMismatch.ok).toBe(false);
    if (!shopMismatch.ok) expect(shopMismatch.error).toBe("device_shop_mismatch");
    if (!fpMismatch.ok) expect(fpMismatch.error).toBe("device_not_found");
  });

  it("fails closed when the POS is not eligible", () => {
    const web = assertTicketDeviceResolution({
      shopId: "shop-a",
      fingerprint: "pos-aaaa-1111",
      device: device({ platform: "web" }),
      nowMs: now,
    });
    const inactive = assertTicketDeviceResolution({
      shopId: "shop-a",
      fingerprint: "pos-aaaa-1111",
      device: device({ is_active: false, status: "disconnected" }),
      nowMs: now,
    });
    expect(web.ok).toBe(false);
    expect(inactive.ok).toBe(false);
    if (!web.ok) expect(web.error).toBe("device_not_eligible");
    if (!inactive.ok) expect(inactive.error).toBe("device_not_eligible");
  });

  it("passes supportRequestId through the start payload", () => {
    expect(
      ticketRemoteSupportPayload({
        shopId: "shop-a",
        shopDeviceId: "dev-a",
        supportRequestId: "ticket-a",
        reasonCode: "printer",
        reasonText: "Printer is not working",
      }),
    ).toEqual({
      shopId: "shop-a",
      shopDeviceId: "dev-a",
      supportRequestId: "ticket-a",
      reasonCode: "printer",
      reasonText: "Printer is not working",
    });
    expect(
      ticketRemoteSupportPayload({
        shopId: "shop-a",
        shopDeviceId: "dev-a",
        supportRequestId: "",
        reasonCode: "other",
        reasonText: "Manual connect",
      }).supportRequestId,
    ).toBeNull();
  });

  it("maps POS ticket categories to existing Remote Support reasons", () => {
    expect(mapTicketIssueToReason("printer")).toBe("printer");
    expect(mapTicketIssueToReason("network")).toBe("sync");
    expect(mapTicketIssueToReason("scanner")).toBe("hardware");
    expect(mapTicketIssueToReason("waka_pos")).toBe("software");
    expect(mapTicketIssueToReason("other")).toBe("other");
  });
});
