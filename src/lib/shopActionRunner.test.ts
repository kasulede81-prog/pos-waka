import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { executeShopAction } from "./shopActionRunner";

describe("executeShopAction", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      confirm: vi.fn(() => true),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks when permission denied", async () => {
    const onError = vi.fn();
    const result = await executeShopAction(
      { permitted: false, onError, permissionDeniedMessage: "denied" },
      async () => ({ ok: true }),
    );
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("denied");
  });

  it("runs mutation, calls onSuccess and refresh", async () => {
    const setBusy = vi.fn();
    const onSuccess = vi.fn();
    const refresh = vi.fn(async () => {});

    const result = await executeShopAction(
      { setBusy, onSuccess, refresh, audit: { action: "customer.add" } },
      async () => ({ ok: true, message: "saved" }),
    );

    expect(result.ok).toBe(true);
    expect(setBusy).toHaveBeenCalledWith(true);
    expect(setBusy).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalledWith("saved");
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces RPC failures via onError", async () => {
    const onError = vi.fn();
    const result = await executeShopAction({ onError, audit: { action: "customer.debt_payment" } }, async () => ({
      ok: false,
      errorKey: "noActiveShift",
    }));
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("noActiveShift");
  });

  it("catches thrown errors", async () => {
    const onError = vi.fn();
    const result = await executeShopAction({ onError }, async () => {
      throw new Error("boom");
    });
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("boom");
  });
});
