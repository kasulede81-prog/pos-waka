import { describe, expect, it } from "vitest";
import { formatRemoteSupportDeviceLabel, resolveRemoteSupportStatusCardModel } from "./statusCard";
import type { RemoteSupportInbox } from "./types";

const empty: RemoteSupportInbox = { request: null, session: null };

describe("formatRemoteSupportDeviceLabel", () => {
  it("shortens long WAKA device fingerprints", () => {
    expect(formatRemoteSupportDeviceLabel("abcdefghijklmnop")).toBe("abcdefgh…");
  });

  it("does not invent a RustDesk id", () => {
    expect(formatRemoteSupportDeviceLabel("")).toBeNull();
  });
});

describe("resolveRemoteSupportStatusCardModel", () => {
  it("stays idle when there is no control-plane request", () => {
    const model = resolveRemoteSupportStatusCardModel({
      inbox: empty,
      uiPhase: "unavailable",
      deviceId: "device-aaaa-1111",
      electronDesktop: true,
    });
    expect(model.headlineKey).toBe("remoteSupportStatusIdle");
    expect(model.tone).toBe("idle");
  });

  it("shows a pending technician request without starting transport", () => {
    const model = resolveRemoteSupportStatusCardModel({
      inbox: {
        request: {
          id: "req-1",
          shop_id: "shop-1",
          shop_device_id: "dev-1",
          device_fingerprint: "device-aaaa-1111",
          technician_admin_id: "admin-1",
          technician_user_id: null,
          technician_name: "WAKA",
          reason_code: "printer",
          reason_text: "printer jam",
          status: "requested",
          requested_at: "2026-08-20T00:00:00.000Z",
          expires_at: "2026-08-20T00:05:00.000Z",
          customer_responded_at: null,
          customer_actor_type: null,
          customer_actor_id: null,
          support_request_id: "ticket-1",
        },
        session: null,
      },
      uiPhase: "requested",
      deviceId: "device-aaaa-1111",
      electronDesktop: true,
    });
    expect(model.headlineKey).toBe("remoteSupportStatusRequested");
    expect(model.tone).toBe("warning");
  });

  it("explains web POS cannot run native transport", () => {
    const model = resolveRemoteSupportStatusCardModel({
      inbox: empty,
      uiPhase: "unavailable",
      deviceId: "web-device",
      electronDesktop: false,
    });
    expect(model.detailKey).toBe("remoteSupportStatusIdleWebDetail");
  });
});
