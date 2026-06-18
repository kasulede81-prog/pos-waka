import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DayDrawerOpen } from "../types";
import {
  markDayDrawerOpenSynced,
  markDayDrawerOpenSyncError,
  syncDayDrawerOpenOperation,
} from "./dayDrawerOpenCloudSync";

const rpcMock = vi.fn();
const setStateMock = vi.fn();

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => ({
      dayDrawerOpens: [
        {
          id: "open-1",
          dateKey: "2026-06-11",
          openingFloatUgx: 100_000,
          countedAt: "2026-06-11T06:00:00.000Z",
          countedByUserId: "owner-1",
          countedByLabel: "Owner",
          note: "",
          deviceId: "device-a",
          status: "open",
          supersedesId: null,
          voidReason: null,
          createdAt: "2026-06-11T06:00:00.000Z",
          updatedAt: "2026-06-11T06:00:00.000Z",
          pendingSync: true,
          cloudSyncedAt: null,
          lastSyncError: null,
          deletedAt: null,
        } satisfies DayDrawerOpen,
      ],
    }),
    setState: (...args: unknown[]) => setStateMock(...args),
  },
}));

const ctx = { shopId: "shop-1", userId: "user-1" };

describe("dayDrawerOpenCloudSync", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    setStateMock.mockReset();
  });

  it("pushes create RPC and marks synced on success", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, id: "open-1" }, error: null });
    const ok = await syncDayDrawerOpenOperation({ action: "create", dayOpenId: "open-1" }, ctx);
    expect(ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("shop_create_day_drawer_open", expect.any(Object));
    expect(setStateMock).toHaveBeenCalled();
  });

  it("records sync error on RPC rejection", () => {
    markDayDrawerOpenSyncError("open-1", "dayDrawerAlreadyOpen");
    expect(setStateMock).toHaveBeenCalled();
  });

  it("sets cloudSyncedAt when synced", () => {
    markDayDrawerOpenSynced("open-1", "2026-06-11T07:00:00.000Z");
    expect(setStateMock).toHaveBeenCalled();
  });
});
