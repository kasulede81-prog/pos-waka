import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { executeInternalAdminAction, notifyInternalOpsChanged } from "./internalAdminActionRunner";

vi.mock("./rescueSupportActions", () => ({
  logInternalAdminAudit: vi.fn(async () => ({ ok: true })),
}));

import { logInternalAdminAudit } from "./rescueSupportActions";

describe("executeInternalAdminAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      confirm: vi.fn(() => true),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks mutations in preview mode", async () => {
    const onError = vi.fn();
    const result = await executeInternalAdminAction(
      { previewMode: true, onError, audit: { action: "test_action" } },
      async () => ({ ok: true }),
    );
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalled();
    expect(logInternalAdminAudit).not.toHaveBeenCalled();
  });

  it("blocks when permission denied", async () => {
    const onError = vi.fn();
    const result = await executeInternalAdminAction(
      { previewMode: false, permitted: false, onError, audit: { action: "test_action" } },
      async () => ({ ok: true }),
    );
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalled();
  });

  it("runs RPC, audits success, refreshes, and notifies", async () => {
    const setBusy = vi.fn();
    const onSuccess = vi.fn();
    const refresh = vi.fn(async () => {});
    const dispatch = vi.spyOn(window, "dispatchEvent");

    const result = await executeInternalAdminAction(
      {
        previewMode: false,
        setBusy,
        onSuccess,
        refresh,
        audit: { action: "admin_force_sync", shopId: "shop-1" },
      },
      async () => ({ ok: true, message: "done" }),
    );

    expect(result.ok).toBe(true);
    expect(setBusy).toHaveBeenCalledWith(true);
    expect(setBusy).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalledWith("done");
    expect(refresh).toHaveBeenCalled();
    expect(logInternalAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin_force_sync", result: "ok", shopId: "shop-1" }),
    );
    expect(dispatch).toHaveBeenCalled();
  });

  it("audits and surfaces RPC failures", async () => {
    const onError = vi.fn();
    const result = await executeInternalAdminAction(
      {
        previewMode: false,
        onError,
        audit: { action: "admin_suspend_shop", shopId: "shop-2" },
      },
      async () => ({ ok: false, message: "rpc_failed" }),
    );
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("rpc_failed");
    expect(logInternalAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin_suspend_shop", result: "failed", reason: "rpc_failed" }),
    );
  });

  it("audits thrown errors", async () => {
    const onError = vi.fn();
    const result = await executeInternalAdminAction(
      { previewMode: false, onError, audit: { action: "admin_test_throw" } },
      async () => {
        throw new Error("boom");
      },
    );
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("boom");
    expect(logInternalAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin_test_throw", result: "failed", reason: "boom" }),
    );
  });
});

describe("notifyInternalOpsChanged", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches refresh events", () => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    notifyInternalOpsChanged();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "waka:internal-ops-changed" }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "waka:subscription-updated" }));
  });
});
