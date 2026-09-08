import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReturnRecord, SyncOperation } from "../types";
import { readLastBlockedReturnProbe, resetBlockedReturnRecoveryForTests } from "../lib/blockedReturnRecovery";
import { usePosStore } from "../store/usePosStore";

const getSessionMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

vi.mock("../lib/organizationDeletionState", () => ({
  assertOrganizationOperationsAllowed: async () => undefined,
}));

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const RETURN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function op(): SyncOperation {
  return {
    id: "op-pending_returns",
    kind: "pending_returns",
    payload: { returnId: RETURN_ID, saleId: SALE_ID },
    createdAt: "2026-09-07T22:43:57.603Z",
    attempts: 48,
    lastAttemptAt: "2026-09-08T06:08:30.953Z",
    shopId: SHOP_ID,
    lastError: "refund_exceeds_remaining",
  };
}

describe("blocked return probe authentication", () => {
  beforeEach(() => {
    resetBlockedReturnRecoveryForTests();
    rpcMock.mockReset();
    fromMock.mockReset();
    getSessionMock.mockReset();
    usePosStore.setState({
      returnRecords: [
        {
          id: RETURN_ID,
          saleId: SALE_ID,
          productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          productName: "Soap",
          quantity: 2,
          refundAmountUgx: 2000,
          reason: "warm_bad",
          actorUserId: SHOP_ID,
          createdAt: "2026-09-07T22:43:57.603Z",
        } satisfies ReturnRecord,
      ],
    });
  });

  it("stops without SELECT or RPC when there is no session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const { probeBlockedReturnRecovery } = await import("./cloudSync");
    expect(await probeBlockedReturnRecovery(op())).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(readLastBlockedReturnProbe()).toMatchObject({
      ok: false,
      blocker: "not_authenticated",
    });
  });
});
