import { describe, expect, it } from "vitest";
import { canRemoteSupport } from "../../components/internal-admin/v2/adminRoles";
import {
  canApproveRemoteSupportRequest,
  canCustomerActOnRequest,
  canCustomerSeeRemoteSupportInbox,
} from "./deviceBinding";
import { evaluateRemoteSupportEligibility, isRemoteSupportEligible } from "./eligibility";
import { assertRemoteSupportGrant, consumeRemoteSupportGrant } from "./grant";
import { canTransitionRequest, canTransitionSession } from "./stateMachine";
import type { RemoteSupportEligibilityDevice } from "./eligibility";
import type { RemoteSupportGrantRecord } from "./grant";

const now = Date.parse("2026-08-15T12:00:00.000Z");

function device(partial: Partial<RemoteSupportEligibilityDevice> = {}): RemoteSupportEligibilityDevice {
  return {
    platform: "windows",
    last_seen_at: new Date(now - 60_000).toISOString(),
    is_active: true,
    status: "active",
    approval_status: "approved",
    ...partial,
  };
}

describe("isRemoteSupportEligible", () => {
  it("allows active + approved + Windows + recent", () => {
    expect(isRemoteSupportEligible(device(), now)).toBe(true);
  });

  it("denies inactive", () => {
    expect(evaluateRemoteSupportEligibility(device({ is_active: false, status: "disconnected" }), now).reason).toBe(
      "inactive",
    );
  });

  it("denies revoked", () => {
    expect(evaluateRemoteSupportEligibility(device({ status: "revoked", is_active: false }), now).reason).toBe("revoked");
  });

  it("denies pending approval", () => {
    expect(evaluateRemoteSupportEligibility(device({ approval_status: "pending" }), now).reason).toBe("not_approved");
  });

  it("denies stale heartbeat", () => {
    expect(
      evaluateRemoteSupportEligibility(device({ last_seen_at: new Date(now - 20 * 60_000).toISOString() }), now).reason,
    ).toBe("stale_heartbeat");
  });

  it("denies unsupported platform", () => {
    expect(evaluateRemoteSupportEligibility(device({ platform: "web" }), now).reason).toBe("unsupported_platform");
    expect(evaluateRemoteSupportEligibility(device({ platform: "android" }), now).reason).toBe("unsupported_platform");
  });
});

describe("request/session transitions", () => {
  it("allows REQUESTED → APPROVED / DECLINED / CANCELLED / EXPIRED", () => {
    expect(canTransitionRequest("requested", "approved")).toBe(true);
    expect(canTransitionRequest("requested", "declined")).toBe(true);
    expect(canTransitionRequest("requested", "cancelled")).toBe(true);
    expect(canTransitionRequest("requested", "expired")).toBe(true);
  });

  it("allows APPROVED session → ENDED / REVOKED", () => {
    expect(canTransitionSession("connecting", "ended")).toBe(true);
    expect(canTransitionSession("connecting", "revoked")).toBe(true);
    expect(canTransitionSession("active", "ended")).toBe(true);
    expect(canTransitionSession("active", "revoked")).toBe(true);
  });

  it("rejects illegal approvals", () => {
    expect(canTransitionRequest("declined", "approved")).toBe(false);
    expect(canTransitionRequest("expired", "approved")).toBe(false);
    expect(canTransitionRequest("cancelled", "approved")).toBe(false);
    expect(canTransitionSession("ended", "connecting")).toBe(false);
    expect(canTransitionSession("revoked", "active")).toBe(false);
    expect(canTransitionSession("ended", "active")).toBe(false);
  });
});

describe("device binding", () => {
  const request = {
    shop_id: "shop-1",
    device_fingerprint: "device-aaaa-1111",
    status: "requested",
    expires_at: new Date(now + 60_000).toISOString(),
  };

  it("allows approval from device A for a request targeting A", () => {
    expect(canCustomerActOnRequest(request, "device-aaaa-1111", now)).toEqual({ ok: true });
  });

  it("rejects approval from device B", () => {
    expect(canCustomerActOnRequest(request, "device-bbbb-2222", now)).toEqual({
      ok: false,
      error: "device_mismatch",
    });
  });

  it("does not treat shop membership as sufficient", () => {
    expect(canCustomerActOnRequest(request, "device-aaaa-1111-other", now).ok).toBe(false);
  });
});

describe("grant assert", () => {
  const record: RemoteSupportGrantRecord = {
    session_id: "sess-1",
    shop_device_id: "dev-1",
    device_fingerprint: "device-aaaa-1111",
    grant_jti: "grant-1",
    grant_expires_at: new Date(now + 60_000).toISOString(),
    grant_consumed_at: null,
    session_status: "connecting",
  };
  const input = {
    sessionId: "sess-1",
    grantJti: "grant-1",
    deviceFingerprint: "device-aaaa-1111",
    shopDeviceId: "dev-1",
  };

  it("accepts a valid grant", () => {
    expect(assertRemoteSupportGrant(record, input, now)).toEqual({ ok: true });
  });

  it("rejects an expired grant", () => {
    expect(
      assertRemoteSupportGrant({ ...record, grant_expires_at: new Date(now - 1).toISOString() }, input, now),
    ).toEqual({ ok: false, error: "grant_expired" });
  });

  it("rejects the wrong device", () => {
    expect(assertRemoteSupportGrant(record, { ...input, deviceFingerprint: "device-bbbb-2222" }, now)).toEqual({
      ok: false,
      error: "grant_device_mismatch",
    });
  });

  it("rejects the wrong session", () => {
    expect(assertRemoteSupportGrant(record, { ...input, sessionId: "sess-other" }, now)).toEqual({
      ok: false,
      error: "grant_session_mismatch",
    });
  });

  it("rejects a replayed grant", () => {
    const first = consumeRemoteSupportGrant(record, input, now, device({ shop_id: "shop-1" }));
    expect(first.ok).toBe(true);
    expect(
      assertRemoteSupportGrant(
        { ...record, grant_consumed_at: first.ok ? first.consumedAt! : now.toString() },
        input,
        now,
        device({ shop_id: "shop-1" }),
      ),
    ).toEqual({ ok: false, error: "grant_replayed" });
  });

  it("accepts a valid grant only while the device remains eligible", () => {
    expect(assertRemoteSupportGrant(record, input, now, device({ shop_id: "shop-1" }))).toEqual({ ok: true });
  });

  it("rejects grant assert after the device is revoked", () => {
    expect(
      assertRemoteSupportGrant(record, input, now, device({ status: "revoked", is_active: false })),
    ).toEqual({ ok: false, error: "device_no_longer_eligible" });
  });

  it("rejects grant assert after the device is disconnected", () => {
    expect(
      assertRemoteSupportGrant(record, input, now, device({ status: "disconnected", is_active: false })),
    ).toEqual({ ok: false, error: "device_no_longer_eligible" });
  });

  it("rejects grant assert after the device is unapproved", () => {
    expect(assertRemoteSupportGrant(record, input, now, device({ approval_status: "suspended" }))).toEqual({
      ok: false,
      error: "device_no_longer_eligible",
    });
  });

  it("rejects grant assert after the device is inactive", () => {
    expect(assertRemoteSupportGrant(record, input, now, device({ is_active: false, status: "disconnected" }))).toEqual({
      ok: false,
      error: "device_no_longer_eligible",
    });
  });
});

describe("lifecycle re-check before approve", () => {
  const request = {
    shop_id: "shop-1",
    shop_device_id: "dev-1",
    device_fingerprint: "device-aaaa-1111",
    status: "requested",
    expires_at: new Date(now + 60_000).toISOString(),
  };

  it("denies approve after the device is revoked", () => {
    expect(
      canApproveRemoteSupportRequest(request, "device-aaaa-1111", device({ shop_id: "shop-1", status: "revoked", is_active: false }), now),
    ).toEqual({ ok: false, error: "device_no_longer_eligible" });
  });

  it("denies approve after the device is disconnected", () => {
    expect(
      canApproveRemoteSupportRequest(
        request,
        "device-aaaa-1111",
        device({ shop_id: "shop-1", status: "disconnected", is_active: false }),
        now,
      ),
    ).toEqual({ ok: false, error: "device_no_longer_eligible" });
  });

  it("denies approve after the device is disabled / unapproved", () => {
    expect(
      canApproveRemoteSupportRequest(request, "device-aaaa-1111", device({ shop_id: "shop-1", approval_status: "disabled" }), now),
    ).toEqual({ ok: false, error: "device_no_longer_eligible" });
    expect(
      canApproveRemoteSupportRequest(request, "device-aaaa-1111", device({ shop_id: "shop-1", approval_status: "suspended" }), now),
    ).toEqual({ ok: false, error: "device_no_longer_eligible" });
  });

  it("allows approve only while the current device is still eligible", () => {
    expect(canApproveRemoteSupportRequest(request, "device-aaaa-1111", device({ shop_id: "shop-1" }), now)).toEqual({
      ok: true,
    });
  });
});

describe("cross-device inbox and crafted approve", () => {
  it("does not show Device A request in Device B inbox", () => {
    expect(canCustomerSeeRemoteSupportInbox("device-aaaa-1111", "device-bbbb-2222")).toBe(false);
  });

  it("shows Device A request only on Device A", () => {
    expect(canCustomerSeeRemoteSupportInbox("device-aaaa-1111", "device-aaaa-1111")).toBe(true);
  });

  it("denies Device B crafted approve of Device A request", () => {
    const request = {
      shop_id: "shop-1",
      device_fingerprint: "device-aaaa-1111",
      status: "requested",
      expires_at: new Date(now + 60_000).toISOString(),
    };
    expect(canApproveRemoteSupportRequest(request, "device-bbbb-2222", device({ shop_id: "shop-1" }), now)).toEqual({
      ok: false,
      error: "device_mismatch",
    });
  });
});

describe("Remote Support role visibility", () => {
  it("allows only support_admin and super_admin", () => {
    expect(canRemoteSupport("support_admin")).toBe(true);
    expect(canRemoteSupport("super_admin")).toBe(true);
    expect(canRemoteSupport("operations_admin")).toBe(false);
    expect(canRemoteSupport("field_agent")).toBe(false);
    expect(canRemoteSupport("finance_admin")).toBe(false);
  });
});

describe("customer inbox data minimization", () => {
  it("does not require grant_jti on the POS inbox session", () => {
    const inboxSession = {
      id: "sess-1",
      request_id: "req-1",
      shop_id: "shop-1",
      shop_device_id: "dev-1",
      technician_admin_id: "",
      technician_name: "WAKA Support",
      status: "connecting" as const,
      approved_at: new Date(now).toISOString(),
      started_at: null,
      ended_at: null,
      duration_seconds: null,
      ended_by: null,
      failure_reason: null,
    };
    expect(inboxSession).not.toHaveProperty("grant_jti");
  });
});
