import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

describe("acceptStaffInviteToken rpc guard", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("returns structured error when rpc throws", async () => {
    rpcMock.mockRejectedValueOnce(new Error("rpc_rejected"));
    const { acceptStaffInviteToken } = await import("./staffInvite");
    await expect(acceptStaffInviteToken("token-1")).resolves.toEqual({
      ok: false,
      error: "rpc_rejected",
    });
  });
});
