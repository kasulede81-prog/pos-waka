import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  classifyActivationError,
  classifyApprovalRpcError,
  normalizeFailureKind,
} from "./deviceActivationDiagnostics";
import {
  resolveActivationBlockKind,
  resolveLoginDeviceActivation,
} from "./deviceActivation";
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

const freeSlotContext = {
  shop_id: "s1",
  plan_code: "business",
  plan_name: "Business",
  device_limit: 4,
  active_count: 2,
  is_owner: true,
  at_limit: false,
  devices: [],
};

const staffContext = { ...freeSlotContext, is_owner: false };

vi.mock("./supabase", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

describe("deviceActivationDiagnostics", () => {
  it("classifies email and fingerprint RPC errors", () => {
    expect(classifyActivationError(new Error("email_not_verified"))).toBe("email_not_verified");
    expect(classifyActivationError(new Error("Invalid device fingerprint"))).toBe(
      "invalid_device_fingerprint",
    );
    expect(classifyApprovalRpcError("approval_expired")).toBe("approval_expired");
    expect(classifyApprovalRpcError("device_limit_reached")).toBe("device_limit_reached");
  });

  it("normalizes enterprise failure aliases", () => {
    expect(normalizeFailureKind("device_limit_reached")).toBe("limit_reached");
    expect(normalizeFailureKind("network_error")).toBe("network");
  });
});

describe("resolveActivationBlockKind", () => {
  it("returns limit when server blocked by register RPC", () => {
    expect(
      resolveActivationBlockKind({
        result: { ok: false, activated: false, limit_blocked: true },
        context: null,
        currentDevice: null,
      }),
    ).toBe("limit");
  });

  it("returns connection for unexpected owner failures", () => {
    expect(
      resolveActivationBlockKind({
        result: { ok: false, activated: false },
        context: freeSlotContext,
        currentDevice: null,
        failureReason: "activation_failed",
      }),
    ).toBe("connection");
  });

  it("returns pending for staff pending device rows", () => {
    expect(
      resolveActivationBlockKind({
        result: { ok: false, activated: false, pending_approval: true, approval_status: "pending" },
        context: staffContext,
        currentDevice: baseDevice,
      }),
    ).toBe("pending");
  });

  it("returns connection for owner pending (server should auto-enroll)", () => {
    expect(
      resolveActivationBlockKind({
        result: { ok: true, activated: false, pending_approval: true, approval_status: "pending" },
        context: freeSlotContext,
        currentDevice: baseDevice,
      }),
    ).toBe("pending");
  });

  it("returns connection for network failures", () => {
    expect(
      resolveActivationBlockKind({
        result: { ok: false, activated: false },
        context: freeSlotContext,
        currentDevice: null,
        failureReason: "network_error",
      }),
    ).toBe("connection");
  });

  it("returns revoked for revoked devices", () => {
    expect(
      resolveActivationBlockKind({
        result: { ok: false, activated: false, revoked: true },
        context: freeSlotContext,
        currentDevice: null,
        failureReason: "device_revoked",
      }),
    ).toBe("revoked");
  });
});

describe("resolveLoginDeviceActivation — owner-first (Phase 20.6)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockReset();
  });

  async function mockRpcSequence(calls: Array<{ fn: string; data: unknown; error?: Error | null }>) {
    const { supabase } = await import("./supabase");
    let i = 0;
    vi.mocked(supabase!.rpc).mockImplementation((async (fn: string) => {
      const entry = calls[i] ?? calls[calls.length - 1];
      i += 1;
      if (entry.fn !== fn) {
        return { data: null, error: new Error(`unexpected rpc ${fn}`) };
      }
      return { data: entry.data, error: entry.error ?? null };
    }) as never);
  }

  it("owner login on first device — activated immediately", async () => {
    await mockRpcSequence([
      {
        fn: "shop_device_limit_context",
        data: { shop_id: "s1", is_owner: true, at_limit: false, device_limit: 4, active_count: 0, devices: [] },
      },
      {
        fn: "shop_device_register_on_login",
        data: {
          ok: true,
          activated: true,
          approval_status: "approved",
          status: "active",
          owner_enrolled: true,
        },
      },
    ]);
    const outcome = await resolveLoginDeviceActivation("s1");
    expect(outcome.activated).toBe(true);
    expect(outcome.isOwner).toBe(true);
  });

  it("owner login on second device with free slot — activated immediately", async () => {
    await mockRpcSequence([
      {
        fn: "shop_device_limit_context",
        data: { shop_id: "s1", is_owner: true, at_limit: false, device_limit: 4, active_count: 1, devices: [] },
      },
      {
        fn: "shop_device_register_on_login",
        data: {
          ok: true,
          activated: true,
          approval_status: "approved",
          status: "active",
          owner_enrolled: true,
          existing_device: false,
        },
      },
    ]);
    const outcome = await resolveLoginDeviceActivation("s1");
    expect(outcome.activated).toBe(true);
  });

  it("owner login at device limit — blocked", async () => {
    await mockRpcSequence([
      {
        fn: "shop_device_limit_context",
        data: { shop_id: "s1", is_owner: true, at_limit: true, device_limit: 2, active_count: 2, devices: [] },
      },
      {
        fn: "shop_device_register_on_login",
        data: {
          ok: false,
          activated: false,
          limit_blocked: true,
          device_limit: 2,
          active_count: 2,
        },
      },
    ]);
    const outcome = await resolveLoginDeviceActivation("s1");
    expect(outcome.activated).toBe(false);
    expect(outcome.failureReason).toBe("device_limit_reached");
  });

  it("staff login on approved device — activated", async () => {
    await mockRpcSequence([
      {
        fn: "shop_device_limit_context",
        data: { shop_id: "s1", is_owner: false, at_limit: false, device_limit: 4, active_count: 1, devices: [] },
      },
      {
        fn: "shop_device_register_on_login",
        data: { ok: true, activated: true, approval_status: "approved", status: "active", existing_device: true },
      },
    ]);
    const outcome = await resolveLoginDeviceActivation("s1");
    expect(outcome.activated).toBe(true);
    expect(outcome.isOwner).toBe(false);
  });

  it("staff login on pending device — blocked pending", async () => {
    await mockRpcSequence([
      {
        fn: "shop_device_limit_context",
        data: { shop_id: "s1", is_owner: false, at_limit: false, device_limit: 4, active_count: 1, devices: [] },
      },
      {
        fn: "shop_device_register_on_login",
        data: {
          ok: true,
          activated: false,
          pending_approval: true,
          approval_status: "pending",
          status: "disconnected",
        },
      },
    ]);
    const outcome = await resolveLoginDeviceActivation("s1");
    expect(outcome.activated).toBe(false);
    expect(outcome.failureReason).toBe("device_pending");
  });

  it("web owner login uses single register RPC (same path as android)", async () => {
    await mockRpcSequence([
      {
        fn: "shop_device_limit_context",
        data: { shop_id: "s1", is_owner: true, at_limit: false, device_limit: 4, active_count: 0, devices: [] },
      },
      {
        fn: "shop_device_register_on_login",
        data: { ok: true, activated: true, approval_status: "approved", status: "active" },
      },
    ]);
    const outcome = await resolveLoginDeviceActivation("s1");
    expect(outcome.activated).toBe(true);
    const { supabase } = await import("./supabase");
    const registerCalls = vi.mocked(supabase!.rpc).mock.calls.filter(
      (c) => c[0] === "shop_device_register_on_login",
    );
    expect(registerCalls).toHaveLength(1);
  });
});
